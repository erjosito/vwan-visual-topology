import { describe, expect, it, vi } from 'vitest'
import { cloudDocumentKey } from './cloud/document-state'
import { example, type Topology } from './model'
import { workspaceStorageKeys } from './workspace-session'
import { workspaceTabKey, type WorkspaceTab } from './workspace-tabs'
import { createWorkspaceDocuments } from './workspace-documents'
import { createDocumentRuntime } from './document-runtime'

const first: WorkspaceTab = { id: '11111111-1111-4111-8111-111111111111', provider: 'vwan', name: 'First' }
const second: WorkspaceTab = { id: '22222222-2222-4222-8222-222222222222', provider: 'vwan', name: 'Second' }
const source = { accountId: 'account-a', id: '33333333-3333-4333-8333-333333333333', name: 'Cloud first', etag: '"one"' }
const history = (name: string) => ({
  provider: 'vwan' as const, topology: { ...structuredClone(example), name }, past: [] as Topology[],
  future: [] as Topology[], error: '', saveError: '', backup: '',
})
function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('workspace document ownership', () => {
  it('does not start a lazy file writer after its document closes', async () => {
    vi.stubGlobal('window', {})
    let ready!: () => void
    const loading = new Promise<void>(resolve => { ready = resolve })
    const write = vi.fn()
    vi.doMock('./browser-document-writer', async () => {
      await loading
      return { createBrowserDocumentWriter: () => ({ write }) }
    })
    const runtime = createDocumentRuntime(() => undefined, () => 'en', () => true)
    const documents = createWorkspaceDocuments(storage(), () => true, runtime.initialize)
    try {
      const document = documents.activate(first)
      document.remember(history('First'))
      const saving = document.commands!.saveAs({ kind: 'choose-file', name: 'first.json' })
      documents.forget(first.id)
      ready()
      expect(await saving).toBe('revoked')
      expect(write).not.toHaveBeenCalled()
    } finally {
      documents.dispose()
      await runtime.dispose()
      vi.doUnmock('./browser-document-writer')
      vi.unstubAllGlobals()
    }
  })

  it('starts without optional artifact metadata when storage reads fail', async () => {
    vi.stubGlobal('window', {})
    const runtime = createDocumentRuntime(() => undefined, () => 'en', () => false)
    const documents = createWorkspaceDocuments({
      ...storage(), getItem: () => { throw new Error('Storage unavailable') },
    }, () => false, runtime.initialize)
    try {
      const document = documents.activate(first)
      expect(document.remember(history('Recovered design'))).toBe(true)
      expect(await document.commands?.save()).toBe('needs-destination')
      expect(document.commands?.getSnapshot().destination).toBeUndefined()
    } finally {
      documents.dispose()
      await runtime.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('does not claim cloud-destination persistence when a temporary document confirms a save', async () => {
    const backing = storage(), documents = createWorkspaceDocuments(backing, () => false)
    documents.setAccount(source.accountId)
    const document = documents.activate(first), value = history('Temporary design')
    document.remember(value)
    const ticket = document.save.begin(source.id, source.accountId)!
    expect(await document.save.confirmed(ticket, source, value.topology, 'vwan')).toBe(true)
    expect(document.save.getSnapshot().cloud?.id).toBe(source.id)
    expect(document.save.getSnapshot().retained).toBe(false)
    expect(backing.getItem(workspaceTabKey(first, 'cloud'))).toBeNull()
  })

  it('retains independent histories and view state while scoping writes to the active document', () => {
    const backing = storage(), documents = createWorkspaceDocuments(backing)
    const original = JSON.stringify(example)
    backing.setItem(workspaceStorageKeys.vwan, original)
    const a = documents.activate(first), firstHistory = history('First edits')
    expect(a.remember(firstHistory)).toBe(true)
    a.editorState.set('vwan.selection', { kind: 'hub', id: 'eu' })
    a.storage.setItem(workspaceStorageKeys.vwan, JSON.stringify(firstHistory.topology))
    const b = documents.activate(second), secondHistory = history('Second edits')
    expect(b.remember(secondHistory)).toBe(true)
    b.editorState.set('vwan.zoom', 1.4)
    b.storage.setItem(workspaceStorageKeys.vwan, JSON.stringify(secondHistory.topology))
    expect(a.remember(history('Late first update'))).toBe(false)
    expect(() => a.storage.setItem(workspaceStorageKeys.vwan, 'late bytes')).toThrow('no longer writable')
    expect(documents.activate(first)).toBe(a)
    expect(a.history).toBe(firstHistory)
    expect(a.editorState.get('vwan.selection')).toEqual({ kind: 'hub', id: 'eu' })
    expect(a.editorState.has('vwan.zoom')).toBe(false)
    expect(b.history).toBe(secondHistory)
    expect(b.editorState.get('vwan.zoom')).toBe(1.4)
    expect(backing.getItem(workspaceTabKey(first, 'topology'))).toBe(JSON.stringify(firstHistory.topology))
    expect(backing.getItem(workspaceTabKey(second, 'topology'))).toBe(JSON.stringify(secondHistory.topology))
    expect(backing.getItem(workspaceStorageKeys.vwan)).toBe(original)
  })

  it('finishes a delayed cloud save only in its live document after switching', async () => {
    const backing = storage(), documents = createWorkspaceDocuments(backing)
    documents.setAccount(source.accountId)
    const a = documents.activate(first), value = history('First')
    a.remember(value)
    const ticket = a.save.begin(source.id, source.accountId)!
    const pending = a.save.confirmed(ticket, source, value.topology, 'vwan')
    const b = documents.activate(second)
    b.remember(history('Second'))
    expect(a.save.getSnapshot().operation).toBe('saving')
    expect(await pending).toBe(true)
    expect(backing.getItem(workspaceTabKey(first, 'cloud'))).toContain(source.id)
    expect(backing.getItem(workspaceTabKey(second, 'cloud'))).toBeNull()
    documents.activate(first)
    const retry = a.save.begin(source.id, source.accountId)!
    expect(await a.save.confirmed(retry, source, value.topology, 'vwan')).toBe(true)
    const association = backing.getItem(workspaceTabKey(first, 'cloud'))
    expect(association).toContain(source.id)
    documents.activate(second)
    expect(b.save.getSnapshot().cloud).toBeUndefined()
    expect(a.save.getSnapshot()).toMatchObject({ ready: false, cloud: { id: source.id } })
    expect(a.save.begin(source.id, source.accountId)).toBeUndefined()
    documents.activate(first)
    expect(a.save.getSnapshot().cloud?.id).toBe(source.id)
    expect(backing.getItem(cloudDocumentKey)).toBeNull()
    documents.activate(second)
    a.save.reset()
    expect(backing.getItem(workspaceTabKey(first, 'cloud'))).toBe(association)
    documents.setAccount('account-b')
    expect(backing.getItem(workspaceTabKey(first, 'cloud'))).toBeNull()
    documents.activate(first)
    expect(a.save.getSnapshot().cloud).toBeUndefined()
  })

  it('keeps a save busy across activation and suspension without accepting inactive editor writes', async () => {
    const documents = createWorkspaceDocuments(storage())
    documents.setAccount(source.accountId)
    const a = documents.activate(first), value = history('First')
    a.remember(value)
    const ticket = a.save.begin(source.id, source.accountId)!
    documents.activate(first)
    expect(await a.save.confirmed(ticket, source, value.topology, 'vwan')).toBe(true)
    const next = a.save.begin(source.id, source.accountId)!
    documents.suspend()
    expect(a.save.getSnapshot().operation).toBe('saving')
    documents.activate(first)
    expect(a.save.begin(source.id, source.accountId)).toBeUndefined()
    documents.suspend()
    expect(await a.save.confirmed(next, source, value.topology, 'vwan')).toBe(true)
    expect(a.remember(history('Practice must not replace the design'))).toBe(false)
    expect(documents.activate(first).history).toBe(value)
  })

  it('retains a new-copy attempt identity across modal/tab changes and revokes closed completions', async () => {
    const backing = storage(), documents = createWorkspaceDocuments(backing)
    documents.setAccount(source.accountId)
    const a = documents.activate(first), value = history('First')
    a.remember(value)
    const id = a.save.newCopyId()
    documents.activate(second)
    expect(documents.activate(first).save.newCopyId()).toBe(id)
    const ticket = a.save.begin(id, source.accountId)!
    const pending = a.save.confirmed(ticket, { ...source, id }, value.topology, 'vwan')
    documents.forget(first.id)
    const reopened = documents.activate(first)
    reopened.remember(value)
    a.save.setActive(true)
    expect(a.save.begin(id, source.accountId)).toBeUndefined()
    expect(await pending).toBe(false)
    expect(reopened.save.getSnapshot().cloud).toBeUndefined()
    expect(backing.getItem(workspaceTabKey(first, 'cloud'))).toBeNull()
  })

  it('revokes forgotten owners even when the same stored document is reopened', () => {
    const backing = storage(), documents = createWorkspaceDocuments(backing)
    const previous = documents.activate(first)
    previous.storage.setItem(workspaceStorageKeys.vwan, 'retained recovery bytes')
    documents.forget(first.id)
    const reopened = documents.activate(first)
    expect(reopened).not.toBe(previous)
    expect(reopened.storage.getItem(workspaceStorageKeys.vwan)).toBe('retained recovery bytes')
    expect(() => previous.storage.removeItem(workspaceStorageKeys.vwan)).toThrow('no longer writable')
    expect(previous.remember(history('Late forgotten history'))).toBe(false)
    expect(() => documents.activate({ ...first, provider: 'azure-net' })).toThrow('provider changed')
    expect(documents.active()).toBe(reopened)
    documents.dispose()
    expect(() => reopened.storage.setItem(workspaceStorageKeys.vwan, 'late')).toThrow('no longer writable')
    expect(() => documents.activate(first)).toThrow('session has ended')
    expect(backing.getItem(workspaceTabKey(first, 'topology'))).toBe('retained recovery bytes')
  })
})
