# Claude 自動化測試指引 (sorai-toolkit-downloader)

這是 SORAI Toolkit 的 **Downloader 子 repo**（yt-dlp 圖形化介面）——跟 `sorai-toolkit-converter` 一樣，被 `sorai-toolkit` 主 repo 當成 npm git dependency 消費（`vite.lib.config.mjs` 產生 `dist/index.js`，`src/index.js` barrel export `{ DownloaderApp }`，`prepare` script 在 `npm install` 時自動建置）。這裡的 `neutralino.config.json`/`vite.config.mjs`/`web-dist/` 只是**獨立開發測試用的殼層**，不是實際出貨的東西——真正的安裝檔/CI/release 全部在 `sorai-toolkit` repo（完整多 repo 重構計畫見 `~/.claude/plans/mac-linux-reactive-metcalfe.md`）。

## 架構
- **`src/lib/ytdlp.js`**：yt-dlp 指令建構 + 輸出解析的純函式（跟 Converter 的 `ffmpeg-commands.js`/`progress-parser.js`同等地位——這個 repo 自己的業務邏輯，不是共用的 runtime global）。
  - `buildMetadataCommand` + `parseMetadataJson`：`yt-dlp -j --no-playlist <url>` 一次拿到 title/thumbnail/duration，`parseMetadataJson` 把 raw formats 過濾／拆成 `videoFormats`/`audioFormats` 兩個陣列（丟掉 webm、mhtml storyboard、已經合併好的 video+audio combined 格式——兩個下拉選單只會顯示各自獨立的串流），不用額外呼叫 `-F`（那樣要重新 parse 人類可讀表格，反而更差）。**Playlist 網址目前只會抓第一部影片**（v1 已知限制，不是 bug）。
  - `videoFormatOptionLabel`/`audioFormatOptionLabel`：畫面上顯示的品質標籤（例如 `1080p · mp4 · 45MB`、`128 kbps · m4a · 3MB`）——刻意不含 format_id/codec 這類雜訊，2K/4K/8K 對應 1440p/2160p/4320p（消費級慣用命名，不是技術上的 DCI 定義）。
  - `bestVideoFormatId`/`bestAudioFormatId`：預設選項，明確用 `height`/`abr` 由高到低排序挑最佳，不依賴 yt-dlp JSON 隱含的 worst→best 順序。
  - `buildFormatSelector`：把 `includeVideo`/`includeAudio`/`autoMerge` 三個 UI 狀態組成 yt-dlp 的 `-f` selector——`"v+a"`（合併）、`"v,a"`（各自輸出、不合併）、或單一 id。
  - `buildDownloadCommand` + `parseDownloadProgress`：下載走 `--newline --no-colors --progress-template "download:DLPROGRESS|%(progress._percent_str)s|%(progress._eta_str)s|%(progress._speed_str)s"`，用固定前綴 `DLPROGRESS|` 讓 regex 好抓，不依賴 yt-dlp 預設的人類可讀進度列格式；`mergeToMp4` 時額外帶 `--merge-output-format mp4`（避免 yt-dlp 自己選的合併容器變成 mkv）；`noMergeSelector`（`"v,a"` 路徑）時額外帶 `-o "%(title)s [%(format_id)s].%(ext)s"`，避免兩個輸出檔案撞名、也方便分辨哪個是哪個。
- **`src/hooks/useDownloader.js`**：狀態機——`fetchMetadata`（`Neutralino.os.execCommand`，同步等待，因為 metadata 查詢通常幾秒內完成）、`startDownload`（`Neutralino.os.spawnProcess` + `spawnedProcess` 事件，跟 Converter 的 `useExecute.js` 同一套模式，可即時進度、可 cancel）。`includeVideo`/`includeAudio` 用 `toggleIncludeVideo`/`toggleIncludeAudio` 包過的 setter，拒絕把最後一個還勾著的 checkbox 取消勾選（避免兩個都不勾）；來源沒有某種串流（例如純音訊網址）時，`fetchMetadata` 會強制把對應的 include flag 設成 `false`，UI 層再用 `!available` 鎖住那個 checkbox。
- **`resources/js/lib/platform.js`**：這裡的複製只是給獨立殼層用（跟 Converter 一樣的 dev-harness mirror 模式）。真正組合進 hub 時，`ytdlpPath()`/`ffmpegPath()` 由 hub 自己提供的 `platform.js` 負責——兩邊路徑解析邏輯必須一致，改一邊要同步改另一邊。
- **共用 ffmpeg**：yt-dlp 合併分離的 video/audio 串流需要 ffmpeg，透過 `--ffmpeg-location` 指向 hub 已經為 Converter 準備好的同一份 `binaries/<platform>/ffmpeg`，Downloader 不需要（也不應該）自己再包一份。

## 核心規則：修改核心邏輯後的回歸檢查
有 `tests/test_download.js`（真的打真實 YouTube 網址 + 真的跑 yt-dlp/ffmpeg 的 E2E 測試，`node tests/test_download.js` 執行）涵蓋下面大部分項目，但改 `ytdlp.js`/`useDownloader.js`/`DownloadPanel.jsx` 後還是建議至少手動走一次：
1. 貼一個真實影片網址，Fetch 後標題/縮圖/時長正確顯示；Video quality／Audio quality 兩個下拉選單分別列出乾淨的品質標籤（`1080p · mp4 · 45MB` 這種格式，不會看到 format_id 或 codec 名稱），且沒有 webm／mhtml storyboard／已合併格式混進來。
2. 預設狀態：Include video／Include audio／Merge into single MP4 三個 checkbox 都是勾選的。
3. 維持預設勾選、選好輸出資料夾後 Start Download：真的下載完成、進度條有更新、輸出資料夾裡只有一個 `.mp4` 檔案，且用 `ffmpeg -i` 確認同時有 Video 跟 Audio 串流（驗證 `--ffmpeg-location` 合併 + `--merge-output-format mp4` 真的接得上）。
4. 取消勾選 Merge into single MP4（維持兩個 include 都勾），下載後應該產生**兩個**檔案，一個只有 video 串流、一個只有 audio 串流，檔名各自帶 format id 以便分辨。
5. 取消勾選 Include video（只剩 audio）：Video quality 下拉跟 Merge checkbox 應該自動變成 disabled；此時嘗試取消勾選 Include audio 應該也被擋下（disabled，不能讓兩個都不勾）；下載應該只產生一個純 audio 檔案。
6. Cancel 能正確中止下載，不留下殘留的 yt-dlp/ffmpeg process。

## Commit 規範
這個 repo 沒有自己的 semantic-release/CHANGELOG/GitHub Release——版本號、打包、發版全部由 `sorai-toolkit` 主 repo 負責。不需要 Conventional Commits 前綴，plain commit message 即可。

## UI 視覺風格
新增/修改 UI 前先看 `design-system/UI_STYLE_REFERENCE.md`。這裡刻意只用 `resources/styles.css` 既有的 class（`.panel`、`.path-row`、`.settings-block`、`.field`、`.btn`、`.progress-bar` 等）—— 縮圖用 inline style 而不是新增 CSS class，因為新 class 必須同時加進這個 repo 的 dev-harness 複本**和** hub 的 `resources/styles.css`（hub 組合時用的是它自己那份，不是這裡的），兩邊沒同步就會變成「standalone 能看，組合後樣式消失」的坑。真的需要新 class 時，記得兩邊都要加。

## 繼承自 sorai-toolkit-converter 的 Neutralino 開發殼層注意事項
- **`src/main.jsx` 自己包了一層 `.app-shell` div**——因為 `App.jsx`（套件匯出的內容）不再自帶這層包裝，那是 hub 組合時的責任。
- **`defaultMode`/`enableInspector`/`windowClose` 監聽**等打包/CI 相關踩坑清單都在 hub repo 的 `CLAUDE.md`——這裡的 `neutralino.config.json` 只是本機開發用，不會被實際打包。
