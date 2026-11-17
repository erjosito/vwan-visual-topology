import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { executePlatform } from '../src/platform/service'
import { simulate } from '../src/routing'
import { simulateAzNet } from '../src/azure-net/engine'
import { validateTopology } from '../src/validation'
import { parseAzNetTopology } from '../src/azure-net/admission'
import { loadLanguage, translate } from '../src/messages'
import { PlatformJobs } from './jobs'
import type { PlatformRequest } from '../src/platform/contract'
import { engineVersion } from '../src/platform/contract'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const compiled = require('../platform-dist/service.cjs') as { executePlatform: typeof executePlatform }
function sample(file: string) { return JSON.parse(readFileSync(new URL(`../public/docs/samples/${file}`, import.meta.url), 'utf8')) }
export const request = (): PlatformRequest => ({
  contractVersion: 1, operation: 'simulate',
  document: { mode: 'vwan', topology: sample('hub-routing-preferences.json') },
})

describe('browser-free platform contract', () => {
  it('counts original NSG and Load Balancer entities against the existing platform node bound', () => {
    const owner = { kind: 'spoke', id: 'network' }
    const topology = { version: 1, name: 'Bounded services', hubs: [], sites: [], connections: [], siteLinks: [],
      spokes: [{ id: 'network', name: 'Network', prefixes: ['10.1.0.0/16'], subnets: [] }],
      inventory: { workloads: [], nics: [], publicIps: [],
        networkSecurityGroups: Array.from({ length: 256 }, (_, index) => ({ id: `nsg-${index}`, name: `NSG ${index}`, rules: [] })),
        loadBalancers: Array.from({ length: 255 }, (_, index) => ({ id: `lb-${index}`, name: `LB ${index}`, sku: 'Standard', owner,
          frontends: [], pools: [], probes: [], rules: [], inboundNatRules: [], outboundRules: [] })) } }
    const input = { contractVersion: 1, operation: 'validate', document: { mode: 'vwan', topology } }
    expect(executePlatform(input).status).toBe('complete')
    topology.inventory.loadBalancers.push({ ...topology.inventory.loadBalancers[0], id: 'one-too-many' })
    expect(executePlatform(input)).toMatchObject({ status: 'invalid', errors: [{ message: 'Topology node limit exceeded.' }] })
    expect(compiled.executePlatform(input)).toEqual(executePlatform(input))
  })
  it.each([
    ['vwan', 'hub-routing-preferences.json'],
    ['hub-spoke', 'azure-net/hub-spoke-firewall-udr.json'],
    ['full', 'azure-net/hybrid-vwan-and-hub-spoke.json'],
  ] as const)('preserves %s engine semantics and native JSON across compiled Node execution', (mode, file) => {
    const input = { contractVersion: 1, operation: 'simulate', document: { mode, topology: sample(file) } }
    const result = executePlatform(input)
    expect(result.errors).toEqual([])
    const expected = mode === 'vwan' ? simulate(validateTopology(input.document.topology)) : simulateAzNet(parseAzNetTopology(input.document.topology))
    expect(result.simulation).toEqual(expected)
    expect(compiled.executePlatform(input)).toEqual(result)
    expect(executePlatform({ ...input, document: JSON.parse(JSON.stringify(result.document)) }).document).toEqual(result.document)
    const inputs: string[] = JSON.parse(readFileSync(new URL('../platform-dist/service.inputs.json', import.meta.url), 'utf8'))
    expect(inputs.some((file) => /node_modules\/react|src\/i18n\.ts|worker/.test(file))).toBe(false)
  })

  it('does not leak locale state across clients or interpret placeholders inside user data', async () => {
    await loadLanguage('ja')
    expect(translate('ja', 'Shortest learned AS path ({0} ASNs).', 2)).not.toEqual(translate('en', 'Shortest learned AS path ({0} ASNs).', 2))
    expect(translate('en', '{0}', '{1}', 'private')).toBe('{1}')
    expect(executePlatform({ ...request(), locale: 'ja' }).simulation).toEqual(executePlatform({ ...request(), locale: 'en' }).simulation)
  })

  it('keeps owned mixed route goals identical in source, compiled Node and isolated worker execution', async () => {
    const topology = sample('azure-net/hybrid-vwan-and-hub-spoke.json')
    const hub = topology.vwanHubs[0]
    const vnet = topology.vnets.find((vnet: { vwanHubAttachment?: { hubId: string } }) => vnet.vwanHubAttachment?.hubId === hub.id)
    const input: PlatformRequest = {
      contractVersion: 1, engineVersion, operation: 'evaluate', document: { mode: 'full', topology },
      requirements: [
        { id: 'hub', kind: 'route', table: hub.id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
        { id: 'unsupported', kind: 'route', table: hub.id, hubTableId: 'custom', prefix: vnet.prefixes[0], expectation: 'absent' },
        { id: 'mismatch', kind: 'route', table: vnet.subnets[0].id, hubTableId: 'defaultRouteTable', prefix: vnet.prefixes[0], expectation: 'present' },
      ],
    }
    const result = executePlatform(input)
    expect(result.assessments.map((goal) => goal.outcome)).toEqual(['satisfied', 'not assessed', 'not assessed'])
    expect(result.document).toEqual(input.document)
    expect(compiled.executePlatform(input)).toEqual(result)
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try { expect(await jobs.run(input)).toEqual(result) }
    finally { jobs.close() }
  })

  it('rejects malformed versions, duplicate/missing requirements, unsafe JSON and input limits', () => {
    for (const input of [
      { ...request(), contractVersion: 3 }, { ...request(), operation: 'evaluate' },
      { ...request(), engineVersion: '' }, { ...request(), locale: '' }, { ...request(), budget: 0 },
      { ...request(), budget: { maxMillis: 15001 } },
      JSON.parse('{"__proto__":{}}'),
      { ...request(), document: { mode: 'vwan', topology: { version: 2 } } },
      { ...request(), padding: 'x'.repeat(4_000_001) },
    ]) expect(executePlatform(input).status).toBe('invalid')
  })
  it('keeps named workload packet evidence identical in source, compiled Node and isolated workers', async () => {
    const topology = parseAzNetTopology(sample('azure-net/hub-spoke-firewall-udr.json'))
    const vnet = topology.vnets.find((vnet) => vnet.role === 'spoke-vnet' || vnet.role === 'spoke')!
    const subnet = vnet.subnets[0]
    const prefix = subnet.prefix.split('/')[0].split('.').slice(0, 3).join('.')
    topology.inventory = {
      workloads: [{ id: 'vm', name: 'VM', nicIds: ['nic'] }],
      nics: [{ id: 'nic', name: 'NIC', owner: { kind: 'vnet', id: vnet.id }, ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: subnet.id, privateIp: `${prefix}.4` }] }],
      publicIps: [],
    }
    const input: PlatformRequest = {
      contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology },
      packet: { source: { kind: 'workload', workloadId: 'vm', nicId: 'nic', ipConfigurationId: 'ip' },
        target: { kind: 'external', address: '20.50.60.70' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 },
    }
    const result = executePlatform(input)
    expect(result.status).toBe('complete')
    expect(result.packet?.reply.routing).toBe('not-assessed')
    expect(compiled.executePlatform(input)).toEqual(result)
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try { expect(await jobs.run(input)).toEqual(result) } finally { jobs.close() }
  })

  it('counts explicit inventory identities against the platform node budget', () => {
    const topology = parseAzNetTopology(sample('azure-net/hub-spoke-firewall-udr.json'))
    topology.inventory = { workloads: [], nics: [], publicIps: Array.from({ length: 512 }, (_, index) => ({ id: `pip-${index}`, name: `IP ${index}` })) }
    expect(executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology } })).toMatchObject({
      status: 'invalid', errors: [{ code: 'INVALID_REQUEST_OR_TOPOLOGY', message: 'Topology node limit exceeded.' }],
    })
  })

  it('rejects array accessors without evaluating user code', () => {
    let accessed = false
    const input = request()
    if (input.document.mode !== 'vwan') throw new Error('Expected VWAN fixture')
    Object.defineProperty(input.document.topology.hubs, '0', { enumerable: true, get() { accessed = true; return {} } })
    expect(executePlatform(input).status).toBe('invalid')
    expect(accessed).toBe(false)
  })

  it('isolates jobs, cancels only the requested job and withholds oversized/timed-out results', async () => {
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try {
      const cancelled = jobs.start(request())
      jobs.cancel(cancelled)
      expect(jobs.get(cancelled).result?.status).toBe('not assessed')
      const complete = await jobs.run(request())
      expect(complete.simulation).toEqual(executePlatform(request()).simulation)
      expect((await jobs.run({ ...request(), budget: { maxOutputBytes: 100 } })).errors[0].code).toBe('OUTPUT_LIMIT')
      expect((await jobs.run({ ...request(), budget: { maxMillis: 1 } })).errors[0].code).toBe('TIME_LIMIT')
    } finally { jobs.close() }
  })

  it('rejects concurrent overload rather than spawning extra workers', () => {
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try {
      jobs.start(request())
      jobs.start(request())
      expect(() => jobs.start(request())).toThrow('capacity')
    } finally { jobs.close() }
  })
})
