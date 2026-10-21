import { useCallback, useRef, useState } from 'react'
import { detectPlatform } from '../lib/ytdlp.js'
import { fetchMetadata, startDownload, cancelDownload } from '../plugin.js'
import { tNow } from '../i18n/dict.js'

// One plugin download job as a promise: resolves on success, rejects on
// failure/cancel. The Rust runner guarantees exactly one 'finished' (with a
// timeout backstop after cancel), so no JS-side cancel guard is needed.
// jobIdRef holds the live job id for cancel(); a cancel requested before the
// id came back is applied as soon as it does.
function runDownload(job, onProgress, jobIdRef, cancelRequestedRef) {
  return new Promise((resolve, reject) => {
    let finished = false
    startDownload(job, (msg) => {
      if (msg.event === 'progress') onProgress(msg)
      else if (msg.event === 'finished') {
        finished = true
        jobIdRef.current = null
        if (msg.ok) resolve()
        else reject(new Error(msg.cancelled ? 'Cancelled' : msg.error))
      }
    }).then((id) => {
      if (finished) return
      jobIdRef.current = id
      if (cancelRequestedRef.current) cancelDownload(id).catch(() => {})
    }, reject)
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
  const currentJobIdRef = useRef(null)
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
      // Fetch + JSON parsing + best-format defaults all happen in Rust
      // (plugin/src/metadata.rs); rejects with yt-dlp's stderr.
      const meta = await fetchMetadata(trimmedUrl)
      const hasSplitStreams = meta.videoFormats.length > 0 || meta.audioFormats.length > 0
      patchItem(id, {
        metadata: meta,
        fetching: false,
        mode: hasSplitStreams ? 'split' : 'combined',
        selectedVideoFormatId: meta.bestVideoFormatId,
        selectedAudioFormatId: meta.bestAudioFormatId,
        selectedCombinedFormatId: meta.bestCombinedFormatId,
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
      if (currentJobIdRef.current != null) cancelDownload(currentJobIdRef.current).catch(() => {})
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
      if (currentJobIdRef.current != null) cancelDownload(currentJobIdRef.current).catch(() => {})
    }
    setItemsAndRef([])
  }, [setItemsAndRef])

  const browseForOutputFolder = useCallback(async () => {
    // Hub's central dialog module (looked up at call time so E2E can stub it).
    const entry = await window.SoraiDialogs.openFolder({ title: 'Select Download Folder' })
    if (entry) setOutputPath(entry)
  }, [])

  const cancel = useCallback(() => {
    if (!queueRunning || cancelRequestedRef.current) return
    cancelRequestedRef.current = true
    setStatus({ key: 'status.cancelling', state: 'busy' })
    if (currentJobIdRef.current != null) cancelDownload(currentJobIdRef.current).catch(() => {})
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

      // Selector / merge / split-file naming / clip args are built in Rust
      // from these settings (plugin/src/download.rs).
      const job = {
        url: item.url,
        outputDir: outputPath,
        mode: item.mode,
        videoFormatId: item.selectedVideoFormatId,
        audioFormatId: item.selectedAudioFormatId,
        combinedFormatId: item.selectedCombinedFormatId,
        includeVideo: item.includeVideo,
        includeAudio: item.includeAudio,
        autoMerge: item.autoMerge,
        clipStart: item.clipStart ?? null,
        clipEnd: item.clipEnd ?? null,
      }

      try {
        await runDownload(
          job,
          (progress) => {
            patchItem(item.id, {
              progressPercent: progress.percent,
              progressText:
                `${progress.percent.toFixed(1)}%` +
                (progress.speed ? ` · ${progress.speed}` : '') +
                (progress.eta ? ` · ETA ${progress.eta}` : ''),
            })
          },
          currentJobIdRef,
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
    currentJobIdRef.current = null
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
