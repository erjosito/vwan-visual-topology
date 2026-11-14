import { test, expect } from '@playwright/test'
import { exercises } from '../src/learning/exercises'
import { progressKey } from '../src/learning/progress'

for (const exercise of exercises) {
  test(`local practice persists independent drafts and grades ${exercise.starter.mode}`, async ({ page }) => {
    await page.goto(`/?mode=${exercise.starter.mode}`)
    const storageKey = exercise.starter.mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    const original = await page.evaluate((key) => localStorage.getItem(key), storageKey)
    await page.getByTestId('learning-open').click()
    const dialog = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
    await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
    await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
    await expect(dialog.getByTestId('practice-result')).toContainText(exercise.starter.mode === 'vwan' ? 'Not assessed' : 'Requirements not yet satisfied')
    await expect(dialog).not.toContainText('Practice badge (local, unverified)')
    const document = structuredClone(exercise.starter)
    if (document.mode === 'vwan') {
      document.topology.spokes[1].hubId = 'one'
      delete document.topology.spokes[1].hubRouting
    } else {
      const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
      document.topology.vnetPeerings.push({ id: 'practice-peer', name: 'Workload peering', vnetAId: 'a', vnetBId: 'b', enabled: true, aToB: flags, bToA: { ...flags } })
    }
    const draft = JSON.stringify(document.topology, null, 2)
    await dialog.getByLabel('Practice topology JSON', { exact: true }).fill(draft)
    await dialog.getByRole('button', { name: 'Show next hint', exact: true }).click()
    await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
    await expect(dialog.getByTestId('practice-result')).toContainText('Practice requirements satisfied')
    await expect(dialog).toContainText('Practice badge (local, unverified)')
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(original)
    await dialog.getByRole('button', { name: 'Open draft in visual editor', exact: true }).click()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBe(original)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('learning-open')).toBeFocused()
    await page.reload()
    await page.getByTestId('learning-open').click()
    await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
    await expect(dialog.getByLabel('Practice topology JSON', { exact: true })).toHaveValue(draft)
    await expect(dialog).toContainText('Hints used: 1/2')
    await expect(dialog).toContainText('Practice badge (local, unverified)')
    await dialog.getByLabel('Practice topology JSON', { exact: true }).fill('not JSON')
    await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Invalid or oversized')
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), progressKey)
    expect(stored.entries.find((entry: { id: string }) => entry.id === exercise.id).attempts).toHaveLength(2)
    await dialog.getByLabel('Practice topology JSON', { exact: true }).fill(draft)
    await dialog.getByRole('button', { name: 'Open draft in visual editor', exact: true }).click()
    await dialog.getByRole('button', { name: 'Replace workspace and open', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey)).not.toBe(original)
  })
}

test('corrupt practice storage stays untouched until an explicit reset', async ({ page }) => {
  await page.addInitScript((key) => localStorage.setItem(key, 'original damaged progress'), progressKey)
  await page.goto('/?mode=hub-spoke')
  await page.getByTestId('learning-open').click()
  const dialog = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
  await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('original contents have not been overwritten')
  await dialog.getByLabel('Practice topology JSON', { exact: true }).fill('{}')
  expect(await page.evaluate((key) => localStorage.getItem(key), progressKey)).toBe('original damaged progress')
  await dialog.getByRole('button', { name: 'Reset local practice progress', exact: true }).click()
  await dialog.getByRole('button', { name: 'Delete practice progress', exact: true }).click()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), progressKey)).toEqual({ version: 1, entries: [] })
})

test('help is on demand, keyboard accessible and localized without changing the workspace', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await page.locator('[data-language-selector]').selectOption('ja')
  await page.getByTestId('learning-open').focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '学習と練習', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('details[open]')).toHaveCount(0)
  await dialog.locator('[data-concept="hrp"] summary').focus()
  await page.keyboard.press('Enter')
  await expect(dialog.locator('[data-concept="hrp"]')).toContainText('即座に再評価')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('learning-open')).toBeFocused()
})

test('an edited draft invalidates the displayed result and storage failures remain explicit', async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new Error('Quota exceeded')
      return original.call(this, name, value)
    }
  }, progressKey)
  await page.goto('/?mode=full')
  await page.getByTestId('learning-open').click()
  const dialog = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
  await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
  await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
  await expect(dialog.getByTestId('practice-result')).toBeVisible()
  await dialog.getByLabel('Practice topology JSON', { exact: true }).fill('{}')
  await expect(dialog.getByTestId('practice-result')).toContainText('The draft changed')
  await expect(dialog.getByRole('status').filter({ hasText: 'session only' })).toBeVisible()
})

test('learning remains contained on narrow dark screens and cannot retain another mode result', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await page.addInitScript(() => localStorage.setItem('aznet-theme', 'dark'))
  await page.goto('/?mode=hub-spoke')
  await page.getByTestId('learning-open').click()
  const dialog = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const bounds = await dialog.boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(390)
  await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
  await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
  await expect(dialog.getByTestId('practice-result')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByTestId('simulator-mode-full').click()
  await page.getByTestId('learning-open').click()
  await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
  await expect(dialog.getByTestId('practice-result')).toHaveCount(0)
  await expect(dialog).toContainText('Connect workloads in Full Hybrid')
})

test('the course picker keeps foreign-mode drafts independent and grades their actual mode', async ({ page }) => {
  await page.goto('/?mode=hub-spoke')
  await page.getByTestId('learning-open').click()
  const dialog = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
  await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
  await dialog.getByLabel('Choose an exercise', { exact: true }).selectOption('vwan-connect')
  await expect(dialog.getByRole('button', { name: 'Open draft in visual editor', exact: true })).toBeDisabled()
  await expect(dialog).toContainText('matching architecture mode')
  await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
  await expect(dialog.getByTestId('practice-result')).toContainText('Not assessed')
  await expect(dialog).not.toContainText('Invalid or oversized')
  await dialog.getByLabel('Choose an exercise', { exact: true }).selectOption('peering-connect')
  await expect(dialog.getByTestId('practice-result')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Open draft in visual editor', exact: true })).toBeEnabled()
})
