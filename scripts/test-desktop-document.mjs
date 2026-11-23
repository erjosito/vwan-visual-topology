import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve('test-artifacts', 'desktop')
await mkdir(root, { recursive: true })
const directory = await mkdtemp(join(root, 'document-capability-'))
const source = join(directory, 'source.json'), copy = join(directory, 'copy.json')
const content = name => JSON.stringify({ version: 1, name, hubs: [], sites: [], spokes: [], connections: [], siteLinks: [], routeMaps: [] })
let application
try {
  await writeFile(source, content('Original'))
  application = await electron.launch({
    args: [resolve('platform-dist', 'electron', 'main.cjs'), `--user-data-dir=${join(directory, 'profile')}`],
  })
  const page = await application.firstWindow()
  await page.getByTestId('aznet-app').waitFor()
  await application.evaluate(({ dialog }, { source, copy }) => {
    globalThis.documentDialogPicks = 0
    globalThis.documentSavePaths = [copy, undefined]
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    dialog.showSaveDialog = async () => {
      globalThis.documentDialogPicks++
      const filePath = globalThis.documentSavePaths.shift()
      return { canceled: !filePath, filePath }
    }
  }, { source, copy })
  const documentId = '11111111-1111-4111-8111-111111111111'
  const loaded = await page.evaluate(documentId => window.desktopSimulator.openDocument({ documentId }), documentId)
  expect(loaded.ok).toBe(true)
  expect(loaded.value.destination.location).toBe(source)
  const save = request => page.evaluate(request => window.desktopSimulator.saveDocument(request), request)
  let saved = await save({ documentId, content: content('Saved'), destinationToken: loaded.value.destination.token })
  expect(saved.ok).toBe(true)
  expect(await readFile(source, 'utf8')).toBe(content('Saved'))
  expect(await application.evaluate(() => globalThis.documentDialogPicks)).toBe(0)
  const borrowed = await save({ documentId: '22222222-2222-4222-8222-222222222222',
    content: content('Borrowed'), destinationToken: saved.value.token })
  expect(borrowed).toMatchObject({ ok: false, code: 'revoked' })
  expect(Object.keys(borrowed).sort()).toEqual(['code', 'error', 'ok'])
  expect(borrowed.error).not.toContain(source)
  saved = await save({ documentId, content: content('Copy'), suggestedName: 'Copy', language: 'ja' })
  expect(saved.ok).toBe(true)
  expect(saved.value.location).toBe(copy)
  expect(await readFile(copy, 'utf8')).toBe(content('Copy'))
  expect(await readFile(source, 'utf8')).toBe(content('Saved'))
  const cancelled = await save({ documentId, content: content('Cancelled') })
  expect(cancelled).toEqual({ ok: true, value: null })
  const updated = await save({ documentId, content: content('Updated copy'), destinationToken: saved.value.token })
  expect(updated.ok).toBe(true)
  expect(await readFile(copy, 'utf8')).toBe(content('Updated copy'))
  expect(await application.evaluate(() => globalThis.documentDialogPicks)).toBe(2)
  await writeFile(copy, content('External change'))
  expect(await save({ documentId, content: content('Unexpected overwrite'), destinationToken: updated.value.token }))
    .toMatchObject({ ok: false, code: 'conflict' })
  const released = await page.evaluate(documentId => window.desktopSimulator.releaseDocument({ documentId }), documentId)
  expect(released.ok).toBe(true)
  expect(await save({ documentId, content: content('Released overwrite'), destinationToken: updated.value.token }))
    .toMatchObject({ ok: false, code: 'revoked' })
  const fileMenu = page.locator('.presentation-group').filter({ has: page.locator('summary', { hasText: /^File$/ }) })
  await fileMenu.locator('summary').click()
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await page.getByRole('dialog', { name: 'Load topology', exact: true }).getByRole('button', { name: 'Load file', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Saved')
  await page.getByLabel('Topology name', { exact: true }).fill('UI saved')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.document-artifact-details summary')).toHaveAttribute('title', /^Saved/, { timeout: 30_000 })
  await expect(page.locator('.document-artifact-status')).toHaveText('Locally saved')
  expect(JSON.parse(await readFile(source, 'utf8')).name).toBe('UI saved')
  expect(await application.evaluate(() => globalThis.documentDialogPicks)).toBe(2)
  await page.reload()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('UI saved')
  await page.getByLabel('Topology name', { exact: true }).fill('UI saved after reload')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.document-artifact-details summary')).not.toHaveAttribute('title', /^Saving/, { timeout: 30_000 })
  if ((await page.locator('.document-artifact-details summary').getAttribute('title'))?.includes('failed')) {
    throw new Error(await page.locator('.document-artifact-details [role="alert"]').textContent())
  }
  await expect(page.locator('.document-artifact-details summary')).toHaveAttribute('title', /^Saved/, { timeout: 30_000 })
  expect(JSON.parse(await readFile(source, 'utf8')).name).toBe('UI saved after reload')
  const third = join(directory, 'third.json')
  await writeFile(third, content('UI saved after reload'))
  await application.evaluate(({ dialog }, third) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [third] })
  }, third)
  await fileMenu.locator('summary').click()
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  await page.getByRole('dialog', { name: 'Load topology', exact: true }).getByRole('button', { name: 'Load file', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(3)
  await expect(page.getByRole('tab', { name: 'UI saved after reload', exact: true })).toHaveCount(2)
  const closes = page.locator('.workspace-tab-close')
  await expect(closes).toHaveCount(3)
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setSize(900, 900)
    window.webContents.setZoomFactor(1.5)
  })
  await closes.first().click()
  const closing = page.getByRole('dialog', { name: 'Save changes before closing?', exact: true })
  await closing.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(closes).toHaveCount(3)
  await closes.first().click()
  await closing.getByRole('button', { name: 'Discard and close', exact: true }).click()
  await expect(closes).toHaveCount(2)
  await expect(page.getByRole('tab').last()).toHaveAttribute('aria-selected', 'true')
  await closes.first().click()
  await expect(closes).toHaveCount(1)
  await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
  await expect(closes).toHaveCount(2)
  await closes.first().click()
  await expect(closes).toHaveCount(1)
  expect(JSON.parse(await readFile(source, 'utf8')).name).toBe('UI saved after reload')
  expect(await readFile(third, 'utf8')).toBe(content('UI saved after reload'))
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1) })
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1440, 1000) })
  await page.getByTestId('workspace-library-open').click()
  await page.getByRole('dialog', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Close all topology tabs', exact: true }).click()
  await page.getByRole('dialog', { name: 'Save changes before closing?', exact: true }).getByRole('button', { name: 'Discard and close', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Workspace', exact: true })).toHaveCount(0)
  const replacementId = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')).activeId)
  const replacement = await page.evaluate(id => {
    const raw = JSON.parse(localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:topology`))
    return { topology: raw.topology ?? raw,
      cloud: localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:cloud`),
      artifact: localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:artifact`) }
  }, replacementId)
  expect(Object.values(replacement.topology).filter(Array.isArray).every(values => values.length === 0)).toBe(true)
  expect(replacement.cloud).toBeNull()
  expect(replacement.artifact).toBeNull()
  await page.keyboard.press('Control+s')
  const freshSave = page.getByRole('dialog', { name: 'Save As', exact: true })
  await expect(freshSave).toBeVisible()
  await freshSave.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(JSON.parse(await readFile(source, 'utf8')).name).toBe('UI saved after reload')
  await page.reload()
  await expect(page.getByRole('tab')).toHaveCount(1)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')).activeId)).toBe(replacementId)
  await page.goto('app://simulator/docs/index.html')
  const untrusted = await page.evaluate(async () => {
    try {
      await window.desktopSimulator.saveDocument({ documentId: '33333333-3333-4333-8333-333333333333',
        content: '{"version":1,"name":"Untrusted","hubs":[],"sites":[],"spokes":[],"connections":[],"siteLinks":[],"routeMaps":[]}' })
      return false
    } catch { return true }
  })
  expect(untrusted).toBe(true)
  expect(JSON.parse(await readFile(source, 'utf8')).name).toBe('UI saved after reload')
  expect(await readFile(copy, 'utf8')).toBe(content('External change'))
  expect((await readdir(directory)).some(file => file.endsWith('.tmp'))).toBe(false)
  console.log('Desktop document capabilities passed: remembered updates, Save As/cancel, ownership, conflicts and IPC origin.')
} finally {
  await application?.close()
  await rm(directory, { recursive: true, force: true })
}
