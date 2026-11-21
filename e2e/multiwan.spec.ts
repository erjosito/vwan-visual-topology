import { expect, test } from '@playwright/test'
import { federationFixture } from '../tests/federation-fixture'
import { largeVwanCapture } from '../tests/large-vwan-fixture'
import { importAzureCapture } from '../src/azure-import'

test('two-capture import retains WAN scopes and only draws explicit inter-WAN VPN; directional controls persist', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?mode=vwan')
  await page.getByLabel('Import topology file').setInputFiles({
    name: 'federation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(federationFixture())),
  })
  const panel = page.getByRole('dialog', { name: 'Azure files', exact: true })
  await expect(panel.getByText(/4 hubs · 4 IPv4 spokes/)).toBeVisible()
  await expect(panel.getByText(/P2S clients, authentication/)).toBeVisible()
  await panel.getByLabel('I understand this is a structure-only import, not verified Azure routing.').check()
  await panel.getByRole('button', { name: 'Replace workspace with Azure capture' }).click()
  await expect(page.getByLabel('Topology name')).toHaveValue('Two synthetic WANs')
  const svg = page.locator('svg.diagram')
  await expect(svg.locator('[data-testid^="interhub-"]')).toHaveCount(2)
  await expect(svg.getByTestId('interwan-wan-vpn')).toHaveCount(1)
  const hub = svg.getByLabel('Select hub Synthetic hub 0', { exact: true }).first()
  await hub.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit configuration', exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Edit hub', exact: true })
  await expect(editor.getByLabel('Virtual WAN scope')).toHaveValue(/az-wan-/)
  await editor.getByLabel('B to A IPv4 export prefixes').fill('')
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.reload()
  await expect(svg.getByTestId('interwan-wan-vpn')).toHaveCount(1)
  const native = await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!))
  expect(native.wans).toHaveLength(2)
  expect(native.interWanVpns[0].bToA).toEqual([])
  expect(native.azureImport.wanIds).toHaveLength(2)
  expect(errors).toEqual([])
})

test('501 synthetic VNet references remain selectable and save without truncation', async ({ page }) => {
  await page.goto('/?mode=vwan')
  await page.getByLabel('Import topology file').setInputFiles({
    name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(largeVwanCapture(501, 4, 1))),
  })
  const panel = page.getByRole('dialog', { name: 'Azure files', exact: true })
  await expect(panel.getByText(/4 hubs · 501 IPv4 spokes/)).toBeVisible()
  await panel.getByLabel('I understand this is a structure-only import, not verified Azure routing.').check()
  await panel.getByRole('button', { name: 'Replace workspace with Azure capture' }).click()
  await expect(page.locator('svg.diagram .spoke-node')).toHaveCount(501)
  await page.getByLabel('Visualization mode', { exact: true }).selectOption('constellation')
  const last = page.getByLabel('Select spoke Synthetic VNet 500', { exact: true })
  await last.focus()
  await page.keyboard.press('Enter')
  await expect(last).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('vwan-visual-topology:v1')!).spokes.length)).toBe(501)
})

test('a saved 501-VNet native topology opens without truncation', async ({ page }) => {
  const topology = importAzureCapture(largeVwanCapture(501, 4, 1))
  await page.addInitScript((native) => localStorage.setItem('vwan-visual-topology:v1', JSON.stringify(native)), topology)
  await page.goto('/?mode=vwan')
  await page.locator('svg.diagram').waitFor({ state: 'visible' })
  await expect(page.locator('svg.diagram .spoke-node')).toHaveCount(501)
})
