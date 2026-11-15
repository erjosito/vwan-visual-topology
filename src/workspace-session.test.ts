import { describe, expect, it } from 'vitest'
import { selectWorkspace, workspaceArchiveKey, workspaceOriginals, workspaceSessionKey, workspaceStartup, workspaceStorageKeys, type WorkspaceStorage } from './workspace-session'

function memory(entries: Record<string, string> = {}): WorkspaceStorage {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
    removeItem: (key) => { map.delete(key) },
  }
}

describe('one authoritative active workspace', () => {
  it('starts fresh in the mixed provider and never guesses between two legacy saves', () => {
    expect(workspaceStartup(memory(), '')).toEqual({ provider: 'azure-net' })
    const storage = memory({ [workspaceStorageKeys.vwan]: 'original v1', [workspaceStorageKeys['azure-net']]: 'original v2' })
    expect(workspaceStartup(storage, '')).toEqual({})
    expect(storage.getItem(workspaceSessionKey)).toBeNull()
    selectWorkspace(storage, 'vwan')
    expect(workspaceStartup(storage, '')).toEqual({ provider: 'vwan' })
    expect(storage.getItem(workspaceStorageKeys['azure-net'])).toBe('original v2')
    expect(workspaceOriginals(storage)).toEqual([{ key: workspaceStorageKeys.vwan, raw: 'original v1' }])
  })

  it('keeps damaged originals and exact native bytes persistently before any replacement', () => {
    const storage = memory({ [workspaceStorageKeys.vwan]: '{damaged', [workspaceStorageKeys['azure-net']]: '{"topology":{"name":"original"}}' })
    selectWorkspace(storage, 'vwan', '{"version":1}')
    selectWorkspace(storage, 'azure-net')
    selectWorkspace(storage, 'azure-net')
    expect(workspaceOriginals(storage)).toEqual([
      { key: workspaceStorageKeys.vwan, raw: '{damaged' },
      { key: workspaceStorageKeys['azure-net'], raw: '{"topology":{"name":"original"}}' },
    ])
    expect(storage.getItem(workspaceStorageKeys.vwan)).toBe('{"version":1}')
  })

  it('refuses replacement when originals cannot be archived or the active pointer cannot be committed', () => {
    for (const failedKey of [workspaceArchiveKey, workspaceSessionKey]) {
      const storage = memory({ [workspaceStorageKeys.vwan]: 'original' })
      const set = storage.setItem
      storage.setItem = (key, value) => { if (key === failedKey) throw new Error('quota'); set(key, value) }
      expect(() => selectWorkspace(storage, 'vwan', 'replacement')).toThrow('quota')
      expect(storage.getItem(workspaceStorageKeys.vwan)).toBe('original')
    }
  })

  it('rolls back selection if native replacement fails, without touching either design', () => {
    const storage = memory({ [workspaceSessionKey]: '{"version":1,"provider":"azure-net"}', [workspaceStorageKeys.vwan]: 'original' })
    const set = storage.setItem
    storage.setItem = (key, value) => { if (key === workspaceStorageKeys.vwan) throw new Error('quota'); set(key, value) }
    expect(() => selectWorkspace(storage, 'vwan', 'replacement')).toThrow('quota')
    expect(workspaceStartup(storage, '')).toEqual({ provider: 'azure-net' })
    expect(storage.getItem(workspaceStorageKeys.vwan)).toBe('original')
  })

  it('normalizes legacy aliases without destructive H&S projection and admits damaged selection recovery', () => {
    for (const alias of ['hub-spoke', 'hub-and-spoke', 'vnet', 'full', 'aznet', 'azure-net']) {
      expect(workspaceStartup(memory(), `?mode=${alias}`)).toEqual({ provider: 'azure-net' })
    }
    expect(workspaceStartup(memory({ [workspaceSessionKey]: '{broken' }), '').recovery).toBeTruthy()
    const storage = memory({ [workspaceSessionKey]: '{broken' })
    selectWorkspace(storage, 'azure-net')
    expect(workspaceOriginals(storage)).toContainEqual({ key: workspaceSessionKey, raw: '{broken' })
    expect(workspaceStartup(storage, '')).toEqual({ provider: 'azure-net' })
  })

  it('requires recovery for every invalid selection and archives its exact bytes before replacement', () => {
    for (const raw of ['null', '[]', '{}', '{"version":2,"provider":"vwan"}', '{"version":1,"provider":"unknown"}', '{broken']) {
      const storage = memory({ [workspaceSessionKey]: raw, [workspaceStorageKeys.vwan]: 'original' })
      expect(workspaceStartup(storage, '').provider).toBeUndefined()
      expect(workspaceStartup(storage, '').recovery).toBeTruthy()
      selectWorkspace(storage, 'azure-net')
      expect(workspaceOriginals(storage)).toContainEqual({ key: workspaceSessionKey, raw })
      expect(storage.getItem(workspaceStorageKeys.vwan)).toBe('original')
    }
  })

  it('does not replace a corrupt archive or an unarchivable invalid selection', () => {
    for (const archive of ['{broken', '[{"key":"native"}]']) {
      const storage = memory({ [workspaceArchiveKey]: archive, [workspaceSessionKey]: '{}', [workspaceStorageKeys.vwan]: 'original' })
      expect(() => selectWorkspace(storage, 'vwan', 'replacement')).toThrow()
      expect(storage.getItem(workspaceArchiveKey)).toBe(archive)
      expect(storage.getItem(workspaceSessionKey)).toBe('{}')
      expect(storage.getItem(workspaceStorageKeys.vwan)).toBe('original')
    }
  })
})
