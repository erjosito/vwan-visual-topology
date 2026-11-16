import { test, expect } from '@playwright/test'
import { exercises } from '../src/learning/exercises'
import { progressKey } from '../src/learning/progress'

test('failed optional practice loading preserves the workspace and recovers after explicit reload', async ({ page }) => {
  await page.route('**/src/learning/LearningDialog.tsx*', (route) => route.abort())
  await page.goto('/?mode=full')
  await expect(page.getByTestId('aznet-app')).toBeVisible()
  const original = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
  await page.getByTestId('learning-open').click()
  await expect(page.getByRole('status').filter({ hasText: 'Learning tools could not load.' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Learn & practice', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
  await page.unroute('**/src/learning/LearningDialog.tsx*')
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await page.getByTestId('learning-open').click()
  await expect(page.getByRole('dialog', { name: 'Learn & practice', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(original)
})

for (const exercise of exercises) {
  test(`local practice persists independent drafts and grades ${exercise.id}`, async ({ page }) => {
    await page.goto(`/?mode=${exercise.starter.mode}`)
    await expect(page.getByTestId(exercise.starter.mode === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
    const storageKey = exercise.starter.mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'
    if (exercise.starter.mode !== 'vwan') {
      await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), storageKey)).not.toBeNull()
    }
    const original = await page.evaluate((key) => localStorage.getItem(key), storageKey)
    await page.getByTestId('learning-open').click()
    const dialog = page.getByRole('dialog', { name: 'Learn & practice', exact: true })
    await dialog.getByRole('button', { name: 'Practice', exact: true }).click()
    await dialog.getByLabel('Choose an exercise', { exact: true }).selectOption(exercise.id)
    await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
    await expect(dialog.getByTestId('practice-result')).toContainText(/Not assessed|Requirements not yet satisfied/)
    await expect(dialog).not.toContainText('Practice badge (local, unverified)')
    const document = structuredClone(exercise.starter)
    if (document.mode === 'vwan') {
      document.topology.spokes[1].hubId = 'one'
      delete document.topology.spokes[1].hubRouting
    } else if (exercise.id === 'peering-connect' || exercise.id === 'hybrid-connect') {
      const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
      document.topology.vnetPeerings.push({ id: 'practice-peer', name: 'Workload peering', vnetAId: 'a', vnetBId: 'b', enabled: true, aToB: flags, bToA: { ...flags } })
    } else {
      const inventory = document.topology.inventory!
      if (exercise.id === 'private-explicit-egress') {
        inventory.publicIps.push({ id: 'instance', name: 'Instance public', sku: 'Standard', allocation: 'Static', address: '20.40.50.60' })
        inventory.nics[0].ipConfigurations[0].publicIpId = 'instance'
      } else if (exercise.id === 'udr-before-nat') {
        document.topology.udrTables[0].routes[0].nextHopType = 'Internet'
      } else if (exercise.id === 'lb-probe-data-nsg') {
        inventory.networkSecurityGroups![0].rules = inventory.networkSecurityGroups![0].rules.filter((rule) => rule.id !== 'deny-probe')
      } else if (exercise.id === 'public-ingress-nsg') {
        inventory.networkSecurityGroups![0].rules.push({ id: 'allow-client', name: 'AllowClient', priority: 100, direction: 'inbound', action: 'allow',
          protocol: 'tcp', sources: ['8.8.8.8/32'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['443'] })
      } else if (exercise.id === 'dnat-response-owner') {
        document.topology.udrTables.push({ id: 'reply', name: 'Original response owner', disableBgpRoutePropagation: false,
          routes: [{ id: 'client', name: 'Return client', prefix: '8.8.8.8/32', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] })
        document.topology.vnets[0].subnets[0].routeTableId = 'reply'
      } else {
        inventory.loadBalancers![0].probes[0].health[0].status = 'healthy'
      }
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
    await dialog.getByLabel('Choose an exercise', { exact: true }).selectOption(exercise.id)
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

test('Japanese internal LB practice grades unknown and repaired health on a narrow dark screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await page.addInitScript(() => localStorage.setItem('aznet-theme', 'dark'))
  await page.goto('/?mode=full')
  await page.locator('[data-language-selector]').selectOption('ja')
  await page.getByTestId('learning-open').click()
  const dialog = page.getByRole('dialog', { name: '学習と練習', exact: true })
  await dialog.getByRole('button', { name: '練習', exact: true }).click()
  await dialog.locator('select').selectOption('internal-lb-health')
  await expect(dialog.getByRole('heading', { name: '内部 LB バックエンドの不明な正常性を解決', exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '練習の下書きを評価', exact: true }).click()
  await expect(dialog.getByTestId('practice-result')).toContainText('評価不能')
  const draft = structuredClone(exercises.find((exercise) => exercise.id === 'internal-lb-health')!.starter)
  if (draft.mode === 'vwan') throw new Error('Wrong fixture')
  draft.topology.inventory!.loadBalancers![0].probes[0].health[0].status = 'healthy'
  await dialog.locator('textarea').fill(JSON.stringify(draft.topology, null, 2))
  await dialog.getByRole('button', { name: '次のヒントを表示', exact: true }).click()
  await dialog.getByRole('button', { name: '練習の下書きを評価', exact: true }).click()
  await expect(dialog.getByTestId('practice-result')).toContainText('練習の要件を達成')
  await expect(dialog).toContainText('練習バッジ（ローカル、未認証）')
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('learning-open')).toBeFocused()
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
  await page.goto('/?mode=full')
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
  await expect(dialog.getByRole('button', { name: 'Open draft in visual editor', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Assess practice draft', exact: true }).click()
  await expect(dialog.getByTestId('practice-result')).toContainText('Not assessed')
  await expect(dialog).not.toContainText('Invalid or oversized')
  await dialog.getByLabel('Choose an exercise', { exact: true }).selectOption('peering-connect')
  await expect(dialog.getByTestId('practice-result')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Open draft in visual editor', exact: true })).toBeEnabled()
})
