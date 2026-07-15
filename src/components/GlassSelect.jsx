import { useEffect, useRef } from 'react'

// Wraps a native <select> with liquid-glass.js's LiquidSelect custom
// dropdown (resources/js/liquid-glass.js) -- own copy of
// sorai-toolkit-converter's GlassSelect.jsx (no shared UI package between
// tools yet), same behavior: React owns value/onChange declaratively,
// LiquidSelect.sync() keeps the custom overlay in step.
export default function GlassSelect({ id, value, onChange, disabled, children }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !window.LiquidSelect) return
    window.LiquidSelect.create(el)
    return () => window.LiquidSelect.destroy(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (ref.current && window.LiquidSelect) window.LiquidSelect.sync(ref.current)
  }, [value])

  return (
    <select id={id} className="input" ref={ref} value={value} onChange={onChange} disabled={disabled}>
      {children}
    </select>
  )
}
