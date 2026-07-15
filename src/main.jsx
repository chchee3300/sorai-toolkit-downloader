import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// liquid-glass.js explicitly assigns window.LiquidSelect/window.initLiquidGlass,
// so it's safe to bundle as a normal side-effect ES import. neutralino.js is
// NOT imported here -- it's loaded via a real <script src> in index.html
// instead (see that file's comment). Same pattern as sorai-toolkit-converter.
import '../resources/js/liquid-glass.js'

// platform.js attaches to window.EstellaLib.platform -- this repo's own
// dev-harness copy (see resources/js/lib/platform.js's header comment).
// When this component is consumed as a library by the hub, the hub
// supplies its own copy instead; this repo's copy only matters for
// standalone `neu run`/`vite dev` here.
import '../resources/js/lib/platform.js'

if (window.Neutralino) {
  window.Neutralino.init()
  // exitProcessOnClose: false (neutralino.config.json) makes Neutralino
  // intercept the window's close button and emit 'windowClose' instead of
  // actually closing -- without this listener, clicking the close button
  // does nothing and the process is left running in the background (same
  // gotcha documented in the hub's CLAUDE.md).
  window.Neutralino.events.on('windowClose', () => {
    window.Neutralino.app.exit()
  })
}

// App.jsx doesn't provide its own .app-shell wrapper -- that's the hub's
// job when this component is consumed as a library (DownloaderApp renders
// straight into the hub's own .app-shell). This standalone dev-harness
// entry point provides it directly so `neu run` here still lays out
// correctly in isolation (same reasoning as sorai-toolkit-converter's
// main.jsx).
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <div className="app-shell">
      <App />
    </div>
  </StrictMode>,
)
