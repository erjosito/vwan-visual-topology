import { test, expect } from '@playwright/test'
import { executePlatform } from '../src/platform/service'
import { readFileSync } from 'node:fs'

test('browser-worker service matches the Node contract in all modes and supports cancellation', async ({ page }) => {
  await page.goto('/')
  for (const [mode, file] of [
    ['vwan', 'hub-routing-preferences.json'],
    ['hub-spoke', 'azure-net/hub-spoke-firewall-udr.json'],
    ['full', 'azure-net/hybrid-vwan-and-hub-spoke.json'],
  ]) {
    const input = { contractVersion: 1, operation: 'simulate', document: { mode, topology: JSON.parse(readFileSync(`public/docs/samples/${file}`, 'utf8')) } }
    const actual = await page.evaluate(async (request) => {
      // Vite transforms the actual worker adapter; the UI's engine remains unchanged.
      const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
      return module.runBrowserSimulation(request)
    }, input)
    expect(actual).toEqual(executePlatform(input))
    if (mode === 'full') {
      const topology = input.document.topology
      const hub = topology.vwanHubs[0]
      const vnet = topology.vnets.find((vnet: { vwanHubAttachment?: { hubId: string } }) => vnet.vwanHubAttachment?.hubId === hub.id)
      const scoped = { ...input, operation: 'evaluate', requirements: [
        { id: 'hub', kind: 'route', table: hub.id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
        { id: 'custom', kind: 'route', table: hub.id, hubTableId: 'custom', prefix: vnet.prefixes[0], expectation: 'absent' },
        { id: 'subnet', kind: 'route', table: vnet.subnets[0].id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
      ] }
      const assessed = await page.evaluate(async (request) => {
        const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
        return module.runBrowserSimulation(request)
      }, scoped)
      expect(assessed.assessments.map((goal: { outcome: string }) => goal.outcome)).toEqual(['satisfied', 'not assessed', 'not assessed'])
      expect(assessed).toEqual(executePlatform(scoped))
    }
  }
  const cancelled = await page.evaluate(async () => {
    const module = await import(/* @vite-ignore */ '/src/platform/browser.ts')
    const controller = new AbortController()
    controller.abort()
    return module.runBrowserSimulation({
      contractVersion: 1, operation: 'validate', document: { mode: 'vwan', topology: { version: 1, name: 'Empty', hubs: [], sites: [], spokes: [], connections: [], siteLinks: [] } },
    }, controller.signal)
  })
  expect(cancelled.errors[0].code).toBe('CANCELLED')
})
