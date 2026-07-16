import { formatBytes, formatDuration, videoFormatOptionLabel, audioFormatOptionLabel, combinedFormatOptionLabel } from '../lib/ytdlp.js'
import { useTranslation } from '../hooks/useTranslation.js'

function modeLabel(item, t) {
  if (item.includeVideo && item.includeAudio) return t('queue.mode.both')
  if (item.includeVideo) return t('queue.mode.videoOnly')
  if (item.includeAudio) return t('queue.mode.audioOnly')
  return t('queue.mode.none')
}

function stateLabel(item, t) {
  if (item.fetching) return t('queue.state.fetching')
  if (item.fetchError) return t('queue.state.fetchError')
  switch (item.downloadState) {
    case 'pending': return t('queue.state.pending')
    case 'downloading': return `${Math.round(item.progressPercent)}%`
    case 'done': return t('queue.state.done')
    case 'cancelled': return t('queue.state.cancelled')
    case 'error': return t('queue.state.failed')
    default: return ''
  }
}

function stateClassName(item) {
  if (item.fetchError || item.downloadState === 'error') return 'queue-item-state queue-item-state--error'
  if (item.downloadState === 'done') return 'queue-item-state queue-item-state--done'
  return 'queue-item-state'
}

// One queue row's compact settings summary -- video quality label, audio
// quality label, and total estimated size, so the item's current config is
// readable at a glance without opening it (right panel is where you'd
// actually change any of this). Combined-mode sources (Twitch clips, which
// never split video/audio into separate streams at all) have nothing to
// summarize as a mode -- just the one picked format's own label.
function SettingsSummary({ item, t }) {
  if (item.mode === 'combined') {
    const combined = item.metadata?.combinedFormats.find((f) => f.formatId === item.selectedCombinedFormatId)
    return (
      <div className="queue-item-meta">
        {combined && <span>{combinedFormatOptionLabel(combined)}</span>}
      </div>
    )
  }

  const video = item.metadata?.videoFormats.find((f) => f.formatId === item.selectedVideoFormatId)
  const audio = item.metadata?.audioFormats.find((f) => f.formatId === item.selectedAudioFormatId)
  const totalSize = (item.includeVideo ? video?.filesize || 0 : 0) + (item.includeAudio ? audio?.filesize || 0 : 0)

  const parts = []
  if (item.includeVideo && video) parts.push(videoFormatOptionLabel(video))
  if (item.includeAudio && audio) parts.push(audioFormatOptionLabel(audio))
  if (totalSize > 0) parts.push(t('queue.total', { size: formatBytes(totalSize) }))

  return (
    <div className="queue-item-meta">
      <span className="val-chip secondary">{modeLabel(item, t)}</span>
      {parts.length > 0 && <span>{parts.join(' · ')}</span>}
    </div>
  )
}

function QueueItemRow({ item, selected, onSelect, onRemove }) {
  const { t } = useTranslation()
  return (
    <div
      className={selected ? 'queue-item is-selected' : 'queue-item'}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      {item.metadata?.thumbnail ? (
        <img
          src={item.metadata.thumbnail}
          alt=""
          className="queue-item-thumb"
          onError={(e) => { e.currentTarget.style.visibility = 'hidden' }}
        />
      ) : (
        <div className="queue-item-thumb" />
      )}

      <div className="queue-item-body">
        <p className="queue-item-title">{item.metadata?.title || item.url}</p>
        <p className="queue-item-channel">
          {[
            // Platform badge translated by id (only the generic fallback
            // actually differs across languages -- YouTube/Twitch/X are
            // proper nouns); ytdlp.js's own label field stays for callers
            // outside a React render.
            t(`platform.${item.platform.id}`),
            item.metadata?.channel,
            item.metadata?.duration != null ? formatDuration(item.metadata.duration) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {item.metadata && <SettingsSummary item={item} t={t} />}
        {item.fetchError && <p className="queue-item-meta" style={{ color: 'var(--danger)' }}>{item.fetchError}</p>}
      </div>

      <span className={stateClassName(item)} title={item.errorMessage || undefined}>{stateLabel(item, t)}</span>

      <button
        className="remove"
        aria-label={t('queue.remove')}
        onClick={(e) => { e.stopPropagation(); onRemove() }}
      >
        ×
      </button>
    </div>
  )
}

// Left-panel queue of added videos -- click a row to select it (App.jsx
// swaps the right panel to that item's DownloadPanel). Lives inside the
// same #url-panel ghost panel as UrlPanel's add-row, see App.jsx.
export default function QueueList({ items, selectedItemId, onSelect, onRemove }) {
  if (items.length === 0) return null
  return (
    <div className="queue-list" id="queue-list">
      {items.map((item) => (
        <QueueItemRow
          key={item.id}
          item={item}
          selected={item.id === selectedItemId}
          onSelect={() => onSelect(item.id)}
          onRemove={() => onRemove(item.id)}
        />
      ))}
    </div>
  )
}
