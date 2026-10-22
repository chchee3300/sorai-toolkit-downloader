# sorai-toolkit-downloader

The **Downloader tool** for [SORAI Toolkit](https://github.com/chchee3300/sorai-toolkit) — paste a video URL, pick a format, download it locally, no upload, no cloud processing. This repo is consumed by the [`sorai-toolkit`](https://github.com/chchee3300/sorai-toolkit) hub repo as an npm git dependency; it is **not** independently installable or shippable — the hub is the actual installable app.

## Features

- Paste a URL, get back title/channel/duration/thumbnail plus every available video and audio format (via `yt-dlp -j`).
- Batch queue — add multiple videos, each with its own format selection, and download them one after another with a live progress bar per item.
- Pick a video-only format and an audio-only format independently ("split" mode) — they're merged into one file behind the scenes via `--ffmpeg-location`. Sources that only ever offer a single already-muxed stream (Twitch clips, most Twitter/X videos) skip straight to "combined" mode with nothing to merge.
- Clip a video to a start/end range before downloading (`ClipModal.jsx`) — same dual-thumb drag-slider UI as Converter's Trim modal. Falls back to a static thumbnail + timeline when no playable preview stream is available (common for Twitch/X's HLS-only sources).
- Recognizes YouTube, Twitch, and X (Twitter) with a platform badge on each queue row — any other site yt-dlp supports still works, just shown as a generic "Video" badge instead of being rejected.

## How it works

This repo is a [Tauri v2](https://tauri.app/) plugin in two halves, shipped together in one npm git dependency:

- **Rust crate** (`plugin/`, `tauri-plugin-sorai-downloader`) — runs `yt-dlp -j` and classifies its formats, builds the download arguments (format selector, merge, clip sections, progress template), parses progress, and runs/cancels the download processes.
- **React UI** (`src/`, library build `vite.lib.config.mjs` → `dist/index.js`) — exports `{ DownloaderApp }` plus the plugin's `invoke` wrappers (`src/plugin.js`). React and `@tauri-apps/api` are peer dependencies; no CSS is bundled (the hub loads the shared stylesheet). `dist/` is built by the `prepare` script whenever this repo is installed as a git dependency.

The host app (the hub) registers the plugin, grants `sorai-downloader:default`, registers `tauri-plugin-shell`, and provides:

- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) and [`ffmpeg`](https://ffmpeg.org/) in its resource dir or next to its exe (yt-dlp merges separate video/audio streams with that ffmpeg via `--ffmpeg-location`);
- the UI runtime globals `window.LiquidSelect`, `window.EstellaLib.i18n` and `window.SoraiDialogs`.

There is no standalone app in this repo — the UI needs the hub's Tauri runtime. Develop it through the hub's `npm run tauri:dev`, which picks up a sibling checkout of this repo (`src/` hot-reloads, `plugin/` edits rebuild the app).

**A note on legality**: yt-dlp's own license (Unlicense) places no restriction on its use, but the site you're downloading *from* may have its own Terms of Service restricting video downloads — that's a separate concern from open-source licensing. Use this tool for content you have the right to download (personal backups, your own uploads, permissively-licensed content, etc.).

## Testing

```bash
cd plugin && cargo test          # metadata parsing (YouTube/Twitch/X fixtures), argv, progress, sidecar lookup
```

End-to-end metadata fetches and real downloads (including a deliberately video-only format, checked for both a video and an audio stream) run from the hub: `npm run test:e2e -- downloader` there.

## Versioning

This repo has no independent release pipeline — no semantic-release, no CHANGELOG, no GitHub Releases. Versioning and packaging both live in the [`sorai-toolkit`](https://github.com/chchee3300/sorai-toolkit) hub repo, which consumes this repo via a git ref. Commit messages here don't need Conventional Commits prefixes.

## License

[MIT](LICENSE) for this repo's own code. Bundled/invoked third-party tools (yt-dlp, ffmpeg) keep their own licenses — see the hub repo's [`THIRD-PARTY-LICENSES.md`](https://github.com/chchee3300/sorai-toolkit/blob/master/THIRD-PARTY-LICENSES.md) for details, since the hub is what actually bundles and ships them.
