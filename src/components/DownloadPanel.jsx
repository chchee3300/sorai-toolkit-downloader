import GlassSelect from './GlassSelect.jsx'
import { videoFormatOptionLabel, audioFormatOptionLabel, combinedFormatOptionLabel } from '../lib/ytdlp.js'
import { useTranslation } from '../hooks/useTranslation.js'

// Right column: shows the currently SELECTED queue item's independent
// video/audio quality pickers, plus the queue-wide output folder and
// Start/Cancel controls -- mirrors sorai-toolkit-converter's
// SettingsPanel.jsx structure (settings-block / panel-divider / execute-row).
// Rendered once at least one item exists (see App.jsx's items.length ?
// DownloadPanel : DownloadIntro swap); `item` is never null here.
export default function DownloadPanel({
  item,
  onUpdateItem,
  onToggleIncludeVideo,
  onToggleIncludeAudio,
  outputPath,
  onBrowseOutput,
  queueRunning,
  itemCount,
  onStart,
  onCancel,
}) {
  const { t } = useTranslation()
  const metadata = item.metadata
  const itemBusy = item.downloadState === 'downloading'
  const videoAvailable = !!metadata && metadata.videoFormats.length > 0
  const audioAvailable = !!metadata && metadata.audioFormats.length > 0
  // Disabling the currently-checked box when the other is already unchecked
  // is what enforces "at least one stream stays selected" -- unchecking the
  // last remaining box is simply not possible. Fields lock only while THIS
  // item is the one actively downloading -- other queued items stay
  // editable even while the queue is running.
  const videoCheckboxDisabled = itemBusy || !videoAvailable || (item.includeVideo && !item.includeAudio)
  const audioCheckboxDisabled = itemBusy || !audioAvailable || (item.includeAudio && !item.includeVideo)
  const autoMergeDisabled = itemBusy || !(item.includeVideo && item.includeAudio)
  const startLabel = t('panel.start', { itemCount })

  return (
    <section className="panel" id="download-settings">
      <div className="settings-block">
        <p className="settings-subtitle">{t('panel.format')}</p>

        {!metadata ? (
          <p className="intro-lede">
            {item.fetching ? t('panel.fetching') : item.fetchError || t('panel.waiting')}
          </p>
        ) : item.mode === 'combined' ? (
          // Source only offers already-muxed formats (e.g. Twitch clips
          // never split video/audio into separate streams) -- one quality
          // picker, no include toggles or merge option since there's
          // nothing to combine.
          <div className="field">
            <label className="field-label" htmlFor="combined-format-select">{t('panel.quality')}</label>
            <GlassSelect
              id="combined-format-select"
              value={item.selectedCombinedFormatId}
              onChange={(e) => onUpdateItem({ selectedCombinedFormatId: e.target.value })}
              disabled={itemBusy || metadata.combinedFormats.length === 0}
            >
              {metadata.combinedFormats.map((f) => (
                <option key={f.formatId} value={f.formatId}>
                  {combinedFormatOptionLabel(f)}
                </option>
              ))}
            </GlassSelect>
          </div>
        ) : (
          <>
            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="video-format-select">{t('panel.videoQuality')}</label>
                <label className="toggle-check">
                  <input
                    type="checkbox"
                    id="include-video-checkbox"
                    checked={item.includeVideo}
                    disabled={videoCheckboxDisabled}
                    onChange={onToggleIncludeVideo}
                  />
                  {t('panel.includeVideo')}
                </label>
              </div>
              <GlassSelect
                id="video-format-select"
                value={item.selectedVideoFormatId}
                onChange={(e) => onUpdateItem({ selectedVideoFormatId: e.target.value })}
                disabled={itemBusy || !item.includeVideo || !videoAvailable}
              >
                {metadata.videoFormats.map((f) => (
                  <option key={f.formatId} value={f.formatId}>
                    {videoFormatOptionLabel(f)}
                  </option>
                ))}
              </GlassSelect>
            </div>

            <div className="field">
              <div className="field-label-row">
                <label className="field-label" htmlFor="audio-format-select">{t('panel.audioQuality')}</label>
                <label className="toggle-check">
                  <input
                    type="checkbox"
                    id="include-audio-checkbox"
                    checked={item.includeAudio}
                    disabled={audioCheckboxDisabled}
                    onChange={onToggleIncludeAudio}
                  />
                  {t('panel.includeAudio')}
                </label>
              </div>
              <GlassSelect
                id="audio-format-select"
                value={item.selectedAudioFormatId}
                onChange={(e) => onUpdateItem({ selectedAudioFormatId: e.target.value })}
                disabled={itemBusy || !item.includeAudio || !audioAvailable}
              >
                {metadata.audioFormats.map((f) => (
                  <option key={f.formatId} value={f.formatId}>
                    {audioFormatOptionLabel(f)}
                  </option>
                ))}
              </GlassSelect>
            </div>

            <label className="toggle-check">
              <input
                type="checkbox"
                id="auto-merge-checkbox"
                checked={item.autoMerge}
                disabled={autoMergeDisabled}
                onChange={(e) => onUpdateItem({ autoMerge: e.target.checked })}
              />
              {t('panel.mergeMp4')}
            </label>
          </>
        )}
      </div>

      <div className="panel-divider"></div>

      <div className="settings-block">
        <label className="field-label" htmlFor="output-path">{t('panel.downloadFolder')}</label>
        <div className="path-row">
          <input
            type="text"
            className="input"
            id="output-path"
            readOnly
            placeholder={t('panel.folderPlaceholder')}
            value={outputPath}
          />
          <button className="btn btn-outline btn-sm" id="btn-select-output" onClick={onBrowseOutput} disabled={queueRunning}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 4.5c0-.55.45-1 1-1h3.2l1 1.3H13c.55 0 1 .45 1 1v6.2c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V4.5z" />
            </svg>
            {t('panel.browse')}
          </button>
        </div>
      </div>

      <div className="panel-divider"></div>

      <div className="execute-row">
        {queueRunning ? (
          <button type="button" className="btn btn-outline-danger btn-execute" id="btn-download" onClick={onCancel}>
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" /></svg>
            {t('panel.cancel')}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-execute"
            id="btn-download"
            disabled={!outputPath}
            onClick={onStart}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2.5l10 5.5-10 5.5V2.5z" /></svg>
            {startLabel}
          </button>
        )}
      </div>

      <div id="progress-wrapper" className={itemBusy ? 'progress-block' : 'progress-block hidden'}>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={Math.round(item.progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-bar" id="progress-bar" style={{ width: `${item.progressPercent}%` }}></div>
        </div>
        <p className="progress-label tabular-nums" id="progress-text" role="status" aria-live="polite">
          {item.progressText}
        </p>
      </div>
    </section>
  )
}
