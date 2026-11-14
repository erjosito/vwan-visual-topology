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
