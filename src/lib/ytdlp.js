// Display-only yt-dlp helpers (platform badge, size/duration/quality labels).
// Metadata fetch/parsing (format classification, preview URL, best-format
// defaults) lives in Rust: plugin/src/metadata.rs, via fetchMetadata().
// Download argv (format selector, merge, clip, progress template) and
// progress parsing too: plugin/src/download.rs, via startDownload().

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
