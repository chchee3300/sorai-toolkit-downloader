import UrlPanel from './components/UrlPanel.jsx'
import QueueList from './components/QueueList.jsx'
import DownloadIntro from './components/DownloadIntro.jsx'
import DownloadPanel from './components/DownloadPanel.jsx'
import StatusBar from './components/StatusBar.jsx'
import { useDownloader } from './hooks/useDownloader.js'
import { useTranslation } from './hooks/useTranslation.js'

// Same "N file(s) · Clear all" header sorai-toolkit-converter's App.jsx
// puts above FileList (.filelist-header/.mono-label/.btn-ghost, all
// existing classes -- no new CSS needed). No "Add files" button here,
// unlike Converter's version -- UrlPanel's URL input above is Downloader's
// equivalent add affordance, so this header only needs Clear all.
function QueueHeader({ count, onClearAll }) {
  const { t } = useTranslation()
  return (
    <div className="filelist-header">
      <span className="mono-label tabular-nums">
        {t('queueHeader.count', { count })}
      </span>
      <button className="btn btn-ghost btn-xs" id="btn-clear-queue" onClick={onClearAll}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="3" x2="13" y2="13" />
          <line x1="13" y1="3" x2="3" y2="13" />
        </svg>
        {t('queueHeader.clearAll')}
      </button>
    </div>
  )
}

// This is the Downloader tool's own content -- no <Header>, no
// useTheme()/useUpdateChecker() here, same reasoning as
// sorai-toolkit-converter's App.jsx: those are shell/hub-level concerns.
// When consumed as a library by the hub (src/index.js), `App` is exported
// as `DownloaderApp` and rendered inside the hub's own layout. Standalone
// (`neu run` here via src/main.jsx) it's the same component with no
// surrounding chrome.
function App() {
  const { t } = useTranslation()
  const {
    items,
    selectedItemId,
    selectItem,
    url,
    setUrl,
    addError,
    addAndFetch,
    updateItem,
    toggleIncludeVideo,
    toggleIncludeAudio,
    removeItem,
    clearAll,
    outputPath,
    browseForOutputFolder,
    queueRunning,
    startQueue,
    cancel,
    status,
  } = useDownloader()

  // Falls back to the first remaining item if the previously-selected one
  // was removed -- no extra state to keep in sync, just re-derive on render.
  const selectedItem = items.find((i) => i.id === selectedItemId) || items[0] || null

  return (
    <>
      <main className="main" id="main-content">
        <div className="main-columns">
          <section className="panel panel--ghost" id="url-panel">
            <UrlPanel url={url} setUrl={setUrl} addError={addError} onAdd={addAndFetch} />
            {items.length > 0 && (
              <>
                <QueueHeader count={items.length} onClearAll={clearAll} />
                <QueueList
                  items={items}
                  selectedItemId={selectedItem?.id ?? null}
                  onSelect={selectItem}
                  onRemove={removeItem}
                />
              </>
            )}
          </section>

          {selectedItem ? (
            <DownloadPanel
              // Force a full remount per item -- GlassSelect's underlying
              // <select> mounts LiquidSelect once and never rebuilds its
              // custom dropdown's option list on prop changes (only the
              // trigger text/highlight sync on value change, see
              // liquid-glass.js's sync() vs rebuildOptions()). Without this
              // key, switching between items with different available
              // formats leaves the visible dropdown showing whichever
              // item's formats were present the last time this DOM node
              // actually (re)mounted, not the currently-selected item's.
              key={selectedItem.id}
              item={selectedItem}
              onUpdateItem={(patch) => updateItem(selectedItem.id, patch)}
              onToggleIncludeVideo={() => toggleIncludeVideo(selectedItem.id)}
              onToggleIncludeAudio={() => toggleIncludeAudio(selectedItem.id)}
              outputPath={outputPath}
              onBrowseOutput={browseForOutputFolder}
              queueRunning={queueRunning}
              itemCount={items.length}
              onStart={startQueue}
              onCancel={cancel}
            />
          ) : (
            <DownloadIntro />
          )}
        </div>
      </main>
      {/* status carries a dict key + params (see useDownloader's setStatus),
          translated here at render so the always-on status bar re-renders in
          the new language immediately on a switch. */}
      <StatusBar text={t(status.key, status.params)} state={status.state} />
    </>
  )
}

export default App
