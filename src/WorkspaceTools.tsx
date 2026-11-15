import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { t } from './i18n'
import { contextActionDisabled } from './context-actions'
import type { ContextAction } from './TopologyContextMenu'
import './workspace-tools.css'

type WorkspaceAction = ContextAction & { testId?: string }
const storageKey = 'aznet-workspace-tools:v1'

function initialOpen() {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'open' || saved === 'closed') return saved === 'open'
  } catch { /* Keep an in-session display preference. */ }
  return window.matchMedia('(min-width: 901px)').matches
}

function visibleActions(actions: WorkspaceAction[], query: string, parents: string[] = []): WorkspaceAction[] {
  return actions.filter((action) => [...parents, action.label].join(' ').toLocaleLowerCase().includes(query)
    || !!action.children?.some((child) => visibleActions([child], query, [...parents, action.label]).length))
}

function ActionBranch({ action, query, parents, onRun }: {
  action: WorkspaceAction; query: string; parents: string[]; onRun: (action: WorkspaceAction) => void
}) {
  const [open, setOpen] = useState(false)
  return <details open={query ? true : undefined} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{action.label}</summary>
    {(open || !!query) && <ActionList actions={action.children!} query={query} parents={parents} onRun={onRun} />}
  </details>
}

function ActionList({ actions, query, parents = [], onRun }: {
  actions: WorkspaceAction[]; query: string; parents?: string[]; onRun: (action: WorkspaceAction) => void
}) {
  return <ul>{visibleActions(actions, query, parents).map((action, index) => {
    const path = [...parents, action.label]
    const disabled = contextActionDisabled(action)
    return <li key={`${action.label}:${index}`}>
      {action.children?.length && !disabled
        ? <ActionBranch action={action} query={query} parents={path} onRun={onRun} />
        : <button type="button" data-testid={action.testId} className={action.danger ? 'danger' : undefined}
          disabled={disabled || !(action.run ?? action.onSelect)} aria-label={path.join(' > ')}
          onClick={() => onRun(action)}>{action.label}</button>}
    </li>
  })}</ul>
}

export function WorkspaceTools({ creationActions, getSelection }: {
  creationActions: WorkspaceAction[]
  getSelection?: () => { title: string; actions: ContextAction[] } | null | undefined
}) {
  const id = useId()
  const [open, setOpen] = useState(initialOpen)
  const [search, setSearch] = useState('')
  const [top, setTop] = useState(0)
  const opener = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const focusSearch = useRef(false)
  useLayoutEffect(() => {
    const header = opener.current?.closest('header')
    if (!header) return
    const update = () => setTop(Math.max(0, header.getBoundingClientRect().bottom))
    const observer = new ResizeObserver(update)
    observer.observe(header)
    const native = document.querySelector('.desktop-tools')
    if (native) observer.observe(native)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    update()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [])
  const changeOpen = (next: boolean, restoreFocus = false) => {
    focusSearch.current = next
    setOpen(next)
    try { localStorage.setItem(storageKey, next ? 'open' : 'closed') } catch { /* Keep the in-session choice. */ }
    if (restoreFocus) opener.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (open && focusSearch.current) {
      input.current?.focus({ preventScroll: true })
      focusSearch.current = false
    }
  }, [open])
  const query = search.trim().toLocaleLowerCase()
  const selection = open ? getSelection?.() : undefined
  const groups = [
    { title: t('Create network objects'), actions: creationActions },
    ...(selection ? [{ title: selection.title, actions: selection.actions }] : []),
  ].filter((group) => visibleActions(group.actions, query).length)
  const run = (action: WorkspaceAction) => {
    if (!window.matchMedia('(min-width: 901px)').matches) changeOpen(false)
    const handler = action.run ?? action.onSelect
    handler?.()
  }
  return <>
    <button type="button" ref={opener} aria-expanded={open} aria-controls={id}
      onClick={() => changeOpen(!open)}>{t('Workspace controls')}</button>
    {open && <>
      <button type="button" className="workspace-tools-backdrop" aria-label={t('Close workspace controls')}
        onClick={() => changeOpen(false, true)} />
      <aside id={id} className="workspace-tools-panel" aria-label={t('Workspace controls')}
        style={{ '--workspace-tools-top': `${top}px` } as CSSProperties}
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.stopPropagation(); changeOpen(false, true)
          }
        }}>
        <div className="workspace-tools-heading"><h2>{t('Workspace controls')}</h2>
          <button type="button" aria-label={t('Close workspace controls')} onClick={() => changeOpen(false, true)}>x</button>
        </div>
        <label className="workspace-tools-search">{t('Search workspace controls')}
          <input ref={input} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {groups.map((group) => <section key={group.title} aria-label={group.title}>
          <h3>{group.title}</h3><ActionList actions={group.actions} query={query} onRun={run} />
        </section>)}
        {!groups.length && <p role="status">{t('No commands match your search.')}</p>}
        {!selection && <p className="muted">{t('Select an object on the canvas for its configuration, routes and connection actions.')}</p>}
      </aside>
    </>}
  </>
}
