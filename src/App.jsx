import UrlPanel from './components/UrlPanel.jsx'
import DownloadIntro from './components/DownloadIntro.jsx'
import DownloadPanel from './components/DownloadPanel.jsx'
import StatusBar from './components/StatusBar.jsx'
import { useDownloader } from './hooks/useDownloader.js'

// This is the Downloader tool's own content -- no <Header>, no
// useTheme()/useUpdateChecker() here, same reasoning as
// sorai-toolkit-converter's App.jsx: those are shell/hub-level concerns.
// When consumed as a library by the hub (src/index.js), `App` is exported
// as `DownloaderApp` and rendered inside the hub's own layout. Standalone
// (`neu run` here via src/main.jsx) it's the same component with no
// surrounding chrome.
function App() {
  const {
    url,
    setUrl,
    metadata,
    fetching,
    fetchError,
    fetchMetadata,
    selectedVideoFormatId,
    setSelectedVideoFormatId,
    selectedAudioFormatId,
    setSelectedAudioFormatId,
    includeVideo,
    includeAudio,
    toggleIncludeVideo,
    toggleIncludeAudio,
    autoMerge,
    setAutoMerge,
    outputPath,
    browseForOutputFolder,
    downloading,
    progressPercent,
    progressText,
    startDownload,
    cancel,
    status,
  } = useDownloader()

  return (
    <>
      <main className="main" id="main-content">
        <div className="main-columns">
          <UrlPanel
            url={url}
            setUrl={setUrl}
            fetching={fetching}
            fetchError={fetchError}
            onFetch={fetchMetadata}
            metadata={metadata}
          />

          {metadata ? (
            <DownloadPanel
              metadata={metadata}
              selectedVideoFormatId={selectedVideoFormatId}
              setSelectedVideoFormatId={setSelectedVideoFormatId}
              selectedAudioFormatId={selectedAudioFormatId}
              setSelectedAudioFormatId={setSelectedAudioFormatId}
              includeVideo={includeVideo}
              includeAudio={includeAudio}
              toggleIncludeVideo={toggleIncludeVideo}
              toggleIncludeAudio={toggleIncludeAudio}
              autoMerge={autoMerge}
              setAutoMerge={setAutoMerge}
              outputPath={outputPath}
              onBrowseOutput={browseForOutputFolder}
              downloading={downloading}
              progressPercent={progressPercent}
              progressText={progressText}
              onStart={startDownload}
              onCancel={cancel}
            />
          ) : (
            <DownloadIntro />
          )}
        </div>
      </main>
      <StatusBar text={status.text} state={status.state} />
    </>
  )
}

export default App
