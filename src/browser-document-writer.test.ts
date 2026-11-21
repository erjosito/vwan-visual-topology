import { expect, test, vi } from 'vitest'
import { createDocumentCommands, type ArtifactMetadata } from './document-commands'
import { createBrowserDocumentWriter, type BrowserDocumentHandle } from './browser-document-writer'

function fileHandle(content = '{}') {
  let value = content
  const abort = vi.fn(async () => {})
  const close = vi.fn<() => Promise<void>>()
  const write = vi.fn<(value: string) => Promise<void>>()
  const handle: BrowserDocumentHandle = {
    kind: 'file', name: 'network.json',
    getFile: vi.fn(async () => new File([value], 'network.json')),
    queryPermission: vi.fn<BrowserDocumentHandle['queryPermission']>(async () => 'granted'),
    requestPermission: vi.fn<BrowserDocumentHandle['requestPermission']>(async () => 'granted'),
    isSameEntry: vi.fn<BrowserDocumentHandle['isSameEntry']>(async other => other === handle),
    createWritable: vi.fn<BrowserDocumentHandle['createWritable']>(async () => {
      let staged = ''
      write.mockImplementation(async text => { staged = text })
      close.mockImplementation(async () => { value = staged })
      return { write, close, abort }
    }),
  }
  return { handle, abort, close, write, value: () => value, external: (text: string) => { value = text } }
}
function setup(writer: ReturnType<typeof createBrowserDocumentWriter>, id = 'document') {
  let topology = { name: 'Original' }
  let metadata: ArtifactMetadata | undefined
  const commands = createDocumentCommands({
    documentId: id, getTopology: () => topology, getAccountId: () => undefined, write: writer.write,
    retain: value => { metadata = value; return true }, release: async () => { writer.release(id) },
    digest: async value => JSON.stringify(value),
  })
  return { commands, metadata: () => metadata, edit: () => { topology = { name: 'Modified' } } }
}

test('unsupported browser downloads are unconfirmed and cannot become a default destination', async () => {
  const download = vi.fn()
  const writer = createBrowserDocumentWriter({ picker: null, download })
  const state = setup(writer)
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'network.json' })).toBe('downloaded')
  expect(download).toHaveBeenCalledWith(JSON.stringify({ name: 'Original' }, null, 2), 'network.json')
  expect(state.metadata()).toBeUndefined()
  expect(state.commands.getSnapshot().destination).toBeUndefined()
  expect(state.commands.canClose()).toBe(false)
  expect(await state.commands.save()).toBe('needs-destination')
})

test('confirmed browser saves reuse only their own handle, renew permission and confirm actual bytes', async () => {
  const file = fileHandle()
  const picker = vi.fn(async () => file.handle)
  const writer = createBrowserDocumentWriter({ picker })
  const state = setup(writer)
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'suggested.json' })).toBe('saved')
  expect(file.value()).toBe(JSON.stringify({ name: 'Original' }, null, 2))
  expect(file.handle.createWritable).toHaveBeenCalledWith({ mode: 'exclusive' })
  expect(JSON.stringify(state.metadata())).not.toContain('authority')
  state.edit()
  vi.mocked(file.handle.queryPermission).mockResolvedValue('prompt')
  expect(await state.commands.save()).toBe('saved')
  expect(file.handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
  expect(file.value()).toBe(JSON.stringify({ name: 'Modified' }, null, 2))
  expect(picker).toHaveBeenCalledOnce()
  expect(state.commands.canClose()).toBe(true)
})

test('external edits and denied permission never overwrite the target or fall back to a download', async () => {
  const file = fileHandle(), download = vi.fn()
  const writer = createBrowserDocumentWriter({ picker: null, download })
  const read = await writer.read(file.handle)
  const state = setup(writer)
  await state.commands.loaded(writer.bind('document', file.handle, read.revision), { name: 'Original' })
  file.external('external editor')
  expect(await state.commands.save()).toBe('failed')
  expect(state.commands.getSnapshot().error).toContain('changed externally')
  expect(file.handle.createWritable).not.toHaveBeenCalled()
  vi.mocked(file.handle.queryPermission).mockResolvedValue('denied')
  vi.mocked(file.handle.requestPermission).mockResolvedValue('denied')
  expect(await state.commands.save()).toBe('failed')
  expect(file.value()).toBe('external editor')
  expect(download).not.toHaveBeenCalled()
})

test('changes during staged writing abort the stream and do not adopt a saved revision', async () => {
  const file = fileHandle()
  const writer = createBrowserDocumentWriter({ picker: async () => file.handle })
  const state = setup(writer)
  const createWritable = vi.mocked(file.handle.createWritable).getMockImplementation()!
  vi.mocked(file.handle.createWritable).mockImplementation(async options => {
    const stream = await createWritable(options)
    return { ...stream, write: async content => { await stream.write(content); file.external('concurrent edit') } }
  })
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'network.json' })).toBe('failed')
  expect(file.abort).toHaveBeenCalledOnce()
  expect(file.close).not.toHaveBeenCalled()
  expect(file.value()).toBe('concurrent edit')
  expect(state.commands.getSnapshot().destination).toBeUndefined()
})

test('cancelled picker preserves the prior default; copied or foreign authority cannot write it', async () => {
  const file = fileHandle()
  const picker = vi.fn(async () => file.handle)
  const writer = createBrowserDocumentWriter({ picker })
  const initial = await writer.read(file.handle)
  const destination = writer.bind('document', file.handle, initial.revision)
  const state = setup(writer)
  await state.commands.loaded(destination, { name: 'Original' })
  picker.mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'other.json' })).toBe('cancelled')
  expect(state.commands.getSnapshot().destination).toMatchObject({ name: file.handle.name })
  await expect(writer.write({ documentId: 'other', choice: destination, content: '{}' })).rejects.toThrow('renewed')
  await expect(writer.write({ documentId: 'document', choice: JSON.parse(JSON.stringify(destination)), content: '{}' })).rejects.toThrow('renewed')
  expect(file.handle.createWritable).not.toHaveBeenCalled()
})

test('released picker completions cannot attach to a reopened document with the same ID', async () => {
  const old = fileHandle(), reopened = fileHandle('reopened')
  let finish!: (handle: BrowserDocumentHandle) => void
  const writer = createBrowserDocumentWriter({ picker: () => new Promise(resolve => { finish = resolve }) })
  const pending = writer.write({ documentId: 'document', choice: { kind: 'choose-file', name: 'network.json' }, content: 'old' })
  writer.release('document')
  const current = await writer.read(reopened.handle)
  const destination = writer.bind('document', reopened.handle, current.revision)
  finish(old.handle)
  await expect(pending).rejects.toThrow('released')
  expect(old.handle.createWritable).not.toHaveBeenCalled()
  expect((await writer.write({ documentId: 'document', choice: destination, content: 'new' }))?.confirmed).toBe(true)
  expect(reopened.value()).toBe('new')
})

test('disposing commands releases a pending picker before it can write, not merely after its completion', async () => {
  const file = fileHandle()
  let finish!: (handle: BrowserDocumentHandle) => void
  const writer = createBrowserDocumentWriter({ picker: () => new Promise(resolve => { finish = resolve }) })
  const { commands } = setup(writer)
  const pending = commands.saveAs({ kind: 'choose-file', name: 'network.json' })
  await Promise.resolve()
  const disposal = commands.dispose()
  finish(file.handle)
  expect(await pending).toBe('revoked')
  await disposal
  expect(file.handle.createWritable).not.toHaveBeenCalled()
  expect(file.value()).toBe('{}')
})

test('different documents cannot concurrently save through the same file handle', async () => {
  const file = fileHandle()
  const writer = createBrowserDocumentWriter()
  const initial = await writer.read(file.handle)
  const first = writer.bind('first', file.handle, initial.revision)
  const second = writer.bind('second', file.handle, initial.revision)
  let finish!: () => void, started!: () => void
  const waiting = new Promise<void>(resolve => { finish = resolve })
  const writing = new Promise<void>(resolve => { started = resolve })
  const createWritable = vi.mocked(file.handle.createWritable).getMockImplementation()!
  vi.mocked(file.handle.createWritable).mockImplementation(async options => {
    const stream = await createWritable(options)
    return { ...stream, write: async content => { await stream.write(content); started(); await waiting } }
  })
  const pending = writer.write({ documentId: 'first', choice: first, content: 'first' })
  await writing
  await expect(writer.write({ documentId: 'second', choice: second, content: 'second' })).rejects.toThrow('Another document')
  finish()
  expect((await pending)?.confirmed).toBe(true)
  expect(file.value()).toBe('first')
  await expect(writer.write({ documentId: 'second', choice: second, content: 'second' })).rejects.toThrow('changed externally')
})

test('a changed post-close file is not reported as a confirmed saved artifact', async () => {
  const file = fileHandle()
  const writer = createBrowserDocumentWriter({ picker: async () => file.handle })
  const state = setup(writer)
  const createWritable = vi.mocked(file.handle.createWritable).getMockImplementation()!
  vi.mocked(file.handle.createWritable).mockImplementation(async options => {
    const stream = await createWritable(options)
    return { ...stream, close: async () => { await stream.close(); file.external('changed after commit') } }
  })
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'network.json' })).toBe('failed')
  expect(state.commands.getSnapshot().error).toContain('could not be confirmed')
  expect(state.commands.getSnapshot().destination).toBeUndefined()
  expect(file.value()).toBe('changed after commit')
})
