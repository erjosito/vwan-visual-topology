import type { PlatformDocument } from '../platform/contract'
import type { WorkspaceProvider } from '../workspace-session'

import { practiceWorkspaceKey } from './practice-workspace-key'
export { practiceWorkspaceKey } from './practice-workspace-key'
export const practiceSaveFailure = 'Practice could not be saved. Changes remain in this session only. Return to practice and export your design before reloading.'
export const practiceReadFailure = 'Saved practice could not be read. Its original contents have not been overwritten.'
export const practiceConflict = 'Saved practice changed in another tab. It has not been overwritten. Reload to use that saved session.'

export type PracticeWorkspace = {
  version: 1
  courseId: string
  scenarioId: string
  active: boolean
  returnProvider: WorkspaceProvider
  document: PlatformDocument
}
export type PracticeRequest = Pick<PracticeWorkspace, 'courseId' | 'scenarioId' | 'document'>
export type PracticeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const practiceProvider = (document: PlatformDocument): WorkspaceProvider =>
  document.mode === 'vwan' ? 'vwan' : 'azure-net'

export async function admitPracticeDocument(document: PlatformDocument): Promise<PlatformDocument> {
  if (document?.mode === 'vwan') {
    const { validateTopology } = await import('../validation')
    return { mode: 'vwan', topology: validateTopology(document.topology) }
  }
  if (document?.mode === 'hub-spoke' || document?.mode === 'full') {
    const { parseAzNetTopology } = await import('../azure-net/admission')
    return { mode: document.mode, topology: parseAzNetTopology(document.topology) }
  }
  throw new Error('Unsupported practice document.')
}

function checkEnvelope(value: PracticeWorkspace) {
  if (!value || value.version !== 1 || typeof value.active !== 'boolean'
    || !['vwan', 'azure-net'].includes(value.returnProvider)
    || [value.courseId, value.scenarioId].some((id) => typeof id !== 'string' || !/^[a-z][a-z0-9.-]{0,119}$/.test(id))
    || Object.keys(value).some((key) => !['version', 'courseId', 'scenarioId', 'active', 'returnProvider', 'document'].includes(key))) {
    throw new Error(practiceReadFailure)
  }
}

export async function readPracticeWorkspace(raw: string | null): Promise<PracticeWorkspace | undefined> {
  if (raw === null) return undefined
  if (raw.length > 4_010_000) throw new Error(practiceReadFailure)
  const value = JSON.parse(raw) as PracticeWorkspace
  checkEnvelope(value)
  return { ...value, document: await admitPracticeDocument(value.document) }
}

export function writePracticeWorkspace(storage: PracticeStorage, value: PracticeWorkspace, expected: string | null): string {
  checkEnvelope(value)
  const raw = JSON.stringify(value)
  if (raw.length > 4_010_000) throw new Error(practiceSaveFailure)
  // Refuse a known stale write; full progress/multi-tab ownership is a separate stage.
  if (storage.getItem(practiceWorkspaceKey) !== expected) throw new Error(practiceConflict)
  storage.setItem(practiceWorkspaceKey, raw)
  return raw
}

export function explicitWorkspaceEntry(search: string, hash: string): boolean {
  const params = new URLSearchParams(search)
  return params.has('mode') || params.has('sample') || /(?:#|&)s=/.test(hash)
}
