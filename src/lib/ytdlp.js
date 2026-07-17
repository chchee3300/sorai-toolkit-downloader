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

// vcodec/acodec classification follows yt-dlp's OWN convention, not an
// "absent means none" assumption: a format lacks a stream ONLY when yt-dlp
// explicitly says so with the literal string 'none'. A missing/undefined
// field means "unknown, assume present" -- yt-dlp's own bestvideo+bestaudio
// selector logic works the same way. This matters a lot in practice:
// verified against real yt-dlp -j output, Twitch clips never populate
// vcodec/acodec on ANY format (they're single pre-muxed HLS renditions,
// confirmed by having neither key at all) -- treating that as "no video AND
// no audio" the old `f.vcodec || 'none'` fallback did silently threw away
// every single format Twitch offers. Twitter/X formats are more mixed: HLS
// audio-only entries set vcodec:'none' explicitly but omit acodec entirely,
// and there are also genuine combined progressive ("http-*") formats with
// neither key set alongside separate hls video-only/hls-audio-only ones.
const isNone = (v) => v === 'none'
const hasVideo = (f) => !isNone(f.vcodec)
const hasAudio = (f) => !isNone(f.acodec)

// Storyboards (vcodec+acodec both explicitly "none") and mhtml containers
// are yt-dlp housekeeping entries, not real download candidates. webm is
// excluded site-wide per product decision (avoids a third container family
// showing up across the pickers).
const isStoryboard = (f) => (isNone(f.vcodec) && isNone(f.acodec)) || f.ext === 'mhtml'
const isWebm = (f) => f.ext === 'webm'
// Twitch-specific: clips recorded/cropped for mobile also get a
// "portrait-<height>" format_id alongside the regular "<height>" one at the
// same tier (verified against real yt-dlp -j output) -- a redundant
// vertical-crop duplicate of the same landscape clip, not a distinct
// quality option, so drop it rather than clutter the picker with look-alike
// entries at the same height.
const isPortraitVariant = (f) => /^portrait-/i.test(f.formatId)
const isVideoOnly = (f) => hasVideo(f) && !hasAudio(f)
const isAudioOnly = (f) => hasAudio(f) && !hasVideo(f)
// Neither field explicitly excludes its stream -- e.g. Twitch's HLS
// renditions, Twitter's "http-*" progressive formats -- so treat it as
// already-muxed: one format, no merge needed. Not the same as "unknown";
// see the block comment above for why undefined defaults to "present".
const isCombined = (f) => hasVideo(f) && hasAudio(f)

// Picks a single progressive (already-muxed) stream to feed a <video> tag
// for ClipModal's preview player -- must come from the RAW data.formats
// (parseMetadataJson's `mapped` array drops `url` entirely, since normal
// download flow only ever needs a format_id for yt-dlp's own -f selector).
// Only http(s) direct file URLs work here: m3u8/dash manifests aren't
// something a bare <video src> can play, and mhtml is a storyboard, not
// video. Prefers mp4 near 480p (small enough to load fast, big enough to
// judge a crop by) over other mp4s over any other combined format; returns
// null when nothing qualifies so callers fall back to the thumbnail+timeline
// degraded mode.
export function pickPreviewUrl(rawFormats) {
  const candidates = (rawFormats || []).filter((f) =>
    typeof f.url === 'string' &&
    /^https?:\/\//i.test(f.url) &&
    f.vcodec && f.vcodec !== 'none' &&
    f.acodec && f.acodec !== 'none' &&
    f.ext !== 'mhtml' &&
    (f.protocol === 'https' || f.protocol === 'http'),
  )
  if (candidates.length === 0) return null

  const tier = (f) => {
    if (f.ext === 'mp4') return typeof f.height === 'number' ? 0 : 1
    return 2
  }
  const sorted = [...candidates].sort((a, b) => {
    const ta = tier(a)
    const tb = tier(b)
    if (ta !== tb) return ta - tb
    if (ta === 0) return Math.abs((a.height || 0) - 480) - Math.abs((b.height || 0) - 480)
    return (a.height || 0) - (b.height || 0)
  })
  return sorted[0].url
}

export function parseMetadataJson(text) {
  const data = JSON.parse(text.trim())
  const mapped = (data.formats || [])
    .filter((f) => f.format_id)
    .map((f) => ({
      formatId: f.format_id,
      ext: f.ext || '',
      height: typeof f.height === 'number' ? f.height : null,
      abr: typeof f.abr === 'number' ? f.abr : (typeof f.tbr === 'number' ? f.tbr : null),
      vcodec: f.vcodec ?? null,
      acodec: f.acodec ?? null,
      filesize: f.filesize || f.filesize_approx || null,
    }))
    .filter((f) => !isStoryboard(f) && !isWebm(f) && !isPortraitVariant(f))

  const videoFormats = mapped.filter(isVideoOnly)
  const audioFormats = mapped.filter(isAudioOnly)
  // Only surfaced when there's nothing else to offer (see useDownloader.js's
  // mode selection) -- when real separate streams exist (YouTube, and often
  // Twitter/X) those give better quality control and stay the default UX;
  // combined formats are the fallback for sources that never split streams
  // at all (Twitch).
  const combinedFormats = mapped.filter(isCombined)

  return {
    title: data.title || 'Untitled',
    thumbnail: data.thumbnail || null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    channel: data.channel || data.uploader || null,
    videoFormats,
    audioFormats,
    combinedFormats,
    previewUrl: pickPreviewUrl(data.formats),
  }
}

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

export function bestCombinedFormatId(combinedFormats) {
  if (!combinedFormats.length) return ''
  const sorted = [...combinedFormats].sort(
    (a, b) => (b.height || 0) - (a.height || 0) || (b.filesize || 0) - (a.filesize || 0),
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
