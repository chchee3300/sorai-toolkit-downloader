// JS guest bindings for this repo's Tauri plugin (plugin/). One wrapper per
// Rust command; argument keys are the Rust parameter names in camelCase.
import { invoke, Channel } from '@tauri-apps/api/core'

export const ping = (value) => invoke('plugin:sorai-downloader|ping', { value })

// yt-dlp -j metadata, parsed in Rust (plugin/src/metadata.rs): { title,
// thumbnail, duration, channel, videoFormats, audioFormats, combinedFormats,
// previewUrl, bestVideoFormatId, bestAudioFormatId, bestCombinedFormatId }.
// Rejects with yt-dlp's stderr text.
export const fetchMetadata = (url) => invoke('plugin:sorai-downloader|fetch_metadata', { url })

// Starts one yt-dlp download (args built in Rust, plugin/src/download.rs)
// from a queue item's settings: { url, outputDir, mode, videoFormatId,
// audioFormatId, combinedFormatId, includeVideo, includeAudio, autoMerge,
// clipStart, clipEnd }. Resolves to a job id; onEvent gets
// { event: 'progress', percent, eta, speed } | { event: 'log', line } and
// exactly one { event: 'finished', ok, cancelled, error }.
export const startDownload = (job, onEvent) => {
  const channel = new Channel()
  channel.onmessage = onEvent
  return invoke('plugin:sorai-downloader|start_download', { job, onEvent: channel })
}

// Kills the job's whole process tree; its 'finished' (cancelled) follows
// within a few seconds even if the process never reports its exit.
export const cancelDownload = (jobId) => invoke('plugin:sorai-downloader|cancel_download', { jobId })
