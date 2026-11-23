import { useEffect, useId, useRef, type ButtonHTMLAttributes } from 'react'

export function CloudLibraryButton({ hint, children, onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { hint: string }) {
  const id = useId(), tip = useRef<HTMLSpanElement>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = (button: HTMLButtonElement) => {
    clearTimeout(timer.current)
    const element = tip.current
    if (!element || button.disabled) return
    if (!element.matches(':popover-open')) element.showPopover()
    const anchor = button.getBoundingClientRect(), bounds = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8))}px`
  }
  const hide = () => tip.current?.hidePopover()
  const leave = (button?: HTMLButtonElement) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if ((!button || document.activeElement !== button) && !tip.current?.matches(':hover')) hide()
    }, 150)
  }
  return <>
    <button {...props} type="button" aria-describedby={id} onFocus={event => show(event.currentTarget)} onBlur={hide}
      onPointerEnter={event => show(event.currentTarget)}
      onPointerLeave={event => leave(event.currentTarget)}
      onClick={event => { if (onClick) { hide(); onClick(event) } else show(event.currentTarget) }}>
      {children}
    </button>
    <span ref={tip} id={id} role="tooltip" popover="auto" className="cloud-library-hint"
      onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={() => leave(tip.current?.previousElementSibling as HTMLButtonElement)}>
      {hint}
    </span>
  </>
}

export function CloudLibraryIcon({ action }: { action: 'open' | 'overwrite' | 'edit' | 'share' | 'delete' }) {
  const paths = {
    open: 'M8 3H3v18h18v-5M13 3h8v8M21 3L10 14',
    overwrite: 'M12 16V3M7 8l5-5 5 5M3 16v5h18v-5',
    edit: 'M15 4l5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 15v6Z',
    share: 'M8 11l8-5M8 13l8 5M8 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM22 20a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  }
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[action]} /></svg>
}
