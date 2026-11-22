import { test, expect } from '@playwright/test'
import { executePlatform } from '../src/platform/service'
import { readFileSync } from 'node:fs'

test('a real connection editor sends unsaved native edits to the worker without serializing away invalid fields', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    const [{ default: React }, { default: ReactDOM }, editor, browser, requests] = await Promise.all([
      import(/* @vite-ignore */ '/node_modules/.vite/deps/react.js'),
      import(/* @vite-ignore */ '/node_modules/.vite/deps/react-dom_client.js'),
      import(/* @vite-ignore */ '/src/azure-net/HybridRoutingEditor.tsx'),
      import(/* @vite-ignore */ '/src/platform/browser.ts'),
      import(/* @vite-ignore */ '/src/platform/request.ts'),
    ])
    const topology = await fetch('/docs/samples/azure-net/hybrid-vwan-and-hub-spoke.json').then(response => response.json())
    topology.vpnConnections.push({ id: 'live-vpn', name: 'Live VPN', siteId: topology.sites[0].id,
      targetKind: 'vwan-hub', targetId: topology.vwanHubs[0].id, enabled: true, bgpEnabled: true })
    const connection = topology.vpnConnections[0]
    connection.advertisedPrefixes = [...topology.sites.find((site: { id: string }) => site.id === connection.siteId).prefixes]
    let live = topology
    const container = document.createElement('div')
    container.id = 'live-boundary-editor'
    Object.assign(container.style, { position: 'fixed', inset: '0', zIndex: '10000', overflow: 'auto', background: 'white' })
    document.body.append(container)
    ReactDOM.createRoot(container).render(React.createElement(editor.HybridConnectionEditor, {
      topology, connectionId: connection.id,
      commit: (edit: (draft: typeof topology) => void) => { live = structuredClone(live); edit(live); return true },
    }))
    Object.assign(window, { inspectLiveBoundary: async (invalid = false) => {
      if (invalid) live.vpnConnections[0].advertisedPrefixes = undefined
      const input = requests.createPlatformRequest({ contractVersion: 1, operation: 'simulate', locale: undefined,
        budget: { maxMillis: undefined }, document: { mode: 'full', topology: live } })
      try {
        const result = await browser.runBrowserSimulation(input)
        return { name: live.vpnConnections[0].name, advertisedPresent: Object.hasOwn(live.vpnConnections[0], 'advertisedPrefixes'),
          localePresent: Object.hasOwn(input, 'locale'), status: result.status, errors: result.errors }
      } catch (error) { return { rejected: error instanceof Error ? error.message : String(error) } }
    } })
  })
  const editor = page.locator('#live-boundary-editor')
  await editor.locator('input[name="name"]').fill('Unsaved connection edit')
  await editor.getByRole('checkbox', { name: 'Select site prefixes advertised on this transport' }).uncheck()
  await editor.getByRole('button', { name: 'Save connection routing', exact: true }).click()
  const inspect = (invalid = false) => page.evaluate(async value => {
    const host = window as unknown as { inspectLiveBoundary: (invalid: boolean) => Promise<unknown> }
    return host.inspectLiveBoundary(value)
  }, invalid)
  expect(await inspect()).toMatchObject({ name: 'Unsaved connection edit', advertisedPresent: false, localePresent: false,
    status: 'complete', errors: [] })
  expect(await inspect(true)).toMatchObject({ rejected: 'Plain JSON data required.' })
})

test('malformed browser worker replies settle as unassessed instead of carrying fabricated success or hanging', async ({ page }) => {
  await page.goto('/')
  const codes = await page.evaluate(async () => {
    const { runBrowserSimulation } = await import(/* @vite-ignore */ '/src/platform/browser.ts')
    const OriginalWorker = window.Worker
    const codes: string[] = []
    try {
      for (const data of [{}, { status: 'complete', contractVersion: 99 }, { cyclic: 1n }]) {
        window.Worker = class {
          onmessage?: (event: { data: unknown }) => void
          postMessage() { setTimeout(() => this.onmessage?.({ data }), 0) }
          terminate() {}
        } as unknown as typeof Worker
        const result = await runBrowserSimulation({ contractVersion: 1, operation: 'validate',
          budget: { maxMillis: 1000 }, document: { mode: 'vwan',
            topology: { version: 1, name: 'Empty', hubs: [], sites: [], spokes: [], connections: [], siteLinks: [] } } })
        codes.push(result.errors[0]?.code)
      }
    } finally { window.Worker = OriginalWorker }
    return codes
  })
  expect(codes).toEqual(['INVALID_WORKER_RESULT', 'INVALID_WORKER_RESULT', 'INVALID_WORKER_RESULT'])
})

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
