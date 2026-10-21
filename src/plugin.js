// JS guest bindings for this repo's Tauri plugin (plugin/). One wrapper per
// Rust command; argument keys are the Rust parameter names in camelCase.
import { invoke } from '@tauri-apps/api/core'

export const ping = (value) => invoke('plugin:sorai-downloader|ping', { value })

// yt-dlp -j metadata, parsed in Rust (plugin/src/metadata.rs): { title,
// thumbnail, duration, channel, videoFormats, audioFormats, combinedFormats,
// previewUrl, bestVideoFormatId, bestAudioFormatId, bestCombinedFormatId }.
// Rejects with yt-dlp's stderr text.
export const fetchMetadata = (url) => invoke('plugin:sorai-downloader|fetch_metadata', { url })
