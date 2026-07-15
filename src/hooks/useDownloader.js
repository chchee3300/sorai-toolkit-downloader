import { useCallback, useRef, useState } from 'react'
import {
  buildMetadataCommand,
  buildDownloadCommand,
  parseMetadataJson,
  parseDownloadProgress,
  bestVideoFormatId,
  bestAudioFormatId,
  buildFormatSelector,
} from '../lib/ytdlp.js'

// Ported from sorai-toolkit-converter's useExecute.js's runCommandWithLogs --
// same spawnProcess + 'spawnedProcess' event pattern, just without the
// per-file batching (Downloader handles one URL at a time for v1).
function runCommandWithLogs(command, onProgress, spawnedIdRef, cancelRequestedRef) {
  return new Promise((resolve, reject) => {
    ;(async () => {
      try {
        const processInfo = await window.Neutralino.os.spawnProcess(command)
        const pid = processInfo.id
        spawnedIdRef.current = pid
        if (cancelRequestedRef.current) {
          window.Neutralino.os.updateSpawnedProcess(pid, 'exit').catch(() => {})
        }
        const handler = (evt) => {
          if (evt.detail.id !== pid) return
          if (evt.detail.action === 'stdOut' || evt.detail.action === 'stdErr') {
            onProgress(evt.detail.data)
          }
          if (evt.detail.action === 'exit') {
            window.Neutralino.events.off('spawnedProcess', handler)
            spawnedIdRef.current = null
            if (Number(evt.detail.data) === 0) resolve()
            else reject(new Error('Exit code ' + evt.detail.data))
          }
        }
        window.Neutralino.events.on('spawnedProcess', handler)
      } catch (e) {
        reject(e)
      }
    })()
  })
}

export function useDownloader() {
  const [url, setUrl] = useState('')
  const [metadata, setMetadata] = useState(null)
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState('')
  const [selectedVideoFormatId, setSelectedVideoFormatId] = useState('')
  const [selectedAudioFormatId, setSelectedAudioFormatId] = useState('')
  const [includeVideo, setIncludeVideo] = useState(true)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [autoMerge, setAutoMerge] = useState(true)
  const [outputPath, setOutputPath] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [progressPercent, setProgressPercent] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [status, setStatus] = useState({ text: 'Ready', state: 'ready' })

  const cancelRequestedRef = useRef(false)
  const spawnedIdRef = useRef(null)

  const fetchMetadata = useCallback(async () => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) return

    setFetching(true)
    setFetchError('')
    setMetadata(null)
    setStatus({ text: 'Fetching video info…', state: 'busy' })

    try {
      const platform = window.EstellaLib.platform
      const binPath = platform.resolveBinPath()
      const ytdlpPath = platform.ytdlpPath(binPath)
      const command = buildMetadataCommand({ ytdlpPath, url: trimmedUrl })
      const res = await window.Neutralino.os.execCommand(command)
      if (res.exitCode !== 0) {
        throw new Error(res.stdErr?.trim() || `yt-dlp exited with code ${res.exitCode}`)
      }
      const meta = parseMetadataJson(res.stdOut)
      setMetadata(meta)
      setSelectedVideoFormatId(bestVideoFormatId(meta.videoFormats))
      setSelectedAudioFormatId(bestAudioFormatId(meta.audioFormats))
      // Force-disable a stream type this source doesn't have at all (e.g. an
      // audio-only source) -- the corresponding checkbox stays locked via
      // DownloadPanel's `!available` disabled condition.
      setIncludeVideo(meta.videoFormats.length > 0)
      setIncludeAudio(meta.audioFormats.length > 0)
      setAutoMerge(meta.videoFormats.length > 0 && meta.audioFormats.length > 0)
      setStatus({ text: 'Ready', state: 'ready' })
    } catch (e) {
      setFetchError(e.message || String(e))
      setStatus({ text: 'Error fetching video info', state: 'error' })
    } finally {
      setFetching(false)
    }
  }, [url])

  // Defensive layer behind DownloadPanel's `disabled` attribute on each
  // checkbox: refuses to flip a stream off if the other is already off, so
  // "both unchecked" can't happen even if a future caller bypasses the UI
  // guard.
  const toggleIncludeVideo = useCallback(() => {
    setIncludeVideo((prev) => (prev && !includeAudio ? prev : !prev))
  }, [includeAudio])

  const toggleIncludeAudio = useCallback(() => {
    setIncludeAudio((prev) => (prev && !includeVideo ? prev : !prev))
  }, [includeVideo])

  const browseForOutputFolder = useCallback(async () => {
    const entry = await window.Neutralino.os.showFolderDialog('Select Download Folder')
    if (entry) setOutputPath(entry)
  }, [])

  const cancel = useCallback(() => {
    if (!downloading || cancelRequestedRef.current) return
    cancelRequestedRef.current = true
    setStatus({ text: 'Cancelling…', state: 'busy' })
    if (spawnedIdRef.current != null) {
      window.Neutralino.os.updateSpawnedProcess(spawnedIdRef.current, 'exit').catch(() => {})
    }
  }, [downloading])

  const startDownload = useCallback(async () => {
    if (!metadata || !outputPath) return
    if (!includeVideo && !includeAudio) return
    if (includeVideo && !selectedVideoFormatId) return
    if (includeAudio && !selectedAudioFormatId) return

    setDownloading(true)
    setProgressPercent(0)
    setProgressText('Starting…')
    setStatus({ text: 'Downloading…', state: 'busy' })

    const formatSelector = buildFormatSelector({
      includeVideo,
      includeAudio,
      videoFormatId: selectedVideoFormatId,
      audioFormatId: selectedAudioFormatId,
      autoMerge,
    })
    const bothIncluded = includeVideo && includeAudio
    const mergeToMp4 = bothIncluded && autoMerge
    const noMergeSelector = bothIncluded && !autoMerge

    const platform = window.EstellaLib.platform
    const binPath = platform.resolveBinPath()
    const command = buildDownloadCommand({
      ytdlpPath: platform.ytdlpPath(binPath),
      ffmpegPath: platform.ffmpegPath(binPath),
      url: url.trim(),
      formatSelector,
      outputDir: outputPath,
      mergeToMp4,
      noMergeSelector,
    })

    try {
      await runCommandWithLogs(
        command,
        (chunk) => {
          const progress = parseDownloadProgress(chunk)
          if (progress) {
            setProgressPercent(progress.percent)
            setProgressText(
              `Downloading… ${progress.percent.toFixed(1)}%` +
                (progress.speed && progress.speed !== 'NA' ? ` · ${progress.speed}` : '') +
                (progress.eta && progress.eta !== 'NA' ? ` · ETA ${progress.eta}` : ''),
            )
          }
        },
        spawnedIdRef,
        cancelRequestedRef,
      )
      setProgressPercent(100)
      setProgressText('Done')
      setStatus({ text: 'Download complete', state: 'ready' })
    } catch (err) {
      if (cancelRequestedRef.current) {
        setProgressText('Cancelled')
        setStatus({ text: 'Cancelled', state: 'ready' })
      } else {
        setProgressText('Failed')
        setStatus({ text: `Error: ${err.message || err}`, state: 'error' })
      }
    }

    cancelRequestedRef.current = false
    spawnedIdRef.current = null
    setDownloading(false)
  }, [metadata, includeVideo, includeAudio, selectedVideoFormatId, selectedAudioFormatId, autoMerge, outputPath, url])

  return {
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
  }
}
