// Pure command-building + output-parsing helpers for yt-dlp -- this
// repo's own business logic (analogous to sorai-toolkit-converter's
// ffmpeg-commands.js/progress-parser.js), not a shared runtime global.
// ytdlpPath/ffmpegPath themselves come from the host's platform.js
// (window.EstellaLib.platform) since binary *location* is cross-tool infra,
// but *how yt-dlp is invoked* is this tool's own concern.

// Metadata fetch/parsing (format classification, preview URL, best-format
// defaults) lives in Rust: plugin/src/metadata.rs, via fetchMetadata().

// Detects which known platform a URL belongs to, for display purposes only
// (a small badge on the queue row) -- NOT a gate on what can be added.
// yt-dlp supports far more sites than these three; anything else falls back
// to a generic label rather than being rejected.
const PLATFORM_PATTERNS = [
  { id: 'youtube', label: 'YouTube', re: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { id: 'twitch', label: 'Twitch', re: /(^|\.)twitch\.tv$/i },
  { id: 'twitter', label: 'X', re: /(^|\.)(twitter\.com|x\.com)$/i },
]

export function detectPlatform(url) {
  try {
    const hostname = new URL(url).hostname
    const match = PLATFORM_PATTERNS.find((p) => p.re.test(hostname))
    if (match) return { id: match.id, label: match.label }
  } catch (e) {
    /* not a parseable URL yet -- fall through to generic */
  }
  return { id: 'generic', label: 'Video' }
}

export function formatBytes(n) {
  if (!n) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)}${units[i]}`
}

export function formatDuration(seconds) {
  if (seconds == null) return ''
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// Quality labels avoid format codes entirely -- just what a user actually
// cares about: resolution tier, container, size. 2K/4K/8K match the common
// consumer naming for 1440p/2160p/4320p rather than the technical DCI usage.
function videoQualityLabel(height) {
  if (height == null) return 'Unknown'
  if (height >= 4320) return '8K'
  if (height >= 2160) return '4K'
  if (height >= 1440) return '2K'
  return `${height}p`
}

export function videoFormatOptionLabel(f) {
  return [videoQualityLabel(f.height), f.ext, formatBytes(f.filesize)].filter(Boolean).join(' · ')
}

export function audioFormatOptionLabel(f) {
  const kbps = f.abr != null ? `${Math.round(f.abr)} kbps` : ''
  return [kbps, f.ext, formatBytes(f.filesize)].filter(Boolean).join(' · ')
}

// Combined (already-muxed) formats only ever carry a height reliably
// (Twitch never reports abr/tbr on them) -- same resolution-tier label as
// video-only, no separate audio line since it's one file either way.
export function combinedFormatOptionLabel(f) {
  return [videoQualityLabel(f.height), f.ext, formatBytes(f.filesize)].filter(Boolean).join(' · ')
}

// Builds the yt-dlp -f selector from independent video/audio picks. "+"
// merges the two streams (yt-dlp shells out to --ffmpeg-location's ffmpeg
// to mux them); "," downloads both as separate files with no merge step.
export function buildFormatSelector({ includeVideo, includeAudio, videoFormatId, audioFormatId, autoMerge }) {
  if (includeVideo && includeAudio) {
    return autoMerge ? `${videoFormatId}+${audioFormatId}` : `${videoFormatId},${audioFormatId}`
  }
  if (includeVideo) return videoFormatId
  if (includeAudio) return audioFormatId
  return ''
}

const PROGRESS_PREFIX = 'DLPROGRESS|'

// --progress-template's percent/eta/speed fields are yt-dlp's own display
// strings (e.g. " 42.3%", "01:23", "3.10MiB/s") -- --no-colors keeps them
// free of ANSI escapes so a plain regex can pull the fields back out,
// mirroring progress-parser.js's regex-based extraction from ffmpeg's
// stderr in sorai-toolkit-converter.
export function buildProgressTemplateArg() {
  return `download:${PROGRESS_PREFIX}%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s`
}

export function parseDownloadProgress(chunk) {
  const idx = chunk.indexOf(PROGRESS_PREFIX)
  if (idx === -1) return null
  const line = chunk.slice(idx + PROGRESS_PREFIX.length)
  const match = line.match(/^\s*([\d.]+)%\|([^|]*)\|([^\r\n]*)/)
  if (!match) return null
  const percent = parseFloat(match[1])
  // --download-sections hands the clipped range to ffmpeg for the actual
  // cut, and yt-dlp's own percent field can go missing/"N/A" during that
  // phase -- Number.isFinite screens that out so the UI just stays on
  // "Starting…" instead of rendering NaN%.
  if (!Number.isFinite(percent)) return null
  return {
    percent,
    eta: match[2].trim(),
    speed: match[3].trim(),
  }
}

// --ffmpeg-location accepts either the ffmpeg binary path itself or its
// containing directory -- the binary path (from platform.js's
// ffmpegPath()) works directly, no need to strip it down to a directory.
//
// mergeToMp4 forces the merged container to mp4 (yt-dlp's default merge
// container otherwise depends on the source formats and often lands on
// mkv). noMergeSelector marks the "v,a" comma-selector case: yt-dlp
// downloads both streams as separate files with no ffmpeg step, so an
// explicit -o template embeds the format id in each filename -- otherwise
// two same-titled outputs (e.g. same ext family) could collide, and even
// without collision the user would otherwise have no way to tell which
// file is which.
export function buildDownloadCommand({ ytdlpPath, ffmpegPath, url, formatSelector, outputDir, mergeToMp4, noMergeSelector, clipStart, clipEnd }) {
  const hasClip = typeof clipStart === 'number' && typeof clipEnd === 'number' && clipEnd > clipStart
  const parts = [
    `"${ytdlpPath}"`,
    `-f "${formatSelector}"`,
    '--no-playlist',
    `--ffmpeg-location "${ffmpegPath}"`,
    mergeToMp4 ? '--merge-output-format mp4' : null,
    // --force-keyframes-at-cuts makes ffmpeg re-encode around the cut points
    // so the range lands on exact seconds instead of the nearest keyframe --
    // slower, but the length tolerance ClipModal promises depends on it.
    hasClip ? `--download-sections "*${clipStart.toFixed(2)}-${clipEnd.toFixed(2)}"` : null,
    hasClip ? '--force-keyframes-at-cuts' : null,
    `-P "${outputDir}"`,
    noMergeSelector ? `-o "%(title)s [%(format_id)s].%(ext)s"` : null,
    '--newline',
    '--no-colors',
    `--progress-template "${buildProgressTemplateArg()}"`,
    `"${url}"`,
  ]
  return parts.filter(Boolean).join(' ')
}
