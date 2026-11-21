import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import type { PlatformDocument } from './platform/contract'
import type { PracticeRequest, PracticeWorkspace } from './learning/practice-workspace'
import type { CourseRunner, LearningObservation, RunnerState } from './learning/runner'
import type { LedgerState } from './learning/progress-ledger'
import type { SyncStatus } from './cloud/progress-sync'
import type { CloudDocumentSource, DocumentSaveState } from './cloud/document-state'
import type { WorkspaceStorage } from './workspace-session'

export type WorkspaceEditorHistory =
  | { provider: 'vwan'; topology: Topology; past: Topology[]; future: Topology[]; error: string; saveError: string; backup: string }
  | { provider: 'azure-net'; topology: AzNetTopology; sampleId: string; past: AzNetTopology[]; future: AzNetTopology[];
      recovery: { source: string; raw: string; message: string }[]; recoveryAcknowledged: boolean; pendingUrlSample: string }

export const WorkspaceSessionContext = createContext<{
  openLibrary: () => void
  presentationPreview?: boolean
  setPresentationPreview?: (preview: boolean) => void
  openDocument: (input: unknown, source?: CloudDocumentSource) => Promise<void>
  documentSave?: DocumentSaveState
  storage?: WorkspaceStorage
  editorState?: Map<string, unknown>
  getRequestVersion: () => number
  capture?: unknown
  consumeCapture?: () => void
  openPractice?: (request: PracticeRequest, signal?: AbortSignal) => Promise<void>
  practice?: PracticeWorkspace
  savePractice?: (document: PlatformDocument) => void
  getEditorHistory?: () => WorkspaceEditorHistory | undefined
  rememberEditorHistory?: (history: WorkspaceEditorHistory) => void
  learningView?: { open: boolean }
  setLearningView?: (view: { open: boolean }) => void
  learningDetailsOpen?: boolean
  setLearningDetailsOpen?: (open: boolean) => void
  loadLearning?: () => Promise<CourseRunner>
  selectLearningEdition?: (courseId: string) => Promise<boolean>
  learning?: CourseRunner
  learningState?: RunnerState
  reportLearningObservation?: (event: LearningObservation) => void
  learningProgress?: LedgerState
  resetLearningProgress?: (expected: LedgerState) => Promise<boolean>
  retryLearningProgress?: () => Promise<boolean>
  backupLearningProgress?: (legacy: boolean) => string | null | undefined
  cloudProgress?: {
    status?: SyncStatus
    refresh: (choice?: 'cloud' | 'local') => Promise<void> | undefined
    hasAnonymousProgress: boolean
    importAnonymous: () => Promise<boolean>
  }
} | undefined>(undefined)

export const useWorkspaceSession = () => useContext(WorkspaceSessionContext)

const browserStorage: WorkspaceStorage = {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
}
export const useWorkspaceStorage = () => useWorkspaceSession()?.storage ?? browserStorage

export function useWorkspaceEditorState<T>(key: string, initial: T | (() => T), restore?: (value: T) => T): readonly [T, Dispatch<SetStateAction<T>>]
export function useWorkspaceEditorState<T = undefined>(key: string): readonly [T | undefined, Dispatch<SetStateAction<T | undefined>>]
export function useWorkspaceEditorState<T>(key: string, initial?: T | (() => T), restore?: (value: T) => T) {
  const session = useWorkspaceSession()
  // Capture the owner once: a delayed update must never write into a newly selected document.
  const [owner] = useState(() => session?.editorState)
  const [value, setValue] = useState<T | undefined>(() => owner?.has(key)
    ? restore ? restore(owner.get(key) as T) : owner.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial)
  useLayoutEffect(() => { owner?.set(key, value) }, [owner, key, value])
  return [value, setValue] as const
}

const noSubscribe = () => () => {}
const noSnapshot = () => undefined
export function useDocumentSaveState() {
  const state = useWorkspaceSession()?.documentSave
  return useSyncExternalStore(state?.subscribe ?? noSubscribe, state?.getSnapshot ?? noSnapshot)
}
