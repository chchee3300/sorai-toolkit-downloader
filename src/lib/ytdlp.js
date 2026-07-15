// Pure command-building + output-parsing helpers for yt-dlp -- this
// repo's own business logic (analogous to sorai-toolkit-converter's
// ffmpeg-commands.js/progress-parser.js), not a shared runtime global.
// ytdlpPath/ffmpegPath themselves come from the host's platform.js
// (window.EstellaLib.platform) since binary *location* is cross-tool infra,
// but *how yt-dlp is invoked* is this tool's own concern.

// One JSON call gets title/thumbnail/duration/formats together -- avoids a
// second `-F` call that would mean re-parsing yt-dlp's human-readable
// table instead of structured JSON. --no-playlist: playlist URLs are
// treated as "first video only" for v1 (known limitation, not solved now).
export function buildMetadataCommand({ ytdlpPath, url }) {
  return `"${ytdlpPath}" -j --no-playlist "${url}"`
}

// Storyboards (vcodec+acodec both "none") and mhtml containers are yt-dlp
// housekeeping entries, not real download candidates. webm is excluded
// site-wide per product decision (avoids a third container family showing
// up across the two pickers). Pre-muxed combined formats (both vcodec and
// acodec real) are excluded too -- the two dropdowns only ever offer
// separate streams, since the UI always builds its own video+audio selector.
const isStoryboard = (f) => (f.vcodec === 'none' && f.acodec === 'none') || f.ext === 'mhtml'
const isWebm = (f) => f.ext === 'webm'
const isVideoOnly = (f) => f.vcodec !== 'none' && f.acodec === 'none'
const isAudioOnly = (f) => f.acodec !== 'none' && f.vcodec === 'none'

export function parseMetadataJson(text) {
  const data = JSON.parse(text.trim())
  const mapped = (data.formats || [])
    .filter((f) => f.format_id)
    .map((f) => ({
      formatId: f.format_id,
      ext: f.ext || '',
      height: typeof f.height === 'number' ? f.height : null,
      abr: typeof f.abr === 'number' ? f.abr : (typeof f.tbr === 'number' ? f.tbr : null),
      vcodec: f.vcodec || 'none',
      acodec: f.acodec || 'none',
      filesize: f.filesize || f.filesize_approx || null,
    }))

  const videoFormats = mapped.filter((f) => isVideoOnly(f) && !isStoryboard(f) && !isWebm(f))
  const audioFormats = mapped.filter((f) => isAudioOnly(f) && !isStoryboard(f) && !isWebm(f))

  return {
    title: data.title || 'Untitled',
    thumbnail: data.thumbnail || null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    videoFormats,
    audioFormats,
  }
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

// Best-quality default: sort explicitly by the numeric quality field rather
// than trusting yt-dlp's implicit worst-to-best JSON ordering, since that
// ordering is undocumented and we already have the numeric fields on hand.
// filesize is a tiebreaker proxy for "less compressed" at the same tier.
export function bestVideoFormatId(videoFormats) {
  if (!videoFormats.length) return ''
  const sorted = [...videoFormats].sort(
    (a, b) => (b.height || 0) - (a.height || 0) || (b.filesize || 0) - (a.filesize || 0),
  )
  return sorted[0].formatId
}

export function bestAudioFormatId(audioFormats) {
  if (!audioFormats.length) return ''
  const sorted = [...audioFormats].sort(
    (a, b) => (b.abr || 0) - (a.abr || 0) || (b.filesize || 0) - (a.filesize || 0),
  )
  return sorted[0].formatId
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
  return {
    percent: parseFloat(match[1]),
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
export function buildDownloadCommand({ ytdlpPath, ffmpegPath, url, formatSelector, outputDir, mergeToMp4, noMergeSelector }) {
  const parts = [
    `"${ytdlpPath}"`,
    `-f "${formatSelector}"`,
    '--no-playlist',
    `--ffmpeg-location "${ffmpegPath}"`,
    mergeToMp4 ? '--merge-output-format mp4' : null,
    `-P "${outputDir}"`,
    noMergeSelector ? `-o "%(title)s [%(format_id)s].%(ext)s"` : null,
    '--newline',
    '--no-colors',
    `--progress-template "${buildProgressTemplateArg()}"`,
    `"${url}"`,
  ]
  return parts.filter(Boolean).join(' ')
}
