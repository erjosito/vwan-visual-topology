import type { WorkspaceProvider } from '../workspace-session'
import type { CloudEntry } from './contracts'
import { randomUUID } from '../random-id'

export const cloudDocumentKey = 'network-simulator:cloud-document:v1'
export interface CloudDocumentSource { accountId: string; id: string; name: string; etag: string }
interface Association extends CloudDocumentSource { version: 1; provider: WorkspaceProvider; digest: string }
export interface DocumentSaveSnapshot {
  ready: boolean
  provider?: WorkspaceProvider
  local: 'draft' | 'saved' | 'unavailable'
  operation: 'idle' | 'saving' | 'failed'
  retained: boolean
  cloud?: CloudDocumentSource & { state: 'checking' | 'matches' | 'modified' | 'changed' | 'missing' | 'unavailable' | 'unknown' }
}

async function fingerprint(value: unknown) {
  const raw = JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function createDocumentSaveState(storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  digest = fingerprint, documentOwned = false) {
  let accountId: string | undefined, provider: WorkspaceProvider | undefined, topology: unknown
  let active = true, revoked = false, epoch = 0, sequence = 0
  let draftId = randomUUID()
  let local: { topology: unknown; state: DocumentSaveSnapshot['local'] } | undefined
  let binding: Association | undefined, restored: Association | undefined
  let verification: 'confirmed' | 'changed' | 'missing' | 'unavailable' = 'confirmed'
  let currentDigest: string | undefined, hashFailed = false
  let operation: DocumentSaveSnapshot['operation'] = 'idle', retained = false
  let pending: { epoch: number; sequence: number; id: string } | undefined
  let snapshot: DocumentSaveSnapshot = { ready: false, local: 'draft', operation, retained }
  const listeners = new Set<() => void>()
  try {
    const raw = storage().getItem(cloudDocumentKey)
    const value = raw && raw.length <= 4096 ? JSON.parse(raw) as Association : undefined
    if (value?.version === 1 && ['vwan', 'azure-net'].includes(value.provider)
      && typeof value.accountId === 'string' && value.accountId.length > 0 && value.accountId.length <= 1000
      && typeof value.name === 'string' && value.name.length <= 120
      && /^[0-9a-f-]{36}$/.test(value.id) && /^"[\x21\x23-\x7e]{1,160}"$/.test(value.etag)
      && /^[0-9a-f]{64}$/.test(value.digest)) restored = value
  } catch { /* Association recovery must never prevent access to the local design. */ }
  const remove = () => { try { storage().removeItem(cloudDocumentKey) } catch {} }
  const publish = () => {
    const cloud = (active || documentOwned) && binding?.accountId === accountId && binding ? {
      accountId: binding.accountId, id: binding.id, name: binding.name, etag: binding.etag,
      state: verification !== 'confirmed' ? verification
        : hashFailed || !binding.digest ? 'unknown' : !currentDigest ? active ? 'checking' : 'unknown'
          : currentDigest === binding.digest ? 'matches' : 'modified',
    } as NonNullable<DocumentSaveSnapshot['cloud']> : undefined
    const next: DocumentSaveSnapshot = { ready: active && topology !== undefined, provider,
      local: local && local.topology === topology ? local.state : 'draft', operation, retained, cloud }
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const check = () => {
    if (revoked || (!active && !documentOwned) || !binding || topology === undefined) { publish(); return }
    const current = topology, ticket = epoch
    currentDigest = undefined; hashFailed = false
    publish()
    void digest(current).then(value => {
      if (ticket === epoch && current === topology) { currentDigest = value; publish() }
    }).catch(() => {
      if (ticket === epoch && current === topology) { hashFailed = true; publish() }
    })
  }
  const reset = () => {
    epoch++; pending = undefined; operation = 'idle'; draftId = randomUUID()
    topology = undefined; provider = undefined; local = undefined
    binding = undefined; restored = undefined; currentDigest = undefined; hashFailed = false; retained = false
    remove(); publish()
  }
  const valid = (ticket: { epoch: number; sequence: number }) =>
    !revoked && (active || documentOwned) && ticket.epoch === epoch && ticket.sequence === sequence
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    newCopyId: () => draftId,
    revoke() {
      epoch++; revoked = true; active = false; pending = undefined; operation = 'idle'; publish()
    },
    scope(owner: string | undefined) {
      return owner && owner === accountId && active ? { epoch, sequence } : undefined
    },
    reset,
    setAccount(next: string | undefined) {
      if (next === accountId) return
      epoch++; accountId = next; pending = undefined; operation = 'idle'; binding = undefined
      if (restored && restored.accountId === next && (!provider || provider === restored.provider)) binding = restored
      else remove()
      retained = !!binding; restored = undefined; verification = 'confirmed'; check()
    },
    setActive(next: boolean) {
      if (revoked || next === active) return
      active = next
      if (!documentOwned) { epoch++; pending = undefined; operation = 'idle' }
      check()
    },
    observe(value: unknown, kind: WorkspaceProvider) {
      if (!active || topology === value && provider === kind) return
      if (provider && provider !== kind || binding && binding.provider !== kind) reset()
      topology = value; provider = kind; check()
    },
    local(value: unknown, state: 'saved' | 'unavailable') {
      if (!active) return
      local = { topology: value, state }; publish()
    },
    invalidateLocal() {
      if (topology !== undefined) { local = { topology, state: 'unavailable' }; publish() }
    },
    begin(id: string, owner: string) {
      if (!active || accountId !== owner || topology === undefined || pending) return undefined
      const ticket = { epoch, sequence: ++sequence, id }
      pending = ticket; operation = 'saving'; publish()
      return ticket
    },
    async confirmed(ticket: { epoch: number; sequence: number }, source: CloudDocumentSource,
      value: unknown, kind: WorkspaceProvider) {
      if (!valid(ticket) || accountId !== source.accountId) return false
      let hash = ''
      try { hash = await digest(value) } catch {}
      if (!valid(ticket) || accountId !== source.accountId) return false
      binding = { ...source, version: 1, provider: kind, digest: hash }
      restored = undefined; verification = 'confirmed'; operation = 'idle'; pending = undefined
      if (source.id === draftId) draftId = randomUUID()
      retained = false; remove()
      if (hash) {
        try { storage().setItem(cloudDocumentKey, JSON.stringify(binding)); retained = true } catch { remove() }
      }
      check()
      return true
    },
    link(source: CloudDocumentSource, value: unknown, kind: WorkspaceProvider) {
      if (!active || source.accountId !== accountId) return
      const ticket = { epoch, sequence: ++sequence }
      void this.confirmed(ticket, source, value, kind)
    },
    failed(ticket: { epoch: number; sequence: number; id: string }, conflict: boolean) {
      if (!valid(ticket)) return
      pending = undefined; operation = 'failed'
      if (binding?.id === ticket.id && !['changed', 'missing'].includes(verification)) verification = conflict ? 'changed' : 'unavailable'
      publish()
    },
    listed(entries: CloudEntry[], ticket: { epoch: number; sequence: number } | undefined) {
      if (!ticket || !valid(ticket) || !binding) return
      const entry = entries.find(value => value.id === binding!.id)
      if (!entry) verification = 'missing'
      else if (entry.etag !== binding.etag) verification = 'changed'
      else if (!['changed', 'missing'].includes(verification)) verification = 'confirmed'
      publish()
    },
    listUnavailable(ticket: { epoch: number; sequence: number } | undefined) {
      if (ticket && valid(ticket) && binding && !['changed', 'missing'].includes(verification)) {
        verification = 'unavailable'; publish()
      }
    },
  }
}
export type DocumentSaveState = ReturnType<typeof createDocumentSaveState>
