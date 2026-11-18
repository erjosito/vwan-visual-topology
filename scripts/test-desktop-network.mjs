import { _electron as electron, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

// Only synthetic samples and loopback probes belong in this diagnostic profile.
const artifacts = resolve('test-artifacts', 'desktop')
await mkdir(artifacts, { recursive: true })
const directory = join(artifacts, `network-${randomUUID()}`)
await mkdir(directory)
const netLogPath = join(directory, 'chromium-netlog.json')
const executablePath = process.env.DESKTOP_EXECUTABLE
const flavor = executablePath ? 'packaged' : 'development'
const summaryPath = join(artifacts, `${flavor}-network-checks.json`)
await rm(summaryPath, { force: true })
let connections = 0, application
const server = createServer((_request, response) => response.end('loopback control'))
server.on('connection', () => { connections++ })
server.on('upgrade', (_request, socket) => socket.destroy())
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const canary = `http://127.0.0.1:${server.address().port}`
try {
  const control = await fetch(canary, { signal: AbortSignal.timeout(3000) })
  expect(await control.text()).toBe('loopback control')
  expect(connections).toBeGreaterThan(0)
  server.closeAllConnections()
  connections = 0
  application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : [resolve('platform-dist', 'electron', 'main.cjs')]),
      `--user-data-dir=${join(directory, 'profile')}`,
      `--log-net-log=${netLogPath}`, '--net-log-capture-mode=Default',
      `--proxy-pac-url=${canary}/proxy.pac`,
    ],
  })
  const page = await application.firstWindow()
  await page.getByTestId('aznet-app').waitFor()
  const runtime = await application.evaluate(() => ({
    electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node,
  }))
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const [mode, file] of [
    ['vwan', ['hub-routing-preferences.json']],
    ['hub-spoke', ['azure-net', 'hub-spoke-firewall-udr.json']],
    ['full', ['azure-net', 'hybrid-vwan-and-hub-spoke.json']],
  ]) {
    await page.goto(`app://simulator/?mode=${mode}`)
    await page.getByTestId(mode === 'vwan' ? 'vwan-app' : 'aznet-app').waitFor()
    const topology = JSON.parse(await readFile(resolve('public', 'docs', 'samples', ...file), 'utf8'))
    const result = await page.evaluate((request) => window.desktopSimulator.simulate(request), {
      contractVersion: 1, operation: 'simulate', document: { mode, topology },
    })
    expect(result.ok).toBe(true)
    expect(result.value.status).toBe('complete')
    topology.application = {
      version: 1,
      services: [{ id: 'offline-service', name: 'Declared identity only', kind: 'front-door', references: [], unsupportedFeatures: [] }],
      dnsProfiles: [{ id: 'offline-dns', name: 'Declared DNS only', kind: 'traffic-manager', references: [], unsupportedFeatures: [] }],
    }
    for (const applicationRequest of [
      { version: 1, kind: 'http', serviceId: 'offline-service', client: { kind: 'external', address: '198.51.100.10' },
        scheme: 'https', host: 'offline.example.test', port: 443, path: '/' },
      { version: 1, kind: 'dns', profileId: 'offline-dns', resolver: { kind: 'external', address: '198.51.100.10' },
        name: 'offline.example.test', evaluatedAt: '2026-11-16T00:00:00.000Z', cache: 'fresh' },
    ]) {
      const contract = await page.evaluate((request) => window.desktopSimulator.simulate(request), {
        contractVersion: 2, operation: 'application', document: { mode, topology }, application: applicationRequest,
      })
      expect(contract.ok).toBe(true)
      expect(contract.value.status).toBe('not assessed')
      expect(contract.value.application.configuration).toBe('not-assessed')
      expect(contract.value.application.availability).toBe('not-assessed')
      expect(contract.value.application.decisions.every((decision) => decision.outcome === 'not-assessed')).toBe(true)
    }
  }
  await page.goto('app://simulator/?mode=vwan')
  await page.getByTestId('vwan-app').waitFor()
  await page.locator('.presentation-group > summary').filter({ hasText: /^Help & feedback$/ }).click()
  const [documentation] = await Promise.all([
    application.waitForEvent('window'),
    page.getByRole('button', { name: 'Docs', exact: true }).click(),
  ])
  await documentation.waitForLoadState()
  expect(documentation.url()).toContain('app://simulator/docs/')
  expect(await documentation.evaluate(() => typeof window.desktopSimulator)).toBe('undefined')

  const probes = []
  for (const [context, window] of [['renderer', page], ['documentation', documentation]]) {
    const results = await window.evaluate(async (base) => {
      const urls = [base, base.replace('http:', 'https:')]
      const outcomes = {}
      for (const url of urls) {
        outcomes[url.startsWith('https:') ? 'https' : 'http'] = await fetch(url, { signal: AbortSignal.timeout(3000) })
          .then(() => 'allowed', () => 'blocked')
      }
      for (const scheme of ['ws:', 'wss:']) {
        outcomes[scheme] = await new Promise((resolve) => {
          const socket = new WebSocket(base.replace('http:', scheme))
          const timer = setTimeout(() => { socket.close(); resolve('timeout') }, 3000)
          socket.onopen = () => { clearTimeout(timer); socket.close(); resolve('allowed') }
          socket.onerror = () => { clearTimeout(timer); resolve('blocked') }
        })
      }
      return outcomes
    }, canary)
    expect(Object.values(results)).toEqual(['blocked', 'blocked', 'blocked', 'blocked'])
    probes.push({ context, results: Object.keys(results).map((transport) => ({ transport, outcome: 'blocked' })) })
  }
  // Bypass renderer CSP, but not the production session's request filter.
  for (const scheme of ['http:', 'https:']) {
    const outcome = await application.evaluate(async ({ session }, url) => {
      return session.defaultSession.fetch(url, { signal: AbortSignal.timeout(3000) })
        .then(() => 'allowed', () => 'blocked')
    }, canary.replace('http:', scheme))
    expect(outcome).toBe('blocked')
  }
  await page.waitForTimeout(1000)
  expect(connections).toBe(0)
  expect(errors).toEqual([])
  await application.close()
  application = undefined
  const log = JSON.parse(await readFile(netLogPath, 'utf8'))
  expect(log.events.length).toBeGreaterThan(0)
  const eventTypes = new Map(Object.entries(log.constants.logEventTypes).map(([name, value]) => [value, name]))
  const counts = {}
  for (const event of log.events) {
    const name = eventTypes.get(event.type)
    if (name && /^(?:TCP_CONNECT|UDP_CONNECT|HOST_RESOLVER_MANAGER_REQUEST|HOST_RESOLVER_IMPL_REQUEST)$/.test(name)) {
      counts[name] = (counts[name] ?? 0) + 1
    }
  }
  expect(counts).toEqual({})
  const summary = {
    testedAt: new Date().toISOString(), flavor, runtime,
    executableSha256: executablePath ? createHash('sha256').update(await readFile(executablePath)).digest('hex') : null,
    asarSha256: executablePath ? createHash('sha256').update(await readFile(join(dirname(executablePath), 'resources', 'app.asar'))).digest('hex') : null,
    evidence: 'Actual Electron + synthetic samples + reachable loopback canary; no authenticated Azure calls.',
    scope: 'Startup, three local engine simulations, six unavailable HTTP/DNS contract inspections, documentation, HTTP(S)/WS(S) renderer probes and session HTTP(S) probes.',
    canaryPositiveControl: true, explicitPacCanary: true, applicationCanaryConnections: connections,
    chromiumConnectAndResolverEvents: counts, rendererProbes: probes, sessionHttpProbes: 'blocked',
    limitations: 'Chromium net log is not an OS-wide process-tree/firewall trace or Azure CLI endpoint evidence.',
  }
  await writeFile(summaryPath, JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
} finally {
  try { if (application) await application.close() }
  finally {
    server.closeAllConnections()
    try { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) }
    finally { await rm(directory, { recursive: true, force: true }) }
  }
}
