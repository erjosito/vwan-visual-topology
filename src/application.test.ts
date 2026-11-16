import { describe, expect, it, vi } from 'vitest'
import { aggregateApplicationDecisions, applicationProjection, evaluateApplication, normalizeApplicationHost, normalizeApplicationPath, validateApplicationInventory, validateApplicationRequest } from './application'
import { applicationFixture, applicationPlatformRequest, dnsRequest, httpRequest } from '../tests/fixtures/application'
import { validateTopology } from './validation'
import { parseAzNetTopology } from './azure-net/admission'
import { executePlatform, validateRequest } from './platform/service'
import { capabilities } from './platform/contract'
import { simulate } from './routing'
import { simulateAzNet } from './azure-net/engine'

describe('optional application inventory admission', () => {
  it.each(['vwan', 'hub-spoke', 'full'] as const)('round trips original %s identities without changing native simulation or legacy saves', (mode) => {
    const topology = applicationFixture(mode), original = structuredClone(topology)
    const parsed = topology.version === 1 ? validateTopology(topology) : parseAzNetTopology(topology)
    expect(parsed.application).toEqual(topology.application)
    const legacy = structuredClone(topology)
    delete legacy.application
    const native = (value: typeof topology) => value.version === 1 ? simulate(value) : simulateAzNet(value)
    expect(native(parsed)).toEqual(native(legacy))
    const legacyParsed = legacy.version === 1 ? validateTopology(legacy) : parseAzNetTopology(legacy)
    expect(Object.hasOwn(legacyParsed, 'application')).toBe(false)
    expect(executePlatform({ contractVersion: 1, operation: 'validate', document: { mode, topology: legacy } }).status).toBe('complete')
    expect(topology).toEqual(original)
    const exported = JSON.parse(JSON.stringify(parsed))
    expect((exported.version === 1 ? validateTopology(exported) : parseAzNetTopology(exported)).application).toEqual(original.application)
  })

  it.each([
    ['future inventory version', (topology: ReturnType<typeof applicationFixture>) => { Object.assign(topology.application!, { version: 2 }) }],
    ['unknown root property', (topology: ReturnType<typeof applicationFixture>) => { Object.assign(topology.application!, { ignored: true }) }],
    ['provider settings before provider implementation', (topology: ReturnType<typeof applicationFixture>) => { Object.assign(topology.application!.services[0], { listeners: [] }) }],
    ['duplicate service/profile IDs', (topology: ReturnType<typeof applicationFixture>) => { topology.application!.dnsProfiles[0].id = 'original-gateway' }],
    ['missing workload reference', (topology: ReturnType<typeof applicationFixture>) => { topology.application!.services[0].references.push({ kind: 'workload', workloadId: 'missing', nicId: 'original-nic', ipConfigurationId: 'original-ip' }) }],
    ['missing subnet owner', (topology: ReturnType<typeof applicationFixture>) => { topology.application!.services[0].references.push({ kind: 'subnet', owner: { kind: 'vnet', id: 'missing' }, id: 'original-subnet' }) }],
    ['missing service owner', (topology: ReturnType<typeof applicationFixture>) => { topology.application!.services[0].owner = { kind: 'vnet', id: 'missing' } }],
    ['oversized services', (topology: ReturnType<typeof applicationFixture>) => {
      topology.application!.services = Array.from({ length: 33 }, (_, index) => ({ ...topology.application!.services[0], id: `service-${index}` }))
    }],
    ['oversized references', (topology: ReturnType<typeof applicationFixture>) => {
      topology.application!.services[0].references = Array.from({ length: 65 }, () => ({ kind: 'service', id: 'original-gateway' }))
    }],
    ['unbounded strings', (topology: ReturnType<typeof applicationFixture>) => { topology.application!.services[0].name = 'x'.repeat(121) }],
    ['unknown service kind', (topology: ReturnType<typeof applicationFixture>) => { Object.assign(topology.application!.services[0], { kind: 'arbitrary-provider' }) }],
    ['unknown reference field', (topology: ReturnType<typeof applicationFixture>) => { Object.assign(topology.application!.services[0].references[0], { extra: 'silently ignored' }) }],
  ])('rejects %s explicitly', (_label, mutate) => {
    const topology = applicationFixture()
    mutate(topology)
    expect(() => validateApplicationInventory(topology)).toThrow('Application:')
    expect(() => parseAzNetTopology(topology)).toThrow('Application:')
  })

  it('keeps reference types scoped to the original public IP and LB frontend/pool owners', () => {
    const topology = applicationFixture()
    const owner = { kind: 'vnet' as const, id: 'original-network' }
    topology.inventory!.publicIps.push({ id: 'pip', name: 'Frontend' })
    topology.inventory!.loadBalancers = [{ id: 'lb', name: 'Original LB', sku: 'Standard', owner,
      frontends: [{ id: 'frontend', name: 'Public', kind: 'public', publicIpId: 'pip' }], pools: [{ id: 'pool', name: 'Original pool', members: [] }],
      probes: [], rules: [], inboundNatRules: [], outboundRules: [] }]
    topology.application!.services[0].references.push({ kind: 'public-ip', id: 'pip' },
      { kind: 'load-balancer-frontend', loadBalancerId: 'lb', id: 'frontend' }, { kind: 'load-balancer-pool', loadBalancerId: 'lb', id: 'pool' })
    expect(() => validateApplicationInventory(topology)).not.toThrow()
    topology.application!.services[0].references.push({ kind: 'load-balancer-frontend', loadBalancerId: 'another-lb', id: 'frontend' })
    expect(() => validateApplicationInventory(topology)).toThrow('reference')
  })
  it('retains independently owned backend references without asserting cross-network reachability', () => {
    const topology = applicationFixture()
    if (topology.version !== 2) throw new Error('Azure topology required')
    topology.vnets.push({ ...structuredClone(topology.vnets[0]), id: 'other-network', prefixes: ['10.2.0.0/16'], subnets: [] })
    topology.application!.services[0].owner = { kind: 'vnet', id: 'other-network' }
    expect(() => validateApplicationInventory(topology)).not.toThrow()
    const result = evaluateApplication(topology, httpRequest())
    expect(result.configuration).toBe('not-assessed')
    expect([...applicationProjection(topology, { kind: 'vnet', id: 'original-network' }, result).workloadIds]).toEqual(['original-vm'])
    expect(applicationProjection(topology, { kind: 'vnet', id: 'other-network' }, result).workloadIds.size).toBe(0)
  })
  it('includes application entities in the existing aggregate node bound', () => {
    const input = applicationPlatformRequest()
    input.operation = 'validate'
    delete input.application
    input.document.topology.inventory!.networkSecurityGroups = Array.from({ length: 507 }, (_, index) => ({ id: `nsg-${index}`, name: `NSG ${index}`, rules: [] }))
    expect(executePlatform(input).status).toBe('complete')
    input.document.topology.application!.dnsProfiles.push({ ...input.document.topology.application!.dnsProfiles[0], id: 'over-budget' })
    expect(executePlatform(input)).toMatchObject({ status: 'invalid', errors: [{ message: 'Topology node limit exceeded.' }] })
  })
})

describe('application negotiation and safe requests', () => {
  it('requires explicit v2 negotiation and advertises no providers', () => {
    const input = applicationPlatformRequest()
    expect(capabilities).toMatchObject({ contractVersion: 2, supportedContractVersions: [1, 2], application: { providers: [], minimumContractVersion: 2 } })
    expect(() => validateRequest({ ...input, contractVersion: 1 })).toThrow('contractVersion 2')
    expect(() => validateRequest({ ...input, contractVersion: 3 })).toThrow('version')
    const legacyEnvelope = { ...input, contractVersion: 1, operation: 'validate' }
    delete legacyEnvelope.application
    expect(() => validateRequest(legacyEnvelope)).toThrow('contractVersion 2')
    expect(() => validateRequest({ ...input, operation: 'simulate' })).toThrow('application operation')
    expect(() => validateRequest({ ...input, requirements: [] })).toThrow('separate')
    expect(() => validateApplicationRequest({ ...httpRequest(), version: 2 })).toThrow('version')
    expect(() => validateApplicationRequest({ ...httpRequest(), headers: { 'X-Forwarded-For': '10.1.1.4' } })).toThrow('field')
  })
  it('normalizes only explicit safe hostname and absolute-path syntax without URL resolution', () => {
    expect(normalizeApplicationHost('APP.Example.test.')).toBe('app.example.test')
    expect(normalizeApplicationPath('/catalog/%aa')).toBe('/catalog/%AA')
    for (const host of ['https://app.test/', 'a.test:443', '*.test', '127.0.0.1', 'a..test', 'a_test', 'x'.repeat(64) + '.test', 'a.test/']) expect(() => normalizeApplicationHost(host)).toThrow()
    for (const path of ['relative', '//remote.test/', '/a?query=secret', '/a#fragment', '/a\\b', '/a/../b', '/a/%2e%2e/b', '/a%2fb', '/%252e/', '/%', '/%00', '/a b']) expect(() => normalizeApplicationPath(path)).toThrow()
    for (const override of [{ port: 0 }, { scheme: 'ftp' }, { client: { kind: 'external', address: '10.0.0.1' } }, { client: { kind: 'workload', workloadId: 'only-one-id' } }]) expect(() => validateApplicationRequest({ ...httpRequest(), ...override })).toThrow()
    for (const override of [{ cache: 'cached' }, { evaluatedAt: 'now' }, { evaluatedAt: '2026-02-31T00:00:00.000Z' }, { evaluatedAt: '2026-11-16' }]) expect(() => validateApplicationRequest({ ...dnsRequest(), ...override })).toThrow()
  })
})

describe('separate bounded offline evidence', () => {
  it('keeps all HTTP stages and unknown prerequisites unassessed without inventing packets or TLS availability', () => {
    const topology = applicationFixture(), result = evaluateApplication(topology, httpRequest())
    expect(result.configuration).toBe('not-assessed')
    expect(result.availability).toBe('not-assessed')
    expect(result.decisions.map((entry) => entry.kind)).toEqual(['listener-match', 'request-route', 'network-leg', 'network-leg', 'response-assumption'])
    expect(result.decisions.every((entry) => entry.outcome === 'not-assessed' && entry.provenance === 'unsupported-provider')).toBe(true)
    expect(result.uncertainties).toHaveLength(5)
    expect(result.decisions.filter((entry) => entry.kind === 'network-leg').map((entry) => entry.evidence)).toEqual([
      { leg: 'client-to-proxy', source: httpRequest().client, target: { kind: 'service', id: 'original-gateway' }, before: null, after: null, packetEvidence: null },
      { leg: 'proxy-to-backend', source: { kind: 'service', id: 'original-gateway' }, target: null, before: null, after: null, packetEvidence: null },
    ])
    const projection = applicationProjection(topology, { kind: 'vnet', id: 'original-network' }, result)
    expect([...projection.subnetIds]).toEqual(['original-subnet'])
    expect([...projection.workloadIds]).toEqual(['original-vm'])
    expect(applicationProjection(topology, { kind: 'vnet', id: 'other' }, result).subnetIds.size).toBe(0)
    topology.inventory!.workloads = []
    topology.application!.services[0].references = []
    expect(applicationProjection(topology, { kind: 'vnet', id: 'original-network' }, result).workloadIds.size).toBe(0)
  })
  it('aggregates unknown prerequisites conservatively while preserving independent definite failures', () => {
    const decision = evaluateApplication(applicationFixture(), httpRequest()).decisions[0]
    expect(aggregateApplicationDecisions('http', [])).toBe('not-assessed')
    expect(aggregateApplicationDecisions('http', [{ ...decision, outcome: 'satisfied' }, decision])).toBe('not-assessed')
    expect(aggregateApplicationDecisions('http', [decision, { ...decision, outcome: 'violated' }])).toBe('violated')
    expect(aggregateApplicationDecisions('http', [{ ...decision, outcome: 'satisfied' }])).toBe('not-assessed')
    const complete = evaluateApplication(applicationFixture(), httpRequest()).decisions.map((entry) => ({ ...entry, outcome: 'satisfied' as const }))
    expect(aggregateApplicationDecisions('http', complete)).toBe('not-assessed')
    expect(aggregateApplicationDecisions('dns', complete)).toBe('not-assessed')
    const dns = evaluateApplication(applicationFixture(), dnsRequest()).decisions[0]
    if (dns.kind !== 'dns-selection') throw new Error('DNS decision required')
    const known = { ...dns, outcome: 'satisfied' as const, evidence: { ...dns.evidence, method: 'Priority', ttl: 30,
      candidates: [{ endpointId: 'original-endpoint', name: 'origin.example.test', enabled: true as const, health: 'healthy' as const }] } }
    expect(aggregateApplicationDecisions('dns', [known])).toBe('satisfied')
    expect(aggregateApplicationDecisions('dns', [{ ...known, evidence: { ...known.evidence, candidates: [{ ...known.evidence.candidates[0], health: 'unknown' }] } }])).toBe('not-assessed')
  })
  it('never invokes fetch or folds DNS selection into an HTTP hop; missing references fail admission', () => {
    const fetch = vi.fn(() => { throw new Error('network forbidden') })
    vi.stubGlobal('fetch', fetch)
    try {
      const input = applicationPlatformRequest('full', 'dns'), result = executePlatform(input)
      expect(result.status).toBe('not assessed')
      expect(result.simulation).toBeUndefined()
      expect(result.packet).toBeUndefined()
      expect(result.application?.decisions).toMatchObject([{ kind: 'dns-selection', outcome: 'not-assessed', evidence: { method: null, candidates: [], ttl: null, cache: 'fresh' } }])
      expect(fetch).not.toHaveBeenCalled()
      input.application = { ...httpRequest(), serviceId: 'missing' }
      expect(executePlatform(input)).toMatchObject({ status: 'invalid', errors: [{ code: 'INVALID_REQUEST_OR_TOPOLOGY' }] })
      input.application = { ...httpRequest(), client: { kind: 'workload', workloadId: 'missing', nicId: 'original-nic', ipConfigurationId: 'original-ip' } }
      expect(executePlatform(input).status).toBe('invalid')
    } finally { vi.unstubAllGlobals() }
  })
})
