import { useEffect, useLayoutEffect, useRef } from 'react'

export interface ContextAction { label: string; run: () => void; disabled?: boolean; danger?: boolean }

export function TopologyContextMenu({ x, y, title, actions, onClose }: {
  x: number; y: number; title: string; actions: ContextAction[]; onClose: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = menu.current!
    const bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y])
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [onClose])

  return <div ref={menu} className="topology-context-menu" role="menu" aria-label={title} style={{ left: x, top: y }} onKeyDown={(event) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const buttons = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const current = buttons.findIndex((button) => button === document.activeElement)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[index]?.focus({ preventScroll: true })
    }
  }}>
    <div role="presentation" className="context-menu-title">{title}</div>
    {actions.map((action) => <button key={action.label} role="menuitem" className={action.danger ? 'danger' : undefined} disabled={action.disabled} onClick={() => { onClose(); action.run() }}>{action.label}</button>)}
  </div>
}
