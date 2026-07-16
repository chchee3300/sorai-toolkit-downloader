// The "add to queue" row: paste a URL, click Fetch (or Enter), it's queued
// and the input clears immediately so the next URL can go in right away --
// the queued item's own metadata fetch happens in the background (see
// QueueList.jsx for how each item's fetch/error/settings state is shown).
// Lives inside the shared #url-panel ghost panel that App.jsx composes
// together with QueueList, mirroring how sorai-toolkit-converter's App.jsx
// wraps FileList + DropZone inside one #input-panel section.
export default function UrlPanel({ url, setUrl, addError, onAdd }) {
  return (
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
            if (e.key === 'Enter') onAdd()
          }}
        />
        <button className="btn btn-primary btn-sm" id="btn-fetch" onClick={onAdd} disabled={!url.trim()}>
          Fetch
        </button>
      </div>
      {addError && (
        <p className="settings-subtitle" id="add-error" style={{ color: 'var(--danger)' }}>
          {addError}
        </p>
      )}
    </div>
  )
}
