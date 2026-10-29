import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { RouteMap, RouteMapDirection } from './model'
import { RouteMapRules } from './RouteMapRules'

export function RouteMapPreview({ id, anchor, map, owner, connection, direction, enabled, onEnter, onLeave, onClose }: {
  id: string; anchor: SVGGElement; map: RouteMap; owner: string; connection: string; direction: RouteMapDirection; enabled: boolean
  onEnter: () => void; onLeave: () => void; onClose: () => void
}) {
  const preview = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const position = () => {
      const element = preview.current!, bounds = anchor.getBoundingClientRect()
      let left = bounds.right + 10, top = bounds.top
      let vertical = false
      if (left + element.offsetWidth > window.innerWidth - 8) {
        if (bounds.left - element.offsetWidth - 10 >= 8) left = bounds.left - element.offsetWidth - 10
        else {
          vertical = true
          left = Math.max(8, Math.min(bounds.left, window.innerWidth - element.offsetWidth - 8))
          const above = bounds.top - 18, below = window.innerHeight - bounds.bottom - 18
          element.style.maxHeight = `${Math.max(1, Math.min(420, Math.max(above, below)))}px`
          top = below >= above ? bounds.bottom + 10 : bounds.top - element.offsetHeight - 10
        }
        if (!vertical) element.style.maxHeight = ''
      }
      element.style.left = `${left}px`
      element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - element.offsetHeight - 8))}px`
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    document.addEventListener('keydown', dismiss, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      document.removeEventListener('keydown', dismiss, true)
    }
  }, [anchor, map, onClose])
  return createPortal(<div ref={preview} id={id} role="tooltip" className={`route-map-preview ${direction}`} onPointerEnter={onEnter} onPointerLeave={onLeave}>
    <h3><span className={`policy-tag ${direction}`}>{direction === 'inbound' ? 'IN' : 'OUT'}</span>{map.name}</h3>
    <p>{owner} · {connection}</p>
    {!enabled && <p className="notice">Connection down; configured but inactive.</p>}
    <RouteMapRules map={map} label={`Preview rules for ${map.name}`} />
    <p className="muted">Rules run in order; unmatched routes pass unchanged. Click the marker to inspect or configure. Escape dismisses this preview.</p>
  </div>, document.body)
}
