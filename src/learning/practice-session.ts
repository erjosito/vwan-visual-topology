import type { PlatformDocument } from '../platform/contract'
import type { WorkspaceProvider } from '../workspace-session'
import { createPracticeOwnership, practiceOwnershipFailure, type PracticeOwnership } from './practice-ownership'
import {
  admitPracticeDocument, explicitWorkspaceEntry, practiceConflict, practiceReadFailure, practiceSaveFailure,
  practiceWorkspaceKey, readPracticeWorkspace, writePracticeWorkspace,
  type PracticeRequest, type PracticeStorage, type PracticeWorkspace,
} from './practice-workspace'

export function createPracticeSession(options: {
  storage: () => PracticeStorage
  changed: (practice: PracticeWorkspace | undefined) => void
  notice: (notice: '' | 'read' | 'save' | 'conflict' | 'ownership') => void
  replaced: () => void
  ownership?: PracticeOwnership
}) {
  const ownership = options.ownership ?? createPracticeOwnership(globalThis.navigator?.locks)
  let current: PracticeWorkspace | undefined
  let raw: string | null = null
  let blocked = false
  let dirty = false
  let generation = 0
  const update = (next: PracticeWorkspace | undefined) => { current = next; options.changed(next) }
  const replace = (next: PracticeWorkspace | undefined) => { generation++; options.replaced(); update(next) }
  const persist = (next: PracticeWorkspace) => {
    if (!ownership.owned) { options.notice('ownership'); throw new Error(practiceOwnershipFailure) }
    try {
      raw = writePracticeWorkspace(options.storage(), next, raw)
      dirty = false
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
  const acquire = async () => {
    const owned = await ownership.acquire()
    if (!owned) options.notice('ownership')
    return owned
  }
  return {
    get current() { return current },
    get owns() { return ownership.owned },
    acquire,
    release: () => { if (!current?.active) ownership.release() },
    unreadable,
    async restore(original: string, search: string, hash: string, valid: () => boolean) {
      try {
        let next = await readPracticeWorkspace(original)
        if (!valid()) return
        raw = original
        if (next?.active) {
          const owned = await acquire()
          if (!valid()) { ownership.release(); return }
          if (!owned) next = { ...next, active: false }
          else if (explicitWorkspaceEntry(search, hash)) {
            next = { ...next, active: false }
            try { persist(next) } catch { dirty = true }
            ownership.release()
          }
        }
        update(next)
      } catch { if (valid()) unreadable(original) }
    },
    async open(input: PracticeRequest, returnProvider: WorkspaceProvider, valid: () => boolean, signal?: AbortSignal) {
      if (blocked) throw new Error(practiceReadFailure)
      const document = await admitPracticeDocument(input.document)
      if (signal?.aborted || !valid()) throw new DOMException('Practice opening cancelled.', 'AbortError')
      if (!await acquire()) throw new Error(practiceOwnershipFailure)
      if (signal?.aborted || !valid()) {
        if (!current?.active) ownership.release()
        throw new DOMException('Practice opening cancelled.', 'AbortError')
      }
      const next: PracticeWorkspace = { version: 1, ...input, document, active: true, returnProvider }
      try { persist(next) } catch (error) { if (!current?.active) ownership.release(); throw error }
      replace(next)
    },
    save(document: PlatformDocument, expectedGeneration: number) {
      if (!current?.active || generation !== expectedGeneration) throw new Error(practiceSaveFailure)
      const next = { ...current, document }
      dirty = true
      update(next)
      persist(next)
    },
    leave() {
      if (!current?.active) { ownership.release(); return }
      const next = { ...current, active: false }
      dirty = true
      update(next)
      try { persist(next) } catch { /* Keep the unsaved-session warning and live document available. */ }
      ownership.release()
    },
    async resume(provider?: WorkspaceProvider, valid = () => true) {
      if (!current) return false
      if (!await acquire()) return false
      if (!valid()) { if (!current.active) ownership.release(); return false }
      let refreshed = false
      let source = current
      if (!dirty) {
        try {
          const latestRaw = options.storage().getItem(practiceWorkspaceKey)
          if (latestRaw !== raw) {
            const latest = await readPracticeWorkspace(latestRaw)
            if (!valid()) { ownership.release(); return false }
            raw = latestRaw
            if (!latest) { replace(undefined); options.notice(''); ownership.release(); return false }
            source = latest; refreshed = true
          }
        } catch { options.notice('read'); ownership.release(); return false }
      }
      const next = { ...source, active: true, returnProvider: provider ?? source.returnProvider }
      try { persist(next) }
      catch (error) {
        if (error instanceof Error && [practiceConflict, practiceOwnershipFailure].includes(error.message)) {
          ownership.release(); return false
        }
        // Session-only resumption keeps unsaved practice accessible for export.
      }
      if (refreshed) replace(next)
      else update(next)
      return true
    },
    async discard(valid = () => true) {
      if (!await acquire()) return false
      if (!valid()) { if (!current?.active) ownership.release(); return false }
      try {
        const storage = options.storage()
        if (storage.getItem(practiceWorkspaceKey) !== raw) throw new Error(practiceConflict)
        storage.removeItem(practiceWorkspaceKey)
        raw = null; blocked = false; dirty = false
        replace(undefined); options.notice('')
        ownership.release()
        return true
      } catch (error) {
        options.notice(error instanceof Error && error.message === practiceConflict ? 'conflict' : 'save')
        if (!current?.active) ownership.release()
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
