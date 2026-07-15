import GlassSelect from './GlassSelect.jsx'
import { formatOptionLabel } from '../lib/ytdlp.js'

// Right column: format picker, output folder, and the download/cancel
// button -- mirrors sorai-toolkit-converter's SettingsPanel.jsx structure
// (settings-block / panel-divider / execute-row), shown once metadata has
// been fetched (see App.jsx's metadata ? DownloadPanel : DownloadIntro swap).
export default function DownloadPanel({
  metadata,
  selectedFormatId,
  setSelectedFormatId,
  outputPath,
  onBrowseOutput,
  downloading,
  progressPercent,
  progressText,
  onStart,
  onCancel,
}) {
  return (
    <section className="panel" id="download-settings">
      <div className="settings-block">
        <p className="settings-subtitle">Format</p>
        <div className="field">
          <label className="field-label" htmlFor="format-select">Quality / format</label>
          <GlassSelect
            id="format-select"
            value={selectedFormatId}
            onChange={(e) => setSelectedFormatId(e.target.value)}
            disabled={downloading}
          >
            {metadata.formats.map((f) => (
              <option key={f.formatId} value={f.formatId}>
                {formatOptionLabel(f)}
              </option>
            ))}
          </GlassSelect>
        </div>
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
            disabled={!outputPath}
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
