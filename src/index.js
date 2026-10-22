// Library entry point consumed by the sorai-toolkit hub repo (installed as
// a git dependency; built automatically via the "prepare" npm lifecycle
// script -- see vite.lib.config.mjs and package.json). Deliberately does
// NOT import index.css/resources/styles.css -- this component's classNames
// key into the shared stylesheet the hub already loads itself. The UI
// runtime globals (window.EstellaLib.i18n, window.LiquidSelect,
// window.SoraiDialogs) and the plugin's Rust half are the host app's to
// provide before mounting, exactly like sorai-toolkit-converter.
export { default as DownloaderApp } from './App.jsx'

// Tauri plugin guest bindings (invoke wrappers for plugin/'s commands).
export * from './plugin.js'
