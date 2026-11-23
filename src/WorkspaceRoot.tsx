import { Component, lazy, Suspense, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { t, useLanguage } from './i18n'
import { randomUUID } from './random-id'
import { CanvasMaximizeButton } from './CanvasPresentation'
import { useCanvasPresentation } from './useCanvasPresentation'
import { WorkspaceSessionContext, WorkspaceTabsContext, type WorkspaceEditorHistory } from './workspace-context'
import { selectWorkspace, workspaceSessionKey, workspaceStartup, workspaceStorageKeys, type WorkspaceProvider, type WorkspaceStorage } from './workspace-session'
import { addWorkspaceTab, closeWorkspaceTabs, reopenWorkspaceTab, readWorkspaceTabs, workspaceTabKey, workspaceTabsKey, workspaceTabsLimit, writeWorkspaceTabs, type WorkspaceTabs, type WorkspaceTab } from './workspace-tabs'
import { createWorkspaceDocuments } from './workspace-documents'
import { WorkspaceTabs as WorkspaceTabsNavigation } from './WorkspaceTabs'
import { confirmConfigurationSwitch } from './configuration-selection'
import { useWorkspaceOwnership } from './useWorkspaceOwnership'
import { practiceWorkspaceKey } from './learning/practice-workspace-key'
import type { PracticeRequest, PracticeWorkspace } from './learning/practice-workspace'
import type { PracticeSession } from './learning/practice-session'
import type { CourseRunner, RunnerState } from './learning/runner'
import { createProgressLedger, guidedProgressKey, legacyProgressKey, recordCompletion, type ProgressLedger, type ProgressLedgerStore } from './learning/progress-ledger'
import { editions, selectedEdition } from './learning/editions'
import { CloudProvider } from './cloud/CloudSession'
import { useCloudSession } from './cloud/useCloudSession'
import { cloudDocumentKey, createDocumentSaveState, type CloudDocumentSource } from './cloud/document-state'
import { createDocumentRuntime, desktopArtifact } from './document-runtime'
import type { ArtifactDestination } from './document-commands'

const App = lazy(() => import('./App'))
const AzureNetApp = lazy(() => import('./azure-net/AzureNetApp').then((module) => ({ default: module.AzureNetApp })))
const WorkspaceLibrary = lazy(() => import('./WorkspaceLibrary').then((module) => ({ default: module.WorkspaceLibrary })))
const DesktopTools = lazy(() => import('./DesktopTools').then((module) => ({ default: module.DesktopTools })))
const PracticeWorkspaceBar = lazy(() => import('./learning/PracticeWorkspaceBar').then((module) => ({ default: module.PracticeWorkspaceBar })))
const SharedTopology = lazy(() => import('./cloud/SharedTopology'))
const CloseDocumentsDialog = lazy(() => import('./CloseDocumentsDialog').then(module => ({ default: module.CloseDocumentsDialog })))
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
  const sharedHash = () => /(?:#|&)(?:share|s)=/.test(location.hash) ? location.hash : ''
  const [sharing, setSharing] = useState(sharedHash)
  const [workspaceStarted, setWorkspaceStarted] = useState(() => !sharedHash())
  useEffect(() => {
    const changed = () => { const hash = sharedHash(); setSharing(hash); if (!hash) setWorkspaceStarted(true) }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  return <CloudProvider>
    {workspaceStarted && <div hidden={!!sharing}><Workspace visible={!sharing} /></div>}
    {sharing && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}>
      <SharedTopology key={sharing} hash={sharing} modal={workspaceStarted} onReturn={() => {
        const url = new URL(location.href)
        url.hash = ''; url.searchParams.delete('sample'); url.searchParams.delete('mode')
        history.replaceState(null, '', url)
        setSharing(''); setWorkspaceStarted(true)
      }} />
    </Suspense>}
  </CloudProvider>
}

const noSubscribe = () => () => {}
const noSync = () => undefined
const rootStorage: WorkspaceStorage = {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
}
const emptyVwan = '{"version":1,"name":"New topology","hubs":[],"sites":[],"spokes":[],"connections":[],"siteLinks":[],"routeMaps":[]}'

function Workspace({ visible = true }: { visible?: boolean }) {
  const visibleRef = useRef(visible)
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const [presentationPreview, setPresentationPreview] = useState(() => {
    try { return localStorage.getItem('aznet-ui-preview:v1') !== 'false' } catch { return true }
  })
  const cloud = useCloudSession()
  const accountId = cloud?.account?.id
  const accountRef = useRef(accountId)
  const cloudRef = useRef(cloud)
  const languageRef = useRef(language)
  useLayoutEffect(() => { cloudRef.current = cloud; languageRef.current = language }, [cloud, language])
  useLayoutEffect(() => { accountRef.current = accountId }, [accountId])
  const [documentSave] = useState(() => {
    const state = createDocumentSaveState(() => sessionStorage)
    return state
  })
  const [startup] = useState(() => workspaceStartup({ getItem: (key) => localStorage.getItem(key) }, location.search, location.hash))
  const [tabsStartup] = useState(() => readWorkspaceTabs(rootStorage))
  const ownership = useWorkspaceOwnership(tabsStartup.recovery === 'unavailable')
  const [storage] = useState<WorkspaceStorage>(() => {
    const values = new Map<string, string | null>()
    const writable = () => {
      if (!['owned', 'memory', 'blocked'].includes(ownership.current.current)) throw new Error('Workspace profile ownership is unavailable.')
    }
    return {
      getItem: key => {
        if (values.has(key)) return values.get(key) ?? null
        if (tabsStartup.recovery === 'unavailable' || ownership.current.current !== 'owned' && key.endsWith(':cloud')) return null
        return rootStorage.getItem(key)
      },
      setItem: (key, value) => {
        writable()
        if (ownership.current.current === 'owned') rootStorage.setItem(key, value)
        else values.set(key, value)
      },
      removeItem: key => {
        writable()
        if (ownership.current.current === 'owned') rootStorage.removeItem(key)
        else values.set(key, null)
      },
    }
  })
  const [tabs, setTabs] = useState<WorkspaceTabs>(() => tabsStartup.session ?? { version: 1, tabs: [] })
  const tabsRef = useRef(tabs)
  const [runtime] = useState(() => createDocumentRuntime(() => cloudRef.current, () => languageRef.current,
    () => ownership.current.current === 'owned'))
  const [documents] = useState(() => createWorkspaceDocuments(storage, () => ownership.current.current === 'owned', runtime.initialize))
  const [active, setActive] = useState<{ id: string; provider: WorkspaceProvider; revision: number }>()
  const [libraryOpen, setLibraryOpen] = useState(tabsStartup.recovery === 'invalid' || !startup.provider && !tabs.activeId)
  const [notice, setNotice] = useState(tabsStartup.recovery
    ? 'The workspace tab session could not be read. Its stored designs have not been replaced.' : startup.recovery ?? '')
  const [closing, setClosing] = useState<{ tabs: WorkspaceTab[]; after?: () => void }>()
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
  const practiceHistory = useRef<WorkspaceEditorHistory | undefined>(undefined)
  const practiceEditorState = useRef(new Map<string, unknown>())
  const design = active ? documents.get({ id: active.id, provider: active.provider, name: '' }) : undefined
  const designRef = useRef(design)
  const initialized = useRef(false)
  useLayoutEffect(() => { designRef.current = design }, [design])
  const activeSave = design?.save ?? documentSave
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
  const { style, maximized, headerActionsOpen } = useCanvasPresentation()
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
        completed: (completion) => learningIdentity.current === progress && progress.record(completion, practiceRef.current?.owns === true),
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
        changed: (next) => {
          if (next?.active) documents.suspend()
          else if (designRef.current) documents.activate({ id: designRef.current.id, provider: designRef.current.provider, name: '' })
          setPractice(next); learningRef.current?.workspaceChanged()
        },
        notice: setPracticeNotice,
        replaced: () => {
          practiceHistory.current = undefined; learningRevision.current++
          practiceEditorState.current = new Map()
          setPracticeEpoch((epoch) => epoch + 1)
        },
      })
      return practiceRef.current
    }).catch((error) => { practiceLoading.current = undefined; throw error })
    return practiceLoading.current
  }, [documents])
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
  const api = cloud?.api, progressSync = cloud?.progressSync
  const sync = useMemo(() => api && progressSync ? progressSync(api, progress, applyCloudProgress) : undefined,
    [api, progressSync, progress, applyCloudProgress])
  const cloudProgressStatus = useSyncExternalStore(sync?.subscribe ?? noSubscribe, sync?.getSnapshot ?? noSync)
  useEffect(() => { sync?.start(); return () => sync?.stop() }, [sync])
  useLayoutEffect(() => {
    learningIdentity.current = progress
    learningRef.current?.cancel()
    learningRef.current = undefined; learningLoading.current = undefined; learningCourse.current = undefined
    // Invalidate account-bound callbacks before the sidebar's passive loading effect runs.
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
    if (!active) throw new Error(text('Open a topology before starting practice.', '練習を開始する前にトポロジを開いてください。'))
    const session = await loadPractice()
    await session.open(input, active.provider, () => ticket === request.current, signal)
    if (ticket !== request.current || signal?.aborted) return
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
  const syncProviderUrl = (provider: WorkspaceProvider, preserveQuery = false) => {
    const url = new URL(location.href)
    if (ownership.current.current === 'owned') url.searchParams.delete('mode')
    else url.searchParams.set('mode', provider === 'vwan' ? 'vwan' : 'full')
    if (!preserveQuery) url.searchParams.delete('sample')
    window.history.replaceState(null, '', url)
  }
  const open = (provider: WorkspaceProvider, replacement?: string, capture?: unknown, preserveQuery = false, candidateId?: string) => {
    if (!visibleRef.current) return false
    if (!preserveQuery && active && !confirmConfigurationSwitch('.object-editor, .aznet-inspector-window')) return false
    if (tabsRef.current.tabs.length >= workspaceTabsLimit) {
      setNotice(text('Close a tab before opening another (maximum 16). Closed designs remain available in Workspace recovery.', '別のタブを開くにはタブを閉じてください (最大16)。閉じたデザインはワークスペースから復元できます。'))
      return false
    }
    request.current++
    try {
      if (tabsStartup.recovery === 'invalid' && ownership.current.current === 'owned') throw new Error('The tab session requires recovery.')
      const raw = replacement ?? storage.getItem(workspaceStorageKeys[provider]) ?? (provider === 'vwan' ? emptyVwan : undefined)
      if (raw === undefined) throw new Error('Topology data is unavailable.')
      let name = 'Untitled topology'
      try { const parsed = JSON.parse(raw); if (typeof (parsed.topology ?? parsed).name === 'string') name = (parsed.topology ?? parsed).name.slice(0, 120) } catch {}
      const tab = { id: candidateId ?? randomUUID(), provider, name }
      selectWorkspace(storage, provider)
      const legacy = ownership.current.current === 'owned' && preserveQuery && !tabsRef.current.tabs.length && !new URLSearchParams(location.search).has('sample')
      const next = addWorkspaceTab(storage, tabsRef.current, tab, raw)
      if (legacy) {
        try {
          const saved = sessionStorage.getItem(cloudDocumentKey)
          if (saved && saved.length <= 4096 && JSON.parse(saved).provider === provider) {
            storage.setItem(workspaceTabKey(tab, 'cloud'), saved)
            sessionStorage.removeItem(cloudDocumentKey)
          }
        } catch {}
        if (provider === 'vwan') {
          try {
            const profile = rootStorage.getItem('vwan-visual-topology:diagnostics:v1')
            if (profile !== null) storage.setItem(workspaceTabKey(tab, 'diagnostics'), profile)
          } catch {}
        }
      }
      tabsRef.current = next; setTabs(next)
      documents.setAccount(accountRef.current)
      designRef.current = documents.activate(tab)
      designRef.current.capture = capture
      // Provider slots remain compatibility mirrors; each tab owns its editable design.
      if (ownership.current.current === 'owned') {
        try { rootStorage.setItem(workspaceStorageKeys[provider], raw) } catch {}
      }
      setActive((current) => ({ id: tab.id, provider, revision: (current?.revision ?? 0) + 1 }))
      setLibraryOpen(false); setNotice(ownership.current.current !== 'owned'
        ? 'Workspace storage is unavailable. Save a file or cloud copy before closing this session.' : '')
      syncProviderUrl(provider, preserveQuery)
      return true
    } catch {
      setNotice(selectionFailure)
      return false
    }
  }
  const tabFocusRequest = useRef<string | undefined>(undefined)
  const activateTab = (tab: WorkspaceTab, persist = true) => {
    if (active?.id === tab.id && !practiceRef.current?.current?.active) return true
    if (persist && !confirmConfigurationSwitch('.object-editor, .aznet-inspector-window')) return false
    request.current++
    try {
      const raw = storage.getItem(workspaceTabKey(tab, 'topology'))
      if (raw === null) throw new Error('The saved tab data is missing.')
      const next = { ...tabsRef.current, activeId: tab.id }
      if (persist) writeWorkspaceTabs(storage, next, tabsRef.current)
      tabsRef.current = next; setTabs(next)
      documents.setAccount(accountRef.current)
      designRef.current = documents.activate(tab)
      setActive({ id: tab.id, provider: tab.provider, revision: 0 })
      setLibraryOpen(false); setNotice('')
      if (ownership.current.current === 'owned') {
        try {
          rootStorage.setItem(workspaceSessionKey, JSON.stringify({ version: 1, provider: tab.provider }))
          rootStorage.setItem(workspaceStorageKeys[tab.provider], raw)
        } catch {}
      }
      syncProviderUrl(tab.provider)
      return true
    } catch {
      setNotice('The workspace tab could not be restored. Its stored data has not been replaced.')
      setLibraryOpen(true)
      return false
    }
  }
  const closeTabs = (targets: WorkspaceTab[], after?: () => void) => {
    if (targets.some(tab => documents.get(tab).capture !== undefined)) {
      setNotice(text('Finish or cancel the capture review in its tab before closing it.', '閉じる前に、そのタブでキャプチャの確認を完了またはキャンセルしてください。'))
      return
    }
    if (targets.some(tab => documents.get(tab).save.getSnapshot().operation === 'saving'
      || documents.get(tab).commands?.getSnapshot().operation === 'saving')) {
      setNotice(text('Wait for the save to finish before closing its tab.', '保存が完了してからタブを閉じてください。'))
      return
    }
    if (targets.some(tab => !documents.get(tab).commands?.canClose())) { setClosing({ tabs: targets, after }); return }
    finishClose(targets, after)
  }
  const finishClose = (targets: WorkspaceTab[], after?: () => void) => {
    if (targets.some(tab => !tabsRef.current.tabs.some(current => current.id === tab.id)
      || documents.get(tab).commands?.getSnapshot().operation === 'saving')) return
    try {
      const next = closeWorkspaceTabs(storage, tabsRef.current, targets.map(tab => tab.id))
      request.current++
      tabFocusRequest.current = next.activeId
      tabsRef.current = next; setTabs(next)
      for (const tab of targets) documents.forget(tab.id)
      if (targets.some(tab => tab.id === active?.id)) {
        const remaining = next.tabs.find(tab => tab.id === next.activeId)
        if (remaining) activateTab(remaining, false)
        else { setActive(undefined); setLibraryOpen(true) }
      }
      setClosing(undefined)
      after?.()
    } catch { setNotice(text('Tabs could not be closed. Their designs have not been removed.', 'タブを閉じられませんでした。デザインは削除されていません。')) }
  }
  const reopenTab = (tab: WorkspaceTab) => {
    if (!confirmConfigurationSwitch('.object-editor, .aznet-inspector-window')) return
    try {
      if (ownership.current.current !== 'owned') {
        const raw = rootStorage.getItem(workspaceTabKey(tab, 'topology'))
        if (raw === null) throw new Error('Recovery data is missing.')
        open(tab.provider, raw)
        return
      }
      const next = reopenWorkspaceTab(storage, tabsRef.current, tab)
      tabsRef.current = next; setTabs(next)
      activateTab(tab, false)
    } catch { setNotice(text('Recovery copy could not be opened. Its stored contents remain unchanged.', '復元用コピーを開けませんでした。保存済みの内容は変更されていません。')) }
  }
  const resetTabList = () => {
    if (ownership.current.current !== 'owned' || !window.confirm(text('Reset the damaged tab list? Its original metadata will be archived and stored designs will remain available in Workspace recovery.', '破損したタブ一覧をリセットしますか? 元のメタデータをアーカイブし、保存済みのデザインはワークスペースから復元できます。'))) return
    try {
      if (readWorkspaceTabs(rootStorage).recovery !== 'invalid') {
        setNotice(text('The tab list changed. Reload before resetting it.', 'タブ一覧が変更されました。リセットする前に再読み込みしてください。'))
        return
      }
      const raw = rootStorage.getItem(workspaceTabsKey)
      if (raw !== null) rootStorage.setItem(`network-simulator:workspace-tabs:recovery:v1:${randomUUID()}`, raw)
      rootStorage.removeItem(workspaceTabsKey)
      window.location.reload()
    } catch { setNotice(text('The damaged tab list could not be archived. Nothing was reset; download the recovery data before freeing storage.', '破損したタブ一覧をアーカイブできませんでした。リセットしていません。ストレージを空ける前に復元用データをダウンロードしてください。')) }
  }
  const initialize = useEffectEvent(async () => {
    if (initialized.current || !visibleRef.current) return
    const ticket = ++request.current
    if (ownership.current.current !== 'owned' && tabsStartup.recovery === 'invalid') storage.setItem(workspaceTabsKey, '{"version":1,"tabs":[]}')
    const current = readWorkspaceTabs(storage)
    if (ownership.current.current === 'owned' && (JSON.stringify(current.session) !== JSON.stringify(tabsStartup.session) || current.recovery && current.recovery !== tabsStartup.recovery)) {
      setNotice('The workspace session changed while opening. Reload to use its latest designs.')
      setLibraryOpen(true); setPracticeReady(true)
      return
    }
    if (ownership.current.current !== 'owned' && current.session) {
      const originals = current.session
      const copies = originals.tabs.map(tab => ({ ...tab, id: randomUUID() }))
      for (let index = 0; index < copies.length; index++) {
        for (const field of ['topology', 'diagnostics'] as const) {
          const raw = storage.getItem(workspaceTabKey(originals.tabs[index], field))
          if (raw !== null) storage.setItem(workspaceTabKey(copies[index], field), raw)
        }
      }
      const next: WorkspaceTabs = { version: 1, tabs: copies,
        activeId: copies[originals.tabs.findIndex(tab => tab.id === originals.activeId)]?.id }
      storage.setItem(workspaceTabsKey, JSON.stringify(next))
      tabsRef.current = next; setTabs(next)
    }
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
    if (tabsStartup.recovery === 'invalid' && ownership.current.current === 'owned') { setLibraryOpen(true); return }
    if (tabsStartup.session && !tabsStartup.session.tabs.length) {
      initialized.current = true; setLibraryOpen(!restored?.active)
      return
    }
    const params = new URLSearchParams(location.search)
    const selected = params.has('mode') && startup.provider
      ? [...tabsRef.current.tabs].reverse().find(tab => tab.provider === startup.provider)
      : tabsRef.current.tabs.find(tab => tab.id === tabsRef.current.activeId)
    if (selected && !params.has('sample')) {
      initialized.current = activateTab(selected, selected.id !== tabsRef.current.activeId)
      return
    }
    const initialProvider = restored?.active ? restored.returnProvider : startup.provider
    if (initialProvider) {
      try {
        let raw = storage.getItem(workspaceStorageKeys[initialProvider])
        if (raw === null) raw = initialProvider === 'vwan' ? emptyVwan
          : JSON.stringify({ sampleId: '', topology: (await import('./azure-net/model')).createEmptyAzNetTopology() })
        if (ticket !== request.current) return
        initialized.current = open(initialProvider, raw, undefined, true)
        if (!initialized.current) setLibraryOpen(true)
      } catch { setNotice(selectionFailure); setLibraryOpen(true) }
    }
  })
  useEffect(() => {
    // Synchronize the selected native provider with external browser storage once.
    // oxlint-disable-next-line react/set-state-in-effect
    if (ownership.status !== 'checking') void initialize()
    return () => {
      // This is a request-generation counter, not a DOM ref.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      request.current++
    }
  }, [ownership.status, visible])
  const openDocument = async (input: unknown, source?: CloudDocumentSource,
    options?: { sampleId?: string; candidateId?: string; destination?: ArtifactDestination }) => {
    if (!visibleRef.current) throw new Error('Return to your design before loading a document.')
    const ticket = ++request.current
    if (options?.sampleId !== undefined && (options.sampleId.length > 128 || !/^[a-z0-9-]*$/.test(options.sampleId))) throw new Error('Invalid sample identity.')
    if (practiceRef.current?.current?.active) {
      if (source) throw new Error('Return to your design before loading a cloud save.')
      await practiceRef.current.importDocument(input, () => ticket === request.current)
      return
    }
    let openedId: string | undefined
    const commit = async (provider: WorkspaceProvider, replacement?: string, capture?: unknown) => {
      if (ticket !== request.current) return
      if (source && source.accountId !== accountRef.current) throw new Error('The cloud account changed while loading the design.')
      if (!open(provider, replacement, capture, false, options?.candidateId)) throw new Error(selectionFailure)
      const opened = documents.active()!
      openedId = opened.id
      const raw = replacement ? JSON.parse(replacement) : undefined
      const normalized = raw ? provider === 'vwan' ? raw : raw.topology : input
      if (source) {
        opened.save.link(source, normalized, provider)
        await opened.commands?.loaded({ kind: 'cloud', ...source }, normalized)
      } else if (options?.destination && !capture) {
        await opened.commands?.loaded(options.destination, normalized)
      }
    }
    if (!input || typeof input !== 'object') throw new Error('Topology object required.')
    if ('kind' in input && ['azure-vwan-capture', 'azure-vwan-federation'].includes(String(input.kind))) {
      const { importAzureCapture } = await import('./azure-import')
      importAzureCapture(input)
      await commit('vwan', undefined, input)
    } else if ('kind' in input && input.kind === 'azure-network-capture') {
      const { importAzNetCapture } = await import('./azure-net/azure-import')
      const imported = importAzNetCapture(input)
      await commit('azure-net', JSON.stringify({ sampleId: '', topology: imported.topology }), input)
    } else if ('version' in input && input.version === 1 && !('kind' in input)) {
      const { validateTopology } = await import('./validation')
      const topology = validateTopology(input)
      await commit('vwan', JSON.stringify(topology))
    } else {
      const { parseAzNetTopology } = await import('./azure-net/admission')
      const topology = parseAzNetTopology(input)
      await commit('azure-net', JSON.stringify({ sampleId: options?.sampleId ?? '', topology }))
    }
    return openedId
  }
  const loadFile = async () => {
    if (practiceRef.current?.current?.active || !visibleRef.current) throw new Error('Return to your design before loading a file.')
    const candidateId = randomUUID(), version = request.current
    let adopted = false
    try {
      if (window.desktopSimulator) {
        const reply = await window.desktopSimulator.openDocument({ documentId: candidateId, language })
        if (!reply.ok) throw new Error(reply.error)
        if (!reply.value || version !== request.current || !visibleRef.current) return
        const value = reply.value
        const id = await openDocument(JSON.parse(value.content), undefined, { candidateId,
          destination: value.destination ? desktopArtifact(value.destination) : undefined })
        adopted = id === candidateId
      } else {
        const browser = window as Window & { showOpenFilePicker?: (options: unknown) => Promise<import('./browser-document-writer').BrowserDocumentHandle[]> }
        if (!browser.showOpenFilePicker) {
          document.querySelector<HTMLInputElement>('[data-desktop-import]')?.click()
          return
        }
        const [handle] = await browser.showOpenFilePicker({ multiple: false,
          types: [{ description: 'Topology JSON', accept: { 'application/json': ['.json'] } }] })
        if (!handle || version !== request.current || !visibleRef.current) return
        const value = await runtime.browser.read(handle)
        if (version !== request.current || !visibleRef.current) return
        const destination = runtime.browser.bind(candidateId, handle, value.revision)
        const id = await openDocument(JSON.parse(value.content), undefined, { candidateId, destination })
        adopted = id === candidateId
        if (adopted && destination.kind === 'file') {
          await runtime.retainBrowserFile(candidateId, handle, value.revision, destination.bindingId!)
        }
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) throw error
    } finally {
      if (!adopted) {
        runtime.browser.release(candidateId)
        await window.desktopSimulator?.releaseDocument({ documentId: candidateId })
      }
    }
  }
  const newWorkspace = async () => {
    const ticket = ++request.current
    try {
      const { createEmptyAzNetTopology } = await import('./azure-net/model')
      if (ticket === request.current) open('azure-net', JSON.stringify({ sampleId: '', topology: createEmptyAzNetTopology() }))
    } catch { if (ticket === request.current) setNotice('Workspace could not load. Your saved design has not been replaced.') }
  }
  const practicing = practice?.active === true
  const provider = practicing ? practice.document.mode === 'vwan' ? 'vwan' : 'azure-net' : active?.provider
  const editorKey = practicing ? `practice:${practiceEpoch}:${provider}` : `design:${active?.id}:${active?.revision}`
  useLayoutEffect(() => {
    visibleRef.current = visible
    request.current++
    if (!visible) learningRef.current?.cancel()
  }, [visible])
  useLayoutEffect(() => {
    documents.setAccount(accountId)
    if (practicing || !visible) documents.suspend()
    else if (active) documents.activate({ id: active.id, provider: active.provider, name: '' })
  }, [documents, accountId, practicing, active, visible])
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (active && (event.key === null || event.key === workspaceTabKey({ ...active, name: '' }, 'topology'))) activeSave.invalidateLocal()
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [active, activeSave])
  return <WorkspaceSessionContext value={{
    tabId: !practicing ? active?.id : undefined,
    presentationPreview, setPresentationPreview: (value) => {
      setPresentationPreview(value)
      try { localStorage.setItem('aznet-ui-preview:v1', String(value)) } catch { /* Keep the choice in this tab. */ }
    },
    openLibrary: () => { leavePractice(); request.current++; setLibraryOpen(true) },
    openDocument, getRequestVersion: () => request.current,
    documentSave: practicing || !visible ? undefined : activeSave,
    artifactCommands: practicing || !visible ? undefined : design?.commands,
    loadFile,
    clearDocument: () => {
      if (practicing || !design) return
      const tab = tabsRef.current.tabs.find(tab => tab.id === design.id)
      if (!tab) return
      closeTabs([tab], () => {
        if (tab.provider === 'vwan') open('vwan', emptyVwan)
        else void import('./azure-net/model').then(({ createEmptyAzNetTopology }) =>
          open('azure-net', JSON.stringify({ sampleId: '', topology: createEmptyAzNetTopology() })))
      })
    },
    storage: !practicing && design ? {
      getItem: design.storage.getItem,
      removeItem: design.storage.removeItem,
      setItem: (key, value) => {
        design.storage.setItem(key, value)
        if (ownership.current.current !== 'owned') throw new Error('Profile storage is unavailable.')
        if (ownership.current.current === 'owned' && key === workspaceStorageKeys[design.provider]) {
          try { rootStorage.setItem(key, value) } catch {}
        }
      },
    } : undefined,
    editorState: practicing ? practiceEditorState.current : design?.editorState,
    configurationPending: practicing ? undefined : design?.configurationPending,
    capture: practicing ? undefined : design?.capture,
    consumeCapture: () => { if (design && documents.active() === design) design.capture = undefined },
    openPractice, practice: practicing ? practice : undefined,
    savePractice: (document) => practiceRef.current?.save(document, practiceEpoch),
    getEditorHistory: () => practicing ? practiceHistory.current : design?.history,
    rememberEditorHistory: (value) => {
      const changed = practiceHistory.current?.topology !== value.topology
      if (practicing) practiceHistory.current = value
      else if (design?.remember(value)) {
        const current = tabsRef.current
        const tab = current.tabs.find(tab => tab.id === design.id)
        const name = value.topology.name.slice(0, 120)
        if (tab && tab.name !== name) {
          try {
            const next = { ...current, tabs: current.tabs.map(entry => entry.id === tab.id ? { ...entry, name } : entry) }
            writeWorkspaceTabs(storage, next, current)
            tabsRef.current = next; setTabs(next)
          } catch { setNotice('Tab names could not be saved. Export your design before reloading.') }
        }
      }
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
    <WorkspaceTabsContext value={{ restoreFocus: () => {
      const id = tabFocusRequest.current
      const button = id ? document.getElementById(`workspace-tab-${id}`) : undefined
      if (button) { button.focus(); tabFocusRequest.current = undefined }
    }, navigation: practiceReady && !practicing && tabs.tabs.length > 0 ? <WorkspaceTabsNavigation tabs={tabs.tabs} activeId={active?.id}
        temporary={ownership.status !== 'owned'}
        getSave={tab => documents.get(tab).save}
        getCommands={tab => documents.get(tab).commands}
        onActivate={tab => { if (tab.id !== active?.id && activateTab(tab)) tabFocusRequest.current = tab.id }}
        onClose={tab => closeTabs([tab])} onNew={() => { void newWorkspace() }} /> : null }}>
    <div className={`simulator-shell${maximized ? ' canvas-maximized' : ''}`} data-canvas-style={style} data-ui-preview={presentationPreview || undefined}
      data-header-actions={headerActionsOpen || undefined}>
      {notice && !libraryOpen && <p role="alert">{t(notice)}</p>}
      <CanvasMaximizeButton />
      {(practice || practiceNotice) && <Suspense fallback={null}><PracticeWorkspaceBar active={practicing}
        notice={practiceNotice} onReturn={leavePractice} onResume={practice ? resumePractice : undefined} onDiscard={discardPractice} /></Suspense>}
      <div id="workspace-design-container">
      {!practiceReady && <p role="status">{t('Loading workspace…')}</p>}
      {visible && practiceReady && (active || practicing) && provider && <>
        {window.desktopSimulator && <Suspense fallback={null}>
          <DesktopTools key={`tools:${provider}:${practicing}`} mode={provider === 'vwan' ? 'vwan' : 'full'} />
        </Suspense>}
        <WorkspaceBoundary key={editorKey} onRecover={() => { leavePractice(); setLibraryOpen(true) }}>
          <Suspense fallback={<section aria-label={t('Workspace loading')}><p role="status">{t('Loading workspace…')}</p></section>}>
            {provider === 'vwan' ? <App /> : <AzureNetApp simulatorMode="full" />}
          </Suspense>
        </WorkspaceBoundary>
      </>}
      </div>
      {practiceReady && libraryOpen && <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}>
        <WorkspaceLibrary required={!active} notice={notice} onOpen={open} onNew={() => { void newWorkspace() }}
          onReopen={reopenTab} onCloseAll={tabs.tabs.length ? () => closeTabs(tabs.tabs) : undefined}
          onResetTabs={tabsStartup.recovery === 'invalid' && ownership.status === 'owned' ? resetTabList : undefined}
          onResumePractice={practice && !practicing ? resumePractice : undefined} onClose={() => setLibraryOpen(false)} />
      </Suspense>}
      {closing && <Suspense fallback={null}><CloseDocumentsDialog documents={closing.tabs.map(tab => documents.get(tab))}
        onClose={() => setClosing(undefined)} onDiscard={() => finishClose(closing.tabs, closing.after)} /></Suspense>}
    </div>
    </WorkspaceTabsContext>
  </WorkspaceSessionContext>
}
