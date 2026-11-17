import { expect, test, type Page } from '@playwright/test'
import { exercises } from '../src/learning/exercises'
import { practiceWorkspaceKey, type PracticeWorkspace } from '../src/learning/practice-workspace'
import { progressKey } from '../src/learning/progress'

const normalKeys = ['vwan-visual-topology:v1', 'aznet-visual-topology:v1']
const stored = (page: Page) => page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), normalKeys)
const practice = (page: Page): Promise<PracticeWorkspace> => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), practiceWorkspaceKey)
const bar = (page: Page) => page.getByTestId('practice-workspace-bar')
const undo = (page: Page) => page.getByRole('button', { name: /Undo/, exact: false })
const redo = (page: Page) => page.getByRole('button', { name: /Redo/, exact: false })
const node = (page: Page, vwan: boolean) => vwan ? page.locator('[data-node-id="a"]') : page.getByTestId('aznet-vnet-a')
const position = (page: Page, vwan: boolean) => vwan ? node(page, vwan).getAttribute('transform')
  : node(page, vwan).locator('.network-node-frame').getAttribute('x')

async function seed(page: Page, vwan: boolean) {
  const document = structuredClone(exercises[vwan ? 0 : 1].starter)
  document.topology.name = 'My original design'
  await page.addInitScript(({ document, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(
      document.mode === 'vwan' ? document.topology : { sampleId: '', topology: document.topology },
    ))
  }, { document, key: normalKeys[vwan ? 0 : 1] })
  await page.goto(`/?mode=${vwan ? 'vwan' : 'full'}`)
  await expect(node(page, vwan)).toBeVisible()
}

async function start(page: Page) {
  const dialog = page.getByTestId('learning-sidebar')
  if (!await dialog.isVisible()) await page.getByTestId('learning-open').click()
  await dialog.getByRole('button', { name: 'Load practice network', exact: true }).click()
  return dialog
}

async function confirmStart(page: Page, scenario: string) {
  const dialog = await start(page)
  await dialog.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
  await expect(bar(page)).toContainText('your normal design is kept separately')
  await page.getByTestId('learning-sidebar').getByRole('button', { name: 'Pause learning', exact: true }).click()
  if (scenario === 'vwan-connect') {
    await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
      name: 'practice-native.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(exercises[0].starter.topology)),
    })
    await expect(node(page, true)).toBeVisible()
  }
}

async function move(page: Page, vwan: boolean) {
  await (vwan ? node(page, vwan) : page.getByTestId('aznet-select-vnet-a')).focus()
  await page.keyboard.press(vwan ? 'Alt+ArrowRight' : 'ArrowRight')
  await expect(undo(page)).toBeEnabled()
}

for (const vwan of [true, false]) {
  test(`${vwan ? 'VWAN' : 'mixed'} design/practice histories, layout and reload are isolated`, async ({ page }) => {
    await seed(page, vwan)
    await move(page, vwan)
    const originals = await stored(page)
    const designPosition = await position(page, vwan)
    const scenario = vwan ? 'vwan-connect' : 'peering-connect'
    const dialog = await start(page)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await dialog.getByRole('button', { name: 'Pause learning', exact: true }).click()
    expect(await stored(page)).toEqual(originals)
    expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBeNull()
    await confirmStart(page, scenario)
    await expect(undo(page)).toBeDisabled()
    await move(page, vwan)
    await move(page, vwan)
    await expect.poll(async () => {
      const { document } = await practice(page)
      return document.mode === 'vwan' ? !!document.topology.layout?.positions.layered?.a : typeof document.topology.vnets[0].x === 'number'
    }).toBe(true)
    const practicePosition = await position(page, vwan)
    const edited = (await practice(page)).document
    await page.getByTestId('learning-open').click()
    const reopened = page.getByTestId('learning-sidebar')
    await reopened.getByText('Learning path and completed-task review', { exact: true }).click()
    await reopened.getByRole('button', { name: 'Pause learning', exact: true }).click()
    expect((await practice(page)).document).toEqual(edited)
    await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
    await expect(undo(page)).toBeEnabled()
    expect(await position(page, vwan)).toBe(designPosition)
    expect(await stored(page)).toEqual(originals)
    await undo(page).click()
    await expect(redo(page)).toBeEnabled()
    await redo(page).click()
    expect(await stored(page)).toEqual(originals)
    await bar(page).getByRole('button', { name: 'Resume practice', exact: true }).click()
    await expect(bar(page).getByRole('button', { name: 'Return to my design', exact: true })).toBeVisible()
    await expect(undo(page)).toBeEnabled()
    expect(await position(page, vwan)).toBe(practicePosition)
    await undo(page).click()
    await expect(redo(page)).toBeEnabled()
    await redo(page).click()
    expect((await practice(page)).document).toEqual(edited)
    await page.reload()
    await expect(bar(page)).toContainText('your normal design is kept separately')
    await expect(node(page, vwan)).toBeVisible()
    expect(await position(page, vwan)).toBe(practicePosition)
    await expect(undo(page)).toBeDisabled()
    expect((await practice(page)).document).toEqual(edited)
    expect(await stored(page)).toEqual(originals)
    await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
    await expect(undo(page)).toBeDisabled()
    expect(await position(page, vwan)).toBe(designPosition)
    expect(await stored(page)).toEqual(originals)
  })

  test(`${vwan ? 'VWAN' : 'mixed'} design survives cross-provider practice and explicit normal links`, async ({ page }) => {
    await seed(page, vwan)
    const originals = await stored(page)
    await confirmStart(page, vwan ? 'peering-connect' : 'vwan-connect')
    await expect(node(page, !vwan)).toBeVisible()
    await move(page, !vwan)
    const edited = (await practice(page)).document
    await page.goto(`/?mode=${vwan ? 'vwan' : 'full'}`)
    await expect(bar(page).getByRole('button', { name: 'Resume practice', exact: true })).toBeVisible()
    await expect(node(page, vwan)).toBeVisible()
    expect(await stored(page)).toEqual(originals)
    expect((await practice(page)).active).toBe(false)
    await bar(page).getByRole('button', { name: 'Resume practice', exact: true }).click()
    await expect(node(page, !vwan)).toBeVisible()
    expect((await practice(page)).document).toEqual(edited)
    expect(await stored(page)).toEqual(originals)
  })
}

test('quota failures keep live practice accessible for export without touching normal designs', async ({ page }) => {
  await seed(page, false)
  const originals = await stored(page)
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error('quota')
      return original.call(this, name, value)
    }
  }, practiceWorkspaceKey)
  const dialog = await start(page)
  await dialog.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Practice could not be saved')
  expect(await stored(page)).toEqual(originals)
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBeNull()
  await page.reload()
  await confirmStart(page, 'peering-connect')
  const saved = await practice(page)
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error('quota')
      return original.call(this, name, value)
    }
  }, practiceWorkspaceKey)
  await move(page, false)
  await expect(bar(page).getByRole('alert')).toContainText('session only')
  const x = await node(page, false).locator('.network-node-frame').getAttribute('x')
  expect(await practice(page)).toEqual(saved)
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  expect(await stored(page)).toEqual(originals)
  await bar(page).getByRole('button', { name: 'Resume practice', exact: true }).click()
  await expect(node(page, false).locator('.network-node-frame')).toHaveAttribute('x', x!)
  await expect(bar(page).getByRole('alert')).toContainText('session only')
  expect(await practice(page)).toEqual(saved)
})

test('corrupt practice requires scoped discard and cannot erase independent drafts or normal recovery data', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem(key, 'damaged practice original')
      localStorage.setItem('aznet-visual-topology:v1', 'damaged normal original')
      sessionStorage.setItem('seeded', 'true')
    }
  }, practiceWorkspaceKey)
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await expect(bar(page).getByRole('alert')).toContainText('original contents have not been overwritten')
  const dialog = await start(page)
  await dialog.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Saved practice could not be read')
  const progress = await page.evaluate((key) => localStorage.getItem(key), progressKey)
  await page.keyboard.press('Escape')
  await bar(page).getByRole('button', { name: 'Discard practice workspace', exact: true }).click()
  await page.keyboard.press('Escape')
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBe('damaged practice original')
  await bar(page).getByRole('button', { name: 'Discard practice workspace', exact: true }).click()
  await page.getByRole('dialog', { name: 'Discard practice workspace', exact: true })
    .getByRole('button', { name: 'Discard practice workspace', exact: true }).click()
  expect(await page.evaluate((key) => localStorage.getItem(key), progressKey)).toBe(progress)
  expect((await stored(page))[1]).toBe('damaged normal original')
  await confirmStart(page, 'vwan-connect')
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  expect((await stored(page))[1]).toBe('damaged normal original')
})

test('abandoning a delayed starter cannot replace later design edits', async ({ page }) => {
  await seed(page, true)
  let release!: () => void
  let waiting = false
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/src/platform/browser-worker.ts*', async (route) => {
    waiting = true
    await gate
    await route.continue().catch(() => {})
  })
  const dialog = await start(page)
  await dialog.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
  await expect.poll(() => waiting).toBe(true)
  await page.keyboard.press('Escape')
  await move(page, true)
  const originals = await stored(page)
  release()
  await page.unrouteAll({ behavior: 'wait' })
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), practiceWorkspaceKey)).toBeNull()
  expect(await stored(page)).toEqual(originals)
})

test('a known other-tab update is not overwritten by edits, return, resume or discard', async ({ page }) => {
  await seed(page, false)
  const originals = await stored(page)
  await confirmStart(page, 'peering-connect')
  const other = await practice(page)
  other.document.topology.name = 'Other tab practice'
  await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: practiceWorkspaceKey, raw: JSON.stringify(other) })
  await move(page, false)
  await expect(bar(page).getByRole('alert')).toContainText('changed in another tab')
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  await bar(page).getByRole('button', { name: 'Resume practice', exact: true }).click()
  await expect(bar(page).getByRole('button', { name: 'Resume practice', exact: true })).toBeVisible()
  await bar(page).getByRole('button', { name: 'Discard practice workspace', exact: true }).click()
  await page.getByRole('dialog', { name: 'Discard practice workspace', exact: true })
    .getByRole('button', { name: 'Discard practice workspace', exact: true }).click()
  expect(await practice(page)).toEqual(other)
  expect(await stored(page)).toEqual(originals)
})

test('live shared snapshots use normal admission without importing into saved practice', async ({ page }) => {
  await seed(page, false)
  await confirmStart(page, 'vwan-connect')
  const original = (await practice(page)).document
  await page.evaluate(() => { location.hash = 's=not-valid-json' })
  await expect(page.getByRole('alert').filter({ hasText: 'Shared snapshot rejected' })).toBeVisible()
  await expect(bar(page)).toContainText('your normal design is kept separately')
  const incoming = structuredClone(exercises[1].starter.topology)
  incoming.name = 'Explicit incoming snapshot'
  const snapshot = Buffer.from(JSON.stringify(incoming)).toString('base64url')
  await page.evaluate((snapshot) => { location.hash = `retained&s=${snapshot}` }, snapshot)
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await expect(bar(page).getByRole('button', { name: 'Resume practice', exact: true })).toBeVisible()
  await expect.poll(() => new URL(page.url()).hash).toBe('#retained')
  expect(JSON.parse((await stored(page))[1]!).topology.name).toBe(incoming.name)
  expect((await practice(page)).document).toEqual(original)
  expect((await practice(page)).active).toBe(false)
  await page.reload()
  await expect(bar(page).getByRole('button', { name: 'Resume practice', exact: true })).toBeVisible()
})

test('cross-provider file imports while practising remain in practice, not normal saves', async ({ page }) => {
  await seed(page, false)
  const originals = await stored(page)
  await confirmStart(page, 'peering-connect')
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'practice-native.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exercises[0].starter.topology)),
  })
  await expect(node(page, true)).toBeVisible()
  expect((await practice(page)).document.mode).toBe('vwan')
  await move(page, true)
  expect(await stored(page)).toEqual(originals)
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  expect(await stored(page)).toEqual(originals)
})

test('practice status and scoped discard remain accessible in narrow Japanese dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await seed(page, false)
  await confirmStart(page, 'peering-connect')
  await page.locator('header [data-language-selector]').selectOption('ja')
  await page.getByLabel('Theme', { exact: true }).selectOption('dark')
  await expect(bar(page)).toContainText('通常の設計は別に保持')
  for (const button of await bar(page).getByRole('button').all()) {
    const box = (await button.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  const discard = bar(page).getByRole('button', { name: '練習ワークスペースを破棄', exact: true })
  await discard.click()
  const dialog = page.getByRole('dialog', { name: '練習ワークスペースを破棄', exact: true })
  await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeFocused()
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(discard).toBeFocused()
  expect((await practice(page)).active).toBe(true)
})

test('practice can resume from an ambiguous design library and return to a safe explicit choice', async ({ page }) => {
  const saved: PracticeWorkspace = {
    version: 1, courseId: 'local-practice', scenarioId: 'vwan-connect', active: false,
    returnProvider: 'azure-net', document: exercises[0].starter,
  }
  await page.addInitScript(({ saved, normal }) => {
    localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(saved.document.topology))
    localStorage.setItem('aznet-visual-topology:v1', JSON.stringify({ sampleId: '', topology: normal.topology }))
    localStorage.setItem('network-simulator:practice-workspace:v1', JSON.stringify(saved))
  }, { saved, normal: exercises[1].starter })
  await page.goto('/')
  const library = page.getByRole('dialog', { name: 'Workspace', exact: true })
  await expect(library).toContainText('Neither saved family has been selected')
  const originals = await stored(page)
  await library.getByRole('button', { name: 'Resume practice', exact: true }).click()
  await expect(node(page, true)).toBeVisible()
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  await expect(library).toContainText('Neither saved family has been selected')
  expect(await stored(page)).toEqual(originals)
})

test('resuming after a normal provider change remembers the current return design across reload', async ({ page }) => {
  await seed(page, true)
  await confirmStart(page, 'vwan-connect')
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  await page.getByTestId('workspace-library-open').click()
  await page.getByRole('dialog', { name: 'Workspace', exact: true })
    .getByRole('button', { name: 'New mixed-network workspace', exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const originals = await stored(page)
  await bar(page).getByRole('button', { name: 'Resume practice', exact: true }).click()
  await expect.poll(async () => (await practice(page)).returnProvider).toBe('azure-net')
  await page.reload()
  await expect(node(page, true)).toBeVisible()
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  expect(await stored(page)).toEqual(originals)
})

test('returning to an unsaved normal VWAN design retains its edit and storage warning', async ({ page }) => {
  await seed(page, true)
  const originals = await stored(page)
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key === 'vwan-visual-topology:v1') throw new Error('Normal document exceeds quota')
      return original.call(this, key, value)
    }
  })
  await move(page, true)
  const editedPosition = await position(page, true)
  const warning = page.getByText('Browser storage is unavailable or full. Export JSON to preserve your topology.', { exact: true })
  await expect(warning).toBeVisible()
  await confirmStart(page, 'vwan-connect')
  await bar(page).getByRole('button', { name: 'Return to my design', exact: true }).click()
  await expect(warning).toBeVisible()
  expect(await position(page, true)).toBe(editedPosition)
  expect(await stored(page)).toEqual(originals)
})
