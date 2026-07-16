import { useTranslation } from '../hooks/useTranslation.js'

// The "add to queue" row: paste a URL, click Add (or Enter), it's queued
// and the input clears immediately so the next URL can go in right away --
// the queued item's own metadata fetch happens in the background (see
// QueueList.jsx for how each item's fetch/error/settings state is shown).
// Lives inside the shared #url-panel ghost panel that App.jsx composes
// together with the queue header + QueueList, mirroring how
// sorai-toolkit-converter's App.jsx wraps FileList + DropZone inside one
// #input-panel section -- element ids (video-url/btn-fetch) are kept as-is
// even though the visible label/button text reads "Add Video"/"Add" now,
// so existing test selectors don't need to change.
export default function UrlPanel({ url, setUrl, addError, onAdd }) {
  const { t } = useTranslation()
  return (
    <div className="settings-block">
      <label className="field-label" htmlFor="video-url">{t('urlPanel.label')}</label>
      <div className="path-row">
        <input
          type="text"
          className="input"
          id="video-url"
          placeholder={t('urlPanel.placeholder')}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAdd()
          }}
        />
        <button className="btn btn-primary btn-sm" id="btn-fetch" onClick={onAdd} disabled={!url.trim()}>
          {t('urlPanel.add')}
        </button>
      </div>
      {addError && (
        <p className="settings-subtitle" id="add-error" style={{ color: 'var(--danger)' }}>
          {/* addError holds a dict key (e.g. 'error.enterUrl') -- t() falls
              back to returning the key verbatim for anything not in the
              dict, so raw passthrough text would still render. */}
          {t(addError)}
        </p>
      )}
    </div>
  )
}
