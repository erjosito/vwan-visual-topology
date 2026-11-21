import { expect, test } from '@playwright/test'

test('real browser file handles confirm bytes, reuse their destination and reject external changes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const result = await page.evaluate(async () => {
    const writerModule = '/src/browser-document-writer.ts', commandsModule = '/src/document-commands.ts'
    const modelModule = '/src/azure-net/model.ts'
    const { createBrowserDocumentWriter } = await import(writerModule)
    const { createDocumentCommands } = await import(commandsModule)
    const { createEmptyAzNetTopology } = await import(modelModule)
    const directory = await navigator.storage.getDirectory()
    const handle = await directory.getFileHandle('document-writer-test.json', { create: true })
    const writer = createBrowserDocumentWriter({ picker: async () => handle })
    let topology = createEmptyAzNetTopology(), metadata: unknown
    const commands = createDocumentCommands({
      documentId: 'browser-file-test', getTopology: () => topology, getAccountId: () => undefined, write: writer.write,
      retain: (value: unknown) => { metadata = value; return true },
      release: async () => { writer.release('browser-file-test') },
    })
    try {
      const savedAs = await commands.saveAs({ kind: 'choose-file', name: handle.name })
      const original = await (await handle.getFile()).text()
      topology = { ...topology, name: 'Modified browser file' }
      const saved = await commands.save()
      const updated = await (await handle.getFile()).text()
      const external = await handle.createWritable()
      await external.write('externally changed')
      await external.close()
      const conflict = await commands.save()
      return { savedAs, saved, original: JSON.parse(original), updated: JSON.parse(updated),
        conflict, finalBytes: await (await handle.getFile()).text(), metadata: JSON.stringify(metadata),
        destination: commands.getSnapshot().destination, error: commands.getSnapshot().error }
    } finally {
      await commands.dispose()
      await directory.removeEntry('document-writer-test.json')
    }
  })
  expect(result.savedAs).toBe('saved')
  expect(result.saved).toBe('saved')
  expect(result.original.name).not.toBe(result.updated.name)
  expect(result.updated.name).toBe('Modified browser file')
  expect(result.conflict).toBe('failed')
  expect(result.finalBytes).toBe('externally changed')
  expect(result.error).toContain('changed externally')
  expect(result.metadata).not.toContain('authority')
  expect(result.destination).toMatchObject({ platform: 'browser', name: 'document-writer-test.json' })
})
