// Own copy of sorai-toolkit-converter's StatusBar.jsx -- state is
// 'ready' | 'busy' | 'error', mapped to the same dot class names shared via
// resources/styles.css. Version display lives in the hub's own Header.jsx,
// not here -- same reasoning as Converter's copy.
export default function StatusBar({ text = 'Ready', state = 'ready' }) {
  const dotClass =
    state === 'busy'
      ? 'statusbar-indicator busy'
      : state === 'error'
        ? 'statusbar-indicator error'
        : 'statusbar-indicator'

  return (
    <footer className="statusbar">
      <span className={dotClass}></span>
      <span className="statusbar-text" role="status" aria-live="polite">{text}</span>
    </footer>
  )
}
