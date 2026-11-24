import { t } from './i18n'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { hasPendingConfiguration } from './configuration-selection'
import { useWorkspaceSession } from './workspace-context'

export function CanvasOverlay({ title, children, onClose, className = '', focusOnOpen = true, restoreFocus = false }: {
  title: string; children: ReactNode; onClose: () => void; className?: string; focusOnOpen?: boolean
  restoreFocus?: boolean
}) {
  const panel = useRef<HTMLDivElement>(null)
  const session = useWorkspaceSession()
  const [configurationOwner] = useState(() => session?.configurationPending)
  const configurationKey = useId()
  useLayoutEffect(() => {
    const element = panel.current
    if (!element || !configurationOwner) return
    const update = () => configurationOwner.set(configurationKey, hasPendingConfiguration(element))
    const observer = new MutationObserver(update)
    observer.observe(element, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-configuration-pending', 'data-configuration-saved', 'value', 'checked', 'selected'] })
    const events = ['input', 'change', 'focusout', 'reset']
    for (const event of events) element.addEventListener(event, update, true)
    update()
    return () => {
      observer.disconnect()
      for (const event of events) element.removeEventListener(event, update, true)
      configurationOwner.delete(configurationKey)
    }
  }, [configurationOwner, configurationKey])
  const [position, setPosition] = useState<{ x: number; y: number }>()
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined)
  useLayoutEffect(() => {
    if (!restoreFocus) return
    const opener = document.activeElement
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }) }
  }, [restoreFocus])
  useEffect(() => {
    const element = panel.current!
    if (focusOnOpen && !element.contains(document.activeElement)) element.focus({ preventScroll: true })
    const observer = new ResizeObserver(() => setPosition((current) => {
      if (!current) return current
      const parent = element.offsetParent as HTMLElement
      const x = Math.max(0, Math.min(parent.clientWidth - element.offsetWidth, current.x))
      const y = Math.max(0, Math.min(parent.clientHeight - 48, current.y))
      return x === current.x && y === current.y ? current : { x, y }
    }))
    observer.observe(element)
    observer.observe(element.offsetParent!)
    return () => observer.disconnect()
  }, [focusOnOpen])
  return <div ref={panel} role="dialog" tabIndex={-1} aria-label={title} className={`canvas-overlay ${className}`} style={position ? { left: position.x, top: position.y, right: 'auto' } : undefined} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
  }}>
    <div className="overlay-heading" onPointerDown={(event) => {
      if ((event.target as Element).closest('button')) return
      const element = panel.current!
      drag.current = { x: event.clientX, y: event.clientY, left: element.offsetLeft, top: element.offsetTop }
      event.currentTarget.setPointerCapture(event.pointerId)
    }} onPointerMove={(event) => {
      if (!drag.current) return
      const element = panel.current!
      const parent = element.offsetParent as HTMLElement
      setPosition({
        x: Math.max(0, Math.min(parent.clientWidth - element.offsetWidth, drag.current.left + event.clientX - drag.current.x)),
        y: Math.max(0, Math.min(parent.clientHeight - 48, drag.current.top + event.clientY - drag.current.y)),
      })
    }} onPointerUp={() => { drag.current = undefined }} onLostPointerCapture={() => { drag.current = undefined }}>
      <div><p className="eyebrow">{t("CANVAS INSPECTOR · DRAG TO MOVE")}</p><h2>{title}</h2></div>
      <div className="row"><button aria-label={t("Move {0} to left", title)} onClick={() => setPosition({ x: 12, y: 12 })}>{t("Left")}</button><button aria-label={t("Move {0} to right", title)} onClick={() => setPosition(undefined)}>{t("Right")}</button><button aria-label={t("Close {0}", title)} onClick={onClose}>{t("Close")}</button></div>
    </div>
    <div className="overlay-content">{children}</div>
  </div>
}
