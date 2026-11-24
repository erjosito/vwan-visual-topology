import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const executablePath = process.env.DESKTOP_EXECUTABLE
const flavor = executablePath ? 'packaged' : 'development'
const artifacts = resolve('test-artifacts', 'desktop', `${flavor}-detail-${randomUUID()}`)
await mkdir(artifacts, { recursive: true })
const fixture = join(artifacts, 'network-detail.cjs')
await build({ entryPoints: [resolve('tests', 'fixtures', 'network-detail.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: fixture })
const { graphicalDetailTopology } = createRequire(import.meta.url)(fixture)
const bgpFixture = join(artifacts, 'bgp-neighbors.cjs')
await build({ entryPoints: [resolve('tests', 'fixtures', 'bgp-neighbors.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bgpFixture })
const { bgpNeighborTopology, bgpNeighborVwanTopology } = createRequire(import.meta.url)(bgpFixture)
const application = await electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : [resolve('platform-dist', 'electron', 'main.cjs')]), `--user-data-dir=${join(artifacts, 'profile')}`],
})
const results = []
try {
  const page = await application.firstWindow(), errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const mode of ['vwan', 'hub-spoke', 'full']) {
    await page.goto(`app://simulator/?mode=${mode}`)
    await page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    await page.evaluate(({ mode, topology }) => {
      localStorage.setItem('aznet-ui-preview:v1', 'true')
      const raw = JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology })
      const id = JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')).activeId
      localStorage.setItem(`network-simulator:workspace-tab:v1:${id}:topology`, raw)
      localStorage.setItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1', raw)
    }, { mode, topology: graphicalDetailTopology(mode, 145) })
    await page.reload()
    const node = page.locator(mode === 'vwan' ? '.spoke-node[data-node-id="detail-network"]' : '[data-testid="aznet-select-vnet-detail-network"]')
    await node.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
    const detail = page.getByTestId('network-detail-dialog'), first = detail.locator('[data-subnet-id="first"]')
    const read = () => page.evaluate((mode) => {
      const saved = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'))
      return saved.topology ?? saved
    }, mode)
    const before = await read()
    await expect(detail.locator(':scope > header + [data-testid="vnet-detail-diagram"]')).toBeVisible()
    await expect.poll(() => detail.getByTestId('vnet-detail-diagram').locator('img').evaluateAll((images) =>
      images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true)
    await expect(detail.locator('.detail-subnet-policies[open]')).toHaveCount(0)
    await expect(first.getByTestId('detail-device')).toHaveCount(12)
    await expect(first.locator('[data-attachment-edge="nic:original-nic"]')).toHaveCount(1)
    await first.locator('[data-attachment-reference="nic:original-nic"]').getByRole('button', { name: 'Attachment reference → original entity', exact: true }).click()
    const original = detail.locator('[data-original-entity="nic:original-nic"]')
    const target = original.getByRole('button', { name: 'NIC: Original NIC', exact: true })
    await expect(target).toBeFocused()
    await page.keyboard.press('ContextMenu')
    await detail.getByRole('menuitem', { name: 'Edit workload: Original workload', exact: true }).click()
    const form = detail.getByTestId('selected-workload-form')
    await expect(form.getByLabel('Workload name', { exact: true })).toBeFocused()
    await form.getByLabel('Workload name', { exact: true }).fill('Edited desktop original')
    await form.getByRole('button', { name: 'Save workload', exact: true }).click()
    await expect(original).toContainText('Edited desktop original')
    await first.getByLabel('Search attached entities', { exact: true }).fill('vm-144')
    await expect(first.getByTestId('detail-device')).toHaveCount(1)
    await first.locator('.detail-subnet-content > summary').click()
    await expect(first.getByRole('button', { name: 'NIC: Inventory NIC 144', exact: true })).not.toBeVisible()
    await first.locator('.detail-subnet-content > summary').click()
    await detail.screenshot({ path: join(artifacts, `${mode}.png`) })
    await page.keyboard.press('Escape')
    await expect(node).toBeFocused()
    await page.getByRole('button', { name: /^(↶ )?Undo$/ }).click()
    expect(await read()).toEqual(before)
    await page.getByRole('button', { name: /^(↷ )?Redo$/ }).click()
    await node.focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Open VNet detail', exact: true }).click()
    await expect(form.getByLabel('Workload name', { exact: true })).toHaveValue('Edited desktop original')
    await expect(first.getByTestId('detail-device')).toHaveCount(12)
    const expected = structuredClone(before)
    expected.inventory.workloads[0].name = 'Edited desktop original'
    expect(await read()).toEqual(expected)
    await page.keyboard.press('Escape')
    results.push({ mode, preview: true, diagramFirst: true, azureIcons: true, attachments: 145, originalIdentity: true, editUndoRedo: true, keyboardFocus: true })
  }
  for (const mode of ['hub-spoke', 'full', 'vwan']) {
    const topology = mode === 'vwan' ? bgpNeighborVwanTopology() : bgpNeighborTopology()
    await page.goto(`app://simulator/?mode=${mode}`)
    await page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    await page.evaluate(({ mode, topology }) => {
      localStorage.setItem('aznet-ui-preview:v1', 'false')
      const raw = JSON.stringify(mode === 'vwan' ? topology : { sampleId: '', topology })
      const id = JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')).activeId
      localStorage.setItem(`network-simulator:workspace-tab:v1:${id}:topology`, raw)
      localStorage.setItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1', raw)
    }, { mode, topology })
    await page.reload()
    await expect(page.getByRole('banner').getByRole('button', { name: 'BGP neighbors', exact: true })).toHaveCount(0)
    const bgpNode = mode === 'vwan' ? page.locator('[data-node-id="managed-hub"]') : page.getByTestId('aznet-chip-reader')
    await (await bgpNode.getAttribute('role') === 'group' ? bgpNode.locator(':scope > .network-node') : bgpNode).focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'BGP neighbors', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'BGP neighbors', exact: true })
    const resource = dialog.getByLabel('Local BGP resource')
    if (mode === 'vwan') {
      await expect(resource).toHaveValue(JSON.stringify(['vwan-hub', 'managed-hub']))
      await expect(dialog.getByLabel('Local BGP instance')).toHaveCount(0)
      await expect(dialog.getByTestId('bgp-managed-relationships')).toContainText('managed-vpn')
      const rows = dialog.getByTestId('bgp-managed-rows').locator('tbody tr')
      await expect(rows).toHaveCount(3)
      await expect(rows.filter({ hasText: 'Remote hub' })).toContainText('65515')
      await expect(rows.filter({ hasText: 'Hub ER' })).toContainText('12076')
      await expect(rows.filter({ hasText: 'Managed VPN' })).toContainText('65050')
      await rows.getByRole('button', { name: 'Synthetic ER location', exact: true }).click()
      await expect(rows.filter({ hasText: 'er-hub' })).toContainText('65515')
      await resource.selectOption(JSON.stringify(['site', 'branch']))
      await expect(rows.filter({ hasText: 'managed-vpn' })).toContainText('65515')
    } else {
      await expect(resource).toHaveValue(JSON.stringify(['appliance', 'reader']))
      await expect(dialog.getByTestId('bgp-neighbor-rows').locator('tbody tr')).toHaveCount(4)
      await resource.selectOption(JSON.stringify(['route-server', 'west-ars']))
      const instances = dialog.getByLabel('Local BGP instance')
      const choices = await instances.locator('option').evaluateAll((options) => options.map((option) => option.value))
      expect(choices).toHaveLength(2)
      await instances.selectOption(choices[1])
      await expect(dialog.getByTestId('bgp-neighbor-rows').locator('tbody tr')).toHaveCount(2)
      await expect(dialog.getByTestId('bgp-neighbor-rows').locator('tbody tr').first()).toHaveAttribute('data-local-instance-id', choices[1])
      await dialog.getByTestId('bgp-neighbor-rows').getByRole('button').first().click()
      await expect(dialog.getByTestId('bgp-neighbor-details')).toBeVisible()
      const contract = await page.evaluate((request) => window.desktopSimulator.simulate(request), {
        contractVersion: 1, operation: 'simulate', document: { mode, topology },
      })
      expect(contract.ok).toBe(true)
      expect(contract.value.bgpNeighbors.neighbors.filter((neighbor) => neighbor.localResourceKey === JSON.stringify(['appliance', 'reader']))).toHaveLength(4)
    }
    const saved = await page.evaluate((mode) => {
      const value = JSON.parse(localStorage.getItem(mode === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1'))
      return value.topology ?? value
    }, mode)
    expect(saved).toEqual(topology)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    results.push({ mode, simulatedBgpNeighbors: true, originalIdentity: true, readOnly: true, managedUnknowns: true })
  }
  expect(errors).toEqual([])
  await writeFile(join(artifacts, 'results.json'), `${JSON.stringify({ flavor, results, errors }, null, 2)}\n`)
  console.log(JSON.stringify({ artifacts, flavor, results }))
} finally {
  await application.close()
}
