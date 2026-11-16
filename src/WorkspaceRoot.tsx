import { Component, lazy, Suspense, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { t } from './i18n'
import { CanvasMaximizeButton } from './CanvasPresentation'
import { useCanvasPresentation } from './useCanvasPresentation'
import { WorkspaceSessionContext, type WorkspaceEditorHistory } from './workspace-context'
import { selectWorkspace, workspaceOriginals, workspaceStartup, workspaceStorageKeys, type WorkspaceProvider } from './workspace-session'
import { admitPracticeDocument, explicitWorkspaceEntry, practiceConflict, practiceProvider, practiceReadFailure, practiceSaveFailure,
  practiceWorkspaceKey, readPracticeWorkspace, writePracticeWorkspace, type PracticeRequest, type PracticeWorkspace } from './learning/practice-workspace'
import type { PlatformDocument } from './platform/contract'

const App = lazy(() => import('./App'))
const AzureNetApp = lazy(() => import('./azure-net/AzureNetApp').then((module) => ({ default: module.AzureNetApp })))
const WorkspaceLibrary = lazy(() => import('./WorkspaceLibrary').then((module) => ({ default: module.WorkspaceLibrary })))
const DesktopTools = lazy(() => import('./DesktopTools').then((module) => ({ default: module.DesktopTools })))
const PracticeWorkspaceBar = lazy(() => import('./learning/PracticeWorkspaceBar').then((module) => ({ default: module.PracticeWorkspaceBar })))
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
  const [practice, setPractice] = useState<PracticeWorkspace>()
  const [practiceReady, setPracticeReady] = useState(false)
  const [practiceNotice, setPracticeNotice] = useState<'' | 'read' | 'save' | 'conflict'>('')
  const [practiceEpoch, setPracticeEpoch] = useState(0)
  const practiceGeneration = useRef(0)
  const practiceRef = useRef<PracticeWorkspace | undefined>(undefined)
  const practiceRaw = useRef<string | null>(null)
  const practiceBlocked = useRef(false)
  const designHistory = useRef<WorkspaceEditorHistory | undefined>(undefined)
  const practiceHistory = useRef<WorkspaceEditorHistory | undefined>(undefined)
  const { style, maximized } = useCanvasPresentation()
  const request = useRef(0)
  const persistPractice = (next: PracticeWorkspace) => {
    try {
      practiceRaw.current = writePracticeWorkspace(localStorage, next, practiceRaw.current)
      setPracticeNotice('')
    } catch (error) {
      const conflict = error instanceof Error && error.message === practiceConflict
      setPracticeNotice(conflict ? 'conflict' : 'save')
      throw new Error(conflict ? practiceConflict : practiceSaveFailure)
    }
  }
  const leavePractice = () => {
    request.current++
    if (!practiceRef.current?.active) return
    const next = { ...practiceRef.current, active: false }
    practiceRef.current = next; setPractice(next)
    if (!active) setLibraryOpen(true)
    try { persistPractice(next) } catch { /* The visible notice retains the unsaved-session warning. */ }
  }
  const savePractice = (document: PlatformDocument) => {
    if (!practiceRef.current?.active || practiceEpoch !== practiceGeneration.current) throw new Error(practiceSaveFailure)
    const next = { ...practiceRef.current, document }
    practiceRef.current = next; setPractice(next)
    persistPractice(next)
  }
  const openPractice = async (input: PracticeRequest, signal?: AbortSignal) => {
    const ticket = ++request.current
    if (practiceBlocked.current) throw new Error(practiceReadFailure)
    const document = await admitPracticeDocument(input.document)
    if (signal?.aborted || ticket !== request.current) throw new DOMException('Practice opening cancelled.', 'AbortError')
    if (!active) throw new Error('Choose a design workspace before starting practice.')
    const next: PracticeWorkspace = { version: 1, ...input, document, active: true, returnProvider: active.provider }
    persistPractice(next)
    practiceGeneration.current++
    practiceHistory.current = undefined
    practiceRef.current = next; setPractice(next); setPracticeEpoch((epoch) => epoch + 1)
    setActive((current) => current && ({ ...current, capture: undefined }))
    setLibraryOpen(false)
  }
  const resumePractice = () => {
    request.current++
    if (!practiceRef.current) return
    const next = { ...practiceRef.current, active: true, returnProvider: active?.provider ?? practiceRef.current.returnProvider }
    try { persistPractice(next) }
    catch (error) {
      if (error instanceof Error && error.message === practiceConflict) return
      // Session-only resumption keeps unsaved practice accessible for export.
    }
    practiceRef.current = next; setPractice(next); setLibraryOpen(false)
  }
  const discardPractice = () => {
    request.current++
    try {
      if (localStorage.getItem(practiceWorkspaceKey) !== practiceRaw.current) throw new Error(practiceConflict)
      localStorage.removeItem(practiceWorkspaceKey)
      practiceRaw.current = null; practiceRef.current = undefined; practiceHistory.current = undefined
      practiceBlocked.current = false; setPractice(undefined); setPracticeNotice('')
      if (!active) setLibraryOpen(true)
    } catch (error) { setPracticeNotice(error instanceof Error && error.message === practiceConflict ? 'conflict' : 'save') }
  }
  const open = (provider: WorkspaceProvider, replacement?: string, capture?: unknown) => {
    request.current++
    try {
      selectWorkspace(localStorage, provider, replacement)
      designHistory.current = undefined
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
  const initialize = useEffectEvent(async () => {
    const ticket = ++request.current
    let restored: PracticeWorkspace | undefined
    try {
      practiceRaw.current = localStorage.getItem(practiceWorkspaceKey)
      restored = await readPracticeWorkspace(practiceRaw.current)
      if (ticket !== request.current) return
      if (restored?.active && explicitWorkspaceEntry(location.search, location.hash)) {
        restored = { ...restored, active: false }
        try { persistPractice(restored) } catch { /* Explicit incoming designs take precedence, with a visible save warning. */ }
      }
      practiceRef.current = restored; setPractice(restored)
    } catch {
      if (ticket !== request.current) return
      practiceBlocked.current = true; setPracticeNotice('read')
    }
    if (ticket !== request.current) return
    setPracticeReady(true)
    if (restored?.active) {
      setActive({ provider: restored.returnProvider, revision: 0 })
      setLibraryOpen(false)
      return
    }
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
    void initialize()
    return () => {
      // This is a request-generation counter, not a DOM ref.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      request.current++
    }
  }, [])
  const openDocument = async (input: unknown) => {
    const ticket = ++request.current
    if (practiceRef.current?.active) {
      let document: PlatformDocument
      if (input && typeof input === 'object' && 'kind' in input && input.kind === 'azure-vwan-capture') {
        const { importAzureCapture } = await import('./azure-import')
        document = { mode: 'vwan', topology: importAzureCapture(input) }
      } else if (input && typeof input === 'object' && 'kind' in input && input.kind === 'azure-network-capture') {
        const { importAzNetCapture } = await import('./azure-net/azure-import')
        document = { mode: 'full', topology: importAzNetCapture(input).topology }
      } else {
        document = await admitPracticeDocument({
          mode: input && typeof input === 'object' && 'version' in input && input.version === 1 ? 'vwan' : 'full',
          topology: input,
        } as PlatformDocument)
      }
      if (ticket !== request.current) return
      const next = { ...practiceRef.current, document }
      persistPractice(next)
      practiceRef.current = next; setPractice(next)
      practiceGeneration.current++
      practiceHistory.current = undefined; setPracticeEpoch((epoch) => epoch + 1)
      return
    }
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
    if (practiceRef.current?.active && /(?:#|&)s=/.test(location.hash)) {
      const ticket = ++request.current
      try {
        const { loadAzWorkspace } = await import('./azure-net/workspace')
        const loaded = loadAzWorkspace({ getItem: () => null }, location.hash)
        if (loaded.recovery.length) throw new Error('Shared snapshot rejected; the active design is unchanged.')
        if (ticket === request.current && open('azure-net')) leavePractice()
      } catch (error) { if (ticket === request.current) setNotice(error instanceof Error ? error.message : 'Shared snapshot rejected.') }
      return
    }
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
  const practicing = practice?.active === true
  const provider = practicing ? practiceProvider(practice.document) : active?.provider
  const editorKey = practicing ? `practice:${practiceEpoch}:${provider}` : `design:${active?.provider}:${active?.revision}`
  const editorHistory = practicing ? practiceHistory : designHistory
  return <WorkspaceSessionContext value={{
    openLibrary: () => { leavePractice(); request.current++; setLibraryOpen(true) },
    openDocument, getRequestVersion: () => request.current,
    capture: practicing ? undefined : active?.capture,
    openPractice, practice: practicing ? practice : undefined, savePractice,
    getEditorHistory: () => editorHistory.current,
    rememberEditorHistory: (value) => { editorHistory.current = value },
  }}>
    <div className={`simulator-shell${maximized ? ' canvas-maximized' : ''}`} data-canvas-style={style}>
      {notice && !libraryOpen && <p role="alert">{t(notice)}</p>}
      <CanvasMaximizeButton />
      {(practice || practiceNotice) && <Suspense fallback={null}><PracticeWorkspaceBar active={practicing}
        notice={practiceNotice} onReturn={leavePractice} onResume={practice ? resumePractice : undefined} onDiscard={discardPractice} /></Suspense>}
      {!practiceReady && <p role="status">{t('Loading workspace…')}</p>}
      {practiceReady && (active || practicing) && provider && <>
        {window.desktopSimulator && <Suspense fallback={null}>
          <DesktopTools key={`tools:${provider}:${practicing}`} mode={provider === 'vwan' ? 'vwan' : 'full'} />
        </Suspense>}
        <WorkspaceBoundary key={editorKey} onRecover={() => { leavePractice(); setLibraryOpen(true) }}>
          <Suspense fallback={<section aria-label={t('Workspace loading')}><p role="status">{t('Loading workspace…')}</p></section>}>
            {provider === 'vwan' ? <App /> : <AzureNetApp simulatorMode="full" />}
          </Suspense>
        </WorkspaceBoundary>
      </>}
      {practiceReady && libraryOpen && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}>
        <WorkspaceLibrary required={!active} notice={notice} onOpen={open} onNew={() => { void newWorkspace() }}
          onResumePractice={practice && !practicing ? resumePractice : undefined} onClose={() => setLibraryOpen(false)} />
      </Suspense>}
    </div>
  </WorkspaceSessionContext>
}
