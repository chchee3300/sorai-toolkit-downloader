// Right-column placeholder shown before any URL has been fetched, so the
// two-panel layout has something in both columns on first paint -- same
// role as sorai-toolkit-converter's ToolIntro.jsx.
export default function DownloadIntro() {
  return (
    <section className="panel" id="download-intro">
      <div className="settings-block">
        <p className="settings-subtitle">About this tool</p>
        <p className="intro-lede">
          Paste a video URL on the left and click Fetch to see its title, thumbnail, and duration.
          Then pick a format and a download folder here.
        </p>
      </div>
    </section>
  )
}
