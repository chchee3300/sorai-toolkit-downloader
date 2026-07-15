import { useCallback, useRef, useState } from 'react'
import {
  buildMetadataCommand,
  buildDownloadCommand,
  parseMetadataJson,
  parseDownloadProgress,
  defaultFormatId,
  resolveFormatSelector,
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
  const [selectedFormatId, setSelectedFormatId] = useState('')
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
      setSelectedFormatId(defaultFormatId(meta.formats))
      setStatus({ text: 'Ready', state: 'ready' })
    } catch (e) {
      setFetchError(e.message || String(e))
      setStatus({ text: 'Error fetching video info', state: 'error' })
    } finally {
      setFetching(false)
    }
  }, [url])

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
    if (!metadata || !selectedFormatId || !outputPath) return

    setDownloading(true)
    setProgressPercent(0)
    setProgressText('Starting…')
    setStatus({ text: 'Downloading…', state: 'busy' })

    const selectedFormat = metadata.formats.find((f) => f.formatId === selectedFormatId)
    const formatSelector = selectedFormat ? resolveFormatSelector(selectedFormat) : selectedFormatId

    const platform = window.EstellaLib.platform
    const binPath = platform.resolveBinPath()
    const command = buildDownloadCommand({
      ytdlpPath: platform.ytdlpPath(binPath),
      ffmpegPath: platform.ffmpegPath(binPath),
      url: url.trim(),
      formatId: formatSelector,
      outputDir: outputPath,
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
  }, [metadata, selectedFormatId, outputPath, url])

  return {
    url,
    setUrl,
    metadata,
    fetching,
    fetchError,
    fetchMetadata,
    selectedFormatId,
    setSelectedFormatId,
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
