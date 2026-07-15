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

export function parseMetadataJson(text) {
  const data = JSON.parse(text.trim())
  const formats = (data.formats || [])
    .filter((f) => f.format_id)
    .map((f) => ({
      formatId: f.format_id,
      ext: f.ext || '',
      resolution: f.resolution || (f.vcodec === 'none' ? 'audio only' : ''),
      vcodec: f.vcodec || '',
      acodec: f.acodec || '',
      filesize: f.filesize || f.filesize_approx || null,
      note: f.format_note || '',
    }))
  return {
    title: data.title || 'Untitled',
    thumbnail: data.thumbnail || null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    formats,
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

// Label shown in the format picker: id · container · resolution/kind · size.
export function formatOptionLabel(f) {
  const isAudioOnly = f.vcodec === 'none' && f.acodec !== 'none'
  const isVideoOnly = f.acodec === 'none' && f.vcodec !== 'none'
  const kind = isAudioOnly ? 'audio only' : isVideoOnly ? 'video only (needs merge)' : 'video+audio'
  const size = formatBytes(f.filesize)
  return [f.formatId, f.ext, f.resolution, kind, size].filter(Boolean).join(' · ')
}

// yt-dlp lists formats worst-to-best; the last entry is its own idea of the
// best available for this format list, so default the picker to it.
export function defaultFormatId(formats) {
  return formats.length ? formats[formats.length - 1].formatId : ''
}

// A video-only format_id passed alone to `-f` downloads silent video --
// yt-dlp only merges audio in when the selector itself asks for it (e.g.
// "137+140"). Picking a video-only entry in the UI should still produce a
// normal video-with-audio file, so pair it with yt-dlp's own "bestaudio"
// selector here -- this is what actually exercises --ffmpeg-location's
// merge path, not just a plain single-stream download.
export function resolveFormatSelector(format) {
  const isVideoOnly = format.acodec === 'none' && format.vcodec !== 'none'
  return isVideoOnly ? `${format.formatId}+bestaudio` : format.formatId
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
export function buildDownloadCommand({ ytdlpPath, ffmpegPath, url, formatId, outputDir }) {
  return (
    `"${ytdlpPath}" -f "${formatId}" --no-playlist --ffmpeg-location "${ffmpegPath}" ` +
    `-P "${outputDir}" --newline --no-colors --progress-template "${buildProgressTemplateArg()}" "${url}"`
  )
}
