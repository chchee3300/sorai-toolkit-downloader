import { useTranslation } from '../hooks/useTranslation.js'

// Right-column placeholder shown before any URL has been queued, so the
// two-panel layout has something in both columns on first paint -- same
// role as sorai-toolkit-converter's ToolIntro.jsx. Copy lives in
// src/i18n/dict.js (intro.*) -- which also fixed the stale "click Fetch"
// wording left over from before the button was renamed to "Add".
export default function DownloadIntro() {
  const { t } = useTranslation()
  return (
    <section className="panel" id="download-intro">
      <div className="settings-block">
        <p className="settings-subtitle">{t('intro.about')}</p>
        <p className="intro-lede">{t('intro.lede')}</p>
      </div>
    </section>
  )
}
