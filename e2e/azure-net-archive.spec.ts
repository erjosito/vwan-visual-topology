import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import type { AzNetTopology } from '../src/azure-net/model'

for (const id of ['access-disabled', 'access-corrected']) {
  test(`recorded VNRA archive imports, distinguishes route visibility from forwarding and round-trips: ${id}`, async ({ page }) => {
    const archive = JSON.parse(await readFile(resolve('verification', 'issue-98-vnra-archive.json'), 'utf8')) as {
      cases: { id: string; topology: AzNetTopology; probes: { received: number }[] }[]
    }

    const entry = archive.cases.find((c) => c.id === id)!
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/?mode=hub-spoke')
    const importFile = page.locator('input[type="file"]').first()
    await importFile.setInputFiles({ name: 'vnra.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(entry.topology)) })
    await expect(page.getByTestId('aznet-vnet-spoke1-vnet')).toBeVisible()
    await page.getByTestId('aznet-subnet-spoke1-vnet-vm-subnet').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
    const table = page.getByTestId('aznet-effective-route-table')
    await expect(table.getByTestId('aznet-route-row-10.1.0.0/16-System')).not.toHaveClass(/suppressed/)
    const udr = table.getByTestId('aznet-route-row-10.20.0.0/16-User')
    await expect(udr).toContainText('10.1.0.4')
    await page.getByTestId('aznet-lpm-input').fill('10.20.1.4')
    await expect(udr).toContainText('LPM Winner')
    await page.getByRole('button', { name: 'Close Effective routes', exact: true }).click()
    await page.getByTestId('aznet-subnet-spoke1-vnet-vm-subnet').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
    await page.getByTestId('aznet-trace-dest-select').selectOption('subnet:spoke2-vnet:spoke2-vnet-vm-subnet')
    await page.getByTestId('aznet-trace-custom-ip').fill('10.20.1.4')
    await page.getByTestId('aznet-run-trace-btn').click()
    for (const direction of ['forward', 'reverse']) {
      await expect(page.getByTestId(`aznet-${direction}-hops`).locator(entry.probes[0].received ? '.delivered' : '.dropped')).toHaveCount(1)
    }
    if (entry.probes[0].received) {
      await expect(page.getByTestId('aznet-forward-hops')).toContainText('vnra1')
      await expect(page.getByTestId('aznet-forward-hops')).toContainText('vnra2')
    }
    await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export JSON/ }).click()
    const download = await downloadPromise
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(exported).toEqual(entry.topology)
    await importFile.setInputFiles({ name: 'round-trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
    await page.reload()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)).toEqual(entry.topology)
    expect(errors).toEqual([])
  })
}

for (const id of ['summary-only', 'explicit-spokes']) {
  test(`recorded UDR archive imports, displays native route state and round-trips: ${id}`, async ({ page }) => {
    const archive = JSON.parse(await readFile(resolve('verification', 'issue-98-udr-archive.json'), 'utf8')) as {
      cases: { id: string; topology: AzNetTopology }[]
    }
    const entry = archive.cases.find((c) => c.id === id)!
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/?mode=hub-spoke')
    const importFile = page.locator('input[type="file"]').first()
    await importFile.setInputFiles({ name: 'udr.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(entry.topology)) })
    await page.getByTestId('aznet-subnet-probe').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
    const table = page.getByTestId('aznet-effective-route-table')
    const peering = table.getByTestId('aznet-route-row-10.1.0.0/16-System')
    await expect(peering).toContainText('VNetPeering')
    if (id === 'summary-only') await expect(peering).not.toHaveClass(/suppressed/)
    else await expect(peering).toHaveClass(/suppressed/)
    await page.getByTestId('aznet-lpm-input').fill('10.1.1.4')
    const winner = id === 'summary-only' ? peering : table.getByTestId('aznet-route-row-10.1.0.0/16-User')
    await expect(winner).toContainText('LPM Winner')
    if (id === 'explicit-spokes') await expect(winner).toContainText('10.0.1.4')
    await page.getByRole('button', { name: 'Close Effective routes', exact: true }).click()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export JSON/ }).click()
    const download = await downloadPromise
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(exported).toEqual(entry.topology)
    await importFile.setInputFiles({ name: 'round-trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
    await page.reload()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)).toEqual(entry.topology)
    expect(errors).toEqual([])
  })
}
