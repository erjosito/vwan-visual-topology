import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { t, useLanguage } from './i18n'
import { contextActionDisabled } from './context-actions'
import type { ContextAction } from './TopologyContextMenu'
import { workspaceIdentityKey } from './workspace-objects'
import type { WorkspaceIdentity, WorkspaceObject } from './workspace-objects'
import './workspace-tools.css'
import { workspaceCapabilities, workspaceCapabilityLimits } from './workspace-capabilities'
import { workspaceCapabilitiesJa } from './workspace-capabilities-ja'
import { useWorkspaceSession } from './workspace-context'

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

export function WorkspaceTools<Selection>({ creationActions, getSelection, inventory, dismissRequest = 0, openRequest = 0 }: {
  creationActions: WorkspaceAction[]
  dismissRequest?: number
  openRequest?: number
  getSelection?: () => { title: string; actions: ContextAction[] } | null | undefined
  inventory?: {
    getObjects: () => readonly WorkspaceObject<Selection>[]
    selected?: WorkspaceIdentity
    onSelect: (selection: Selection) => void
  }
}) {
  const id = useId()
  const language = useLanguage()
  const preview = useWorkspaceSession()?.presentationPreview
  const capabilityText = (message: string) => language === 'ja' ? workspaceCapabilitiesJa[message] ?? message : message
  const [visibility, setVisibility] = useState(() => ({ open: initialOpen(), request: dismissRequest, openRequest }))
  const requested = visibility.openRequest !== openRequest
  const open = requested || visibility.open && visibility.request === dismissRequest
  const [search, setSearch] = useState('')
  if (requested) {
    setVisibility({ open: true, request: dismissRequest, openRequest })
    setSearch('')
  }
  const [top, setTop] = useState(0)
  const [objectsOpen, setObjectsOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const selectionHeading = useRef<HTMLHeadingElement>(null)
  const focusSelection = useRef(false)
  const focusSearch = useRef(false)
  const lastOpenRequest = useRef(openRequest)
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
    setVisibility({ open: next, request: dismissRequest, openRequest })
    try { localStorage.setItem(storageKey, next ? 'open' : 'closed') } catch { /* Keep the in-session choice. */ }
    if (restoreFocus) opener.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (open && (focusSearch.current || lastOpenRequest.current !== openRequest)) {
      input.current?.focus({ preventScroll: true })
      focusSearch.current = false
    }
    lastOpenRequest.current = openRequest
  }, [open, openRequest])
  useEffect(() => {
    if (focusSelection.current || selectionHeading.current === document.activeElement) {
      focusSelection.current = false
      const target = selectionHeading.current ?? input.current
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      target?.focus({ preventScroll: true })
    }
  })
  const query = search.trim().toLocaleLowerCase()
  const selection = open ? getSelection?.() : undefined
  const needsObjects = open && (objectsOpen || !!query)
  const getObjects = inventory?.getObjects
  const objects = useMemo(() => needsObjects ? getObjects?.() ?? [] : [], [needsObjects, getObjects])
  const matches = objects.filter((object) => [t(object.kindLabel), object.name, object.label ?? '',
    object.identity.id, object.identity.ownerId ?? '', ...object.parents, ...object.searchTerms]
    .join(' ').toLocaleLowerCase().includes(query))
  const selectedKey = inventory?.selected ? workspaceIdentityKey(inventory.selected) : undefined
  const capabilityMatches = workspaceCapabilities.filter((row) =>
    [t('Capability coverage'), capabilityText(row.feature)].join(' ').toLocaleLowerCase().includes(query))
  const groups = [
    { title: t('Create network objects'), actions: creationActions, selection: false },
    ...(selection ? [{ title: selection.title, actions: selection.actions, selection: true }] : []),
  ].filter((group) => visibleActions(group.actions, query).length)
  if (preview) groups.sort((a, b) => Number(b.selection) - Number(a.selection))
  const run = (action: WorkspaceAction) => {
    if (!window.matchMedia('(min-width: 901px)').matches) changeOpen(false, true)
    const handler = action.run ?? action.onSelect
    handler?.()
  }
  const chooseObject = (object: WorkspaceObject<Selection>) => {
    const narrow = !window.matchMedia('(min-width: 901px)').matches
    if (narrow) changeOpen(false, true)
    else {
      input.current?.focus({ preventScroll: true })
      focusSelection.current = true
    }
    setObjectsOpen(false)
    setSearch('')
    inventory?.onSelect(object.selection)
  }
  const actionSections = groups.map((group) => <section key={group.title} aria-label={group.title}>
    {preview && !group.selection && selection && !query ? <details>
      <summary>{group.title}</summary>
      <ActionList actions={group.actions} query={query} onRun={run} />
    </details> : <>
      <h3 ref={group.selection ? selectionHeading : undefined} tabIndex={group.selection ? -1 : undefined}>{group.title}</h3>
      <ActionList actions={group.actions} query={query} onRun={run} />
    </>}
  </section>)
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
        {preview && actionSections}
        {(!query || capabilityMatches.length > 0) && <details className="workspace-tools-objects" data-testid="workspace-capabilities" open={query ? true : undefined}>
          <summary>{t('Capability coverage')}</summary>
          <div style={{ overflowX: 'auto' }}>
            <table><thead><tr><th>{t('Capability')}</th><th>{t('Dedicated VWAN')}</th><th>{t('Classic networking')}</th><th>{t('Mixed networking')}</th></tr></thead>
              <tbody>{capabilityMatches.map((row) => <tr key={row.feature}><th scope="row">{capabilityText(row.feature)}</th>
                {(['vwan', 'classic', 'mixed'] as const).map((provider) => <td key={provider}>{t(row[provider] ? 'Supported' : 'Not applicable')}</td>)}
              </tr>)}</tbody></table>
          </div>
          {workspaceCapabilityLimits.map((limit) => <p className="muted" key={limit}>{capabilityText(limit)}</p>)}
        </details>}
        {inventory && (!query || matches.length > 0) && <details className="workspace-tools-objects"
          open={objectsOpen || !!query} onToggle={(event) => setObjectsOpen(event.currentTarget.open)}>
          <summary>{t('Find objects')}</summary>
          {(objectsOpen || !!query) && <>
            <ul aria-label={t('Objects in this design')}>{matches.slice(0, 100).map((object) => {
              const key = workspaceIdentityKey(object.identity)
              const title = t('Select {0}: {1}', t(object.kindLabel), object.label ?? object.name)
              const parents = [...new Set(object.parents)].join(' / ')
              return <li key={key}><button type="button" aria-pressed={key === selectedKey}
                title={object.identity.ownerId
                  ? t('Object ID: {0}; VNet ID: {1}', object.identity.id, object.identity.ownerId)
                  : t('Object ID: {0}', object.identity.id)}
                aria-label={parents ? t('{0} ({1})', title, parents) : title} onClick={() => chooseObject(object)}>
                <span>{title}{object.enabled === false && <span className="muted"> · {t('Disabled')}</span>}</span>
                {parents && <small>{parents}</small>}
              </button></li>
            })}</ul>
            {!matches.length && <p role="status">{t('No selectable objects in this design.')}</p>}
            {matches.length > 100 && <p role="status">{t('Showing {0} of {1} objects. Refine your search to find others.', 100, matches.length)}</p>}
          </>}
        </details>}
        {!preview && actionSections}
        {!groups.length && !matches.length && !capabilityMatches.length && <p role="status">{t('No commands match your search.')}</p>}
        {!selection && <p className="muted">{t('Select an object on the canvas or find it here for its configuration, routes and connection actions.')}</p>}
      </aside>
    </>}
  </>
}
