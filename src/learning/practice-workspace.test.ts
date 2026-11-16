import { describe, expect, it } from 'vitest'
import { exercises } from './exercises'
import { createPracticeSession } from './practice-session'
import {
  admitPracticeDocument, explicitWorkspaceEntry, practiceConflict, practiceProvider, practiceWorkspaceKey,
  readPracticeWorkspace, writePracticeWorkspace, type PracticeWorkspace,
} from './practice-workspace'

const record = (index = 0): PracticeWorkspace => ({
  version: 1, courseId: 'local-practice', scenarioId: exercises[index].id,
  active: true, returnProvider: 'azure-net', document: structuredClone(exercises[index].starter),
})
const storage = () => {
  const entries = new Map<string, string>([
    ['aznet-visual-topology:v1', 'original mixed design'],
    ['vwan-visual-topology:v1', 'original vwan design'],
    ['network-simulator:workspace:v1', 'original selection'],
    ['aznet-simulator:practice:v1', 'original learning progress'],
  ])
  return {
    entries, getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) },
    removeItem: (key: string) => { entries.delete(key) },
  }
}

describe('isolated practice persistence', () => {
  it.each([0, 1, 2])('round trips a native starter, identity, layout and resume flag (%i)', async (index) => {
    const saved = record(index)
    if (saved.document.mode === 'vwan') {
      saved.document.topology.layout = { mode: 'layered', positions: { layered: { a: { x: 120, y: 240 } } } }
    } else {
      saved.document.topology.vnets[0].x = 120
      saved.document.topology.vnets[0].y = 240
    }
    saved.document = await admitPracticeDocument(saved.document)
    const store = storage()
    const originals = [...store.entries]
    const raw = writePracticeWorkspace(store, saved, null)
    expect(await readPracticeWorkspace(raw)).toEqual(saved)
    expect(practiceProvider(saved.document)).toBe(saved.document.mode === 'vwan' ? 'vwan' : 'azure-net')
    const paused = { ...saved, active: false }
    const next = writePracticeWorkspace(store, paused, raw)
    expect((await readPracticeWorkspace(next))?.active).toBe(false)
    store.removeItem(practiceWorkspaceKey)
    expect([...store.entries]).toEqual(originals)
  })

  it('distinguishes no practice from unreadable, unsupported or inadmissible originals without writing', async () => {
    expect(await readPracticeWorkspace(null)).toBeUndefined()
    for (const raw of [
      '', 'broken', 'null', '[]', '{}', 'x'.repeat(4_010_001),
      JSON.stringify({ ...record(), version: 2 }),
      JSON.stringify({ ...record(), active: 'true' }),
      JSON.stringify({ ...record(), courseId: 'bad identity' }),
      JSON.stringify({ ...record(), scenarioId: '' }),
      JSON.stringify({ ...record(), returnProvider: 'other' }),
      JSON.stringify({ ...record(), futureEnvelope: true }),
      JSON.stringify({ ...record(), document: { mode: 'other', topology: {} } }),
      JSON.stringify({ ...record(), document: { mode: 'vwan', topology: {} } }),
      JSON.stringify({ ...record(), document: { mode: 'full', topology: {} } }),
    ]) await expect(readPracticeWorkspace(raw)).rejects.toThrow()
  })

  it('refuses known stale writes and retains all designs and the other practice', () => {
    const store = storage()
    const prior = writePracticeWorkspace(store, record(), null)
    const newer = writePracticeWorkspace(store, { ...record(), active: false }, prior)
    const snapshot = [...store.entries]
    expect(() => writePracticeWorkspace(store, record(1), prior)).toThrow(practiceConflict)
    expect(store.getItem(practiceWorkspaceKey)).toBe(newer)
    expect([...store.entries]).toEqual(snapshot)
  })

  it('propagates unavailable/quota errors without falling back to design or progress keys', () => {
    const store = storage()
    const prior = writePracticeWorkspace(store, record(), null)
    const snapshot = [...store.entries]
    expect(() => writePracticeWorkspace({ ...store, setItem: () => { throw new Error('quota') } }, record(1), prior)).toThrow('quota')
    expect(() => writePracticeWorkspace({ ...store, getItem: () => { throw new Error('unavailable') } }, record(1), prior)).toThrow('unavailable')
    expect([...store.entries]).toEqual(snapshot)
  })

  it('gives explicit workspace/sample/snapshot links precedence over automatic resumption', () => {
    for (const [search, hash] of [['?mode=full', ''], ['?sample=example', ''], ['', '#s=snapshot'], ['', '#other=1&s=snapshot']]) {
      expect(explicitWorkspaceEntry(search, hash)).toBe(true)
    }
    expect(explicitWorkspaceEntry('', '')).toBe(false)
    expect(explicitWorkspaceEntry('?theme=dark', '#section')).toBe(false)
  })

  it('rejects cancelled opens and writers from an earlier editor generation', async () => {
    const store = storage()
    const session = createPracticeSession({ storage: () => store, changed: () => {}, notice: () => {}, replaced: () => {},
      ownership: { owned: true, acquire: async () => true, release: () => {} } })
    const input = record()
    await expect(session.open(input, 'vwan', () => false)).rejects.toThrow('cancelled')
    expect(store.getItem(practiceWorkspaceKey)).toBeNull()
    await session.open(input, 'vwan', () => true)
    const prior = store.getItem(practiceWorkspaceKey)
    expect(() => session.save(record(1).document, 0)).toThrow('Practice could not be saved')
    expect(store.getItem(practiceWorkspaceKey)).toBe(prior)
    await session.open(record(1), 'vwan', () => true)
    const next = store.getItem(practiceWorkspaceKey)
    expect(() => session.save(input.document, 1)).toThrow('Practice could not be saved')
    expect(store.getItem(practiceWorkspaceKey)).toBe(next)
  })
})
