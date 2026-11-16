import type { PlatformDocument } from '../platform/contract'
import type { WorkspaceProvider } from '../workspace-session'
import {
  admitPracticeDocument, explicitWorkspaceEntry, practiceConflict, practiceReadFailure, practiceSaveFailure,
  practiceWorkspaceKey, readPracticeWorkspace, writePracticeWorkspace,
  type PracticeRequest, type PracticeStorage, type PracticeWorkspace,
} from './practice-workspace'

export function createPracticeSession(options: {
  storage: () => PracticeStorage
  changed: (practice: PracticeWorkspace | undefined) => void
  notice: (notice: '' | 'read' | 'save' | 'conflict') => void
  replaced: () => void
}) {
  let current: PracticeWorkspace | undefined
  let raw: string | null = null
  let blocked = false
  let generation = 0
  const update = (next: PracticeWorkspace | undefined) => { current = next; options.changed(next) }
  const replace = (next: PracticeWorkspace | undefined) => { generation++; options.replaced(); update(next) }
  const persist = (next: PracticeWorkspace) => {
    try {
      raw = writePracticeWorkspace(options.storage(), next, raw)
      options.notice('')
    } catch (error) {
      const conflict = error instanceof Error && error.message === practiceConflict
      options.notice(conflict ? 'conflict' : 'save')
      throw new Error(conflict ? practiceConflict : practiceSaveFailure)
    }
  }
  const unreadable = (original: string | null = null) => {
    raw = original; blocked = true; options.notice('read')
  }
  return {
    get current() { return current },
    unreadable,
    async restore(original: string, search: string, hash: string, valid: () => boolean) {
      try {
        let next = await readPracticeWorkspace(original)
        if (!valid()) return
        raw = original
        if (next?.active && explicitWorkspaceEntry(search, hash)) {
          next = { ...next, active: false }
          try { persist(next) } catch { /* Explicit incoming designs take precedence, with a visible save warning. */ }
        }
        update(next)
      } catch { if (valid()) unreadable(original) }
    },
    async open(input: PracticeRequest, returnProvider: WorkspaceProvider, valid: () => boolean, signal?: AbortSignal) {
      if (blocked) throw new Error(practiceReadFailure)
      const document = await admitPracticeDocument(input.document)
      if (signal?.aborted || !valid()) throw new DOMException('Practice opening cancelled.', 'AbortError')
      const next: PracticeWorkspace = { version: 1, ...input, document, active: true, returnProvider }
      persist(next)
      replace(next)
    },
    save(document: PlatformDocument, expectedGeneration: number) {
      if (!current?.active || generation !== expectedGeneration) throw new Error(practiceSaveFailure)
      const next = { ...current, document }
      update(next)
      persist(next)
    },
    leave() {
      if (!current?.active) return
      const next = { ...current, active: false }
      update(next)
      try { persist(next) } catch { /* Keep the unsaved-session warning and live document available. */ }
    },
    resume(provider?: WorkspaceProvider) {
      if (!current) return false
      const next = { ...current, active: true, returnProvider: provider ?? current.returnProvider }
      try { persist(next) }
      catch (error) {
        if (error instanceof Error && error.message === practiceConflict) return false
        // Session-only resumption keeps unsaved practice accessible for export.
      }
      update(next)
      return true
    },
    discard() {
      try {
        const storage = options.storage()
        if (storage.getItem(practiceWorkspaceKey) !== raw) throw new Error(practiceConflict)
        storage.removeItem(practiceWorkspaceKey)
        raw = null; blocked = false
        replace(undefined); options.notice('')
        return true
      } catch (error) {
        options.notice(error instanceof Error && error.message === practiceConflict ? 'conflict' : 'save')
        return false
      }
    },
    async importDocument(input: unknown, valid: () => boolean) {
      let document: PlatformDocument
      if (input && typeof input === 'object' && 'kind' in input && input.kind === 'azure-vwan-capture') {
        const { importAzureCapture } = await import('../azure-import')
        document = { mode: 'vwan', topology: importAzureCapture(input) }
      } else if (input && typeof input === 'object' && 'kind' in input && input.kind === 'azure-network-capture') {
        const { importAzNetCapture } = await import('../azure-net/azure-import')
        document = { mode: 'full', topology: importAzNetCapture(input).topology }
      } else {
        document = await admitPracticeDocument({
          mode: input && typeof input === 'object' && 'version' in input && input.version === 1 ? 'vwan' : 'full',
          topology: input,
        } as PlatformDocument)
      }
      if (!valid() || !current?.active) return
      const next = { ...current, document }
      persist(next)
      replace(next)
    },
  }
}

export type PracticeSession = ReturnType<typeof createPracticeSession>
