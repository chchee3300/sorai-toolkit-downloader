// Library entry point consumed by the sorai-toolkit hub repo (installed as
// a git dependency; built automatically via the "prepare" npm lifecycle
// script -- see vite.lib.config.mjs and package.json). Deliberately does
// NOT import index.css/resources/styles.css -- this component's classNames
// key into the shared stylesheet the hub already loads itself. It also does
// NOT import resources/js/lib/platform.js or liquid-glass.js -- those are
// runtime globals (window.EstellaLib.platform, window.LiquidSelect) the
// host app is responsible for loading before mounting this component,
// exactly like sorai-toolkit-converter.
export { default as DownloaderApp } from './App.jsx'
