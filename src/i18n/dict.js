// Downloader's own UI copy -- flat key -> string (or key -> (params) =>
// string for interpolated/pluralized entries) per language. See
// src/hooks/useTranslation.js and resources/js/lib/i18n.js for the
// mechanism this feeds.
//
// IMPORTANT: several `en` entries are pinned to the EXACT wording the
// existing Playwright regression suites assert against (this repo's
// tests/test_download.js and the hub's copy) -- "Download complete",
// "Cancelled", the "Start Download"/"Start Download (N)" button, and
// queue-row state labels like "Done". Don't "improve" those specific en
// entries without also updating the test assertions -- tests pin
// sorai-lang=en and assert English.
export const dict = {
  en: {
    // App.jsx (QueueHeader)
    'queueHeader.count': ({ count }) => `${count} video${count !== 1 ? 's' : ''}`,
    'queueHeader.clearAll': 'Clear all',

    // UrlPanel.jsx
    'urlPanel.label': 'Add Video',
    'urlPanel.placeholder': 'Paste a video URL…',
    'urlPanel.add': 'Add',

    // QueueList.jsx
    'queue.mode.both': 'Video + Audio',
    'queue.mode.videoOnly': 'Video only',
    'queue.mode.audioOnly': 'Audio only',
    'queue.mode.none': 'No stream selected',
    'queue.state.fetching': 'Fetching…',
    'queue.state.fetchError': 'Error',
    'queue.state.pending': 'Queued',
    'queue.state.done': 'Done',
    'queue.state.cancelled': 'Cancelled',
    'queue.state.failed': 'Failed',
    'queue.total': ({ size }) => `Total ${size}`,
    'queue.remove': 'Remove from queue',
    'queue.clip': 'Clip video segment',
    // Platform badge labels -- YouTube/Twitch/X are proper nouns, identical
    // in every language; only the generic fallback differs.
    'platform.youtube': 'YouTube',
    'platform.twitch': 'Twitch',
    'platform.twitter': 'X',
    'platform.generic': 'Video',

    // ClipModal.jsx -- ported from sorai-toolkit-converter's trimModal.*
    // keys, plus previewUnavailable for the degraded (no playable preview
    // stream) fallback.
    'clipModal.title': 'Clip Video Segment',
    'clipModal.selected': ({ duration, percent }) => `${duration}s selected (${percent}%)`,
    'clipModal.playPause': 'Play/Pause',
    'clipModal.mute': 'Mute',
    'clipModal.unmute': 'Unmute',
    'clipModal.setStart': 'In',
    'clipModal.setEnd': 'Out',
    'clipModal.toggleLoop': 'Toggle Loop',
    'clipModal.loop': 'Loop',
    'clipModal.clearClip': 'Clear Clip',
    'clipModal.cancel': 'Cancel',
    'clipModal.save': 'Save',
    'clipModal.previewUnavailable': 'Preview unavailable — drag the handles to choose a range',

    // DownloadPanel.jsx
    'panel.format': 'Format',
    'panel.fetching': 'Fetching video info…',
    'panel.waiting': 'Waiting for video info…',
    'panel.quality': 'Quality',
    'panel.videoQuality': 'Video quality',
    'panel.audioQuality': 'Audio quality',
    'panel.includeVideo': 'Include video',
    'panel.includeAudio': 'Include audio',
    'panel.mergeMp4': 'Merge into single MP4',
    'panel.downloadFolder': 'Download folder',
    'panel.folderPlaceholder': 'Choose a folder…',
    'panel.browse': 'Browse',
    'panel.cancel': 'Cancel',
    'panel.start': ({ itemCount }) => (itemCount > 1 ? `Start Download (${itemCount})` : 'Start Download'),

    // DownloadIntro.jsx -- copy also FIXED here: the old text said "click
    // Fetch" but the button was renamed to "Add" a while ago.
    'intro.about': 'About this tool',
    'intro.lede': 'Paste a video URL on the left and click Add to queue it — YouTube, Twitch, X, and more. Each video gets its own quality settings; pick a download folder here and start the whole queue at once.',

    // useDownloader.js -- status bar (stored as key+params, translated at
    // render in App.jsx) and per-item progress snapshots (tNow).
    'status.ready': 'Ready',
    'status.cancelling': 'Cancelling…',
    'status.downloading': ({ done, total }) => `Downloading ${done} of ${total}…`,
    'status.cancelled': 'Cancelled',
    'status.complete': 'Download complete',
    'error.enterUrl': 'Enter a URL',
    'progress.starting': 'Starting…',
    'progress.done': 'Done',
    'progress.cancelled': 'Cancelled',
    'progress.failed': 'Failed',
  },
  'zh-TW': {
    'queueHeader.count': ({ count }) => `${count} 部影片`,
    'queueHeader.clearAll': '清除全部',

    'urlPanel.label': '新增影片',
    'urlPanel.placeholder': '貼上影片網址…',
    'urlPanel.add': '新增',

    'queue.mode.both': '影片＋音訊',
    'queue.mode.videoOnly': '僅影片',
    'queue.mode.audioOnly': '僅音訊',
    'queue.mode.none': '未選取串流',
    'queue.state.fetching': '擷取中…',
    'queue.state.fetchError': '錯誤',
    'queue.state.pending': '已排入佇列',
    'queue.state.done': '完成',
    'queue.state.cancelled': '已取消',
    'queue.state.failed': '失敗',
    'queue.total': ({ size }) => `共 ${size}`,
    'queue.remove': '從佇列移除',
    'queue.clip': '剪輯影片片段',
    'platform.youtube': 'YouTube',
    'platform.twitch': 'Twitch',
    'platform.twitter': 'X',
    'platform.generic': '影片',

    'clipModal.title': '剪輯影片片段',
    'clipModal.selected': ({ duration, percent }) => `已選取 ${duration} 秒（${percent}%）`,
    'clipModal.playPause': '播放／暫停',
    'clipModal.mute': '靜音',
    'clipModal.unmute': '取消靜音',
    'clipModal.setStart': '起點',
    'clipModal.setEnd': '終點',
    'clipModal.toggleLoop': '切換循環播放',
    'clipModal.loop': '循環',
    'clipModal.clearClip': '清除剪輯',
    'clipModal.cancel': '取消',
    'clipModal.save': '儲存',
    'clipModal.previewUnavailable': '無法預覽 — 請拖曳把手選擇範圍',

    'panel.format': '格式',
    'panel.fetching': '正在擷取影片資訊…',
    'panel.waiting': '等待影片資訊…',
    'panel.quality': '畫質',
    'panel.videoQuality': '影片畫質',
    'panel.audioQuality': '音訊品質',
    'panel.includeVideo': '包含影片',
    'panel.includeAudio': '包含音訊',
    'panel.mergeMp4': '合併為單一 MP4',
    'panel.downloadFolder': '下載資料夾',
    'panel.folderPlaceholder': '選擇資料夾…',
    'panel.browse': '瀏覽',
    'panel.cancel': '取消',
    'panel.start': ({ itemCount }) => (itemCount > 1 ? `開始下載（${itemCount}）` : '開始下載'),

    'intro.about': '關於此工具',
    'intro.lede': '在左側貼上影片網址並點擊「新增」即可排入佇列 — 支援 YouTube、Twitch、X 等平台。每部影片都有獨立的畫質設定；在這裡選擇下載資料夾後，即可一次下載整個佇列。',

    'status.ready': '就緒',
    'status.cancelling': '正在取消…',
    'status.downloading': ({ done, total }) => `正在下載第 ${done}／${total} 部…`,
    'status.cancelled': '已取消',
    'status.complete': '下載完成',
    'error.enterUrl': '請輸入網址',
    'progress.starting': '開始中…',
    'progress.done': '完成',
    'progress.cancelled': '已取消',
    'progress.failed': '失敗',
  },
}

// Non-hook, point-in-time translation for text STORED in state at the
// moment it's produced (per-item progressText snapshots) rather than
// rendered live from a key -- reads the current language at call time.
// Long-lived text (the status bar) stores {key, params} instead and
// translates at render -- see useDownloader's setStatus + App.jsx.
export function tNow(key, params) {
  const i18n = window.EstellaLib.i18n
  return i18n.translate(dict, i18n.getLang(), key, params)
}
