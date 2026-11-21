import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('a failed document dialog chunk keeps the active design editable', async ({ page }) => {
  await page.route('**/DocumentDialogs.tsx', route => route.abort())
  await page.goto('/?mode=vwan')
  const name = page.getByLabel('Topology name', { exact: true })
  await name.fill('Keep this design')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.document-dialog-error')).toContainText('Your design stays open')
  await page.keyboard.press('Escape')
  await expect(page.locator('.document-dialog-error')).toHaveCount(0)
  await expect(name).toHaveValue('Keep this design')
  await name.fill('Still editable')
  await expect(page.getByRole('tab', { name: 'Still editable', exact: true })).toBeVisible()
})

for (const mode of ['vwan', 'hub-spoke', 'full']) {
  for (const language of ['en', 'ja']) {
    test(`${mode} ${language}: document destination dialog fits, announces and supports keyboard cancellation`, async ({ page }) => {
      const japanese = language === 'ja'
      await page.setViewportSize({ width: japanese ? 390 : 1440, height: 900 })
      await page.emulateMedia({ colorScheme: japanese ? 'dark' : 'light' })
      await page.addInitScript(language => {
        localStorage.setItem('vwan-visual-topology:language:v1', language)
      }, language)
      await page.goto(`/?mode=${mode}`)
      await expect(page.locator('.document-artifact-status')).toBeVisible()
      await page.keyboard.press('Control+s')
      const chooser = page.getByRole('dialog', { name: japanese ? '名前を付けて保存' : 'Save As', exact: true })
      await expect(chooser).toBeVisible()
      const bounds = (await chooser.boundingBox())!
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(japanese ? 390 : 1440)
      expect((await new AxeBuilder({ page }).include('.document-command-dialog').analyze()).violations).toEqual([])
      await page.keyboard.press('Escape')
      await expect(chooser).toHaveCount(0)
      await page.keyboard.press('Control+Shift+s')
      await expect(chooser).toBeVisible()
      await chooser.getByRole('button', { name: japanese ? 'キャンセル' : 'Cancel', exact: true }).click()
      await expect(chooser).toHaveCount(0)
      await expect(page.locator('.document-artifact-status')).toHaveAttribute('aria-live', 'polite')
      await expect(page.locator('.document-artifact-status')).toContainText(japanese ? '未保存の変更' : 'Unsaved changes')
    })
  }
}

test('document toolbar and Ctrl+S update the same real file, isolate tabs and restore private permissions', async ({ page }) => {
  await page.addInitScript(() => {
    const browser = window as Window & { showSaveFilePicker: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
      pickerCount: number; cancelPicker: boolean }
    browser.pickerCount = 0
    browser.showSaveFilePicker = async options => {
      browser.pickerCount++
      if (browser.cancelPicker) throw new DOMException('Cancelled', 'AbortError')
      return (await navigator.storage.getDirectory()).getFileHandle(options.suggestedName, { create: true })
    }
  })
  await page.goto('/?mode=vwan')
  await expect(page.getByLabel('Topology name', { exact: true })).toBeVisible()
  await page.getByLabel('Topology name', { exact: true }).fill('First document')
  await page.keyboard.press('Control+s')
  const chooser = page.getByRole('dialog', { name: 'Save As', exact: true })
  await expect(chooser).toBeVisible()
  await chooser.getByLabel('Name', { exact: true }).fill('toolbar-real-file')
  await chooser.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(chooser).toHaveCount(0)
  await expect(page.locator('.document-artifact-status')).toContainText('Saved')
  await page.getByLabel('Topology name', { exact: true }).fill('Second revision')
  await expect(page.locator('.document-artifact-status')).toContainText('Unsaved changes')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.document-artifact-status')).toContainText('Saved')
  expect(await page.evaluate(() => (window as Window & { pickerCount: number }).pickerCount)).toBe(1)
  const file = () => page.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('toolbar-real-file.json')
    return JSON.parse(await (await handle.getFile()).text())
  })
  expect((await file()).name).toBe('Second revision')
  await page.evaluate(() => { (window as Window & { cancelPicker: boolean }).cancelPicker = true })
  await page.getByRole('button', { name: 'Save As', exact: true }).click()
  await chooser.getByLabel('Name', { exact: true }).fill('cancelled-destination')
  await chooser.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(chooser.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  await chooser.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.locator('.document-artifact-status')).toContainText('toolbar-real-file.json')
  await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.keyboard.press('Control+s')
  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect((await file()).name).toBe('Second revision')
  await page.getByRole('tab', { name: 'Second revision', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Second revision')
  await page.reload()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Second revision')
  await page.getByLabel('Topology name', { exact: true }).fill('After reload')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.document-artifact-status')).toContainText('Saved')
  expect(await page.evaluate(() => (window as Window & { pickerCount: number }).pickerCount)).toBe(0)
  expect((await file()).name).toBe('After reload')
  await page.getByLabel('Topology name', { exact: true }).fill('Not saved')
  await page.getByRole('button', { name: 'Close topology: Not saved', exact: true }).click()
  const closing = page.getByRole('dialog', { name: 'Save changes before closing?', exact: true })
  await closing.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Not saved')
  await page.getByRole('button', { name: 'Close topology: Not saved', exact: true }).click()
  await closing.getByRole('button', { name: 'Save and close', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Not saved', exact: true })).toHaveCount(0)
  expect((await file()).name).toBe('Not saved')
  await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry('toolbar-real-file.json') })
})

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

test('private browser handles survive reload without granting authority through JSON hints', async ({ page }) => {
  const id = '90000000-0000-4000-8000-000000000001'
  await page.goto('/')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  try {
    const first = await page.evaluate(async id => {
      const writerModule = '/src/browser-document-writer.ts', storeModule = '/src/browser-document-store.ts'
      const commandsModule = '/src/document-commands.ts', modelModule = '/src/azure-net/model.ts'
      const { createBrowserDocumentWriter } = await import(writerModule)
      const { createBrowserDocumentStore } = await import(storeModule)
      const { createDocumentCommands } = await import(commandsModule)
      const { createEmptyAzNetTopology } = await import(modelModule)
      const directory = await navigator.storage.getDirectory()
      const handle = await directory.getFileHandle('document-store-reload-test.json', { create: true })
      const store = createBrowserDocumentStore()
      const writer = createBrowserDocumentWriter({ picker: async () => handle, retainHandle: store.put })
      const topology = createEmptyAzNetTopology()
      const commands = createDocumentCommands({
        documentId: id, getTopology: () => topology, getAccountId: () => undefined, write: writer.write,
        retain: (value: unknown) => { localStorage.setItem(`network-simulator:workspace-tab:v1:${id}:artifact`, JSON.stringify(value)); return true },
        release: async () => { writer.release(id) },
      })
      try {
        const result = await commands.saveAs({ kind: 'choose-file', name: handle.name })
        const stored = await store.get(id, commands.getSnapshot().destination?.bindingId)
        localStorage.setItem(`network-simulator:workspace-tab:v1:${id}:topology`, JSON.stringify({ ...topology, name: 'Recovered newer edits' }))
        return { result, retained: !!stored && await stored.handle.isSameEntry(handle),
          hint: localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:artifact`) }
      } finally { await commands.dispose(); await store.dispose() }
    }, id)
    expect(first.result).toBe('saved')
    expect(first.retained).toBe(true)
    expect(first.hint).not.toMatch(/authority|getFile|createWritable/)
    await page.reload()
    const restored = await page.evaluate(async id => {
      const writerModule = '/src/browser-document-writer.ts', storeModule = '/src/browser-document-store.ts'
      const commandsModule = '/src/document-commands.ts', metadataModule = '/src/document-metadata.ts'
      const { createBrowserDocumentWriter } = await import(writerModule)
      const { createBrowserDocumentStore } = await import(storeModule)
      const { createDocumentCommands } = await import(commandsModule)
      const { parseArtifactMetadata } = await import(metadataModule)
      const store = createBrowserDocumentStore()
      const writer = createBrowserDocumentWriter({ picker: async () => { throw new Error('Unexpected new destination picker') }, retainHandle: store.put })
      const topology = JSON.parse(localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:topology`)!)
      const hint = parseArtifactMetadata(localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:artifact`))
      const stored = await store.get(id, hint?.destination.bindingId)
      if (!hint || !stored || stored.revision !== hint.destination.revision) throw new Error('Missing matching file permission')
      const commands = createDocumentCommands({
        documentId: id, getTopology: () => topology, getAccountId: () => undefined, write: writer.write,
        retain: () => true, release: async () => { writer.release(id) },
      })
      try {
        await commands.restore(hint)
        const before = commands.getSnapshot()
        const raw = await writer.read(stored.handle)
        if (raw.revision !== stored.revision) throw new Error('The retained file changed')
        const destination = writer.bind(id, stored.handle, raw.revision, stored.id)
        await commands.restore(hint, destination.authority)
        const result = await commands.save()
        const file = JSON.parse(await (await stored.handle.getFile()).text())
        const retained = await store.get(id, commands.getSnapshot().destination?.bindingId)
        return { before, result, file, revisionUpdated: retained?.revision === commands.getSnapshot().destination?.revision }
      } finally { await commands.dispose(); await store.dispose() }
    }, id)
    expect(restored.before).toMatchObject({ revision: 'modified', fileAccess: 'required' })
    expect(restored.result).toBe('saved')
    expect(restored.file.name).toBe('Recovered newer edits')
    expect(restored.revisionUpdated).toBe(true)
  } finally {
    await page.evaluate(async id => {
      const storeModule = '/src/browser-document-store.ts'
      const { createBrowserDocumentStore } = await import(storeModule)
      const store = createBrowserDocumentStore()
      await store.remove(id); await store.dispose()
      localStorage.removeItem(`network-simulator:workspace-tab:v1:${id}:artifact`)
      localStorage.removeItem(`network-simulator:workspace-tab:v1:${id}:topology`)
      await (await navigator.storage.getDirectory()).removeEntry('document-store-reload-test.json').catch(() => {})
    }, id)
  }
})

test('private bindings separate identical same-name files, reject foreign owners and cap retained references', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const result = await page.evaluate(async () => {
    const storeModule = '/src/browser-document-store.ts', writerModule = '/src/browser-document-writer.ts'
    const { createBrowserDocumentStore } = await import(storeModule)
    const { createBrowserDocumentWriter } = await import(writerModule)
    const store = createBrowserDocumentStore(), writer = createBrowserDocumentWriter()
    const directory = await navigator.storage.getDirectory()
    const firstDirectory = await directory.getDirectoryHandle('document-binding-first', { create: true })
    const secondDirectory = await directory.getDirectoryHandle('document-binding-second', { create: true })
    const first = await firstDirectory.getFileHandle('same-name.json', { create: true })
    const second = await secondDirectory.getFileHandle('same-name.json', { create: true })
    const id = '90000000-0000-4000-8000-000000000002', other = '90000000-0000-4000-8000-000000000003'
    try {
      for (const handle of [first, second]) {
        const stream = await handle.createWritable()
        await stream.write('{"name":"Identical"}'); await stream.close()
      }
      const raw = await writer.read(first)
      const bindingA = crypto.randomUUID(), bindingB = crypto.randomUUID()
      await store.put(id, first, raw.revision, bindingA)
      await store.put(id, second, raw.revision, bindingB)
      const a = await store.get(id, bindingA), b = await store.get(id, bindingB)
      const foreign = await store.get(other, bindingA)
      const separated = !!a && !!b && await a.handle.isSameEntry(first) && await b.handle.isSameEntry(second)
        && !await a.handle.isSameEntry(b.handle)
      let last = ''
      for (let index = 0; index < 66; index++) {
        last = crypto.randomUUID()
        if (!await store.put(id, first, raw.revision, last)) throw new Error('Permission reference could not be retained.')
      }
      const retained = await store.get(id, last)
      const count = await new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('aznetsim-document-files', 1)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const transaction = db.transaction('handles', 'readonly')
          const request = transaction.objectStore('handles').index('documentId').count(id)
          transaction.oncomplete = () => { db.close(); resolve(request.result) }
        }
      })
      return { separated, foreignRejected: !foreign, count, latestRetained: !!retained,
        firstBytes: await (await first.getFile()).text(), secondBytes: await (await second.getFile()).text() }
    } finally {
      await store.remove(id); await store.dispose()
      await firstDirectory.removeEntry('same-name.json'); await secondDirectory.removeEntry('same-name.json')
      await directory.removeEntry('document-binding-first'); await directory.removeEntry('document-binding-second')
    }
  })
  expect(result).toEqual({ separated: true, foreignRejected: true, count: 64, latestRetained: true,
    firstBytes: '{"name":"Identical"}', secondBytes: '{"name":"Identical"}' })
})
