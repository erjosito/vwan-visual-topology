import { createContext, useContext } from 'react'
import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import type { PlatformDocument } from './platform/contract'
import type { PracticeRequest, PracticeWorkspace } from './learning/practice-workspace'
import type { CourseRunner, LearningObservation, RunnerState } from './learning/runner'
import type { LedgerState } from './learning/progress-ledger'
import type { SyncStatus } from './cloud/progress-sync'

export type WorkspaceEditorHistory =
  | { provider: 'vwan'; topology: Topology; past: Topology[]; future: Topology[]; error: string; saveError: string; backup: string }
  | { provider: 'azure-net'; topology: AzNetTopology; sampleId: string; past: AzNetTopology[]; future: AzNetTopology[];
      recovery: { source: string; raw: string; message: string }[]; recoveryAcknowledged: boolean; pendingUrlSample: string }

export const WorkspaceSessionContext = createContext<{
  openLibrary: () => void
  presentationPreview?: boolean
  setPresentationPreview?: (preview: boolean) => void
  openDocument: (input: unknown) => Promise<void>
  getRequestVersion: () => number
  capture?: unknown
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
