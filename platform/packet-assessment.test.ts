import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { createEmptyAzNetTopology } from '../src/azure-net/model'
import { executePlatform } from '../src/platform/service'
import type { PacketRequirement, PlatformRequest } from '../src/platform/contract'
import { PlatformJobs } from './jobs'

const compiled = createRequire(import.meta.url)('../platform-dist/service.cjs') as { executePlatform: typeof executePlatform }
function input(): PlatformRequest {
  const topology = createEmptyAzNetTopology(), owner = { kind: 'vnet' as const, id: 'network' }
  const backend = { workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' }
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24', defaultOutboundAccess: false },
      { id: 'front', name: 'Frontend', prefix: '10.1.2.0/24', defaultOutboundAccess: false }], gateways: [], appliances: [] }]
  topology.inventory = { publicIps: [], workloads: [{ id: 'server', name: 'Server', nicIds: ['server-nic'] }, { id: 'client', name: 'Client', nicIds: ['client-nic'] }],
    nics: [{ id: 'server-nic', name: 'Server NIC', owner, ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4', primary: true }] },
      { id: 'client-nic', name: 'Client NIC', owner, ipConfigurations: [{ id: 'client-ip', name: 'Primary', subnetId: 'front', privateIp: '10.1.2.5', primary: true }] }],
    networkSecurityGroups: [{ id: 'nsg', name: 'Backend NSG', rules: [] }],
    nsgAssociations: [{ owner, target: { kind: 'nic', id: 'server-nic' }, nsgId: 'nsg' }],
    loadBalancers: [{ id: 'lb', name: 'Internal LB', sku: 'Standard', owner,
      frontends: [{ id: 'frontend', name: 'Frontend', kind: 'private', subnetId: 'front', privateIp: '10.1.2.10' }],
      pools: [{ id: 'pool', name: 'Servers', members: [backend] }],
      probes: [{ id: 'probe', name: 'Probe', protocol: 'tcp', port: 8080, health: [] }],
      rules: [{ id: 'rule', name: 'Web', frontendId: 'frontend', poolId: 'pool', probeId: 'probe', protocol: 'tcp', frontendPort: 443, backendPort: 8443 }],
      inboundNatRules: [], outboundRules: [] }] }
  return { contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: [{
    id: 'configured-service', kind: 'packet', sourceAddress: '10.1.2.5', destinationAddress: '10.1.2.10', expectation: 'configured',
    requiredBackend: { ...backend, address: '10.1.1.4' },
    packet: { source: { kind: 'workload', workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' },
      target: { kind: 'load-balancer', loadBalancerId: 'lb', frontendId: 'frontend' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 },
  }] }
}
const topology = (request: PlatformRequest) => {
  if (request.document.mode === 'vwan') throw new Error('Wrong fixture')
  return request.document.topology
}
const goal = (request: PlatformRequest) => request.requirements![0] as PacketRequirement
const outcome = (request: PlatformRequest) => executePlatform(request).assessments[0]?.outcome
const healthy = (request: PlatformRequest) => {
  const lb = topology(request).inventory!.loadBalancers![0]
  lb.probes[0].health = [{ target: lb.pools[0].members[0], status: 'healthy' }]
}

describe('bounded original packet configuration rubrics', () => {
  it('never grades unknown health as a configured service or verified isolation, then checks independent probe denial', () => {
    const request = input()
    expect(outcome(request)).toBe('not assessed')
    goal(request).expectation = 'blocked'
    expect(outcome(request)).toBe('not assessed')
    healthy(request); goal(request).expectation = 'configured'
    expect(outcome(request)).toBe('satisfied')
    topology(request).inventory!.networkSecurityGroups![0].rules.push({ id: 'deny-probe', name: 'DenyProbe', priority: 100,
      direction: 'inbound', action: 'deny', protocol: 'tcp', sources: ['AzureLoadBalancer'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['8080'] })
    expect(outcome(request)).toBe('violated')
    goal(request).expectation = 'blocked'
    expect(outcome(request)).toBe('satisfied')
  })

  it('pins original endpoint/backend addresses and distinguishes a return black hole from a blocked initiation', () => {
    const request = input(); healthy(request)
    topology(request).inventory!.nics[0].ipConfigurations[0].privateIp = '10.1.1.6'
    expect(outcome(request)).toBe('not assessed')
    topology(request).inventory!.nics[0].ipConfigurations[0].privateIp = '10.1.1.4'
    topology(request).vnets[0].subnets[0].routeTableId = 'drop'
    topology(request).udrTables.push({ id: 'drop', name: 'Drop response', disableBgpRoutePropagation: false,
      routes: [{ id: 'client', name: 'Client', prefix: '10.1.2.5/32', nextHopType: 'None', enabled: true }] })
    expect(outcome(request)).toBe('violated')
    goal(request).expectation = 'blocked'
    expect(outcome(request)).toBe('violated')
    goal(request).sourceAddress = '10.1.2.6'
    expect(outcome(request)).toBe('not assessed')
  })

  it('requires explicit supported egress and preserves unknown allocation instead of awarding an outbound pass', () => {
    const request = input(), requirement = goal(request)
    delete requirement.requiredBackend
    requirement.packet.target = { kind: 'external', address: '8.8.8.8' }; requirement.destinationAddress = '8.8.8.8'
    expect(outcome(request)).toBe('violated')
    const inventory = topology(request).inventory!
    inventory.publicIps.push({ id: 'public', name: 'NAT public', sku: 'Standard', allocation: 'Static' })
    inventory.natGateways = [{ id: 'nat', name: 'NAT Gateway', sku: 'Standard', owner: { kind: 'vnet', id: 'network' }, subnetIds: ['front'], publicIpIds: ['public'] }]
    expect(outcome(request)).toBe('not assessed')
    inventory.publicIps[0].address = '20.40.50.60'
    expect(outcome(request)).toBe('satisfied')
    expect(executePlatform(request).assessments[0].reasons.join(' ')).toContain('not observed connectivity')
  })

  it('rejects unsupported readiness fields and keeps configuration evidence identical in source, Node and isolated jobs', async () => {
    const request = input(); healthy(request)
    const result = executePlatform(request)
    expect(result.errors).toEqual([])
    expect(compiled.executePlatform(request)).toEqual(result)
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try { expect(await jobs.run(request)).toEqual(result) } finally { jobs.close() }
    expect(executePlatform({ ...request, requirements: [{ ...goal(request), certifyListener: true }] }).status).toBe('invalid')
  })

  it('keeps incomplete captured service scope unassessed in source, Node and isolated jobs', async () => {
    const request = input(); healthy(request)
    topology(request).inventory!.capture = { version: 1, configurationComplete: false, resourceIds: {} }
    request.requirements!.push({ ...goal(request), id: 'missing-capture-is-not-isolation', expectation: 'blocked' })
    const result = executePlatform(request)
    expect(result.errors).toEqual([])
    expect(result.assessments.map((assessment) => assessment.outcome)).toEqual(['not assessed', 'not assessed'])
    expect(compiled.executePlatform(request)).toEqual(result)
    const jobs = new PlatformJobs(resolve('platform-dist', 'worker.cjs'))
    try { expect(await jobs.run(request)).toEqual(result) } finally { jobs.close() }
  })
})
