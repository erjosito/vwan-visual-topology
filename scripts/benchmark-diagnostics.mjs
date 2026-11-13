import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false, server: { middlewareMode: true }, appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
})
const results = []
try {
  const { createRoutingAnalysis } = await server.ssrLoadModule('/src/diagnostics.ts')
  const hub = (id) => ({
    id, name: id, region: '', preference: 'ASPath',
    routingIntent: { private: false, internet: false, privatePrefixes: [] },
  })
  const star = (prefixes) => {
    const topology = {
      version: 1, name: `${prefixes}-prefix star`, hubs: [hub('h')],
      sites: [], connections: [], siteLinks: [],
      spokes: Array.from({ length: prefixes / 25 }, (_, i) => ({
        id: `spoke-${i}`, name: `Spoke ${i}`, hubId: 'h',
        prefixes: [...Array.from({ length: 24 }, (_, j) => `10.${i + 1}.${j}.0/24`), `10.${i + 1}.24.0/21`],
      })),
    }
    return {
      topology,
      profile: {
        version: 1, failureAnalysis: false,
        intents: topology.spokes.slice(1).map((target, i) => ({
          id: target.id, source: { kind: 'spoke', id: 'spoke-0' }, target: { kind: 'spoke', id: target.id },
          sourcePrefix: '10.1.0.0/19', destinationPrefix: `10.${i + 2}.0.0/19`, expectation: 'allow',
        })),
      },
      expectedCells: (prefixes / 25 - 1) * 625,
    }
  }
  const run = (label, topology, profile, options) => {
    const started = performance.now()
    const initialHeap = process.memoryUsage().heapUsed
    let observedHeap = initialHeap
    const analysis = createRoutingAnalysis(topology, profile, { ...options, maxMillis: 60000 })
    let report, batches = 0
    do {
      report = analysis.advance()
      observedHeap = Math.max(observedHeap, process.memoryUsage().heapUsed)
      if (++batches > 2000) throw new Error('Continuation failed to finish within the bounded benchmark')
    } while (report.continuation.status === 'paused')
    const measurement = {
      label, configuredPrefixes: topology.spokes.reduce((sum, spoke) => sum + spoke.prefixes.length, 0),
      elapsedMillis: Math.round(performance.now() - started), batches,
      heapAtStartMiB: Math.round(initialHeap / 1048576), maximumObservedHeapMiB: Math.round(observedHeap / 1048576),
      cells: report.cells, probes: report.probes, failureCases: report.failureCases,
      status: report.continuation.status, complete: report.complete, remainingCells: report.continuation.remainingCells,
      limits: report.limitations,
    }
    results.push(measurement)
    console.log(JSON.stringify(measurement))
    return report
  }
  for (const prefixes of [500, 1000]) {
    const { topology, profile, expectedCells } = star(prefixes)
    const batched = run(`${prefixes}: bounded star continuation`, topology, profile, { maxCells: 1024, maxProbes: 2048 })
    const reference = run(`${prefixes}: wide-batch reference`, topology, profile, { maxCells: 50000, maxProbes: 100000 })
    assert.equal(batched.complete, true)
    assert.equal(batched.cells, expectedCells)
    assert.equal(batched.continuation.remainingCells, 0)
    assert.deepEqual({ ...batched, budget: reference.budget }, reference)
  }
  const topology = {
    version: 1, name: 'Parallel ECMP and N-1', hubs: [hub('h')],
    spokes: [{ id: 'source', name: 'Source', hubId: 'h', prefixes: ['10.1.0.0/16'] }],
    sites: [{ id: 'target', name: 'Target', asn: 65002, prefixes: ['10.2.0.0/16', '10.2.1.0/24'] }],
    connections: ['primary', 'parallel', 'backup'].map((id) => ({
      id, name: id, hubId: 'h', siteId: 'target', transport: 'VPN',
      enabled: true, learnSiteRoutes: true, inbound: [], outbound: [],
    })),
    siteLinks: [],
  }
  const profile = {
    version: 1, failureAnalysis: true,
    intents: [{
      id: 'required', source: { kind: 'spoke', id: 'source' }, target: { kind: 'site', id: 'target' },
      sourcePrefix: '10.1.0.0/16', destinationPrefix: '10.2.0.0/16', expectation: 'allow',
    }],
  }
  topology.sites.push({ id: 'critical', name: 'Single-link target', asn: 65003, prefixes: ['10.4.0.0/16'] })
  topology.connections.push({
    ...topology.connections[0], id: 'critical-link', name: 'Critical link', siteId: 'critical',
  })
  profile.intents.push({
    id: 'critical-required', source: { kind: 'spoke', id: 'source' }, target: { kind: 'site', id: 'critical' },
    sourcePrefix: '10.1.0.0/16', destinationPrefix: '10.4.0.0/16', expectation: 'allow',
  })
  const batched = run('ECMP/N-1: one step per budget', topology, profile, { maxCells: 1, maxProbes: 1, maxFindings: 1, maxFailureCases: 1 })
  const reference = run('ECMP/N-1: wide-batch reference', topology, profile, {})
  assert.equal(batched.complete, true)
  assert.ok(batched.failureCases > 0)
  assert.ok(batched.findings.some((finding) => finding.rule === 'failure'))
  assert.deepEqual({ ...batched, budget: reference.budget }, reference)
  const output = JSON.stringify({
    methodology: 'Node/Vite SSR. Memory is process heap sampled at batch boundaries, not a hard peak or browser-worker limit. Large cases assess a declared source-star scope, not the unrestricted mesh. Complete report parity asserted between batch sizes.',
    results,
  }, null, 2)
  if (process.argv[2]) writeFileSync(resolve(process.argv[2]), output)
  else console.log(output)
} finally {
  await server.close()
}
