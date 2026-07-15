import GlassSelect from './GlassSelect.jsx'
import { videoFormatOptionLabel, audioFormatOptionLabel } from '../lib/ytdlp.js'

// Right column: independent video/audio quality pickers, output folder, and
// the download/cancel button -- mirrors sorai-toolkit-converter's
// SettingsPanel.jsx structure (settings-block / panel-divider / execute-row),
// shown once metadata has been fetched (see App.jsx's metadata ?
// DownloadPanel : DownloadIntro swap).
export default function DownloadPanel({
  metadata,
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
  onBrowseOutput,
  downloading,
  progressPercent,
  progressText,
  onStart,
  onCancel,
}) {
  const videoAvailable = metadata.videoFormats.length > 0
  const audioAvailable = metadata.audioFormats.length > 0
  // Disabling the currently-checked box when the other is already unchecked
  // is what enforces "at least one stream stays selected" -- unchecking the
  // last remaining box is simply not possible.
  const videoCheckboxDisabled = downloading || !videoAvailable || (includeVideo && !includeAudio)
  const audioCheckboxDisabled = downloading || !audioAvailable || (includeAudio && !includeVideo)
  const autoMergeDisabled = downloading || !(includeVideo && includeAudio)

  return (
    <section className="panel" id="download-settings">
      <div className="settings-block">
        <p className="settings-subtitle">Format</p>

        <div className="field">
          <div className="field-label-row">
            <label className="field-label" htmlFor="video-format-select">Video quality</label>
            <label className="toggle-check">
              <input
                type="checkbox"
                id="include-video-checkbox"
                checked={includeVideo}
                disabled={videoCheckboxDisabled}
                onChange={toggleIncludeVideo}
              />
              Include video
            </label>
          </div>
          <GlassSelect
            id="video-format-select"
            value={selectedVideoFormatId}
            onChange={(e) => setSelectedVideoFormatId(e.target.value)}
            disabled={downloading || !includeVideo || !videoAvailable}
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
            <label className="field-label" htmlFor="audio-format-select">Audio quality</label>
            <label className="toggle-check">
              <input
                type="checkbox"
                id="include-audio-checkbox"
                checked={includeAudio}
                disabled={audioCheckboxDisabled}
                onChange={toggleIncludeAudio}
              />
              Include audio
            </label>
          </div>
          <GlassSelect
            id="audio-format-select"
            value={selectedAudioFormatId}
            onChange={(e) => setSelectedAudioFormatId(e.target.value)}
            disabled={downloading || !includeAudio || !audioAvailable}
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
            checked={autoMerge}
            disabled={autoMergeDisabled}
            onChange={(e) => setAutoMerge(e.target.checked)}
          />
          Merge into single MP4
        </label>
      </div>

      <div className="panel-divider"></div>

      <div className="settings-block">
        <label className="field-label" htmlFor="output-path">Download folder</label>
        <div className="path-row">
          <input
            type="text"
            className="input"
            id="output-path"
            readOnly
            placeholder="Choose a folder…"
            value={outputPath}
          />
          <button className="btn btn-outline btn-sm" id="btn-select-output" onClick={onBrowseOutput} disabled={downloading}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 4.5c0-.55.45-1 1-1h3.2l1 1.3H13c.55 0 1 .45 1 1v6.2c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V4.5z" />
            </svg>
            Browse
          </button>
        </div>
      </div>

      <div className="panel-divider"></div>

      <div className="execute-row">
        {downloading ? (
          <button type="button" className="btn btn-outline-danger btn-execute" id="btn-download" onClick={onCancel}>
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="8" height="8" /></svg>
            Cancel
          </button>
        ) : (
          <button
            className="btn btn-primary btn-execute"
            id="btn-download"
            disabled={!outputPath || (!includeVideo && !includeAudio)}
            onClick={onStart}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2.5l10 5.5-10 5.5V2.5z" /></svg>
            Start Download
          </button>
        )}
      </div>

      <div id="progress-wrapper" className={downloading ? 'progress-block' : 'progress-block hidden'}>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={Math.round(progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-bar" id="progress-bar" style={{ width: `${progressPercent}%` }}></div>
        </div>
        <p className="progress-label tabular-nums" id="progress-text" role="status" aria-live="polite">
          {progressText}
        </p>
      </div>
    </section>
  )
}
