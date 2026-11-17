import { parseProgressLedger, type ProgressLedger, type ProgressLedgerStore } from '../learning/progress-ledger'
import type { CloudClient } from './client'

export type SyncStatus = 'loading' | 'synced' | 'saving' | 'conflict' | 'offline'
export function createProgressSync(api: Pick<CloudClient, 'getProgress' | 'saveProgress'>, store: ProgressLedgerStore,
  apply: (ledger: ProgressLedger) => Promise<boolean>) {
  let state: SyncStatus = 'loading'
  let generation = 0
  let runtime: { refresh: (choice?: 'cloud' | 'local') => Promise<void>; stop: () => void } | undefined
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => state,
    refresh: (choice?: 'cloud' | 'local') => runtime?.refresh(choice),
    start() {
      runtime?.stop()
      const ticket = ++generation
      let base: string | undefined, etag: string | null = null, busy = false, applying = false
      const valid = () => generation === ticket
      const publish = (next: SyncStatus) => { if (valid()) { state = next; for (const listener of listeners) listener() } }
      const raw = () => {
        const snapshot = store.getSnapshot()
        if (!snapshot.ledger || !['saved', 'session', 'ownership'].includes(snapshot.status)) throw new Error('Local progress unavailable.')
        return JSON.stringify(snapshot.ledger)
      }
      const push = async () => {
        if (!valid() || busy || applying || base === undefined || state === 'conflict') return
        let next: string
        try { next = raw() } catch { publish('offline'); return }
        if (next === base) return
        busy = true; publish('saving')
        let success = false
        try {
          const version = await api.saveProgress(parseProgressLedger(next), etag)
          if (!valid()) return
          etag = version; base = next; success = true; publish('synced')
        } catch (error) { publish((error as { status?: number }).status === 412 ? 'conflict' : 'offline') }
        finally {
          busy = false
          if (success && valid()) void push()
        }
      }
      const refresh = async (choice?: 'cloud' | 'local') => {
        if (!valid() || busy) return
        busy = true
        let success = false
        try {
          const before = raw()
          const remote = await api.getProgress()
          if (!valid()) return
          const value = remote ? parseProgressLedger(JSON.stringify(remote.value))
            : { version: 1 as const, policyVersion: 1 as const, completions: [] }
          const remoteRaw = JSON.stringify(value)
          const current = raw()
          if (current !== before) { publish('conflict'); return }
          const remoteChanged = base === undefined || remoteRaw !== base
          if (!choice && remoteChanged && remoteRaw !== current
            && (base === undefined ? !!store.getSnapshot().ledger?.completions.length || !!store.getSnapshot().ledger?.enrollment : current !== base)) {
            publish('conflict'); return
          }
          if (choice !== 'local' && (choice === 'cloud' || remoteChanged) && remoteRaw !== current) {
            applying = true
            if (!await apply(value) || !valid()) { publish('offline'); return }
            if (raw() !== remoteRaw) { publish('conflict'); return }
          }
          etag = remote?.etag ?? null
          base = remoteRaw
          publish('synced'); success = true
        } catch { publish('offline') }
        finally { applying = false; busy = false; if (success && valid()) void push() }
      }
      const unsubscribe = store.subscribe(() => { if (!applying) void push() })
      const timer = setInterval(() => { void refresh() }, 60000)
      const online = () => { void refresh() }
      if (typeof window !== 'undefined') window.addEventListener('online', online)
      runtime = { refresh, stop: () => { unsubscribe(); clearInterval(timer); if (typeof window !== 'undefined') window.removeEventListener('online', online) } }
      publish('loading')
      void refresh()
    },
    stop() { generation++; runtime?.stop(); runtime = undefined },
  }
}
