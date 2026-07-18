# sorai-toolkit-downloader

The **Downloader tool** for [SORAI Toolkit](https://github.com/chchee3300/sorai-toolkit) — paste a video URL, pick a format, download it locally, no upload, no cloud processing. This repo is consumed by the [`sorai-toolkit`](https://github.com/chchee3300/sorai-toolkit) hub repo as an npm git dependency; it is **not** independently installable or shippable — the hub is the actual installable app.

## Features

- Paste a URL, get back title/channel/duration/thumbnail plus every available video and audio format (via `yt-dlp -j`).
- Batch queue — add multiple videos, each with its own format selection, and download them one after another with a live progress bar per item.
- Pick a video-only format and an audio-only format independently ("split" mode) — they're merged into one file behind the scenes via `--ffmpeg-location`. Sources that only ever offer a single already-muxed stream (Twitch clips, most Twitter/X videos) skip straight to "combined" mode with nothing to merge.
- Clip a video to a start/end range before downloading (`ClipModal.jsx`) — same dual-thumb drag-slider UI as Converter's Trim modal. Falls back to a static thumbnail + timeline when no playable preview stream is available (common for Twitch/X's HLS-only sources).
- Recognizes YouTube, Twitch, and X (Twitter) with a platform badge on each queue row — any other site yt-dlp supports still works, just shown as a generic "Video" badge instead of being rejected.

## How it works

The UI (React + Vite, in `src/`) runs inside a [Neutralino.js](https://neutralino.js.org/) shell, which gives it native filesystem access and the ability to spawn local command-line tools. Downloading is performed by:

- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) — metadata fetch + the actual download. Bundled on every platform, fetched live from yt-dlp's own GitHub releases (not a pinned version, since it cuts releases often).
- [`ffmpeg`](https://ffmpeg.org/) — merges separate video-only + audio-only streams into one file (`--ffmpeg-location`), invoked by yt-dlp itself, not called directly by this repo.

When composed into the hub, the hub itself provides these binaries and the runtime globals that call into them (`window.EstellaLib.*`, see `resources/js/lib/`) — this repo's own copy of that infrastructure only exists for its **standalone dev harness** (see below), and is not part of what ships to the hub.

**A note on legality**: yt-dlp's own license (Unlicense) places no restriction on its use, but the site you're downloading *from* may have its own Terms of Service restricting video downloads — that's a separate concern from open-source licensing. Use this tool for content you have the right to download (personal backups, your own uploads, permissively-licensed content, etc.).

## This repo's two build outputs

- **Library build** (`vite.lib.config.mjs` → `dist/index.js`) — a plain ESM bundle exporting `{ DownloaderApp }` (`src/index.js`), with React as a peer dependency and no bundled CSS (the hub already loads the shared stylesheet itself). This is what the hub actually consumes; it's built automatically by the `prepare` npm lifecycle script whenever this repo is installed as a git dependency — the hub never needs a manual build step for it.
- **Standalone dev harness** (`vite.config.mjs` → `web-dist/`) — a self-contained build of this repo alone (own `neutralino.config.json`, own copies of the shared runtime globals), for developing/testing Downloader in isolation without needing the hub at all. See [Development](#development) below.

## Requirements

Building from source needs:

- [Node.js](https://nodejs.org/) (for the Vite build and `setup.mjs`)
- The [Neutralino CLI](https://neutralino.js.org/docs/cli/neu-cli) — installed automatically by `npm run setup` (only needed for the standalone dev harness)
- Windows, macOS, or Linux — yt-dlp and ffmpeg are both bundled on every platform, no system dependencies needed.

## Setup

```bash
npm install
npm run setup
```

`npm run setup` chains everything a fresh clone needs for the standalone dev harness:

```bash
npm install -g @neutralinojs/neu@11.7.1   # pinned -- see note below
neu update                                 # fetches the Neutralino client lib + runtime binaries (bin/, gitignored)
node scripts/copy-neutralino-client.mjs    # neu update writes the client lib to web-dist/js/ (per
                                            # neutralino.config.json's clientLibrary); vite.config.mjs
                                            # re-copies it from resources/js/ (its source of truth, also
                                            # gitignored) on every build, so this needs doing once
node setup.mjs                             # downloads yt-dlp + ffmpeg (all platforms) into binaries/
```

The `@neutralinojs/neu` version is pinned rather than left at `latest`: as of this writing, the latest published version (`11.7.2`) declares a `uuid` dependency range that resolves to an ESM-only release, which crashes its own (CommonJS) code with `ERR_REQUIRE_ESM` on install. `11.7.1` is the last version that doesn't have this problem — worth re-checking occasionally in case upstream fixes it.

## Development

```bash
npm run dev         # start the Vite dev server (UI only, in a browser)
neu run             # build the web UI and launch the Neutralino desktop shell, standalone
```

`neu run` serves this repo's own standalone dev harness from `web-dist/`. Rebuild it with:

```bash
npm run build
```

To build the library output the hub actually consumes:

```bash
npm run build:lib   # -> dist/index.js (also runs automatically via "prepare" when this repo
                     #    is installed as a git dependency elsewhere)
```

## Project structure

```
src/                 React UI (components, hooks)
src/index.js          Library entry point — exports { DownloaderApp } for the hub to consume
src/main.jsx          Standalone dev-harness entry point (wraps DownloaderApp in its own .app-shell)
src/lib/ytdlp.js      yt-dlp command building + -j metadata JSON / --progress-template output parsing
src/hooks/useDownloader.js   Metadata fetch (execCommand) + queue/download orchestration (spawnProcess)
resources/           Static assets for the standalone dev harness (icons, styles, neutralino.js client,
                      platform/command-builder libs) — mirrors what the hub provides when composed
binaries/            Bundled yt-dlp + ffmpeg for the standalone dev harness, per platform (fetched by setup.mjs)
bin/                 Neutralino runtime binaries for the standalone dev harness (per-platform)
tests/               Regression/E2E test scripts and their fixture files
scripts/             Dev-harness setup helper (neutralino.js client copy)
neutralino.config.json   Standalone dev harness's own Neutralino config (not used by the hub)
vite.config.mjs      Standalone dev harness build config
vite.lib.config.mjs  Library build config (what the hub actually consumes)
setup.mjs            Downloads yt-dlp + ffmpeg for the standalone dev harness
```

## Testing

```bash
node tests/test_download.js
```

Drives the real app end-to-end via Playwright and a `neu run` instance (this repo's standalone dev harness): fetches metadata for a real, tiny public-domain-adjacent video ("Me at the zoo", the first video ever uploaded to YouTube, ~19 seconds), then downloads it using a **video-only format** deliberately (not the default) to confirm the video+audio merge via `--ffmpeg-location` actually works — verified by checking the output file has both a video and an audio stream with `ffmpeg -i`, not just that a file exists. The native folder-picker dialog is mocked (`window.Neutralino.os.showFolderDialog`), since Playwright can't drive OS-native dialogs. Must be run from the project root; fixtures/output land under a temp directory. The same suite is also run against the real composed hub — see the hub repo's own `tests/`.

## Versioning

This repo has no independent release pipeline — no semantic-release, no CHANGELOG, no GitHub Releases. Versioning and packaging both live in the [`sorai-toolkit`](https://github.com/chchee3300/sorai-toolkit) hub repo, which consumes this repo via a git ref. Commit messages here don't need Conventional Commits prefixes.

## License

[MIT](LICENSE) for this repo's own code. Bundled/invoked third-party tools (yt-dlp, ffmpeg) keep their own licenses — see the hub repo's [`THIRD-PARTY-LICENSES.md`](https://github.com/chchee3300/sorai-toolkit/blob/master/THIRD-PARTY-LICENSES.md) for details, since the hub is what actually bundles and ships them.
