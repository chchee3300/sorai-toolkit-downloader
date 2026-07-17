import { useCallback, useRef, useState } from 'react'
import {
  buildMetadataCommand,
  buildDownloadCommand,
  parseMetadataJson,
  parseDownloadProgress,
  bestVideoFormatId,
  bestAudioFormatId,
  bestCombinedFormatId,
  buildFormatSelector,
  detectPlatform,
} from '../lib/ytdlp.js'
import { tNow } from '../i18n/dict.js'

// Ported from sorai-toolkit-converter's useExecute.js's runCommandWithLogs --
// same spawnProcess + 'spawnedProcess' event pattern. Generic/stateless per
// call, so it's reused once per queue item rather than once per app lifetime.
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
  const [items, setItems] = useState([])
  // Async-safe mirror of `items` -- addAndFetch (one call per queued URL,
  // all potentially in flight concurrently) and startQueue's sequential
  // loop both need up-to-date reads without stale-closure races. Same role
  // as sorai-toolkit-converter's useFileManager.js filesRef.
  const itemsRef = useRef([])
  const setItemsAndRef = useCallback((updater) => {
    setItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      itemsRef.current = next
      return next
    })
  }, [])

  const [selectedItemId, setSelectedItemId] = useState(null)
  const [url, setUrl] = useState('')
  // addError holds a dict KEY (e.g. 'error.enterUrl'), translated at render
  // in UrlPanel -- t() returns unknown keys verbatim, so raw passthrough
  // text would still display if one ever lands here.
  const [addError, setAddError] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [queueRunning, setQueueRunning] = useState(false)
  // Status is stored as a dict KEY + params, translated at render in
  // App.jsx, so the always-visible status bar switches language live
  // instead of freezing whatever language was active when it was set.
  const [status, setStatus] = useState({ key: 'status.ready', params: undefined, state: 'ready' })

  const cancelRequestedRef = useRef(false)
  const currentSpawnedIdRef = useRef(null)
  const idCounterRef = useRef(0)
  const genId = () => 'q' + (idCounterRef.current++)

  const patchItem = useCallback((id, patch) => {
    setItemsAndRef((prev) => prev.map((it) => (
      it.id === id ? { ...it, ...(typeof patch === 'function' ? patch(it) : patch) } : it
    )))
  }, [setItemsAndRef])

  // Same as patchItem, but for USER-initiated settings edits specifically
  // (format pick, include toggles, auto-merge) -- re-arms a 'done'/'error'/
  // 'cancelled' item back to 'pending' so a later Start actually re-runs it
  // with the new settings, mirroring Converter's "settings change
  // invalidates the previous result" behavior (its useEffect clearing
  // `converted` flags on files when shared settings change). Left alone
  // while 'downloading' -- fields are disabled in the UI during that state
  // anyway, so this is just a defensive no-op guard, not a real path.
  const patchItemSettings = useCallback((id, patch) => {
    patchItem(id, (it) => ({
      ...(typeof patch === 'function' ? patch(it) : patch),
      ...(it.downloadState === 'downloading' ? null : {
        downloadState: 'pending',
        progressPercent: 0,
        progressText: '',
        errorMessage: null,
      }),
    }))
  }, [patchItem])

  const addAndFetch = useCallback(async () => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setAddError('error.enterUrl')
      return
    }
    setAddError('')
    const id = genId()
    setItemsAndRef((prev) => [...prev, {
      id,
      url: trimmedUrl,
      // Display-only (queue-row badge) -- detected from the URL itself, not
      // from yt-dlp's response, so it's available immediately even before
      // the fetch resolves.
      platform: detectPlatform(trimmedUrl),
      metadata: null,
      fetching: true,
      fetchError: '',
      // 'split': independent video-only/audio-only streams + merge (the
      // YouTube-shaped case). 'combined': a single already-muxed format per
      // quality tier, no merge needed (Twitch never offers separate
      // streams at all; some sources mix both -- split wins when both
      // exist since it gives finer quality control). Set for real once
      // metadata resolves; 'split' here is just a harmless placeholder
      // since DownloadPanel gates on `!metadata` before reading it.
      mode: 'split',
      selectedVideoFormatId: '',
      selectedAudioFormatId: '',
      selectedCombinedFormatId: '',
      includeVideo: true,
      includeAudio: true,
      autoMerge: true,
      clipStart: undefined,
      clipEnd: undefined,
      downloadState: 'pending',
      progressPercent: 0,
      progressText: '',
      errorMessage: null,
    }])
    // Auto-select the newly added item and clear the input right away so
    // the next URL can be pasted without waiting on this one's fetch.
    setSelectedItemId(id)
    setUrl('')

    try {
      const platformLib = window.EstellaLib.platform
      const binPath = platformLib.resolveBinPath()
      const ytdlpPath = platformLib.ytdlpPath(binPath)
      const command = buildMetadataCommand({ ytdlpPath, url: trimmedUrl })
      const res = await window.Neutralino.os.execCommand(command)
      if (res.exitCode !== 0) {
        throw new Error(res.stdErr?.trim() || `yt-dlp exited with code ${res.exitCode}`)
      }
      const meta = parseMetadataJson(res.stdOut)
      const hasSplitStreams = meta.videoFormats.length > 0 || meta.audioFormats.length > 0
      patchItem(id, {
        metadata: meta,
        fetching: false,
        mode: hasSplitStreams ? 'split' : 'combined',
        selectedVideoFormatId: bestVideoFormatId(meta.videoFormats),
        selectedAudioFormatId: bestAudioFormatId(meta.audioFormats),
        selectedCombinedFormatId: bestCombinedFormatId(meta.combinedFormats),
        includeVideo: meta.videoFormats.length > 0,
        includeAudio: meta.audioFormats.length > 0,
        autoMerge: meta.videoFormats.length > 0 && meta.audioFormats.length > 0,
      })
    } catch (e) {
      patchItem(id, { fetching: false, fetchError: e.message || String(e) })
    }
  }, [url, patchItem, setItemsAndRef])

  // Defensive layer behind DownloadPanel's `disabled` attribute on each
  // checkbox: refuses to flip a stream off if the other is already off, so
  // "both unchecked" can't happen even if a future caller bypasses the UI
  // guard. Scoped per item via patchItemSettings's function-patch form.
  const toggleIncludeVideo = useCallback((id) => {
    patchItemSettings(id, (it) => ({ includeVideo: (it.includeVideo && !it.includeAudio) ? it.includeVideo : !it.includeVideo }))
  }, [patchItemSettings])

  const toggleIncludeAudio = useCallback((id) => {
    patchItemSettings(id, (it) => ({ includeAudio: (it.includeAudio && !it.includeVideo) ? it.includeAudio : !it.includeAudio }))
  }, [patchItemSettings])

  const updateItem = useCallback((id, patch) => {
    patchItemSettings(id, patch)
  }, [patchItemSettings])

  const removeItem = useCallback((id) => {
    const target = itemsRef.current.find((it) => it.id === id)
    if (target && target.downloadState === 'downloading') {
      cancelRequestedRef.current = true
      if (currentSpawnedIdRef.current != null) {
        window.Neutralino.os.updateSpawnedProcess(currentSpawnedIdRef.current, 'exit').catch(() => {})
      }
    }
    // selectedItemId is intentionally left untouched here -- App.jsx derives
    // the displayed item with a fallback (items.find(...) || items[0]), so
    // removing the selected item naturally falls back without extra state.
    setItemsAndRef((prev) => prev.filter((it) => it.id !== id))
  }, [setItemsAndRef])

  // Mirrors sorai-toolkit-converter's clearFiles -- cancels whatever's
  // currently downloading first (same guard as removeItem), then wipes the
  // whole queue. selectedItemId is left as-is; App.jsx's fallback
  // (items.find(...) || items[0] || null) naturally resolves to null once
  // items is empty.
  const clearAll = useCallback(() => {
    const running = itemsRef.current.some((it) => it.downloadState === 'downloading')
    if (running) {
      cancelRequestedRef.current = true
      if (currentSpawnedIdRef.current != null) {
        window.Neutralino.os.updateSpawnedProcess(currentSpawnedIdRef.current, 'exit').catch(() => {})
      }
    }
    setItemsAndRef([])
  }, [setItemsAndRef])

  const browseForOutputFolder = useCallback(async () => {
    const entry = await window.Neutralino.os.showFolderDialog('Select Download Folder')
    if (entry) setOutputPath(entry)
  }, [])

  const cancel = useCallback(() => {
    if (!queueRunning || cancelRequestedRef.current) return
    cancelRequestedRef.current = true
    setStatus({ key: 'status.cancelling', state: 'busy' })
    if (currentSpawnedIdRef.current != null) {
      window.Neutralino.os.updateSpawnedProcess(currentSpawnedIdRef.current, 'exit').catch(() => {})
    }
  }, [queueRunning])

  // Sequential queue processor, modeled on sorai-toolkit-converter's
  // useExecute.js: one shared spawnedIdRef/cancelRequestedRef pair reused
  // across iterations (not concurrent), a per-item try/catch so one failure
  // doesn't abort the batch, and results written back onto the item by id.
  // Iterates by live index against itemsRef.current.length (not a frozen
  // snapshot) so an item added mid-run via addAndFetch is naturally picked
  // up once the loop reaches its index.
  const startQueue = useCallback(async () => {
    if (queueRunning || !outputPath) return
    setQueueRunning(true)
    cancelRequestedRef.current = false
    const totalPending = itemsRef.current.filter((it) => it.downloadState === 'pending').length
    let doneCount = 0
    setStatus({ key: 'status.downloading', params: { done: 1, total: totalPending }, state: 'busy' })

    let index = 0
    while (index < itemsRef.current.length) {
      if (cancelRequestedRef.current) break
      const item = itemsRef.current[index]
      index++
      if (!item || item.downloadState !== 'pending') continue
      // Not yet fetched (still fetching, fetch failed, or no usable
      // selection) -- skip for this run, stays 'pending'. Known v1
      // limitation: click Start again once it's ready.
      if (!item.metadata) continue
      if (item.mode === 'combined') {
        if (!item.selectedCombinedFormatId) continue
      } else {
        if (item.includeVideo && !item.selectedVideoFormatId) continue
        if (item.includeAudio && !item.selectedAudioFormatId) continue
        if (!item.includeVideo && !item.includeAudio) continue
      }

      doneCount++
      setStatus({ key: 'status.downloading', params: { done: doneCount, total: totalPending }, state: 'busy' })
      patchItem(item.id, { downloadState: 'downloading', progressPercent: 0, progressText: tNow('progress.starting') })

      // Combined-mode formats are already muxed -- a single format id, no
      // video+audio selector building and no merge step at all.
      let formatSelector, mergeToMp4, noMergeSelector
      if (item.mode === 'combined') {
        formatSelector = item.selectedCombinedFormatId
        mergeToMp4 = false
        noMergeSelector = false
      } else {
        const bothIncluded = item.includeVideo && item.includeAudio
        formatSelector = buildFormatSelector({
          includeVideo: item.includeVideo,
          includeAudio: item.includeAudio,
          videoFormatId: item.selectedVideoFormatId,
          audioFormatId: item.selectedAudioFormatId,
          autoMerge: item.autoMerge,
        })
        mergeToMp4 = bothIncluded && item.autoMerge
        noMergeSelector = bothIncluded && !item.autoMerge
      }

      const platformLib = window.EstellaLib.platform
      const binPath = platformLib.resolveBinPath()
      const command = buildDownloadCommand({
        ytdlpPath: platformLib.ytdlpPath(binPath),
        ffmpegPath: platformLib.ffmpegPath(binPath),
        url: item.url,
        formatSelector,
        outputDir: outputPath,
        mergeToMp4,
        noMergeSelector,
        clipStart: item.clipStart,
        clipEnd: item.clipEnd,
      })

      try {
        await runCommandWithLogs(
          command,
          (chunk) => {
            const progress = parseDownloadProgress(chunk)
            if (progress) {
              patchItem(item.id, {
                progressPercent: progress.percent,
                progressText:
                  `${progress.percent.toFixed(1)}%` +
                  (progress.speed && progress.speed !== 'NA' ? ` · ${progress.speed}` : '') +
                  (progress.eta && progress.eta !== 'NA' ? ` · ETA ${progress.eta}` : ''),
              })
            }
          },
          currentSpawnedIdRef,
          cancelRequestedRef,
        )
        patchItem(item.id, { downloadState: 'done', progressPercent: 100, progressText: tNow('progress.done') })
      } catch (err) {
        if (cancelRequestedRef.current) {
          patchItem(item.id, { downloadState: 'cancelled', progressText: tNow('progress.cancelled') })
        } else {
          patchItem(item.id, { downloadState: 'error', progressText: tNow('progress.failed'), errorMessage: err.message || String(err) })
        }
      }
    }

    const wasCancelled = cancelRequestedRef.current
    cancelRequestedRef.current = false
    currentSpawnedIdRef.current = null
    setQueueRunning(false)
    setStatus(wasCancelled ? { key: 'status.cancelled', state: 'ready' } : { key: 'status.complete', state: 'ready' })
  }, [outputPath, patchItem, queueRunning])

  return {
    items,
    selectedItemId,
    selectItem: setSelectedItemId,
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
  }
}
