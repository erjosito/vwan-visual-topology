import { describe, expect, it, vi } from 'vitest'
import { example } from '../model'
import { sampleHubSpokeFirewallUdr } from '../azure-net/model'
import { CloudHttpError } from './client'
import { parseCloudTopology, type CloudValue, type CloudTopology } from './contracts'
import {
  exportLibraryBackup, importLibraryBackup, libraryBackupLimits, parseLibraryBackup, previewLibraryBackup,
  type LibraryBackup, type LibraryBackupEntry,
} from './library-backup'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const document = (name = 'Saved design', mixed = false) => parseCloudTopology({
  version: 1, name, description: 'Portable description',
  topology: mixed ? { ...sampleHubSpokeFirewallUdr, retainedExtension: { note: 'Retain me' } } : example,
})
const backup = (entries: LibraryBackupEntry[]): LibraryBackup => ({ format: 'aznetsim-cloud-library', version: 1, entries })
const signal = () => new AbortController().signal
function library(initial: LibraryBackupEntry[] = []) {
  let revision = 0
  const records = new Map<string, CloudValue<CloudTopology>>(initial.map(entry => [
    entry.id, { value: entry.document, etag: `"${++revision}"` },
  ]))
  const api = {
    listTopologies: vi.fn(async () => [...records].map(([id, record]) => ({
      id, name: record.value.name, description: record.value.description, etag: record.etag, updatedAt: '',
    }))),
    getTopology: vi.fn(async (id: string) => records.get(id)),
    saveTopology: vi.fn(async (id: string, value: CloudTopology, etag: string | null) => {
      if (etag === null ? records.has(id) : records.get(id)?.etag !== etag) throw new CloudHttpError(412, 'Changed')
      const next = `"${++revision}"`
      records.set(id, { value, etag: next })
      return next
    }),
  }
  return { api, records }
}

describe('portable cloud library backups', () => {
  it('exports selected or whole libraries with stable GUIDs, both native families and no transport metadata', async () => {
    const values = [{ id: id(1), document: document() }, { id: id(2), document: document('Mixed', true) }]
    const { api } = library(values)
    const all = await exportLibraryBackup(api, undefined, signal())
    expect(parseLibraryBackup(all.raw)).toEqual(backup(values))
    expect(Object.keys(JSON.parse(all.raw))).toEqual(['format', 'version', 'entries'])
    expect(Object.keys(JSON.parse(all.raw).entries[0])).toEqual(['id', 'document'])
    expect(all.raw).not.toContain('etag')
    const selected = await exportLibraryBackup(api, [id(2)], signal())
    expect(parseLibraryBackup(selected.raw).entries).toEqual([values[1]])
    expect(api.saveTopology).not.toHaveBeenCalled()
    expect(parseLibraryBackup((await exportLibraryBackup(library().api, undefined, signal())).raw).entries).toEqual([])
  })

  it('rejects invalid entries, duplicate GUIDs, injected transport fields, unknown versions and batch bounds', () => {
    const entry = { id: id(1), document: document() }
    for (const invalid of [
      { ...backup([entry]), version: 2 },
      { ...backup([entry]), token: 'not portable' },
      backup([{ ...entry, etag: '"secret"' } as LibraryBackupEntry]),
      backup([entry, entry]),
      backup([entry, { id: id(2), document: { ...entry.document, topology: {} } }]),
    ]) expect(() => parseLibraryBackup(JSON.stringify(invalid))).toThrow()
    expect(() => parseLibraryBackup(JSON.stringify(backup(Array.from({ length: 51 }, (_, n) => ({ ...entry, id: id(n) }))))))
      .toThrow('limit')
    expect(() => parseLibraryBackup(' '.repeat(libraryBackupLimits.bytes + 1))).toThrow('limit')
  })

  it('does not prepare a partial backup when a source disappears or changes during collection', async () => {
    const entry = { id: id(1), document: document() }
    const { api } = library([entry])
    api.getTopology.mockResolvedValueOnce(undefined)
    await expect(exportLibraryBackup(api, undefined, signal())).rejects.toMatchObject({ code: 'changed', id: id(1) })
    api.listTopologies.mockResolvedValueOnce([{ id: id(1), name: 'Before', description: undefined, etag: '"1"', updatedAt: '' }])
      .mockResolvedValueOnce([{ id: id(1), name: 'After', description: undefined, etag: '"2"', updatedAt: '' }])
    await expect(exportLibraryBackup(api, undefined, signal())).rejects.toMatchObject({ code: 'changed' })
    expect(api.saveTopology).not.toHaveBeenCalled()
  })

  it('previews GUID/content matches and defaults conflicts to keeping the existing cloud version', async () => {
    const { api, records } = library([{ id: id(1), document: document() }, { id: id(2), document: document('Current') }])
    const input = backup([{ id: id(1), document: document() }, { id: id(2), document: document('Older') },
      { id: id(3), document: document('New', true) }])
    const preview = await previewLibraryBackup(api, input, signal())
    expect(preview.map(entry => entry.state)).toEqual(['identical', 'conflict', 'new'])
    expect(api.saveTopology).not.toHaveBeenCalled()
    const result = await importLibraryBackup(api, preview, new Set(), signal())
    expect(result.map(entry => entry.status)).toEqual(['identical', 'kept', 'imported'])
    expect(records.get(id(2))?.value.name).toBe('Current')
    expect(records.get(id(3))?.value).toEqual(input.entries[2].document)
    const repeat = await previewLibraryBackup(api, input, signal())
    await importLibraryBackup(api, repeat, new Set(), signal())
    expect(records.size).toBe(3)
    expect(api.saveTopology).toHaveBeenCalledTimes(1)
  })

  it('overwrites only explicitly selected conflicts with the exact preview ETag and rejects later revisions', async () => {
    const { api, records } = library([{ id: id(1), document: document('Current') }, { id: id(2), document: document('Other') }])
    const input = backup([{ id: id(1), document: document('Backup') }, { id: id(2), document: document('Older') }])
    const preview = await previewLibraryBackup(api, input, signal())
    records.set(id(2), { value: document('Changed after preview'), etag: '"new-revision"' })
    const results = await importLibraryBackup(api, preview, new Set([id(1), id(2)]), signal())
    expect(results).toEqual([{ id: id(1), status: 'imported' }, { id: id(2), status: 'failed', error: 'changed' }])
    expect(api.saveTopology).toHaveBeenCalledExactlyOnceWith(id(1), input.entries[0].document, '"1"')
    expect(records.get(id(2))?.value.name).toBe('Changed after preview')
  })

  it('reconciles a lost write acknowledgement using the same GUID without duplicating a record', async () => {
    const { api, records } = library()
    const input = backup([{ id: id(1), document: document() }])
    const preview = await previewLibraryBackup(api, input, signal())
    api.saveTopology.mockImplementationOnce(async (id, value) => {
      records.set(id, { value, etag: '"written"' })
      throw new Error('Connection lost after write')
    })
    expect(await importLibraryBackup(api, preview, new Set(), signal())).toEqual([{ id: id(1), status: 'confirmed' }])
    expect(await importLibraryBackup(api, preview, new Set(), signal())).toEqual([{ id: id(1), status: 'confirmed' }])
    expect(api.saveTopology).toHaveBeenCalledTimes(1)
    expect(records.size).toBe(1)
  })

  it('preserves a concurrent save when its revision changes after import preflight but before the conditional write', async () => {
    const { api, records } = library([{ id: id(1), document: document('Current') }])
    const preview = await previewLibraryBackup(api, backup([{ id: id(1), document: document('Backup') }]), signal())
    const save = api.saveTopology.getMockImplementation()!
    api.saveTopology.mockImplementationOnce(async (id, value, etag) => {
      records.set(id, { value: document('Concurrent save'), etag: '"later"' })
      return save(id, value, etag)
    })
    expect(await importLibraryBackup(api, preview, new Set([id(1)]), signal())).toEqual([
      { id: id(1), status: 'failed', error: 'changed' },
    ])
    expect(records.get(id(1))?.value.name).toBe('Concurrent save')
    expect(api.saveTopology).toHaveBeenCalledExactlyOnceWith(id(1), document('Backup'), '"1"')
  })

  it('reports partial and unconfirmed outcomes instead of claiming a complete import', async () => {
    const { api } = library()
    const preview = await previewLibraryBackup(api, backup([
      { id: id(1), document: document() }, { id: id(2), document: document('Second') },
    ]), signal())
    api.saveTopology.mockImplementationOnce(async () => { throw new Error('Timed out') })
    expect((await importLibraryBackup(api, preview, new Set(), signal())).map(entry => entry.status)).toEqual(['unconfirmed', 'imported'])
  })

  it('stops future work on cancellation, including cancellation while a submitted upload finishes', async () => {
    const { api } = library(), controller = new AbortController()
    const preview = await previewLibraryBackup(api, backup([
      { id: id(1), document: document() }, { id: id(2), document: document('Second') },
    ]), signal())
    api.saveTopology.mockImplementationOnce(async () => { controller.abort(); return '"written"' })
    expect(await importLibraryBackup(api, preview, new Set(), controller.signal)).toEqual([
      { id: id(1), status: 'unconfirmed' }, { id: id(2), status: 'not-started' },
    ])
    expect(api.saveTopology).toHaveBeenCalledTimes(1)
    await expect(exportLibraryBackup(api, undefined, controller.signal)).rejects.toThrow()
  })

  it('enforces the library creation limit without preventing an explicitly reviewed overwrite', async () => {
    const { api } = library(Array.from({ length: 50 }, (_, n) => ({ id: id(n), document: document(`Saved ${n}`) })))
    const preview = await previewLibraryBackup(api, backup([
      { id: id(51), document: document('New') }, { id: id(1), document: document('Replacement') },
    ]), signal())
    expect(await importLibraryBackup(api, preview, new Set([id(1)]), signal())).toEqual([
      { id: id(51), status: 'failed', error: 'quota' }, { id: id(1), status: 'imported' },
    ])
  })
})
