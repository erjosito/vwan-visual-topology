import { Component, lazy, Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { t } from './i18n'
import { CanvasMaximizeButton } from './CanvasPresentation'
import { useCanvasPresentation } from './useCanvasPresentation'
import { WorkspaceSessionContext, type WorkspaceEditorHistory } from './workspace-context'
import { selectWorkspace, workspaceOriginals, workspaceStartup, workspaceStorageKeys, type WorkspaceProvider } from './workspace-session'
import { practiceWorkspaceKey } from './learning/practice-workspace-key'
import type { PracticeRequest, PracticeWorkspace } from './learning/practice-workspace'
import type { PracticeSession } from './learning/practice-session'
import type { CourseRunner, RunnerState } from './learning/runner'
import { createProgressLedger, guidedProgressKey, legacyProgressKey, recordCompletion, type ProgressLedger, type ProgressLedgerStore } from './learning/progress-ledger'
import { editions, selectedEdition } from './learning/editions'
import { CloudProvider } from './cloud/CloudSession'
import { useCloudSession } from './cloud/useCloudSession'
import { createProgressSync } from './cloud/progress-sync'

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
  return <CloudProvider><Workspace /></CloudProvider>
}

const noSubscribe = () => () => {}
const noSync = () => undefined

function Workspace() {
  const [presentationPreview, setPresentationPreview] = useState(() => {
    try { return localStorage.getItem('aznet-ui-preview:v1') !== 'false' } catch { return true }
  })
  const cloud = useCloudSession()
  const accountId = cloud?.account?.id
  const [startup] = useState(() => workspaceStartup({ getItem: (key) => localStorage.getItem(key) }, location.search, location.hash))
  const [active, setActive] = useState<{ provider: WorkspaceProvider; revision: number; capture?: unknown }>()
  const [libraryOpen, setLibraryOpen] = useState(!startup.provider)
  const [notice, setNotice] = useState(startup.recovery ?? '')
  const [practice, setPractice] = useState<PracticeWorkspace>()
  const [practiceReady, setPracticeReady] = useState(false)
  const [practiceNotice, setPracticeNotice] = useState<'' | 'read' | 'save' | 'conflict' | 'ownership'>('')
  const [practiceEpoch, setPracticeEpoch] = useState(0)
  const [learningView, setLearningView] = useState({ open: false })
  const [learningDetailsOpen, setLearningDetailsOpen] = useState(false)
  const [learning, setLearning] = useState<CourseRunner>()
  const [learningState, setLearningState] = useState<RunnerState>()
  const learningRef = useRef<CourseRunner | undefined>(undefined)
  const learningLoading = useRef<Promise<CourseRunner> | undefined>(undefined)
  const learningCourse = useRef<string | undefined>(undefined)
  const learningRevision = useRef(0)
  const practiceRef = useRef<PracticeSession | undefined>(undefined)
  const practiceLoading = useRef<Promise<PracticeSession> | undefined>(undefined)
  const designHistory = useRef<WorkspaceEditorHistory | undefined>(undefined)
  const practiceHistory = useRef<WorkspaceEditorHistory | undefined>(undefined)
  const [anonymousProgress] = useState(() => createProgressLedger(() => localStorage))
  const anonymousLedger = useSyncExternalStore(anonymousProgress.subscribe, anonymousProgress.getSnapshot)
  const [accountProgress] = useState(() => new Map<string, ProgressLedgerStore>())
  const progressKey = accountId ? `${guidedProgressKey}:account:${encodeURIComponent(accountId)}` : guidedProgressKey
  const progress = useMemo(() => {
    if (!accountId) return anonymousProgress
    let cached = accountProgress.get(progressKey)
    if (!cached) {
      cached = createProgressLedger(() => ({
        getItem: key => key === legacyProgressKey ? null : localStorage.getItem(progressKey),
        setItem: (_key, value) => localStorage.setItem(progressKey, value),
        removeItem: () => localStorage.removeItem(progressKey),
      }))
      accountProgress.set(progressKey, cached)
    }
    return cached
  }, [accountId, progressKey, anonymousProgress, accountProgress])
  const learningIdentity = useRef(progress)
  const learningProgress = useSyncExternalStore(progress.subscribe, progress.getSnapshot)
  const { style, maximized } = useCanvasPresentation()
  const request = useRef(0)
  const loadLearning = useCallback(() => {
    const courseId = selectedEdition(progress.getSnapshot().ledger, practiceRef.current?.current?.courseId).course.id
    if (learningCourse.current !== courseId) {
      learningRef.current?.cancel()
      learningLoading.current = undefined
      learningCourse.current = courseId
    }
    learningLoading.current ??= import('./learning/learning-session').then(({ createLearningSession }) => {
      if (learningCourse.current !== courseId || learningIdentity.current !== progress) throw new Error('Curriculum or account selection changed.')
      const runner = createLearningSession({
        changed: setLearningState,
        completions: progress.getSnapshot().ledger?.completions,
        completed: (completion) => progress.record(completion, practiceRef.current?.owns === true),
        workspace: () => {
          const current = practiceRef.current?.current
          if (!current?.active) return undefined
          const cached = practiceHistory.current
          const document = cached?.provider === 'vwan' && current.document.mode === 'vwan'
            ? { mode: 'vwan' as const, topology: cached.topology }
            : cached?.provider === 'azure-net' && current.document.mode !== 'vwan'
              ? { mode: current.document.mode, topology: cached.topology } : current.document
          return { practice: { ...current, document }, revision: learningRevision.current, scope: request.current }
        },
      }, courseId)
      learningRef.current = runner
      setLearning(runner)
      return runner
    }).catch((error) => {
      if (learningCourse.current === courseId && learningIdentity.current === progress) learningLoading.current = undefined
      throw error
    })
    return learningLoading.current
  }, [progress])
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.storageArea !== localStorage) return
      if (accountId && (event.key === null || [guidedProgressKey, legacyProgressKey].includes(event.key))) anonymousProgress.externalChange(false)
      for (const [key, cached] of accountProgress) {
        if (cached !== progress && (event.key === null || event.key === key)) cached.externalChange(false)
      }
      if (event.key !== null && ![progressKey, ...(accountId ? [] : [legacyProgressKey])].includes(event.key)) return
      const owned = practiceRef.current?.owns === true
      progress.externalChange(owned)
      if (owned) learningRef.current?.cancel()
      else if (learningRef.current && learningCourse.current !== selectedEdition(progress.getSnapshot().ledger, practiceRef.current?.current?.courseId).course.id) {
        void loadLearning().catch(() => learningRef.current?.cancel())
      } else learningRef.current?.replaceProgress(progress.getSnapshot().ledger?.completions ?? [])
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [progress, loadLearning, progressKey, accountId, anonymousProgress, accountProgress])
  const loadPractice = useCallback(() => {
    practiceLoading.current ??= import('./learning/practice-session').then(({ createPracticeSession }) => {
      practiceRef.current = createPracticeSession({
        storage: () => localStorage,
        changed: (next) => { setPractice(next); learningRef.current?.workspaceChanged() },
        notice: setPracticeNotice,
        replaced: () => {
          practiceHistory.current = undefined; learningRevision.current++
          setPracticeEpoch((epoch) => epoch + 1)
        },
      })
      return practiceRef.current
    }).catch((error) => { practiceLoading.current = undefined; throw error })
    return practiceLoading.current
  }, [])
  const applyCloudProgress = useCallback(async (ledger: ProgressLedger) => {
    const expected = progress.getSnapshot()
    const session = await loadPractice()
    if (!await session.acquire()) return false
    try {
      if (learningIdentity.current !== progress || progress.getSnapshot() !== expected) return false
      if (!progress.replace(ledger, session.owns)) return false
      learningRef.current?.cancel()
      if (learningRef.current) await loadLearning()
      learningRef.current?.replaceProgress(ledger.completions)
      return true
    } finally { session.release() }
  }, [loadPractice, progress, loadLearning])
  const sync = useMemo(() => cloud?.api ? createProgressSync(cloud.api, progress, applyCloudProgress) : undefined,
    [cloud?.api, progress, applyCloudProgress])
  const cloudProgressStatus = useSyncExternalStore(sync?.subscribe ?? noSubscribe, sync?.getSnapshot ?? noSync)
  useEffect(() => { sync?.start(); return () => sync?.stop() }, [sync])
  useEffect(() => {
    learningIdentity.current = progress
    learningRef.current?.cancel()
    learningRef.current = undefined; learningLoading.current = undefined; learningCourse.current = undefined
    // Account changes must not reuse a runner whose completion callback belongs to another ledger.
    // oxlint-disable-next-line react/set-state-in-effect
    setLearning(undefined)
    // oxlint-disable-next-line react/set-state-in-effect
    setLearningState(undefined)
  }, [progress])
  const leavePractice = () => {
    request.current++
    practiceRef.current?.leave()
    if (!active) setLibraryOpen(true)
  }
  const openPractice = async (input: PracticeRequest, signal?: AbortSignal) => {
    const ticket = ++request.current
    if (!active) throw new Error('Choose a design workspace before starting practice.')
    const session = await loadPractice()
    await session.open(input, active.provider, () => ticket === request.current, signal)
    if (ticket !== request.current || signal?.aborted) return
    setActive((current) => current && ({ ...current, capture: undefined }))
    setLibraryOpen(false)
  }
  const resumePractice = async () => {
    const ticket = ++request.current
    if (await practiceRef.current?.resume(active?.provider, () => ticket === request.current)) setLibraryOpen(false)
  }
  const discardPractice = async () => {
    const ticket = ++request.current
    if (await practiceRef.current?.discard(() => ticket === request.current) && !active) setLibraryOpen(true)
  }
  const writeProgress = async (reset = false, expected?: typeof learningProgress) => {
    if (reset && progress.getSnapshot() !== expected) return false
    const session = await loadPractice()
    if (!await session.acquire()) return false
    try {
      if (reset && progress.getSnapshot() !== expected) return false
      const success = reset ? progress.reset(session.owns) : progress.retry(session.owns)
      if (success && reset && learningRef.current) {
        if (learningCourse.current !== selectedEdition(progress.getSnapshot().ledger, session.current?.courseId).course.id) await loadLearning()
        else learningRef.current.replaceProgress([])
      }
      return success
    } finally { session.release() }
  }
  const selectLearningEdition = async (courseId: string) => {
    if (!editions.some((entry) => entry.course.id === courseId)) return false
    const session = await loadPractice()
    if (!await session.acquire()) return false
    try {
      if (!progress.enroll(courseId, session.owns)) return false
      learningRef.current?.cancel()
      await loadLearning()
      return true
    } finally { session.release() }
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
    try {
      const raw = localStorage.getItem(practiceWorkspaceKey)
      if (raw !== null) {
        const session = await loadPractice()
        await session.restore(raw, location.search, location.hash, () => ticket === request.current)
      }
    } catch {
      if (ticket !== request.current) return
      try { (await loadPractice()).unreadable() }
      catch { setPracticeNotice('read') }
    }
    if (ticket !== request.current) return
    setPracticeReady(true)
    const restored = practiceRef.current?.current
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
    if (practiceRef.current?.current?.active) {
      await practiceRef.current.importDocument(input, () => ticket === request.current)
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
    if (practiceRef.current?.current?.active && /(?:#|&)s=/.test(location.hash)) {
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
  const provider = practicing ? practice.document.mode === 'vwan' ? 'vwan' : 'azure-net' : active?.provider
  const editorKey = practicing ? `practice:${practiceEpoch}:${provider}` : `design:${active?.provider}:${active?.revision}`
  const editorHistory = practicing ? practiceHistory : designHistory
  return <WorkspaceSessionContext value={{
    presentationPreview, setPresentationPreview: (value) => {
      setPresentationPreview(value)
      try { localStorage.setItem('aznet-ui-preview:v1', String(value)) } catch { /* Keep the choice in this tab. */ }
    },
    openLibrary: () => { leavePractice(); request.current++; setLibraryOpen(true) },
    openDocument, getRequestVersion: () => request.current,
    capture: practicing ? undefined : active?.capture,
    openPractice, practice: practicing ? practice : undefined,
    savePractice: (document) => practiceRef.current?.save(document, practiceEpoch),
    getEditorHistory: () => editorHistory.current,
    rememberEditorHistory: (value) => {
      const changed = editorHistory.current?.topology !== value.topology
      editorHistory.current = value
      if (practicing && changed) { learningRevision.current++; learningRef.current?.workspaceChanged() }
    },
    selectLearningEdition, learningDetailsOpen, setLearningDetailsOpen,
    learningView, setLearningView: (view) => {
      if (!view.open) learningRef.current?.cancel()
      setLearningView(view)
    },
    loadLearning, learning, learningState,
    reportLearningObservation: (event) => learningRef.current?.observe(event),
    learningProgress, resetLearningProgress: (expected) => writeProgress(true, expected),
    retryLearningProgress: () => writeProgress(),
    backupLearningProgress: progress.backup,
    cloudProgress: accountId ? {
      status: cloudProgressStatus,
      refresh: (choice) => sync?.refresh(choice),
      hasAnonymousProgress: !!anonymousLedger.ledger?.completions.length && ['saved', 'session', 'ownership'].includes(anonymousLedger.status),
      importAnonymous: async () => {
        const source = anonymousProgress.getSnapshot()
        if (!['saved', 'session', 'ownership'].includes(source.status)) return false
        const local = source.ledger
        let next = progress.getSnapshot().ledger
        if (!local || !next || !cloudProgressStatus || ['loading', 'conflict'].includes(cloudProgressStatus)) return false
        for (const completion of local.completions) next = recordCompletion(next, completion)
        if (!next.enrollment && local.enrollment) next = { ...next, enrollment: local.enrollment }
        return applyCloudProgress(next)
      },
    } : undefined,
  }}>
    <div className={`simulator-shell${maximized ? ' canvas-maximized' : ''}`} data-canvas-style={style} data-ui-preview={presentationPreview || undefined}>
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
