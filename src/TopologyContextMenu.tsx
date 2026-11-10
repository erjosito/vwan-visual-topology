import { t } from './i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextAction { label: string; run?: () => void; onSelect?: () => void; children?: ContextAction[]; disabled?: boolean; danger?: boolean }

function MenuLevel({ x = 0, y = 0, title, actions, anchor, preferredSide = 'right', focusOnOpen, onBack, onClose }: {
  x?: number; y?: number; title: string; actions: ContextAction[]; anchor?: HTMLButtonElement
  preferredSide?: 'left' | 'right'; focusOnOpen: boolean; onBack?: () => void; onClose: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [opened, setOpened] = useState<{ index: number; focus: boolean; anchor: HTMLButtonElement }>()
  const [side, setSide] = useState(preferredSide)
  const cancelHover = () => { clearTimeout(timer.current) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    const position = () => {
      const element = menu.current!
      const bounds = element.getBoundingClientRect()
      const parent = anchor?.getBoundingClientRect()
      let left = x, top = y, nextSide = preferredSide
      if (parent) {
        const leftFits = parent.left - bounds.width + 2 >= 8
        const rightFits = parent.right + bounds.width - 2 <= window.innerWidth - 8
        nextSide = (preferredSide === 'left' || !rightFits) && leftFits ? 'left' : 'right'
        left = nextSide === 'left' ? parent.left - bounds.width + 2 : parent.right - 2
        top = parent.top
      }
      element.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8))}px`
      element.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8))}px`
      setSide(nextSide)
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true) }
  }, [x, y, anchor, preferredSide])
  useLayoutEffect(() => {
    if (focusOnOpen) (menu.current?.querySelector<HTMLButtonElement>('button[data-action]:not(:disabled)') ?? menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true })
  }, [focusOnOpen])
  const open = (index: number, focus: boolean) => {
    cancelHover()
    const anchor = buttons.current[index]
    setOpened(actions[index].children?.length && anchor ? { index, focus, anchor } : undefined)
  }
  const active = opened && actions[opened.index]
  return <>
    <div ref={menu} className="topology-context-menu" role="menu" aria-label={title} style={{ left: x, top: y }} onScroll={() => { cancelHover(); setOpened(undefined) }} onKeyDown={(event) => {
      if (event.key === 'Escape' || event.key === 'ArrowLeft' || event.key === 'Tab') {
        if (event.key !== 'Tab') event.preventDefault()
        event.stopPropagation(); cancelHover()
        if (event.key === 'Tab') onClose()
        else if (onBack) onBack()
        else if (event.key === 'Escape') onClose()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault(); event.stopPropagation()
        const index = buttons.current.findIndex((button) => button === document.activeElement)
        if (index >= 0) open(index, true)
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); cancelHover(); setOpened(undefined)
        const items = Array.from(menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        const current = items.findIndex((button) => button === document.activeElement)
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[index]?.focus({ preventScroll: true })
      }
    }}>
      <div role="presentation" className="context-menu-title">{onBack && <button role="menuitem" className="submenu-back" aria-label={t("Back from {0}", title)} onClick={onBack}><span aria-hidden="true" className="menu-chevron back" /></button>}<span>{title}</span></div>
      {actions.map((action, index) => <button key={index} ref={(element) => { buttons.current[index] = element }} data-action role="menuitem" className={`${action.danger ? 'danger' : ''} ${opened?.index === index ? 'submenu-active' : ''}`} disabled={action.disabled}
        aria-haspopup={action.children?.length ? 'menu' : undefined} aria-expanded={action.children?.length ? opened?.index === index : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'touch' || action.disabled) return
          const bounds = menu.current!.getBoundingClientRect()
          if (bounds.left - bounds.width < 6 && bounds.right + bounds.width > window.innerWidth - 6) return
          cancelHover()
          timer.current = setTimeout(() => { open(index, false); buttons.current[index]?.focus({ preventScroll: true }) }, 140)
        }} onPointerLeave={cancelHover}
        onClick={() => {
          if (action.children?.length) open(index, true)
          else { cancelHover(); onClose(); (action.run ?? action.onSelect)?.() }
        }}><span>{action.label}</span>{action.children?.length ? <span aria-hidden="true" className="menu-chevron" /> : null}</button>)}
    </div>
    {opened && active?.children && <MenuLevel key={opened.index} title={active.label} actions={active.children} anchor={opened.anchor} preferredSide={side} focusOnOpen={opened.focus} onBack={() => { cancelHover(); setOpened(undefined); buttons.current[opened.index]?.focus({ preventScroll: true }) }} onClose={onClose} />}
  </>
}

export function TopologyContextMenu({ x, y, title, actions, onClose }: {
  x: number; y: number; title: string; actions: ContextAction[]; onClose: () => void
}) {
  const tree = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!tree.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', dismiss, true)
    return () => document.removeEventListener('pointerdown', dismiss, true)
  }, [onClose])

  return <div ref={tree} className="context-menu-tree"><MenuLevel key={`${x}:${y}`} x={x} y={y} title={title} actions={actions} focusOnOpen onClose={onClose} /></div>
}
