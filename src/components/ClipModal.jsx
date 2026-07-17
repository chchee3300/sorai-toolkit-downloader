import { useEffect, useRef, useState } from 'react'
import { rangeFillStyle } from '../lib/rangeFill.js'
import { useTranslation } from '../hooks/useTranslation.js'

// Ported from sorai-toolkit-converter's TrimModal.jsx -- same dual-thumb drag
// slider, but scoped to remote-video clipping (any yt-dlp source with a
// known duration) instead of arbitrary local media files:
// - No fileType/<audio> branch -- this tool only ever clips video.
// - No Neutralino.server.mount/unmount -- the preview player streams
//   directly from yt-dlp's own metadata (item.metadata.previewUrl), a
//   remote URL, not a local file needing a dev-server mount.
// - Preview can fail (URL expired/IP-bound, or no progressive http(s)
//   format at all for this source -- e.g. Twitch/most Twitter videos are
//   HLS-only, so pickPreviewUrl() never finds a candidate) -- degraded mode
//   swaps the player for a static thumbnail + a message, but keeps the
//   slider/labels/footer fully usable, since clipping only needs duration +
//   a UI to pick a range, not a playable preview.
function formatClipLabel(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0.0s'
  return seconds.toFixed(1) + 's'
}

// Magnet-snap radius for dragging a trim thumb onto the playhead, in
// screen pixels (not seconds) so it feels the same regardless of the
// clip's duration or the slider's current width -- same convention as
// Premiere's own snap radius. Same constant as sorai-toolkit-converter's
// TrimModal.jsx.
const SNAP_PX = 8

export default function ClipModal({ open, item, onClose, onSave, onClear }) {
  const { t } = useTranslation()
  const vidRef = useRef(null)
  const activePlayerRef = useRef(null)
  const sliderContainerRef = useRef(null)
  const thumbLeftRef = useRef(null)
  const thumbRightRef = useRef(null)
  const playheadRef = useRef(null)
  const modalContentRef = useRef(null)

  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLooping, setIsLooping] = useState(true)
  const [volume, setVolume] = useState(1.0)
  const [muted, setMuted] = useState(false)
  const [draggingThumb, setDraggingThumb] = useState(null) // 'left' | 'right' | 'playhead' | null
  const [previewFailed, setPreviewFailed] = useState(false)

  const previousVolumeRef = useRef(1.0)

  const trimStartRef = useRef(trimStart)
  trimStartRef.current = trimStart
  const trimEndRef = useRef(trimEnd)
  trimEndRef.current = trimEnd
  const durationRef = useRef(duration)
  durationRef.current = duration
  const isLoopingRef = useRef(isLooping)
  isLoopingRef.current = isLooping
  const draggingThumbRef = useRef(draggingThumb)
  draggingThumbRef.current = draggingThumb
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  // Loop mode replays [trimStart, trimEnd] on natural playback, but a
  // manual seek (click or playhead drag) past trimEnd is deliberate --
  // the user is checking whether to extend the selection, not asking to
  // be bounced back to the start. Set true whenever a manual seek lands
  // outside the range, false once one lands back inside it; onTimeUpdate
  // only auto-loops while this is false, so playback that's already
  // outside the range on its own (dragged there, or left playing past
  // the boundary) is never forced back. Same fix as sorai-toolkit-converter's
  // TrimModal.jsx.
  const suppressLoopRef = useRef(false)
  // Premiere-style magnet snap: wherever the playhead sits when a trim
  // thumb drag starts is captured once (thumb mousedown) as a fixed
  // anchor, not re-read live during the drag. null when no target is
  // armed (drag didn't start from a thumb, or there's no active player).
  const snapTargetRef = useRef(null)

  const degraded = !item?.metadata?.previewUrl || previewFailed

  // Open (or switch to a different queue item while open): reset players,
  // reset the clip range from the item's own saved clipStart/clipEnd (or
  // full range), point the video straight at previewUrl. Unlike TrimModal
  // there's no server mount/unmount -- previewUrl is already a directly
  // playable remote URL.
  useEffect(() => {
    if (!open || !item) return undefined
    const vid = vidRef.current
    setPreviewFailed(false)
    vid.pause()
    vid.removeAttribute('src')

    const itemDuration = item.metadata?.duration || 0
    setDuration(itemDuration)
    setTrimStart(item.clipStart ?? 0)
    setTrimEnd(item.clipEnd ?? itemDuration)
    suppressLoopRef.current = false

    const previewUrl = item.metadata?.previewUrl
    if (previewUrl) {
      activePlayerRef.current = vid
      vid.src = previewUrl
      vid.load()
      vid.volume = volume
    } else {
      activePlayerRef.current = null
    }

    return () => {
      vid.pause()
      activePlayerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  // Accessibility: Escape closes the modal, Tab/Shift+Tab is trapped inside
  // it, focus moves into the modal on open and back to the trigger on
  // close -- same as TrimModal.
  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement

    const getFocusable = () =>
      Array.from(
        modalContentRef.current?.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) || []
      )

    const focusable = getFocusable()
    ;(focusable[0] || modalContentRef.current)?.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = getFocusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [open])

  // Player event wiring -- registered once; the video element persists in
  // the DOM for the component's whole lifetime (hidden via class in
  // degraded mode, not unmounted) so this effect never needs to re-bind.
  useEffect(() => {
    const vid = vidRef.current

    const onTimeUpdate = (e) => {
      const p = e.target
      if (isLoopingRef.current && !suppressLoopRef.current) {
        if (p.currentTime >= trimEndRef.current) {
          p.currentTime = trimStartRef.current
          p.play().catch(() => {})
        }
      }
      // Dragging a left/right trim thumb still seeks this element (so the
      // preview frame follows the thumb) but must NOT drag the playhead
      // marker along with it -- the marker stays put at wherever it was
      // when the drag started, only catching up once the drag ends (see
      // onMouseUp below). Frozen here specifically, not just left alone
      // in onMouseMove, because this handler fires from the seek itself
      // and would otherwise immediately undo that.
      const dragging = draggingThumbRef.current
      if (durationRef.current > 0 && playheadRef.current && dragging !== 'left' && dragging !== 'right') {
        const pct = (p.currentTime / durationRef.current) * 100
        playheadRef.current.style.left = pct + '%'
      }
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onError = () => setPreviewFailed(true)

    vid.addEventListener('timeupdate', onTimeUpdate)
    vid.addEventListener('play', onPlay)
    vid.addEventListener('pause', onPause)
    vid.addEventListener('error', onError)
    return () => {
      vid.removeEventListener('timeupdate', onTimeUpdate)
      vid.removeEventListener('play', onPlay)
      vid.removeEventListener('pause', onPause)
      vid.removeEventListener('error', onError)
    }
  }, [])

  // Slider drag logic -- unchanged from TrimModal. Thumb dragging only
  // depends on duration state, so it works the same whether or not a
  // preview player is active.
  useEffect(() => {
    const getSecondsFromX = (clientX) => {
      if (durationRef.current <= 0) return 0
      const rect = sliderContainerRef.current.getBoundingClientRect()
      let pct = (clientX - rect.left) / rect.width
      pct = Math.max(0, Math.min(1, pct))
      return pct * durationRef.current
    }

    // Only used for an actual playhead drag (dragging === 'playhead'
    // below) -- the marker's normal position updates come from the
    // video's own 'timeupdate' event (onTimeUpdate above), which is async
    // and can lag or coalesce behind a fast run of programmatic
    // currentTime writes, so this writes the marker directly, in the same
    // tick, instead of waiting on that. Left/right thumb drags
    // deliberately do NOT call this -- see the comment further down.
    const syncPlayheadVisual = (sec) => {
      if (durationRef.current > 0 && playheadRef.current) {
        playheadRef.current.style.left = (sec / durationRef.current) * 100 + '%'
      }
    }

    const onMouseMove = (e) => {
      const dragging = draggingThumbRef.current
      if (!dragging) return

      let sec = getSecondsFromX(e.clientX)

      if (dragging === 'playhead') {
        suppressLoopRef.current = sec > trimEndRef.current
        if (activePlayerRef.current) activePlayerRef.current.currentTime = sec
        syncPlayheadVisual(sec)
        return
      }

      if (snapTargetRef.current !== null) {
        const rect = sliderContainerRef.current.getBoundingClientRect()
        const pxPerSec = durationRef.current > 0 ? rect.width / durationRef.current : 0
        if (pxPerSec > 0 && Math.abs(sec - snapTargetRef.current) * pxPerSec <= SNAP_PX) {
          sec = snapTargetRef.current
        }
      }

      if (dragging === 'left') {
        if (sec > trimEndRef.current) sec = trimEndRef.current
        setTrimStart(sec)
      } else if (dragging === 'right') {
        if (sec < trimStartRef.current) sec = trimStartRef.current
        setTrimEnd(sec)
      }

      // Preview follows the thumb (so you can see the exact frame you're
      // setting as the boundary), but the playhead marker deliberately
      // does NOT -- onTimeUpdate above skips its own marker write while
      // dragging left/right for the same reason, since this currentTime
      // assignment is what triggers it.
      if (activePlayerRef.current) activePlayerRef.current.currentTime = sec
    }

    const onMouseUp = () => {
      if (draggingThumbRef.current) setDraggingThumb(null)
      snapTargetRef.current = null
      // Marker catches up to wherever the preview actually ended up the
      // instant the drag ends, rather than waiting on the next natural
      // timeupdate (which won't fire again on its own once paused).
      if (activePlayerRef.current && durationRef.current > 0 && playheadRef.current) {
        playheadRef.current.style.left = (activePlayerRef.current.currentTime / durationRef.current) * 100 + '%'
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  const handleSliderMouseDown = (e) => {
    if (degraded) return
    // .contains(), not === -- a click that lands on .thumb-grip (a CHILD
    // of the thumb, and the visually obvious part to grab) has e.target
    // set to the grip, which never strictly-equals the thumb ref itself.
    // That let the click bubble past this bail-out and ALSO fire as a
    // playhead seek here (the thumb's own onMouseDown, fired first via
    // bubbling, would already have started a thumb drag -- React just
    // applied whichever setDraggingThumb() call landed last in the same
    // batched event, silently overwriting the thumb drag with a
    // playhead one).
    if (thumbLeftRef.current?.contains(e.target) || thumbRightRef.current?.contains(e.target)) return
    setDraggingThumb('playhead')
    const rect = sliderContainerRef.current.getBoundingClientRect()
    let pct = (e.clientX - rect.left) / rect.width
    pct = Math.max(0, Math.min(1, pct))
    const sec = duration > 0 ? pct * duration : 0
    suppressLoopRef.current = sec > trimEnd
    if (activePlayerRef.current) activePlayerRef.current.currentTime = sec
  }

  const handleSetStart = () => {
    if (!activePlayerRef.current) return
    let sec = activePlayerRef.current.currentTime
    if (sec > trimEnd) sec = trimEnd
    setTrimStart(sec)
    suppressLoopRef.current = false
  }

  const handleSetEnd = () => {
    if (!activePlayerRef.current) return
    let sec = activePlayerRef.current.currentTime
    if (sec < trimStart) sec = trimStart
    setTrimEnd(sec)
    suppressLoopRef.current = false
  }

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value)
    setVolume(vol)
    if (activePlayerRef.current) {
      activePlayerRef.current.volume = vol
      if (vol > 0) {
        activePlayerRef.current.muted = false
        setMuted(false)
      }
    }
  }

  const handleToggleMute = () => {
    const player = activePlayerRef.current
    if (!player) return
    if (player.muted || player.volume === 0) {
      player.muted = false
      const restore = previousVolumeRef.current === 0 ? 1.0 : previousVolumeRef.current
      player.volume = restore
      setVolume(restore)
      setMuted(false)
    } else {
      previousVolumeRef.current = player.volume
      player.muted = true
      player.volume = 0
      setVolume(0)
      setMuted(true)
    }
  }

  const togglePlayPause = () => {
    const player = activePlayerRef.current
    if (!player) return
    if (player.paused) player.play().catch(() => {})
    else player.pause()
  }

  const handleClear = () => {
    setTrimStart(0)
    setTrimEnd(duration)
    suppressLoopRef.current = false
    if (onClear) onClear()
  }

  const handleSave = () => {
    const cleared = trimStart === 0 && trimEnd === duration
    if (onSave) onSave(cleared ? undefined : trimStart, cleared ? undefined : trimEnd)
    onClose()
  }

  const pctStart = duration > 0 ? (trimStart / duration) * 100 : 0
  const pctEnd = duration > 0 ? (trimEnd / duration) * 100 : 100
  const selDuration = trimEnd - trimStart
  const selPct = duration > 0 ? (selDuration / duration) * 100 : 0
  const showVolOff = muted || volume === 0

  return (
    <div className={open ? 'modal-overlay' : 'modal-overlay hidden'} id="clip-modal">
      <div
        className="modal-content modal-lg"
        ref={modalContentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="clip-modal-title"
        tabIndex={-1}
      >
        <div className="modal-header">
          <h3 className="modal-title" id="clip-modal-title">{t('clipModal.title')}</h3>
        </div>
        <div className="modal-body trim-vidcord-body">
          <div className="player-container" id="clip-player-container">
            <video
              id="clip-video-player"
              className={degraded ? 'trim-player hidden' : 'trim-player'}
              ref={vidRef}
              onClick={togglePlayPause}
            />
            {degraded && item?.metadata?.thumbnail && (
              <img className="trim-player" src={item.metadata.thumbnail} alt="" style={{ opacity: 0.45 }} />
            )}
            {degraded && (
              <p
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  color: '#fff',
                  textAlign: 'center',
                  pointerEvents: 'none',
                  zIndex: 2,
                  margin: 0,
                  padding: '0 16px',
                }}
              >
                {t('clipModal.previewUnavailable')}
              </p>
            )}

            <div className="player-overlay" style={degraded ? { opacity: 1 } : undefined}>
              <div className="trim-top-bar">
                <div className="trim-title">
                  <span className="trim-title-info tabular-nums" id="clip-duration-info">
                    {t('clipModal.selected', { duration: selDuration.toFixed(2), percent: selPct.toFixed(1) })}
                  </span>
                </div>
                {!degraded && (
                  <div className="trim-actions">
                    <button className="btn-icon" id="btn-play-pause-clip" title={t('clipModal.playPause')} aria-label={t('clipModal.playPause')} onClick={togglePlayPause}>
                      <svg className={isPlaying ? 'icon-play hidden' : 'icon-play'} viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                      <svg className={isPlaying ? 'icon-pause' : 'icon-pause hidden'} viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                    </button>
                    <div className="trim-volume-control" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button className="btn-icon" id="btn-mute-clip" title={t('clipModal.mute')} aria-label={showVolOff ? t('clipModal.unmute') : t('clipModal.mute')} onClick={handleToggleMute}>
                        <svg className={showVolOff ? 'icon-vol-on hidden' : 'icon-vol-on'} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                        <svg className={showVolOff ? 'icon-vol-off' : 'icon-vol-off hidden'} viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="1" x2="1" y2="23"></line></svg>
                      </button>
                      <input
                        type="range"
                        className="range-input"
                        id="clip-volume-slider"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        style={{ width: 60, ...rangeFillStyle(volume, 0, 1) }}
                        onChange={handleVolumeChange}
                      />
                    </div>
                    <div className="trim-actions-divider" aria-hidden="true"></div>
                    <button className="btn btn-outline btn-xs" id="btn-set-start-clip" onClick={handleSetStart}>{t('clipModal.setStart')}</button>
                    <button className="btn btn-outline btn-xs" id="btn-set-end-clip" onClick={handleSetEnd}>{t('clipModal.setEnd')}</button>
                    <button
                      className={isLooping ? 'btn btn-outline btn-xs' : 'btn btn-outline btn-xs btn-loop-off'}
                      id="btn-loop-clip"
                      style={{ marginLeft: 4, position: 'relative', overflow: 'hidden' }}
                      title={t('clipModal.toggleLoop')}
                      onClick={() => setIsLooping((v) => !v)}
                    >
                      {t('clipModal.loop')}
                    </button>
                  </div>
                )}
              </div>

              <div className="trim-slider-wrapper">
                <div className="trim-time-label left tabular-nums" id="clip-label-start">{formatClipLabel(trimStart)}</div>
                <div className="trim-slider-container" id="clip-slider-container" ref={sliderContainerRef} onMouseDown={handleSliderMouseDown}>
                  <div className="trim-slider-track" id="clip-slider-track">
                    <div className="trim-dim-overlay left" id="clip-dim-left" style={{ width: `${pctStart}%` }}></div>
                    <div className="trim-slider-range" id="clip-slider-range" style={{ left: `${pctStart}%`, width: `${pctEnd - pctStart}%` }}></div>
                    <div className="trim-dim-overlay right" id="clip-dim-right" style={{ width: `${100 - pctEnd}%` }}></div>
                    <div
                      className={draggingThumb === 'left' ? 'trim-slider-thumb left active' : 'trim-slider-thumb left'}
                      id="clip-thumb-left"
                      ref={thumbLeftRef}
                      style={{ left: `${pctStart}%` }}
                      onMouseDown={(e) => {
                        setDraggingThumb('left')
                        snapTargetRef.current = activePlayerRef.current ? activePlayerRef.current.currentTime : null
                        e.preventDefault()
                      }}
                    >
                      <div className="thumb-grip"></div>
                    </div>
                    <div
                      className={draggingThumb === 'right' ? 'trim-slider-thumb right active' : 'trim-slider-thumb right'}
                      id="clip-thumb-right"
                      ref={thumbRightRef}
                      style={{ left: `${pctEnd}%` }}
                      onMouseDown={(e) => {
                        setDraggingThumb('right')
                        snapTargetRef.current = activePlayerRef.current ? activePlayerRef.current.currentTime : null
                        e.preventDefault()
                      }}
                    >
                      <div className="thumb-grip"></div>
                    </div>
                    {!degraded && <div className="trim-playhead" id="clip-playhead" ref={playheadRef}></div>}
                  </div>
                </div>
                <div className="trim-time-label right tabular-nums" id="clip-label-end">{formatClipLabel(trimEnd)}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" id="btn-clear-clip" onClick={handleClear}>{t('clipModal.clearClip')}</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline" id="btn-cancel-clip" onClick={onClose}>{t('clipModal.cancel')}</button>
            <button className="btn btn-primary" id="btn-save-clip" onClick={handleSave}>{t('clipModal.save')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
