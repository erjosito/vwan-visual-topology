import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { example } from '../src/model'
import { sampleHybridVwanAndHubSpoke } from '../src/azure-net/model'
import { workspaceArchiveKey, workspaceSessionKey, workspaceStorageKeys } from '../src/workspace-session'
import { observationFixture } from '../tests/azure-observation-fixture'
import { exercises } from '../src/learning/exercises'

for (const language of ['en', 'ja'] as const) {
  test(`${language}: New topology opens an empty unified document without changing the saved native topology`, async ({ page }) => {
    await page.addInitScript(({ language, topology }) => {
      localStorage.setItem('vwan-visual-topology:language:v1', language)
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      localStorage.setItem('aznet-theme', language === 'ja' ? 'dark' : 'light')
      localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
    }, { language, topology: example })
    await page.setViewportSize({ width: language === 'ja' ? 390 : 1440, height: 1000 })
    await page.goto('/')
    await expect(page.getByRole('tab', { name: example.name, exact: true })).toBeVisible()
    const original = await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!)
      return { id: session.activeId, raw: localStorage.getItem(`network-simulator:workspace-tab:v1:${session.activeId}:topology`) }
    })
    const workspace = page.getByTestId('workspace-library-open')
    if (!await workspace.isVisible()) await page.locator('.workspace-header-toggle').click()
    await workspace.click()
    const library = page.getByRole('dialog', { name: language === 'ja' ? 'ワークスペース' : 'Workspace', exact: true })
    const create = library.getByRole('button', { name: language === 'ja' ? '新しいトポロジ' : 'New topology', exact: true })
    await expect(create).toBeVisible()
    await expect(library).not.toContainText(/mixed-network workspace|混在ネットワーク ワークスペース|dedicated VWAN workspace/)
    await expect(library.getByRole('button', { name: `${language === 'ja' ? '保存済みトポロジを開く' : 'Open saved topology'}: ${example.name}`, exact: true })).toBeVisible()
    expect((await new AxeBuilder({ page }).include('dialog').analyze()).violations).toEqual([])
    await create.focus()
    await page.keyboard.press('Enter')
    await expect(library).toHaveCount(0)
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(2)
    const saved = await page.evaluate(id => ({
      original: localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:topology`),
      activeId: JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId,
      topology: JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology,
    }), original.id)
    expect(saved.original).toBe(original.raw)
    expect(saved.activeId).not.toBe(original.id)
    expect(Object.values(saved.topology).filter(Array.isArray).every(values => values.length === 0)).toBe(true)
  })
}

for (const profile of [
  { vwan: true, language: 'en', width: 1440, zoom: 1 },
  { vwan: false, language: 'en', width: 390, zoom: 1 },
  { vwan: true, language: 'ja', width: 390, zoom: 1.5 },
  { vwan: false, language: 'ja', width: 1440, zoom: 1.5 },
] as const) {
  test(`${profile.vwan ? 'VWAN' : 'mixed'} ${profile.language}: every tab has an independent pointer-close target at ${profile.width}/${profile.zoom}`, async ({ page }) => {
    const topology = structuredClone(exercises[profile.vwan ? 0 : 1].starter.topology)
    topology.name = 'Duplicate long topology label that must not cover an adjacent close action'
    await page.addInitScript(({ topology, profile }) => {
      localStorage.setItem('vwan-visual-topology:language:v1', profile.language)
      localStorage.setItem('aznet-theme', profile.language === 'ja' ? 'dark' : 'light')
      localStorage.setItem('aznet-ui-preview:v1', String(profile.language === 'en'))
      localStorage.setItem(profile.vwan ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1',
        JSON.stringify(profile.vwan ? topology : { sampleId: '', topology }))
    }, { topology, profile })
    await page.setViewportSize({ width: profile.width, height: 1000 })
    await page.goto(`/?mode=${profile.vwan ? 'vwan' : 'full'}`)
    await page.evaluate(zoom => { document.documentElement.style.zoom = String(zoom) }, profile.zoom)
    const navigation = page.locator('.workspace-tabs')
    const tabs = navigation.getByRole('tab')
    const add = async (name: string) => {
      await page.locator('input[type="file"]').first()
        .setInputFiles({ name: 'close-target.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...topology, name })) })
    }
    await add(topology.name)
    await add('Third topology')
    await expect(navigation.locator('.workspace-tab-close')).toHaveCount(3)
    expect((await new AxeBuilder({ page }).include('.workspace-tabs').analyze()).violations).toEqual([])
    await expect(navigation.getByRole('tablist').getByRole('tab')).toHaveCount(3)
    const manifest = () => page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!))
    const close = async (index: number, active: boolean, cancel = false) => {
      if (active) await tabs.nth(index).click()
      const before = await manifest()
      const target = before.tabs[index]
      const button = navigation.locator('.workspace-tab-close').nth(index)
      await button.scrollIntoViewIfNeeded()
      const bounds = await button.boundingBox()
      expect(bounds!.width).toBeGreaterThanOrEqual(24)
      expect(bounds!.height).toBeGreaterThanOrEqual(24)
      await button.click()
      const dialog = page.getByRole('dialog', { name: profile.language === 'ja' ? '閉じる前に変更を保存しますか?' : 'Save changes before closing?', exact: true })
      if (cancel) {
        await dialog.getByRole('button', { name: profile.language === 'ja' ? 'キャンセル' : 'Cancel', exact: true }).click()
        expect(await manifest()).toEqual(before)
        await button.click()
      }
      await dialog.getByRole('button', { name: profile.language === 'ja' ? '破棄して閉じる' : 'Discard and close', exact: true }).click()
      const after = await manifest()
      expect(after.tabs.map((tab: { id: string }) => tab.id)).toEqual(before.tabs.filter((tab: { id: string }) => tab.id !== target.id).map((tab: { id: string }) => tab.id))
      if (!active) expect(after.activeId).toBe(before.activeId)
      await expect(page.locator(`[id="workspace-tab-${after.activeId}"]`)).toBeFocused()
      expect(await page.evaluate(id => localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:topology`), target.id)).not.toBeNull()
    }
    await close(0, profile.vwan, true)
    await add('Fourth topology')
    await close(1, !profile.vwan)
    await add('Fifth topology')
    await tabs.first().click()
    await close(2, profile.vwan)
    await expect(tabs).toHaveCount(2)
    await tabs.first().focus()
    await page.keyboard.press('End')
    await expect(tabs.last()).toBeFocused()
    const keyboardClose = navigation.locator('.workspace-tab-close').last()
    await keyboardClose.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('dialog').getByRole('button', { name: profile.language === 'ja' ? 'キャンセル' : 'Cancel', exact: true }).click()
    await expect(keyboardClose).toBeFocused()
  })
}

for (const vwan of [true, false]) {
  test(`${vwan ? 'VWAN' : 'mixed'} final close creates one fresh editable document after cancellation and unsuccessful save`, async ({ page }) => {
    const topology = structuredClone(exercises[vwan ? 0 : 1].starter.topology)
    topology.name = 'Original final document'
    await page.addInitScript(({ topology, vwan }) => {
      const key = vwan ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(vwan ? topology : { sampleId: '', topology }))
      Object.defineProperty(window, 'showSaveFilePicker', { value: async () => {
        throw vwan ? new DOMException('Cancelled', 'AbortError') : new Error('Test picker failure')
      } })
    }, { topology, vwan })
    await page.goto(`/?mode=${vwan ? 'vwan' : 'full'}`)
    await expect(page.getByRole('tab', { name: topology.name, exact: true })).toBeVisible()
    const original = await page.evaluate(() => {
      const manifest = JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!)
      return { manifest, raw: localStorage.getItem(`network-simulator:workspace-tab:v1:${manifest.activeId}:topology`) }
    })
    const close = page.getByRole('button', { name: `Close topology: ${topology.name}`, exact: true })
    const closing = page.getByRole('dialog', { name: 'Save changes before closing?', exact: true })
    await close.focus()
    await page.keyboard.press('Enter')
    await closing.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(close).toBeFocused()
    await close.click()
    await closing.getByRole('button', { name: 'Save and close', exact: true }).click()
    const chooser = page.getByRole('dialog', { name: 'Save As', exact: true })
    await chooser.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(chooser.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    if (!vwan) await expect(chooser.getByRole('alert')).toContainText('Test picker failure')
    await chooser.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!))).toEqual(original.manifest)
    await closing.getByRole('button', { name: 'Discard and close', exact: true }).click()
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(page.getByRole('tab', { selected: true })).toBeFocused()
    await expect(page.getByRole('dialog', { name: 'Workspace', exact: true })).toHaveCount(0)
    const replacement = await page.evaluate(() => {
      const manifest = JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!)
      const raw = JSON.parse(localStorage.getItem(`network-simulator:workspace-tab:v1:${manifest.activeId}:topology`)!)
      return { manifest, topology: raw.topology ?? raw,
        cloud: localStorage.getItem(`network-simulator:workspace-tab:v1:${manifest.activeId}:cloud`),
        artifact: localStorage.getItem(`network-simulator:workspace-tab:v1:${manifest.activeId}:artifact`) }
    })
    expect(replacement.manifest.activeId).not.toBe(original.manifest.activeId)
    expect(replacement.manifest.tabs).toHaveLength(1)
    expect(replacement.cloud).toBeNull()
    expect(replacement.artifact).toBeNull()
    expect(Object.values(replacement.topology).filter(Array.isArray).every(values => values.length === 0)).toBe(true)
    await page.keyboard.press('Control+s')
    await expect(chooser).toBeVisible()
    await chooser.getByRole('button', { name: 'Cancel', exact: true }).click()
    if (vwan) await page.getByLabel('Topology name', { exact: true }).fill('Edited replacement')
    else await page.getByTestId('aznet-add-vnet-btn').click()
    await page.reload()
    await expect(page.getByRole('tab')).toHaveCount(1)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)).toBe(replacement.manifest.activeId)
    expect(await page.evaluate(id => localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:topology`), original.manifest.activeId)).toBe(original.raw)
    if (vwan) await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Edited replacement')
    else await expect(page.getByTestId('aznet-diagram-svg').getByRole('button', { name: /^VNet / })).toHaveCount(1)
    await page.locator('.workspace-tab-close').click()
    await closing.getByRole('button', { name: 'Discard and close', exact: true }).dblclick()
    await expect(closing).toHaveCount(0)
    await expect(page.getByRole('tab')).toHaveCount(1)
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)).not.toBe(replacement.manifest.activeId)
  })
}

test('a failed final-tab replacement keeps the original editable and permits a deliberate retry', async ({ page }) => {
  await page.goto('/?mode=full')
  await page.getByTestId('aznet-add-vnet-btn').click()
  const original = await page.evaluate(() => localStorage.getItem('network-simulator:workspace-tabs:v1'))
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    Reflect.set(window, 'blockReplacement', true)
    Storage.prototype.setItem = function(key, value) {
      if (Reflect.get(window, 'blockReplacement') && key === 'network-simulator:workspace-tabs:v1') throw new DOMException('Full', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.locator('.workspace-tab-close').click()
  const closing = page.getByRole('dialog', { name: 'Save changes before closing?', exact: true })
  await closing.getByRole('button', { name: 'Discard and close', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Tabs could not be closed')
  expect(await page.evaluate(() => localStorage.getItem('network-simulator:workspace-tabs:v1'))).toBe(original)
  await expect(page.getByRole('tab')).toHaveCount(1)
  await closing.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByTestId('aznet-diagram-svg').getByRole('button', { name: /^VNet / })).toHaveCount(1)
  await page.evaluate(() => { Reflect.set(window, 'blockReplacement', false) })
  await page.locator('.workspace-tab-close').click()
  await closing.getByRole('button', { name: 'Discard and close', exact: true }).click()
  await expect(closing).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByTestId('aznet-diagram-svg').getByRole('button', { name: /^VNet / })).toHaveCount(0)
})

for (const vwan of [true, false]) {
  test(`${vwan ? 'VWAN' : 'mixed'} topology tabs preserve independent edits, view, history and restart`, async ({ page }, info) => {
    const first = structuredClone(exercises[vwan ? 0 : 1].starter.topology)
    first.name = 'First tab design'
    const second = structuredClone(first)
    second.name = 'Second tab design'
    await page.addInitScript(({ topology, vwan }) => {
      const key = vwan ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(vwan ? topology : { sampleId: '', topology }))
    }, { topology: first, vwan })
    await page.goto(`/?mode=${vwan ? 'vwan' : 'full'}`)
    const tabs = page.getByRole('tablist', { name: 'Designs', exact: true })
    const node = vwan ? page.locator('[data-node-id="a"]') : page.getByTestId('aznet-select-vnet-a')
    const selected = vwan ? page.locator('[data-node-id="b"]') : page.getByTestId('aznet-select-vnet-b')
    const position = () => vwan ? node.getAttribute('transform')
      : page.getByTestId('aznet-vnet-a').locator('.network-node-frame').getAttribute('x')
    await expect(node).toBeVisible()
    const navigation = page.getByRole('navigation', { name: 'Open topologies', exact: true })
    const canvas = page.locator(vwan ? '.canvas-stage' : '.aznet-canvas-shell')
    const header = page.locator(vwan ? 'header.unified-topbar' : 'header.aznet-topbar')
    const navBounds = await navigation.boundingBox()
    const canvasBounds = await canvas.boundingBox()
    const headerBounds = await header.boundingBox()
    expect(navBounds!.y).toBeGreaterThanOrEqual(headerBounds!.y + headerBounds!.height)
    expect(Math.abs(navBounds!.y + navBounds!.height - canvasBounds!.y)).toBeLessThanOrEqual(1)
    await expect(navigation.getByRole('button', { name: `Close topology: ${first.name}`, exact: true })).toBeVisible()
    await expect(tabs.getByRole('tab', { name: first.name, exact: true }).locator('..')).toHaveCSS('border-top-left-radius', '10px')
    await info.attach('canvas-tabs', { body: await page.screenshot({ path: info.outputPath('canvas-tabs.png') }), contentType: 'image/png' })
    const initialPosition = await position()
    await node.focus()
    await page.keyboard.press(vwan ? 'Alt+ArrowRight' : 'ArrowRight')
    const firstPosition = await position()
    expect(firstPosition).not.toBe(initialPosition)
    await selected.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    const firstZoom = await page.getByLabel('Canvas zoom', { exact: true }).inputValue()
    await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
      name: 'second.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(second)),
    })
    await expect(tabs.getByRole('tab')).toHaveCount(2)
    await expect(tabs.getByRole('tab', { name: second.name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: /Undo/ })).toBeDisabled()
    await expect(selected).toHaveAttribute('aria-pressed', 'false')
    expect(await position()).toBe(initialPosition)
    await node.focus()
    await page.keyboard.press(vwan ? 'Alt+ArrowLeft' : 'ArrowLeft')
    const secondPosition = await position()
    await tabs.getByRole('tab', { name: first.name, exact: true }).click()
    expect(await position()).toBe(firstPosition)
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Canvas zoom', { exact: true })).toHaveValue(firstZoom)
    await page.getByRole('button', { name: /Undo/ }).click()
    expect(await position()).toBe(initialPosition)
    await page.getByRole('button', { name: /Redo/ }).click()
    expect(await position()).toBe(firstPosition)
    await tabs.getByRole('tab', { name: second.name, exact: true }).click()
    expect(await position()).toBe(secondPosition)
    await page.reload()
    await expect(tabs.getByRole('tab', { name: second.name, exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(node).toBeVisible()
    expect(await position()).toBe(secondPosition)
    await tabs.getByRole('tab', { name: first.name, exact: true }).click()
    await expect(node).toBeVisible()
    expect(await position()).toBe(firstPosition)
  })
}

for (const vwan of [true, false]) {
  test(`${vwan ? 'VWAN' : 'mixed'} tab labels truncate without scrollbars and retain full tooltips`, async ({ page }, info) => {
    const topology = structuredClone(exercises[vwan ? 0 : 1].starter.topology)
    topology.name = 'A very long topology label with enough detail to exceed the available tab width'
    await page.addInitScript(({ topology, vwan }) => {
      const key = vwan ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
      localStorage.setItem(key, JSON.stringify(vwan ? topology : { sampleId: '', topology }))
    }, { topology, vwan })
    await page.goto(`/?mode=${vwan ? 'vwan' : 'full'}`)
    const tabs = page.locator('.workspace-tabs-list')
    await expect(tabs.getByRole('tab', { name: topology.name, exact: true })).toBeVisible()
    for (const name of ['Second design', 'Third design']) {
      await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
        name: 'design.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...topology, name })),
      })
    }
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await tabs.getByRole('tab').last().focus()
      await page.keyboard.press('Home')
      const first = tabs.getByRole('tab', { name: topology.name, exact: true })
      await expect(first).toBeFocused()
      const label = first.locator('.workspace-tab-name')
      await expect(label).toHaveCSS('overflow-x', 'hidden')
      await expect(label).toHaveCSS('overflow-y', 'hidden')
      await expect(label).toHaveCSS('text-overflow', 'ellipsis')
      expect(await label.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
      expect(await first.getAttribute('title')).toContain(topology.name)
      const status = first.locator('..').locator('small')
      await expect(status).toHaveAttribute('title', (await first.getAttribute('title'))!)
      await expect(tabs).toHaveCSS('overflow-y', 'hidden')
      expect(await tabs.evaluate(element => ({
        horizontalScrollbar: element.offsetHeight - element.clientHeight,
        verticalScrollbar: element.offsetWidth - element.clientWidth,
      }))).toEqual({ horizontalScrollbar: 0, verticalScrollbar: 0 })
      if (width === 390) {
        expect(await tabs.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
        await page.keyboard.press('End')
        const last = tabs.getByRole('tab', { name: 'Third design', exact: true })
        await expect(last).toBeFocused()
        const listBounds = await tabs.boundingBox()
        const lastBounds = await last.boundingBox()
        expect(lastBounds!.x).toBeGreaterThanOrEqual(listBounds!.x - 1)
        expect(lastBounds!.x + lastBounds!.width).toBeLessThanOrEqual(listBounds!.x + listBounds!.width + 1)
        await page.keyboard.press('Enter')
        await expect(last).toHaveAttribute('aria-selected', 'true')
      }
      await info.attach(`tab-labels-${width}`, { body: await page.screenshot(), contentType: 'image/png' })
    }
  })
}

test('competing browser windows edit temporary copies without overwriting the owned profile', async ({ page, context }) => {
  await page.goto('/?mode=vwan')
  await page.getByLabel('Topology name', { exact: true }).fill('Owner design')
  const original = await page.evaluate(() => ({
    topology: localStorage.getItem('vwan-visual-topology:v1'),
    tabs: localStorage.getItem('network-simulator:workspace-tabs:v1'),
  }))
  const other = await context.newPage()
  try {
    await other.goto('/')
    await expect(other.getByText('Temporary', { exact: true })).toBeVisible()
    await expect(other.getByLabel('Topology name', { exact: true })).toHaveValue('Owner design')
    await other.getByLabel('Topology name', { exact: true }).fill('Temporary design')
    await expect(other.getByTestId('document-save-state')).toHaveText('Not saved')
    await expect(other.getByTestId('document-save-state')).toHaveAttribute('title', /Profile recovery unavailable/)
    await expect(other.getByText('Browser storage is unavailable or full. Use Save As to preserve your topology.', { exact: true })).toHaveCount(0)
    expect(await other.evaluate(() => ({
      topology: localStorage.getItem('vwan-visual-topology:v1'),
      tabs: localStorage.getItem('network-simulator:workspace-tabs:v1'),
    }))).toEqual(original)
    await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Owner design')
    await page.close()
    await expect.poll(() => other.evaluate(async () =>
      (await navigator.locks.query()).held?.some(lock => lock.name === 'aznetsim-workspace-profile-v1') ?? false,
    )).toBe(false)
    await other.reload()
    await expect(other.getByLabel('Topology name', { exact: true })).toHaveValue('Owner design')
    await expect(other.getByText('Temporary', { exact: true })).toHaveCount(0)
  } finally { await other.close() }
})

for (const partial of [false, true]) test(`${partial ? 'partial' : 'unavailable'} browser locking keeps normal editing in memory without claiming or replacing profile saves`, async ({ page }) => {
  const topology = { ...example, name: 'Stored original' }
  await page.addInitScript(({ topology, partial }) => {
    Object.defineProperty(navigator, 'locks', { value: partial ? {} : undefined })
    Object.defineProperty(crypto, 'randomUUID', { value: undefined })
    localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
  }, { topology, partial })
  await page.goto('/?mode=vwan')
  await expect(page.getByText('Temporary', { exact: true })).toBeVisible()
  await page.getByLabel('Topology name', { exact: true }).fill('Memory edit')
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1')))!)).toEqual(topology)
  expect(await page.evaluate(() => localStorage.getItem('network-simulator:workspace-tabs:v1'))).toBeNull()
})

test('closing, cancelling, reopening and close-all keep recovery data and do not silently reopen after restart', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await page.getByLabel('Topology name', { exact: true }).fill('Recoverable design')
  const manifest = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!))
  const id = manifest.activeId
  await page.getByRole('button', { name: 'Close topology: Recoverable design', exact: true }).click()
  const closing = page.getByRole('dialog', { name: 'Save changes before closing?', exact: true })
  await closing.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Recoverable design', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close topology: Recoverable design', exact: true }).click()
  await closing.getByRole('button', { name: 'Discard and close', exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Workspace', exact: true })
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(library).toHaveCount(0)
  await page.getByTestId('workspace-library-open').click()
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: 'Reopen topology: Recoverable design', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Recoverable design')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)).toBe(id)
  await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByRole('button', { name: 'Close topology: Empty Topology', exact: true }).click()
  await closing.getByRole('button', { name: 'Discard and close', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Recoverable design', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
  await page.getByTestId('workspace-library-open').click()
  await library.getByRole('button', { name: 'Close all topology tabs', exact: true }).click()
  await closing.getByRole('button', { name: 'Discard and close', exact: true }).click()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(library).toHaveCount(0)
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.reload()
  await expect(library).toHaveCount(0)
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(1)
  await expect(page.getByRole('tab', { name: 'Recoverable design', exact: true })).toHaveCount(0)
  expect(await page.evaluate(id => localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:topology`), id)).toContain('Recoverable design')
})

test('damaged tab-list recovery archives metadata without deleting saved native designs', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await page.getByLabel('Topology name', { exact: true }).fill('Recovered native design')
  const before = await page.evaluate(() => ({
    id: JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId,
    raw: localStorage.getItem('vwan-visual-topology:v1'),
  }))
  await page.evaluate(() => localStorage.setItem('network-simulator:workspace-tabs:v1', '{"version":99,"tabs":[]}'))
  await page.reload()
  const library = page.getByRole('dialog', { name: 'Workspace', exact: true })
  await expect(library.getByRole('button', { name: 'Reset damaged tab list', exact: true })).toBeVisible()
  page.once('dialog', dialog => dialog.accept())
  await library.getByRole('button', { name: 'Reset damaged tab list', exact: true }).click()
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  expect(await page.evaluate(id => localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:topology`), before.id)).toBe(before.raw)
  const archives = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('network-simulator:workspace-tabs:recovery:v1:'))
    .map(key => localStorage.getItem(key)))
  expect(archives).toContain('{"version":99,"tabs":[]}')
})

test('legacy cloud identity migrates once into its own tab and cannot attach to a later design', async ({ page }) => {
  const association = JSON.stringify({ version: 1, provider: 'vwan', accountId: 'saved-owner',
    id: '33333333-3333-4333-8333-333333333333', name: 'Original cloud save', etag: '"one"', digest: '0'.repeat(64) })
  await page.addInitScript(({ topology, association }) => {
    if (sessionStorage.getItem('legacy-cloud-seeded')) return
    sessionStorage.setItem('legacy-cloud-seeded', 'true')
    localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(topology))
    sessionStorage.setItem('network-simulator:cloud-document:v1', association)
  }, { topology: example, association })
  await page.goto('/?mode=vwan')
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue(example.name)
  const originalId = await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId)
  expect(await page.evaluate(id => localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:cloud`), originalId)).toBe(association)
  expect(await page.evaluate(() => sessionStorage.getItem('network-simulator:cloud-document:v1'))).toBeNull()
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'independent.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...example, name: 'Independent design' })),
  })
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Independent design')
  expect(await page.evaluate(() => {
    const id = JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!).activeId
    return localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:cloud`)
  })).toBeNull()
  expect(await page.evaluate(id => localStorage.getItem(`network-simulator:workspace-tab:v1:${id}:cloud`), originalId)).toBe(association)
})

test('topology tabs support cross-provider keyboard activation and narrow layout without clipping the mixed canvas', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await page.getByLabel('Topology name', { exact: true }).fill('Native design')
  await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const tabs = page.getByRole('tablist', { name: 'Designs', exact: true })
  const native = tabs.getByRole('tab', { name: 'Native design', exact: true })
  const mixed = tabs.getByRole('tab').last()
  await mixed.focus()
  await page.keyboard.press('Home')
  await expect(native).toBeFocused()
  await expect(mixed).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Native design')
  await page.keyboard.press('End')
  await expect(mixed).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const language of ['en', 'ja']) {
    await page.locator('header [data-language-selector]').selectOption(language)
    for (const theme of ['light', 'dark']) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme)
      const nav = page.getByRole('navigation', { name: language === 'ja' ? '開いているトポロジ' : 'Open topologies', exact: true })
      const navBox = await nav.boundingBox()
      const canvasBox = await page.getByTestId('aznet-app').boundingBox()
      expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(390)
      expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(845)
      await expect(page.getByRole('tablist', { name: language === 'ja' ? 'デザイン' : 'Designs', exact: true }).getByRole('tab')).toHaveCount(2)
      expect((await new AxeBuilder({ page }).include('.workspace-tabs').analyze()).violations).toEqual([])
    }
  }
})

test('accepted capture review is not replayed over an edited topology when returning to its tab', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'capture.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...observationFixture(), version: 1 })),
  })
  const review = page.getByRole('dialog', { name: 'Azure files', exact: true })
  await review.getByLabel('I understand this is a structure-only import, not verified Azure routing.').check()
  await review.getByRole('button', { name: 'Replace workspace with Azure capture' }).click()
  await page.getByLabel('Topology name', { exact: true }).fill('Accepted capture')
  const tabs = page.getByRole('tablist', { name: 'Designs', exact: true })
  await tabs.getByRole('tab').first().click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await tabs.getByRole('tab', { name: 'Accepted capture', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Accepted capture')
  await expect(review.getByRole('heading', { name: 'Review Azure capture' })).toHaveCount(0)
})

for (const vwan of [true, false]) {
  test(`${vwan ? 'VWAN' : 'mixed'} completed routing evidence stays with its topology tab`, async ({ page }) => {
    const topology = structuredClone(exercises[vwan ? 0 : 1].starter.topology)
    topology.name = 'Checked design'
    await page.goto('/')
    await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
      name: 'checked.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
    })
    await page.getByRole('button', { name: 'Check routing', exact: true }).click()
    const status = page.locator('.routing-check-status')
    await expect(status).toBeVisible()
    await expect(status).not.toContainText('Checking all modeled networks', { timeout: 30000 })
    const result = await status.textContent()
    await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await expect(status).toHaveCount(0)
    await page.getByRole('tablist', { name: 'Designs', exact: true }).getByRole('tab', { name: topology.name, exact: true }).click()
    await expect(status).toHaveText(result!)
  })

  test(`${vwan ? 'VWAN' : 'mixed'} suspended routing workers do not restart or appear running on return`, async ({ page }) => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    await page.route('**/*diagnostics-worker*', async route => {
      requests++
      await gate
      await route.continue().catch(() => undefined)
    })
    try {
      const topology = structuredClone(exercises[vwan ? 0 : 1].starter.topology)
      topology.name = 'Suspended check'
      await page.goto('/')
      await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
        name: 'pending.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)),
      })
      await page.getByRole('button', { name: 'Check routing', exact: true }).click()
      await expect.poll(() => requests).toBe(1)
      await page.getByRole('button', { name: 'New topology tab', exact: true }).click()
      await expect(page.getByTestId('aznet-app')).toBeVisible()
      await expect(page.locator('.routing-check-status')).toHaveCount(0)
      await page.getByRole('tablist', { name: 'Designs', exact: true }).getByRole('tab', { name: topology.name, exact: true }).click()
      await expect(page.locator('.routing-check-status')).toContainText(vwan ? 'Routing check cancelled' : 'Analysis cancelled')
      release()
      await expect(page.getByRole('button', { name: 'Check routing', exact: true })).toBeEnabled()
      await expect(page.locator('.routing-check-status')).not.toContainText('Checking all modeled networks')
      expect(requests).toBe(1)
    } finally { release() }
  })
}

test('fresh web and desktop enter the same empty mixed workspace with both creation families', async ({ page }) => {
  for (const desktop of [false, true]) {
    if (desktop) await page.addInitScript(() => Object.defineProperty(window, 'desktopSimulator', { value: {} }))
    await page.goto('/')
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
    await expect(page.getByTestId('aznet-add-vnet-btn')).toBeEnabled()
    await expect(page.getByTestId('aznet-add-vwan-hub-btn')).toBeEnabled()
    await expect(page.locator('[data-testid^="aznet-vnet-"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="aznet-vwanhub-"]')).toHaveCount(0)
  }
})

test('cross-provider captures retain native review and partial comparison behavior', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'vwan-capture.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...observationFixture(), version: 1 })),
  })
  const review = page.getByRole('dialog', { name: 'Azure files', exact: true })
  await expect(review.getByRole('heading', { name: 'Review Azure capture' })).toBeVisible()
  await expect(review.getByRole('button', { name: 'Replace workspace with Azure capture' })).toBeDisabled()
  await review.getByRole('button', { name: 'Cancel Azure import' }).click()
  const original = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
    name: 'mixed-capture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      kind: 'azure-network-capture', version: 2, resourceGroup: 'rg',
      vnets: [{ id: 'known', name: 'Captured VNet', addressSpace: { addressPrefixes: ['10.42.0.0/16'] },
        subnets: [{ id: 'work', name: 'Workload', addressPrefix: '10.42.1.0/24' }] }],
      nicEffectiveRoutes: [{ nicId: 'nic', nicName: 'Probe', vnetName: 'Captured VNet', subnetName: 'Workload', effectiveRoutes: [] }],
    })),
  })
  await expect(page.getByTestId('aznet-comparison-report')).toContainText('COVERAGE UNKNOWN')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
})

test('live legacy shares are read only across providers and keep the active design', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  await page.getByLabel('Topology name', { exact: true }).fill('Preserved native design')
  const original = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
  await page.evaluate(() => { location.hash = 's=not-valid-json' })
  await expect(page.getByRole('alert')).toContainText('Shared topology unavailable')
  const snapshot = Buffer.from(JSON.stringify(sampleHybridVwanAndHubSpoke)).toString('base64url')
  await page.evaluate((snapshot) => { location.hash = `retained&s=${snapshot}` }, snapshot)
  await expect(page.getByRole('heading', { name: 'Shared topology — read only' })).toBeVisible()
  await expect(page.getByTestId('vwan-app')).toHaveCount(0)
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
  await page.reload()
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(original)
  await page.getByRole('button', { name: 'Return to workspace', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Preserved native design')
})

test('damaged selection requires recovery and storage failure never replaces a saved design', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('network-simulator:workspace:v1', '{"version":99,"provider":"vwan"}')
    localStorage.setItem('vwan-visual-topology:v1', '{"version":1,"name":"Original bytes"}')
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) {
      if (key === 'network-simulator:originals:v1') throw new DOMException('Full', 'QuotaExceededError')
      return set.call(this, key, value)
    }
  })
  await page.goto('/')
  const library = page.getByRole('dialog', { name: 'Workspace', exact: true })
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: 'New topology', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('could not be selected or preserved')
  await expect(library).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('network-simulator:workspace:v1'))).toBe('{"version":99,"provider":"vwan"}')
  expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe('{"version":1,"name":"Original bytes"}')
})

test('workspace library fits narrow dark Japanese view and returns keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.locator('header [data-language-selector]').selectOption('ja')
  await page.getByLabel('Theme', { exact: true }).selectOption('dark')
  const opener = page.getByTestId('workspace-library-open')
  await opener.click()
  const library = page.getByRole('dialog', { name: 'ワークスペース', exact: true })
  await expect(library.getByRole('button', { name: '新しいトポロジ', exact: true })).toBeVisible()
  const box = await library.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(391)
  await page.keyboard.press('Escape')
  await expect(library).toHaveCount(0)
  await expect(opener).toBeFocused()
})

test('ambiguous legacy saves require a choice and preserve both native originals and practice', async ({ page }) => {
  const native = structuredClone(example)
  native.layout = { mode: 'layered', positions: { layered: { eu: { x: 733, y: 422 } } } }
  const v1 = JSON.stringify(native), v2 = JSON.stringify({ sampleId: 'native', topology: sampleHybridVwanAndHubSpoke })
  await page.addInitScript(({ v1, v2 }) => {
    if (sessionStorage.getItem('arranged')) return
    sessionStorage.setItem('arranged', '1')
    localStorage.setItem('vwan-visual-topology:v1', v1)
    localStorage.setItem('aznet-visual-topology:v1', v2)
    localStorage.setItem('aznet-simulator:practice:v1', '{"version":1,"entries":[]}')
  }, { v1, v2 })
  await page.goto('/?keep=original#retained')
  const library = page.getByRole('dialog', { name: 'Workspace', exact: true })
  await expect(library).toContainText('Saved topologies are not opened or overwritten automatically')
  expect(await page.evaluate(() => localStorage.getItem('network-simulator:workspace:v1'))).toBeNull()
  await page.keyboard.press('Escape')
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: `Open saved topology: ${native.name}`, exact: true }).click()
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue(native.name)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), workspaceStorageKeys.vwan)).toEqual(native)
  expect(await page.evaluate((key) => localStorage.getItem(key), workspaceStorageKeys['azure-net'])).toBe(v2)
  await page.getByLabel('Topology name', { exact: true }).fill('Edited original design')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue(native.name)
  await page.reload()
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  expect(new URL(page.url()).searchParams.get('keep')).toBe('original')
  expect(new URL(page.url()).hash).toBe('#retained')
  await page.getByTestId('workspace-library-open').click()
  await library.getByRole('button', { name: `Open saved topology: ${sampleHybridVwanAndHubSpoke.name}`, exact: true }).click()
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), workspaceSessionKey)).toEqual({ version: 1, provider: 'azure-net' })
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), workspaceArchiveKey)).toEqual(expect.arrayContaining([
    { key: workspaceStorageKeys.vwan, raw: v1 }, { key: workspaceStorageKeys['azure-net'], raw: v2 },
  ]))
  expect(await page.evaluate(() => localStorage.getItem('aznet-simulator:practice:v1'))).toBe('{"version":1,"entries":[]}')
})

test('cross-provider JSON imports keep native IDs and routes without user-facing mode selection', async ({ page }) => {
  await page.goto('/')
  const input = () => page.getByLabel('Import topology file', { exact: true })
  await input().setInputFiles({ name: 'original.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(example)) })
  await expect(page.getByTestId('vwan-app')).toBeVisible()
  const native = await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
  expect(native.connections.map((connection: { id: string }) => connection.id)).toEqual(example.connections.map((connection) => connection.id))
  await input().setInputFiles({ name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleHybridVwanAndHubSpoke)) })
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
  await page.goto('/?mode=hub-spoke')
  await expect(page.getByTestId(`aznet-vwanhub-${sampleHybridVwanAndHubSpoke.vwanHubs[0].id}`)).toBeVisible()
  await expect(page.getByTestId('aznet-add-vwan-hub-btn')).toBeEnabled()
  await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
})

for (const provider of ['vwan', 'full']) {
  test(`a delayed ${provider} file import cannot replace a subsequently selected workspace`, async ({ page }) => {
    await page.goto(`/?mode=${provider}`)
    await expect(page.getByTestId(provider === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    await page.evaluate(() => {
      const read = File.prototype.text
      File.prototype.text = async function() {
        const content = await read.call(this)
        if (this.name === 'delayed.json') await new Promise<void>((resolve) => { Reflect.set(window, 'releaseDelayedRead', resolve) })
        return content
      }
    })
    await page.getByLabel('Import topology file', { exact: true }).setInputFiles({
      name: 'delayed.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(provider === 'vwan' ? sampleHybridVwanAndHubSpoke : example)),
    })
    await expect.poll(() => page.evaluate(() => typeof Reflect.get(window, 'releaseDelayedRead'))).toBe('function')
    await page.getByTestId('workspace-library-open').click()
    await page.getByRole('button', { name: 'New topology', exact: true }).click()
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    await page.evaluate(() => Reflect.get(window, 'releaseDelayedRead')())
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('network-simulator:workspace:v1')!))).toEqual({ version: 1, provider: 'azure-net' })
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.name)).toBe('Empty Topology')
    await expect(page.locator('[data-testid^="aznet-vwanhub-"]')).toHaveCount(0)
    await expect(page.getByTestId('vwan-app')).toHaveCount(0)
  })
}

for (const operation of ['openDocument', 'collect'] as const) {
  test(`a delayed desktop ${operation} cannot import into a newly selected workspace`, async ({ page }) => {
    await page.addInitScript(({ operation, content }) => {
      const delayed = () => new Promise((resolve) => Reflect.set(window, 'releaseDesktopResult', () => resolve({
        ok: true, value: { name: 'previous-workspace.json', content },
      })))
      Object.defineProperty(window, 'desktopSimulator', { value: {
        openDocument: operation === 'openDocument' ? delayed : async () => ({ ok: true, value: null }),
        releaseDocument: async () => ({ ok: true }),
        collect: delayed,
        accounts: async () => ({ ok: true, value: {
          cloud: { name: 'AzureCloud', resourceManager: 'https://management.azure.com/' },
          accounts: [{ id: 'subscription', tenantId: 'tenant', name: 'Test subscription', state: 'Enabled' }],
        } }),
        targets: async () => ({ ok: true, value: { wans: [{ id: 'wan-id', name: 'Test WAN' }], groups: [] } }),
      } })
      Reflect.set(window, 'desktopImportEvents', 0)
      document.addEventListener('change', (event) => {
        if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-desktop-import')) {
          Reflect.set(window, 'desktopImportEvents', Reflect.get(window, 'desktopImportEvents') + 1)
        }
      })
    }, { operation, content: JSON.stringify(operation === 'openDocument' ? example : { ...observationFixture(), version: 1 }) })
    await page.goto('/')
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    if (operation === 'openDocument') await page.getByRole('button', { name: 'Load file', exact: true }).click()
    else {
      await page.getByText('Read-only local Azure collection', { exact: true }).click()
      await page.getByRole('combobox', { name: 'Capture type', exact: true }).selectOption('vwan')
      await page.getByRole('button', { name: 'Read existing Azure session', exact: true }).click()
      await page.getByRole('combobox', { name: 'Select subscription and tenant', exact: true }).selectOption('subscription')
      await page.getByRole('button', { name: 'Read available collection targets', exact: true }).click()
      await page.getByRole('combobox', { name: 'Virtual WAN', exact: true }).selectOption('wan-id')
      await page.getByRole('button', { name: 'Collect and review locally', exact: true }).click()
    }
    await page.getByTestId('workspace-library-open').click()
    await page.getByRole('button', { name: 'New topology', exact: true }).click()
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    const saved = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await page.evaluate(async () => {
      Reflect.get(window, 'releaseDesktopResult')()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(await page.evaluate(() => Reflect.get(window, 'desktopImportEvents'))).toBe(0)
    await expect(page.getByTestId('aznet-app')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(saved)
  })
}

test('fresh desktop offers both capture families without changing the editable workspace', async ({ page }) => {
  await page.addInitScript((capture) => Object.defineProperty(window, 'desktopSimulator', { value: {
    accounts: async () => ({ ok: true, value: {
      cloud: { name: 'AzureCloud', resourceManager: 'https://management.azure.com/' },
      accounts: [{ id: 'subscription', tenantId: 'tenant', name: 'Test subscription', state: 'Enabled' }],
    } }),
    targets: async () => ({ ok: true, value: { wans: [{ id: 'wan-id', name: 'Test WAN' }], groups: [{ id: 'rg-id', name: 'Test resource group' }] } }),
    collect: async (request: unknown) => {
      Reflect.set(window, 'capturedRequest', request)
      return { ok: true, value: { name: 'wan.json', content: JSON.stringify(capture) } }
    },
  } }), { ...observationFixture(), version: 1 })
  await page.goto('/')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByText('Read-only local Azure collection', { exact: true }).click()
  await page.getByRole('combobox', { name: 'Capture type', exact: true }).selectOption('vwan')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  await page.getByRole('button', { name: 'Read existing Azure session', exact: true }).click()
  await page.getByRole('combobox', { name: 'Select subscription and tenant', exact: true }).selectOption('subscription')
  await page.getByRole('button', { name: 'Read available collection targets', exact: true }).click()
  await page.getByRole('combobox', { name: 'Virtual WAN', exact: true }).selectOption('wan-id')
  await page.getByRole('button', { name: 'Collect and review locally', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Azure capture', exact: true })).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(window, 'capturedRequest'))).toEqual({ subscriptionId: 'subscription', tenantId: 'tenant', mode: 'vwan', target: 'wan-id' })
})
