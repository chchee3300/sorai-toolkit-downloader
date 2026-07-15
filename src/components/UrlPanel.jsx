import { formatDuration } from '../lib/ytdlp.js'

// Left column: URL input + fetch button, and (once fetched) a thumbnail/
// title/duration preview. Mirrors sorai-toolkit-converter's #input-panel
// slot (panel--ghost, left column of .main-columns) but for a single URL
// instead of a file list.
export default function UrlPanel({ url, setUrl, fetching, fetchError, onFetch, metadata }) {
  return (
    <section className="panel panel--ghost" id="url-panel">
      <div className="settings-block">
        <label className="field-label" htmlFor="video-url">Video URL</label>
        <div className="path-row">
          <input
            type="text"
            className="input"
            id="video-url"
            placeholder="Paste a video URL…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onFetch()
            }}
          />
          <button className="btn btn-primary btn-sm" id="btn-fetch" onClick={onFetch} disabled={fetching || !url.trim()}>
            {fetching ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
      </div>

      {fetchError && (
        <p className="settings-subtitle" id="fetch-error" style={{ color: 'var(--danger)' }}>
          {fetchError}
        </p>
      )}

      {metadata && (
        <>
          <div className="panel-divider"></div>
          <div id="metadata-preview" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            {metadata.thumbnail && (
              <img
                src={metadata.thumbnail}
                alt=""
                id="metadata-thumbnail"
                style={{
                  width: 160,
                  height: 90,
                  objectFit: 'cover',
                  borderRadius: 6,
                  border: '1px solid var(--glass-border)',
                  flexShrink: 0,
                }}
                // Plain <img> rather than a fetch-and-blob-URL workaround --
                // unlike the GitHub-release-asset CORS problem elsewhere in
                // this suite (a fetch() body read blocked by a missing CORS
                // header), an <img> tag's simple display request isn't
                // CORS-gated. If a specific host ever blocks hotlinking,
                // just hide the broken image rather than show one.
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <p className="settings-subtitle" id="metadata-title" style={{ marginBottom: '0.25rem' }}>
                {metadata.title}
              </p>
              {metadata.duration != null && (
                <p className="mono-label tabular-nums" id="metadata-duration">{formatDuration(metadata.duration)}</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
