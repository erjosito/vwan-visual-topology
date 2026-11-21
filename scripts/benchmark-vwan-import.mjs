import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpus } from 'node:os'
import { createRequire } from 'node:module'
import { createServer } from 'vite'

const { PlatformJobs } = createRequire(import.meta.url)('../platform-dist/jobs.cjs')
const jobs = new PlatformJobs()
// Generated synthetic captures only; no Azure access or customer files.
const server = await createServer({
  configFile: false, server: { middlewareMode: true, hmr: false }, appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
})
try {
  const { largeVwanCapture } = await server.ssrLoadModule('/tests/large-vwan-fixture.ts')
  const { importAzureCapture } = await server.ssrLoadModule('/src/azure-import.ts')
  const { validateTopology } = await server.ssrLoadModule('/src/validation.ts')
  const { diagramLayout } = await server.ssrLoadModule('/src/diagram-layout.ts')
  const { simulate } = await server.ssrLoadModule('/src/routing.ts')
  console.log(JSON.stringify({ synthetic: true, node: process.version, cpu: cpus()[0]?.model, platform: process.platform }))
  for (const [vnets, hubs, prefixCount] of [[61, 1, 1], [120, 4, 4], [200, 1, 4], [200, 20, 5], [501, 4, 1], [1000, 4, 1]]) {
    const capture = largeVwanCapture(vnets, hubs, prefixCount)
    const heapBefore = process.memoryUsage().heapUsed
    const durations = {}
    const measure = (label, run) => {
      const start = performance.now()
      const value = run()
      durations[label] = Math.round(performance.now() - start)
      return value
    }
    const topology = measure('importMillis', () => importAzureCapture(capture))
    measure('layoutMillis', () => {
      topology.layout = { mode: 'layered', positions: {} }
      for (const mode of ['layered', 'constellation']) {
        const layout = diagramLayout(topology, mode)
        assert.ok(layout.width < 20000 && layout.height < 20000)
        topology.layout.positions[mode] = Object.fromEntries(layout.positions)
      }
    })
    const saved = measure('saveLoadMillis', () => validateTopology(JSON.parse(JSON.stringify(topology))))
    assert.deepEqual(saved, topology)
    const simulation = measure('simulationMillis', () => simulate(saved))
    for (const hub of saved.hubs) {
      assert.ok(simulation.tables[hub.id].some((row) => row.prefix === saved.spokes.at(-1).prefixes.at(-1) && row.selected.length))
    }
    const input = { contractVersion: 1, operation: 'validate', document: { mode: 'vwan', topology: saved } }
    let start = performance.now()
    const validated = await jobs.run(input)
    durations.headlessValidationMillis = Math.round(performance.now() - start)
    assert.equal(validated.status, vnets > 508 ? 'invalid' : 'complete')
    start = performance.now()
    const result = await jobs.run({ ...input, operation: 'simulate' })
    durations.headlessSimulationMillis = Math.round(performance.now() - start)
    assert.equal(result.status, vnets > 508 ? 'invalid' : vnets === 61 ? 'complete' : 'not assessed')
    assert.deepEqual(result.errors.map((error) => error.code), vnets > 508 ? ['INVALID_REQUEST_OR_TOPOLOGY'] : vnets === 61 ? [] : ['OUTPUT_LIMIT'])
    const outputBytes = Buffer.byteLength(JSON.stringify(result))
    assert.ok(outputBytes <= 8_000_000, 'Existing headless output budget')
    console.log(JSON.stringify({
      synthetic: true, vnets, hubs, prefixes: vnets * prefixCount,
      fixtureSha256: createHash('sha256').update(JSON.stringify(capture)).digest('hex'),
      captureBytes: Buffer.byteLength(JSON.stringify(capture)), outputBytes, headlessStatus: result.status,
      headlessErrors: result.errors.map((error) => error.code),
      ...durations, heapDeltaMiB: Math.round((process.memoryUsage().heapUsed - heapBefore) / 1048576),
      totalHeapMiB: Math.round(process.memoryUsage().heapUsed / 1048576),
    }))
  }
} finally {
  jobs.close()
  await server.close()
}
