import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { example } from '../src/model'

for (const desktop of [false, true]) {
  const host = desktop ? 'desktop' : 'web'
  test(`${host} VWAN starts empty while explicit samples and saved work still restore`, async ({ page }) => {
    if (desktop) await page.addInitScript(() => Object.defineProperty(window, 'desktopSimulator', { value: {} }))
    await page.goto('/?mode=vwan')
    await expect(page.getByTestId('vwan-app')).toBeVisible()
    await expect(page.locator('.diagram [data-node-id]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '+ Hub', exact: true })).toBeEnabled()
    await expect(page.getByTestId('workspace-library-open')).toBeEnabled()
    await expect(page.getByTestId('simulator-mode-switch')).toHaveCount(0)
    await page.getByRole('button', { name: 'Sample topologies', exact: true }).click()
    await page.getByRole('dialog', { name: 'Sample topologies', exact: true }).getByRole('button', { name: 'Load sample topology', exact: true }).first().click()
    await expect(page.locator('.hub-node')).toHaveCount(example.hubs.length)
    const saved = await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))
    await page.reload()
    await expect(page.locator('.hub-node')).toHaveCount(example.hubs.length)
    expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe(saved)
    await page.goto('/?mode=vwan&sample=hub-routing-preferences')
    const sample = JSON.parse(await readFile(resolve('public', 'docs', 'samples', 'hub-routing-preferences.json'), 'utf8'))
    await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue(sample.name)
    await expect(page.locator('.hub-node')).toHaveCount(sample.hubs.length)
    await page.getByLabel('Topology name', { exact: true }).fill('Edited URL sample')
    await page.reload()
    await expect(page.getByLabel('Topology name', { exact: true })).toHaveValue('Edited URL sample')
  })

  test(`${host} VWAN preserves damaged saved data without silently displaying a sample`, async ({ page }) => {
    await page.addInitScript((desktop) => {
      if (desktop) Object.defineProperty(window, 'desktopSimulator', { value: {} })
      localStorage.setItem('vwan-visual-topology:v1', 'damaged saved workspace')
    }, desktop)
    await page.goto('/?mode=vwan')
    await expect(page.getByRole('button', { name: 'Download original saved topology', exact: true })).toBeVisible()
    await expect(page.locator('.diagram [data-node-id]')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('vwan-visual-topology:v1'))).toBe('damaged saved workspace')
  })
}
