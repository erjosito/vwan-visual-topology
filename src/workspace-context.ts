import { createContext, useContext } from 'react'
import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import type { PlatformDocument } from './platform/contract'
import type { PracticeRequest, PracticeWorkspace } from './learning/practice-workspace'
import type { CourseRunner, LearningObservation, RunnerState } from './learning/runner'

export type WorkspaceEditorHistory =
  | { provider: 'vwan'; topology: Topology; past: Topology[]; future: Topology[]; error: string; saveError: string; backup: string }
  | { provider: 'azure-net'; topology: AzNetTopology; sampleId: string; past: AzNetTopology[]; future: AzNetTopology[];
      recovery: { source: string; raw: string; message: string }[]; recoveryAcknowledged: boolean; pendingUrlSample: string }

export const WorkspaceSessionContext = createContext<{
  openLibrary: () => void
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
  loadLearning?: () => Promise<CourseRunner>
  learning?: CourseRunner
  learningState?: RunnerState
  reportLearningObservation?: (event: LearningObservation) => void
} | undefined>(undefined)

export const useWorkspaceSession = () => useContext(WorkspaceSessionContext)
