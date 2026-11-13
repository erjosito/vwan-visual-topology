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

for (const id of ['baseline-ecmp', 'bird-default-prepend']) {
  test(`recorded hubless ARS remote peers and default selection import, edit and round-trip: ${id}`, async ({ page }, testInfo) => {
    const archive = JSON.parse(await readFile(resolve('verification', 'issue-98-ars-hubless-archive.json'), 'utf8')) as {
      topology: AzNetTopology
      learned: { peerId: string; prefix: string; asPath: number[] }[]
      cases: { id: string; exportFile: string; nva2DefaultSuffix: number[]; nva2DefaultAsPath: number[]; defaultNextHops: string[] }[]
    }
    const entry = archive.cases.find((entry) => entry.id === id)!
    const topology = structuredClone(archive.topology)
    topology.vnets[1].appliances[0].advertisedRouteAttributes![0].asPath = entry.nva2DefaultSuffix
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/?mode=full')
    const importFile = page.locator('input[type="file"]').first()
    const importTopology = () => importFile.setInputFiles({ name: entry.exportFile, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(topology)) })
    await importTopology()
    await page.getByTestId('aznet-chip-ars-poland').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Inspect Route Server RIB (ASN 65515)', exact: true }).click()
    const rib = page.getByTestId('aznet-control-rib-card')
    for (const observed of archive.learned) {
      const path = observed.peerId === 'nva2' && observed.prefix === '0.0.0.0/0' ? entry.nva2DefaultAsPath : observed.asPath
      await expect(rib.locator(`[data-prefix="${observed.prefix}"]`).filter({ hasText: observed.peerId === 'nva1' ? 'NVA1' : 'NVA2' }).locator('.as-path')).toHaveText(path.join(' '))
    }
    await page.getByRole('button', { name: 'Close Effective routes', exact: true }).click()
    await page.getByTestId('aznet-subnet-c1-work').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Inspect Subnet Effective Routes', exact: true }).click()
    const winners = page.getByTestId('aznet-effective-route-table').locator('[data-testid="aznet-route-row-0.0.0.0/0-RouteServer"]:not(.suppressed)')
    await expect(winners).toHaveCount(entry.defaultNextHops.length)
    for (const ip of entry.defaultNextHops) await expect(winners.filter({ hasText: ip })).toHaveCount(1)
    await page.getByRole('button', { name: 'Close Effective routes', exact: true }).click()
    await page.getByTestId('aznet-chip-ars-poland').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Manage ARS Route Maps', exact: true }).click()
    const policy = page.getByRole('dialog', { name: 'Route maps · ars-poland', exact: true })
    await policy.getByText('BGP peers (local or directly peered VNets)', { exact: true }).click()
    const peer = policy.getByRole('checkbox', { name: 'BGP peer vnet-hub2 / NVA2', exact: true })
    await expect(peer).toBeChecked()
    await peer.uncheck()
    await expect(peer).not.toBeChecked()
    await peer.check()
    await page.keyboard.press('Escape')
    await importTopology()
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export JSON/ }).click()
    const download = await downloadPromise
    await download.saveAs(testInfo.outputPath(entry.exportFile))
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(exported).toEqual(topology)
    await importFile.setInputFiles({ name: 'round-trip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
    await page.reload()
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology)).toEqual(topology)
    await page.getByTestId('aznet-chip-nva2').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Remove Appliance', exact: true }).click()
    await expect(page.getByTestId('aznet-chip-nva2')).toHaveCount(0)
    const peers = await page.evaluate(() => JSON.parse(localStorage.getItem('aznet-visual-topology:v1')!).topology.vnets
      .flatMap((vnet: { routeServer?: { peerApplianceIds: string[] } }) => vnet.routeServer?.peerApplianceIds ?? []))
    expect(peers).not.toContain('nva2')
    expect(errors).toEqual([])
  })
}
