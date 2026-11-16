import { Component, lazy, Suspense, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { t } from './i18n'
import { CanvasMaximizeButton } from './CanvasPresentation'
import { useCanvasPresentation } from './useCanvasPresentation'
import { WorkspaceSessionContext } from './workspace-context'
import { selectWorkspace, workspaceOriginals, workspaceStartup, workspaceStorageKeys, type WorkspaceProvider } from './workspace-session'

const App = lazy(() => import('./App'))
const AzureNetApp = lazy(() => import('./azure-net/AzureNetApp').then((module) => ({ default: module.AzureNetApp })))
const WorkspaceLibrary = lazy(() => import('./WorkspaceLibrary').then((module) => ({ default: module.WorkspaceLibrary })))
const DesktopTools = lazy(() => import('./DesktopTools').then((module) => ({ default: module.DesktopTools })))
const selectionFailure = 'Workspace could not be selected or preserved. Originals have not been intentionally replaced. Export your design before freeing browser storage.'

class WorkspaceBoundary extends Component<{ children: ReactNode; onRecover: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert">
      <p>{t('Workspace could not load. Your saved design has not been replaced.')}</p>
      <button onClick={() => window.location.reload()}>{t('Reload workspace')}</button>
      <button onClick={this.props.onRecover}>{t('Workspace')}</button>
    </section>
  }
}

export function UnifiedSimulatorRoot() {
  const [startup] = useState(() => workspaceStartup({ getItem: (key) => localStorage.getItem(key) }, location.search, location.hash))
  const [active, setActive] = useState<{ provider: WorkspaceProvider; revision: number; capture?: unknown }>()
  const [libraryOpen, setLibraryOpen] = useState(!startup.provider)
  const [notice, setNotice] = useState(startup.recovery ?? '')
  const { style, maximized } = useCanvasPresentation()
  const request = useRef(0)
  const open = (provider: WorkspaceProvider, replacement?: string, capture?: unknown) => {
    request.current++
    try {
      selectWorkspace(localStorage, provider, replacement)
      setActive((current) => ({ provider, revision: (current?.revision ?? 0) + 1, capture }))
      setLibraryOpen(false); setNotice('')
      const url = new URL(location.href)
      url.searchParams.delete('mode')
      url.searchParams.delete('sample')
      window.history.replaceState(null, '', url)
      return true
    } catch {
      setNotice(selectionFailure)
      return false
    }
  }
  const initialize = useEffectEvent(() => {
    if (startup.provider) {
      try { selectWorkspace(localStorage, startup.provider) }
      catch {
        setNotice('Workspace storage could not preserve the original. Export the saved design before freeing storage.')
        let safe = true
        try {
          const key = workspaceStorageKeys[startup.provider], raw = localStorage.getItem(key)
          safe = raw === null || workspaceOriginals(localStorage).some((entry) => entry.key === key && entry.raw === raw)
        } catch { /* Unavailable storage still permits an explicitly unsaved, in-memory workspace. */ }
        if (!safe) { setLibraryOpen(true); return }
      }
      setActive({ provider: startup.provider, revision: 0 })
      const url = new URL(location.href)
      url.searchParams.delete('mode')
      window.history.replaceState(null, '', url)
    }
  })
  useEffect(() => {
    // Synchronize the selected native provider with external browser storage once.
    // oxlint-disable-next-line react/set-state-in-effect
    initialize()
  }, [])
  const openDocument = async (input: unknown) => {
    const ticket = ++request.current
    const commit = (provider: WorkspaceProvider, replacement?: string, capture?: unknown) => {
      if (ticket === request.current && !open(provider, replacement, capture)) throw new Error(selectionFailure)
    }
    if (!input || typeof input !== 'object') throw new Error('Topology object required.')
    if ('kind' in input && input.kind === 'azure-vwan-capture') {
      const { importAzureCapture } = await import('./azure-import')
      importAzureCapture(input)
      commit('vwan', undefined, input)
    } else if ('kind' in input && input.kind === 'azure-network-capture') {
      const { importAzNetCapture } = await import('./azure-net/azure-import')
      importAzNetCapture(input)
      commit('azure-net', undefined, input)
    } else if ('version' in input && input.version === 1 && !('kind' in input)) {
      const { validateTopology } = await import('./validation')
      const topology = validateTopology(input)
      commit('vwan', JSON.stringify(topology))
    } else {
      const { parseAzNetTopology } = await import('./azure-net/admission')
      const topology = parseAzNetTopology(input)
      commit('azure-net', JSON.stringify({ sampleId: '', topology }))
    }
  }
  const newWorkspace = async () => {
    const ticket = ++request.current
    try {
      const { createEmptyAzNetTopology } = await import('./azure-net/model')
      if (ticket === request.current) open('azure-net', JSON.stringify({ sampleId: '', topology: createEmptyAzNetTopology() }))
    } catch { if (ticket === request.current) setNotice('Workspace could not load. Your saved design has not been replaced.') }
  }
  const importSharedSnapshot = useEffectEvent(async () => {
    if (active?.provider !== 'vwan' || !/(?:#|&)s=/.test(location.hash)) return
    const ticket = ++request.current
    const hash = location.hash
    try {
      const { loadAzWorkspace } = await import('./azure-net/workspace')
      const loaded = loadAzWorkspace({ getItem: () => null }, hash)
      if (loaded.recovery.length) throw new Error('Shared snapshot rejected; the active design is unchanged.')
      if (ticket === request.current) open('azure-net')
    } catch (error) { if (ticket === request.current) setNotice(error instanceof Error ? error.message : 'Shared snapshot rejected.') }
  })
  useEffect(() => {
    const changed = () => { void importSharedSnapshot() }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  return <WorkspaceSessionContext value={{ openLibrary: () => { request.current++; setLibraryOpen(true) }, openDocument, getRequestVersion: () => request.current, capture: active?.capture }}>
    <div className={`simulator-shell${maximized ? ' canvas-maximized' : ''}`} data-canvas-style={style}>
      {notice && !libraryOpen && <p role="alert">{t(notice)}</p>}
      <CanvasMaximizeButton />
      {active && <>
        {window.desktopSimulator && <Suspense fallback={null}>
          <DesktopTools key={`tools:${active.provider}`} mode={active.provider === 'vwan' ? 'vwan' : 'full'} />
        </Suspense>}
        <WorkspaceBoundary key={`${active.provider}:${active.revision}`} onRecover={() => setLibraryOpen(true)}>
          <Suspense fallback={<section aria-label={t('Workspace loading')}><p role="status">{t('Loading workspace…')}</p></section>}>
            {active.provider === 'vwan' ? <App /> : <AzureNetApp simulatorMode="full" />}
          </Suspense>
        </WorkspaceBoundary>
      </>}
      {libraryOpen && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}>
        <WorkspaceLibrary required={!active} notice={notice} onOpen={open} onNew={() => { void newWorkspace() }} onClose={() => setLibraryOpen(false)} />
      </Suspense>}
    </div>
  </WorkspaceSessionContext>
}
