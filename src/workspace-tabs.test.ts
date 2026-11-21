import { describe, expect, it } from 'vitest'
import { cloudDocumentKey } from './cloud/document-state'
import { workspaceStorageKeys, type WorkspaceStorage } from './workspace-session'
import { addWorkspaceTab, readWorkspaceTabs, workspaceTabKey, workspaceTabStorage, workspaceTabsKey,
  workspaceTabsLimit, writeWorkspaceTabs, type WorkspaceTab, type WorkspaceTabs } from './workspace-tabs'

const first: WorkspaceTab = { id: '11111111-1111-4111-8111-111111111111', provider: 'vwan', name: 'First design' }
const second: WorkspaceTab = { id: '22222222-2222-4222-8222-222222222222', provider: 'vwan', name: 'Second design' }
const empty: WorkspaceTabs = { version: 1, tabs: [] }
const diagnosticsKey = 'vwan-visual-topology:diagnostics:v1'

function memory() {
  const values = new Map<string, string>()
  const storage: WorkspaceStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
  return { values, storage }
}

describe('workspace tab persistence', () => {
  it('restores every open design and the active tab without changing either native record or legacy originals', () => {
    const { storage } = memory()
    storage.setItem(workspaceStorageKeys.vwan, 'legacy original bytes')
    const firstRaw = '{"version":1, "name":"Native bytes", "future":{"kept":true}}'
    let session = addWorkspaceTab(storage, empty, first, firstRaw)
    const native = { ...second, provider: 'azure-net' as const }
    const secondRaw = '{"sampleId":"","topology":{"kind":"azure-network-topology","version":2}}'
    session = addWorkspaceTab(storage, session, native, secondRaw)
    expect(readWorkspaceTabs(storage)).toEqual({ session })
    expect(workspaceTabStorage(storage, first).getItem(workspaceStorageKeys.vwan)).toBe(firstRaw)
    expect(workspaceTabStorage(storage, native).getItem(workspaceStorageKeys['azure-net'])).toBe(secondRaw)
    expect(storage.getItem(workspaceStorageKeys.vwan)).toBe('legacy original bytes')
  })

  it('isolates topology, diagnostics and cloud associations even for two designs using the same provider', () => {
    const { storage } = memory()
    const one = workspaceTabStorage(storage, first), two = workspaceTabStorage(storage, second)
    for (const key of [workspaceStorageKeys.vwan, diagnosticsKey, cloudDocumentKey]) {
      one.setItem(key, 'first')
      two.setItem(key, 'second')
      one.removeItem(key)
      expect(one.getItem(key)).toBeNull()
      expect(two.getItem(key)).toBe('second')
      expect(storage.getItem(key)).toBeNull()
    }
    one.setItem('theme', 'dark')
    expect(two.getItem('theme')).toBe('dark')
  })

  it('never redirects delayed writes to a newly active design and rejects a revoked writer', () => {
    const { storage } = memory()
    let writable = true
    const one = workspaceTabStorage(storage, first, () => writable)
    const two = workspaceTabStorage(storage, second)
    one.setItem(workspaceStorageKeys.vwan, 'first')
    two.setItem(workspaceStorageKeys.vwan, 'second')
    writable = false
    expect(() => one.setItem(workspaceStorageKeys.vwan, 'delayed result')).toThrow('no longer writable')
    expect(() => one.removeItem(cloudDocumentKey)).toThrow('no longer writable')
    expect(two.getItem(workspaceStorageKeys.vwan)).toBe('second')
    expect(one.getItem(workspaceStorageKeys.vwan)).toBe('first')
  })

  it('leaves malformed or unsupported manifests untouched and distinguishes unavailable storage', () => {
    const { storage } = memory()
    for (const raw of ['not JSON', '{"version":2,"tabs":[]}', JSON.stringify({
      version: 1, tabs: [first, first], activeId: first.id,
    }), JSON.stringify({ version: 1, tabs: [first], activeId: second.id })]) {
      storage.setItem(workspaceTabsKey, raw)
      expect(readWorkspaceTabs(storage)).toEqual({ recovery: 'invalid' })
      expect(storage.getItem(workspaceTabsKey)).toBe(raw)
    }
    expect(readWorkspaceTabs({ getItem: () => { throw new Error('Unavailable') } })).toEqual({ recovery: 'unavailable' })
  })

  it('does not replace the prior session or design when saving a new tab fails', () => {
    const { storage } = memory()
    const session = addWorkspaceTab(storage, empty, first, 'original design')
    const manifest = storage.getItem(workspaceTabsKey)
    const failing = { ...storage, setItem: (key: string, value: string) => {
      if (key === workspaceTabsKey) throw new Error('Full')
      storage.setItem(key, value)
    } }
    expect(() => addWorkspaceTab(failing, session, second, 'new design')).toThrow('Full')
    expect(storage.getItem(workspaceTabsKey)).toBe(manifest)
    expect(storage.getItem(workspaceTabKey(first, 'topology'))).toBe('original design')
    expect(storage.getItem(workspaceTabKey(second, 'topology'))).toBeNull()
  })

  it('rejects duplicate IDs, storage collisions and an oversized manifest before changing designs', () => {
    const { storage } = memory()
    const session = addWorkspaceTab(storage, empty, first, 'original')
    expect(() => addWorkspaceTab(storage, session, first, 'replacement')).toThrow('Invalid active')
    storage.setItem(workspaceTabKey(second, 'topology'), 'preserved orphan')
    expect(() => addWorkspaceTab(storage, session, second, 'replacement')).toThrow('already exists')
    expect(storage.getItem(workspaceTabKey(second, 'topology'))).toBe('preserved orphan')
    expect(() => writeWorkspaceTabs(storage, { version: 1, activeId: first.id,
      tabs: Array.from({ length: workspaceTabsLimit + 1 }, () => first) })).toThrow('Invalid workspace tab session')
    expect(storage.getItem(workspaceTabKey(first, 'topology'))).toBe('original')
  })

  it('rejects a stale session instead of dropping designs opened by another window', () => {
    const { storage } = memory()
    const current = addWorkspaceTab(storage, empty, first, 'original')
    expect(() => addWorkspaceTab(storage, empty, second, 'stale add')).toThrow('changed')
    expect(() => writeWorkspaceTabs(storage, empty, empty)).toThrow('changed')
    expect(readWorkspaceTabs(storage)).toEqual({ session: current })
    expect(storage.getItem(workspaceTabKey(second, 'topology'))).toBeNull()
  })
})
