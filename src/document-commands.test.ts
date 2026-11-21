import { describe, expect, it, vi } from 'vitest'
import { createDocumentCommands, type ArtifactDestination, type ArtifactReceipt, type ArtifactWriter } from './document-commands'

const file: ArtifactDestination = { kind: 'file', platform: 'desktop', name: 'original.json',
  location: 'C:\\Labs\\original.json', revision: 'original-bytes', authority: 'opaque-main-token' }
const cloud: ArtifactDestination = { kind: 'cloud', accountId: 'alice', id: 'owned-entry', name: 'Lab', etag: '"one"' }
function setup(write = vi.fn<ArtifactWriter>(async () => ({ confirmed: true, destination: file }))) {
  let topology = { version: 1, name: 'Original', hubs: [] as unknown[] }
  let account = 'alice'
  const retain = vi.fn<Parameters<typeof createDocumentCommands>[0]['retain']>(() => true)
  const commands = createDocumentCommands({ documentId: 'document-a', getTopology: () => topology,
    getAccountId: () => account, write, retain, digest: async value => JSON.stringify(value) })
  return { commands, write, retain, edit: (name: string) => { topology = { ...topology, name } },
    account: (value: string) => { account = value; commands.accountChanged() } }
}

describe('document artifact commands', () => {
  it('freezes edits before renewing exact file permission and keeps newer edits unsaved', async () => {
    let finish!: (value: Extract<ArtifactDestination, { kind: 'file' }>) => void
    let topology = { name: 'Submitted' }
    const write = vi.fn<ArtifactWriter>(async () => ({ confirmed: true, destination: file }))
    const authorizeFile = vi.fn(() => new Promise<Extract<ArtifactDestination, { kind: 'file' }>>(resolve => { finish = resolve }))
    const commands = createDocumentCommands({ documentId: 'renew', getTopology: () => topology,
      getAccountId: () => undefined, retain: () => true, write, authorizeFile, digest: async value => JSON.stringify(value) })
    const { authority: _authority, ...hint } = file as Extract<ArtifactDestination, { kind: 'file' }>
    await commands.restore({ version: 1, destination: hint, digest: '{"name":"Submitted"}' })
    const pending = commands.save()
    await Promise.resolve()
    expect(commands.getSnapshot().operation).toBe('saving')
    topology = { name: 'Newer edits' }
    finish(file as Extract<ArtifactDestination, { kind: 'file' }>)
    expect(await pending).toBe('saved')
    expect(JSON.parse(write.mock.calls[0][0].content).name).toBe('Submitted')
    expect(commands.getSnapshot().revision).toBe('modified')
  })

  it('rejects renewed authority for a different same-name or changed file without invoking the writer', async () => {
    const write = vi.fn<ArtifactWriter>()
    const commands = createDocumentCommands({ documentId: 'renew', getTopology: () => ({ name: 'Lab' }),
      getAccountId: () => undefined, retain: () => true, write,
      authorizeFile: async destination => ({ ...destination, location: 'C:\\Other\\original.json', authority: 'different' }) })
    const { authority: _authority, ...hint } = file as Extract<ArtifactDestination, { kind: 'file' }>
    await commands.restore({ version: 1, destination: hint })
    expect(await commands.save()).toBe('failed')
    expect(write).not.toHaveBeenCalled()
    expect(commands.getSnapshot().destination).toMatchObject({ location: file.location })
  })

  it('asks only on first Save and keeps actual confirmed file authority outside portable JSON and retained hints', async () => {
    const { commands, write, retain, edit } = setup()
    expect(await commands.save()).toBe('needs-destination')
    expect(await commands.saveAs({ kind: 'choose-file', name: 'suggestion.json' })).toBe('saved')
    edit('Edited')
    await commands.observe()
    expect(commands.getSnapshot().revision).toBe('modified')
    expect(await commands.save()).toBe('saved')
    expect(write.mock.calls[1][0]).toMatchObject({ documentId: 'document-a', choice: file })
    expect(JSON.parse(write.mock.calls[1][0].content).name).toBe('Edited')
    expect(write.mock.calls[1][0].content).not.toContain('opaque-main-token')
    expect(JSON.stringify(retain.mock.calls)).not.toContain('opaque-main-token')
    expect(commands.getSnapshot()).toMatchObject({ revision: 'matches', notice: { name: 'original.json', location: file.location } })
  })

  it('does not replace a confirmed default after cancelled, failed or unconfirmed download Save As', async () => {
    const { commands, write, edit } = setup()
    await commands.loaded(file, { version: 1, name: 'Original', hubs: [] })
    edit('Modified')
    await commands.observe()
    write.mockResolvedValueOnce(null)
    expect(await commands.saveAs({ kind: 'choose-file', name: 'other.json' })).toBe('cancelled')
    write.mockRejectedValueOnce(new Error('Permission denied'))
    expect(await commands.saveAs(cloud)).toBe('failed')
    write.mockResolvedValueOnce({ confirmed: false, name: 'download.json' })
    expect(await commands.saveAs({ kind: 'choose-file', name: 'download.json' })).toBe('downloaded')
    expect(commands.getSnapshot()).toMatchObject({ destination: { name: file.name }, revision: 'modified', notice: { kind: 'downloaded' } })
    expect(await commands.save()).toBe('saved')
    expect(write.mock.calls.at(-1)![0].choice).toEqual(file)
  })

  it('freezes the submitted snapshot, prevents competing writes and leaves edits during saving dirty', async () => {
    let finish!: (value: ArtifactReceipt) => void
    const write = vi.fn<ArtifactWriter>(() => new Promise<ArtifactReceipt>(resolve => { finish = resolve }))
    const { commands, edit } = setup(write)
    const pending = commands.saveAs(cloud)
    expect(await commands.saveAs(file)).toBe('busy')
    edit('Newer edit')
    finish({ confirmed: true, destination: cloud })
    expect(await pending).toBe('saved')
    expect(write).toHaveBeenCalledTimes(1)
    expect(JSON.parse(write.mock.calls[0][0].content).name).toBe('Original')
    expect(commands.getSnapshot().revision).toBe('modified')
    expect(commands.canClose()).toBe(false)
  })

  it('retains the original live document across switching and revokes completion after closing', async () => {
    let finish!: (value: ArtifactReceipt) => void
    const { commands, retain } = setup(vi.fn<ArtifactWriter>(() => new Promise(resolve => { finish = resolve })))
    const other = setup()
    const pending = commands.saveAs(file)
    await Promise.resolve()
    other.edit('Other document')
    finish({ confirmed: true, destination: file })
    expect(await pending).toBe('saved')
    expect(other.commands.getSnapshot().destination).toBeUndefined()
    let finishClosed!: (value: ArtifactReceipt) => void
    const closed = setup(vi.fn<ArtifactWriter>(() => new Promise(resolve => { finishClosed = resolve })))
    const closingSave = closed.commands.saveAs(file)
    await Promise.resolve()
    const disposal = closed.commands.dispose()
    finishClosed({ confirmed: true, destination: file })
    expect(await closingSave).toBe('revoked')
    await disposal
    expect(closed.retain).not.toHaveBeenCalled()
    expect(retain).toHaveBeenCalledTimes(1)
  })

  it('does not turn another-account or failed cloud updates into new saves', async () => {
    const { commands, write, account } = setup()
    await commands.loaded(cloud, { version: 1, name: 'Original', hubs: [] })
    account('bob')
    expect(await commands.save()).toBe('failed')
    expect(write).not.toHaveBeenCalled()
    account('alice')
    write.mockRejectedValueOnce(new Error('ETag conflict'))
    expect(await commands.save()).toBe('failed')
    expect(write.mock.calls[0][0].choice).toEqual(cloud)
    expect(commands.getSnapshot().destination).toEqual(cloud)
  })

  it('does not adopt an acknowledged cloud destination after the account changes during writing', async () => {
    let finish!: (value: ArtifactReceipt) => void
    const { commands, account } = setup(vi.fn<ArtifactWriter>(() => new Promise(resolve => { finish = resolve })))
    await commands.loaded(file, { version: 1, name: 'Original', hubs: [] })
    const pending = commands.saveAs(cloud)
    await Promise.resolve()
    account('bob')
    finish({ confirmed: true, destination: cloud })
    expect(await pending).toBe('failed')
    expect(commands.getSnapshot().destination).toMatchObject({ name: file.name })
  })

  it('rejects a mismatched destination acknowledgement without changing the last default', async () => {
    const { commands, write } = setup()
    await commands.loaded(file, { version: 1, name: 'Original', hubs: [] })
    write.mockResolvedValueOnce({ confirmed: true, destination: { ...file, location: 'C:\\Labs\\unrelated.json' } })
    expect(await commands.save()).toBe('failed')
    expect(commands.getSnapshot().destination).toMatchObject({ location: file.location })
  })

  it('rejects oversized UTF-8 payloads before any file or cloud write', async () => {
    const { commands, write, edit } = setup()
    edit('\u00e9'.repeat(2_000_000))
    expect(await commands.saveAs(file)).toBe('failed')
    expect(write).not.toHaveBeenCalled()
    expect(commands.canClose()).toBe(false)
  })

  it('creates a cloud default only from an acknowledged first-save choice and subsequently updates that identity', async () => {
    const { commands, write } = setup(vi.fn<ArtifactWriter>(async () => ({ confirmed: true, destination: cloud })))
    expect(await commands.saveAs({ kind: 'choose-cloud', accountId: 'alice', name: 'Lab' })).toBe('saved')
    expect(await commands.save()).toBe('saved')
    expect(write.mock.calls[1][0].choice).toEqual(cloud)
    write.mockResolvedValueOnce(null)
    expect(await commands.saveAs({ kind: 'choose-cloud', accountId: 'alice', name: 'Other' })).toBe('cancelled')
    expect(commands.getSnapshot().destination).toEqual(cloud)
  })

  it('restores the saved model digest without restoring file authority or treating newer recovered edits as saved', async () => {
    const { commands, write, edit } = setup()
    const { authority, ...destination } = file
    const metadata = { version: 1 as const, destination, digest: JSON.stringify({ version: 1, name: 'Original', hubs: [] }) }
    edit('Recovered newer edits')
    await commands.restore(metadata)
    expect(commands.getSnapshot()).toMatchObject({ revision: 'modified', fileAccess: 'required' })
    expect(await commands.save()).toBe('failed')
    expect(write).not.toHaveBeenCalled()
    await commands.restore(metadata, authority)
    expect(commands.getSnapshot()).toMatchObject({ revision: 'modified', fileAccess: 'available' })
    expect(await commands.save()).toBe('saved')
    expect(write.mock.calls[0][0].choice).toEqual(file)
  })

  it('hides restored private cloud identity until its account is active, without forgetting its retained hint', async () => {
    const { commands, account } = setup()
    account('bob')
    await commands.restore({ version: 1, destination: cloud, digest: JSON.stringify({ version: 1, name: 'Original', hubs: [] }) })
    expect(commands.getSnapshot()).toMatchObject({ destination: undefined, revision: 'draft', retained: false })
    expect(commands.canClose()).toBe(false)
    account('alice')
    await commands.observe()
    expect(commands.getSnapshot()).toMatchObject({ destination: cloud, revision: 'matches', retained: true })
    account('bob')
    account('alice')
    await commands.observe()
    expect(commands.getSnapshot().retained).toBe(true)
  })

  it('rejects stale cloud completion even when the same account signs in again before acknowledgement', async () => {
    let finish!: (value: ArtifactReceipt) => void
    const { commands, account } = setup(vi.fn<ArtifactWriter>(() => new Promise(resolve => { finish = resolve })))
    await commands.loaded(file, { version: 1, name: 'Original', hubs: [] })
    const pending = commands.saveAs({ kind: 'choose-cloud', accountId: 'alice', name: 'Lab' })
    await Promise.resolve()
    account('bob')
    account('alice')
    finish({ confirmed: true, destination: cloud })
    expect(await pending).toBe('failed')
    expect(commands.getSnapshot().destination).toMatchObject({ name: file.name })
  })
})
