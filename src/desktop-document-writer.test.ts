import { expect, test, vi } from 'vitest'
import { createDocumentCommands, type ArtifactDestination, type ArtifactMetadata } from './document-commands'
import { createDesktopDocumentWriter } from './desktop-document-writer'
import type { DesktopBridge } from './platform/desktop'

const file = { token: 'private-file-capability', name: 'network.json', location: 'C:\\Designs\\network.json', revision: 'original-revision' }
const destination: ArtifactDestination = { kind: 'file', platform: 'desktop', name: file.name,
  location: file.location, revision: file.revision, authority: file.token }

function setup() {
  const saveDocument = vi.fn<DesktopBridge['saveDocument']>()
  let topology = { name: 'Original' }
  let metadata: ArtifactMetadata | undefined
  let language: 'en' | 'ja' = 'en'
  const commands = createDocumentCommands({
    documentId: 'owning-document', getTopology: () => topology, getAccountId: () => undefined,
    write: createDesktopDocumentWriter({ saveDocument }, () => language),
    retain: value => { metadata = value; return true },
    digest: async value => JSON.stringify(value),
  })
  return { commands, saveDocument, metadata: () => metadata,
    edit: (name: string) => { topology = { name } },
    language: () => { language = 'ja' },
  }
}

test('confirmed Save As binds native permission to its document and subsequent Save reuses it', async () => {
  const state = setup()
  state.saveDocument.mockResolvedValueOnce({ ok: true, value: file })
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'suggested.json' })).toBe('saved')
  expect(state.saveDocument.mock.calls[0][0]).toEqual({
    documentId: 'owning-document', suggestedName: 'suggested.json', content: JSON.stringify({ name: 'Original' }, null, 2), language: 'en',
  })
  expect(JSON.stringify(state.metadata())).not.toContain(file.token)
  state.edit('New revision')
  state.language()
  state.saveDocument.mockResolvedValueOnce({ ok: true, value: { ...file, revision: 'new-revision' } })
  expect(await state.commands.save()).toBe('saved')
  expect(state.saveDocument.mock.calls[1][0]).toEqual({
    documentId: 'owning-document', destinationToken: file.token, content: JSON.stringify({ name: 'New revision' }, null, 2), language: 'ja',
  })
  expect(state.commands.getSnapshot().destination).toMatchObject({ location: file.location, revision: 'new-revision' })
  expect(state.commands.canClose()).toBe(true)
})

test('cancelled or denied native Save As keeps the prior default without choosing another file', async () => {
  const state = setup()
  await state.commands.loaded(destination, { name: 'Original' })
  state.saveDocument.mockResolvedValueOnce({ ok: true, value: null })
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'other.json' })).toBe('cancelled')
  state.saveDocument.mockResolvedValueOnce({ ok: false, code: 'permission', error: 'The file is read-only.' })
  expect(await state.commands.saveAs({ kind: 'choose-file', name: 'other.json' })).toBe('failed')
  expect(state.commands.getSnapshot().destination).toMatchObject({ location: file.location })
  state.saveDocument.mockResolvedValueOnce({ ok: false, code: 'conflict', error: 'The file changed externally.' })
  expect(await state.commands.save()).toBe('failed')
  expect(state.saveDocument.mock.calls[2][0].destinationToken).toBe(file.token)
  expect(state.saveDocument).toHaveBeenCalledTimes(3)
  expect(state.commands.getSnapshot().error).toBe('The file changed externally.')
})

test('foreign platforms or metadata without native authority never invoke a file picker', async () => {
  const saveDocument = vi.fn<DesktopBridge['saveDocument']>()
  const write = createDesktopDocumentWriter({ saveDocument })
  for (const choice of [
    { ...destination, platform: 'browser' as const },
    { ...destination, authority: undefined },
    { kind: 'cloud' as const, accountId: 'account', id: 'cloud-id', name: 'Cloud', etag: 'etag' },
  ]) {
    await expect(write({ documentId: 'document', content: '{}', choice })).rejects.toThrow()
  }
  expect(saveDocument).not.toHaveBeenCalled()
})
