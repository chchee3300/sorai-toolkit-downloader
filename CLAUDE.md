# Claude 自動化測試指引 (sorai-toolkit-downloader)

這是 SORAI Toolkit 的 **Downloader 子 repo**（yt-dlp 圖形化介面）——跟 `sorai-toolkit-converter` 一樣，被 `sorai-toolkit` 主 repo 當成 npm git dependency 消費（`vite.lib.config.mjs` 產生 `dist/index.js`，`src/index.js` barrel export `{ DownloaderApp }`，`prepare` script 在 `npm install` 時自動建置）。這裡的 `neutralino.config.json`/`vite.config.mjs`/`web-dist/` 只是**獨立開發測試用的殼層**，不是實際出貨的東西——真正的安裝檔/CI/release 全部在 `sorai-toolkit` repo（完整多 repo 重構計畫見 `~/.claude/plans/mac-linux-reactive-metcalfe.md`）。

## 架構
- **`src/lib/ytdlp.js`**：yt-dlp 指令建構 + 輸出解析的純函式（跟 Converter 的 `ffmpeg-commands.js`/`progress-parser.js`同等地位——這個 repo 自己的業務邏輯，不是共用的 runtime global）。
  - `buildMetadataCommand` + `parseMetadataJson`：`yt-dlp -j --no-playlist <url>` 一次拿到 title/thumbnail/duration/formats，不用額外呼叫 `-F`（那樣要重新 parse 人類可讀表格，反而更差）。**Playlist 網址目前只會抓第一部影片**（v1 已知限制，不是 bug）。
  - `buildDownloadCommand` + `parseDownloadProgress`：下載走 `--newline --no-colors --progress-template "download:DLPROGRESS|%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s"`，用固定前綴 `DLPROGRESS|` 讓 regex 好抓，不依賴 yt-dlp 預設的人類可讀進度列格式。
- **`src/hooks/useDownloader.js`**：狀態機——`fetchMetadata`（`Neutralino.os.execCommand`，同步等待，因為 metadata 查詢通常幾秒內完成）、`startDownload`（`Neutralino.os.spawnProcess` + `spawnedProcess` 事件，跟 Converter 的 `useExecute.js` 同一套模式，可即時進度、可 cancel）。
- **`resources/js/lib/platform.js`**：這裡的複製只是給獨立殼層用（跟 Converter 一樣的 dev-harness mirror 模式）。真正組合進 hub 時，`ytdlpPath()`/`ffmpegPath()` 由 hub 自己提供的 `platform.js` 負責——兩邊路徑解析邏輯必須一致，改一邊要同步改另一邊。
- **共用 ffmpeg**：yt-dlp 合併分離的 video/audio 串流需要 ffmpeg，透過 `--ffmpeg-location` 指向 hub 已經為 Converter 準備好的同一份 `binaries/<platform>/ffmpeg`，Downloader 不需要（也不應該）自己再包一份。

## 核心規則：修改核心邏輯後的回歸檢查
目前沒有 Playwright 測試套件（Phase D 首次實作，優先求真的能跑）。修改 `ytdlp.js`/`useDownloader.js` 後，至少手動驗證：
1. 貼一個真實影片網址，Fetch 後標題/縮圖/時長正確顯示。
2. Format 下拉選單有選項可選。
3. 選好輸出資料夾後，Start Download 真的下載完成、進度條有更新、檔案出現在指定資料夾。
4. 需要合併 video+audio 的 format（`acodec`/`vcodec` 其中之一是 `none`）也能正常完成（驗證 `--ffmpeg-location` 真的接得上）。
5. Cancel 能正確中止下載，不留下殘留的 yt-dlp/ffmpeg process。

## Commit 規範
這個 repo 沒有自己的 semantic-release/CHANGELOG/GitHub Release——版本號、打包、發版全部由 `sorai-toolkit` 主 repo 負責。不需要 Conventional Commits 前綴，plain commit message 即可。

## UI 視覺風格
新增/修改 UI 前先看 `design-system/UI_STYLE_REFERENCE.md`。這裡刻意只用 `resources/styles.css` 既有的 class（`.panel`、`.path-row`、`.settings-block`、`.field`、`.btn`、`.progress-bar` 等）—— 縮圖用 inline style 而不是新增 CSS class，因為新 class 必須同時加進這個 repo 的 dev-harness 複本**和** hub 的 `resources/styles.css`（hub 組合時用的是它自己那份，不是這裡的），兩邊沒同步就會變成「standalone 能看，組合後樣式消失」的坑。真的需要新 class 時，記得兩邊都要加。

## 繼承自 sorai-toolkit-converter 的 Neutralino 開發殼層注意事項
- **`src/main.jsx` 自己包了一層 `.app-shell` div**——因為 `App.jsx`（套件匯出的內容）不再自帶這層包裝，那是 hub 組合時的責任。
- **`defaultMode`/`enableInspector`/`windowClose` 監聽**等打包/CI 相關踩坑清單都在 hub repo 的 `CLAUDE.md`——這裡的 `neutralino.config.json` 只是本機開發用，不會被實際打包。
