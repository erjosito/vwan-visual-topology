import { describe, expect, it } from 'vitest'
import { createEmptyAzNetTopology } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { pruneDeletedInventory, validateInventory, type NetworkSecurityRule } from './inventory'
import { assessEndpointNsg, assessNsg, completePacketNsg, type NsgContext } from './packet-security'
import { tracePacket, type FiveTuple, type PacketRequest } from './packet-flow'
import { simulateAzNet } from './azure-net/engine'

const owner = { kind: 'vnet' as const, id: 'network' }
const tuple: FiveTuple = { sourceAddress: '8.8.8.8', destinationAddress: '10.1.1.4', sourcePort: 49152, destinationPort: 443, protocol: 'tcp' }
const context: NsgContext = { virtualNetworkPrefixes: ['10.1.0.0/16'], virtualNetworkComplete: true }
function rule(edit: Partial<NetworkSecurityRule> = {}): NetworkSecurityRule {
  return { id: 'allow-web', name: 'AllowWeb', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
    sources: ['*'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['443'], ...edit }
}
function network() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24' }], gateways: [], appliances: [] }]
  topology.inventory = { workloads: [{ id: 'client', name: 'Client', nicIds: ['nic'] }],
    nics: [{ id: 'nic', name: 'NIC', owner, ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] }],
    publicIps: [], networkSecurityGroups: [{ id: 'subnet-nsg', name: 'Subnet NSG', rules: [rule()] }, { id: 'nic-nsg', name: 'NIC NSG', rules: [] }],
    nsgAssociations: [{ owner, target: { kind: 'subnet', id: 'app' }, nsgId: 'subnet-nsg' }, { owner, target: { kind: 'nic', id: 'nic' }, nsgId: 'nic-nsg' }] }
  return topology
}

describe('scoped NSG new-flow enforcement', () => {
  it('intersects subnet and NIC permission at their ordered original enforcement points', () => {
    const topology = parseAzNetTopology(network())
    const blocked = assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context)
    expect(blocked).toMatchObject({ outcome: 'denied', checks: [
      { target: { kind: 'subnet', id: 'app' }, outcome: 'allowed', ruleId: 'allow-web', tuple },
      { target: { kind: 'nic', id: 'nic' }, outcome: 'denied', ruleId: 'DenyAllInbound' },
    ] })
    topology.inventory!.networkSecurityGroups![1].rules.push(rule())
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context).outcome).toBe('allowed')
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'outbound', { ...tuple, sourceAddress: '10.1.1.4', destinationAddress: '8.8.8.8' }, context))
      .toMatchObject({ outcome: 'allowed', checks: [{ target: { kind: 'nic' } }, { target: { kind: 'subnet' } }] })
  })

  it('uses first priority, direction and augmented port matching rather than a later allow', () => {
    const rules = [rule({ id: 'later', name: 'Later', priority: 200 }), rule({ action: 'deny', destinationPorts: ['80-100', '440-450'] })]
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules }, 'inbound', tuple, context)).toMatchObject({ outcome: 'denied', priority: 100 })
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules }, 'outbound',
      { ...tuple, sourceAddress: '10.1.1.4', destinationAddress: '8.8.8.8' }, context).outcome).toBe('allowed')
  })

  it('does not generalize Standard public ingress absence to internal or outbound flows', () => {
    const topology = network()
    delete topology.inventory!.nsgAssociations
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context).outcome).toBe('allowed')
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, { ...context, standardPublicIngress: true }).outcome).toBe('denied')
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'outbound', tuple, context).outcome).toBe('allowed')
    expect(assessNsg({ id: 'nsg', name: 'Default-only', rules: [] }, 'inbound', tuple, context).outcome).toBe('denied')
  })

  it('resolves VirtualNetwork from its scoped prefix set, not RFC1918, and preserves incomplete scope', () => {
    const group = { id: 'nsg', name: 'NSG', rules: [] }
    expect(assessNsg(group, 'inbound', { ...tuple, sourceAddress: '10.1.2.4' }, context).outcome).toBe('allowed')
    expect(assessNsg(group, 'inbound', { ...tuple, sourceAddress: '10.90.2.4' }, context).outcome).toBe('denied')
    expect(assessNsg(group, 'inbound', tuple, { ...context, virtualNetworkPrefixes: ['0.0.0.0/0'] }).outcome).toBe('allowed')
    expect(assessNsg(group, 'inbound', tuple, { ...context, virtualNetworkComplete: false }).outcome).toBe('not-assessed')
  })

  it('does not allow public clients because an AzureLoadBalancer probe rule allows probes', () => {
    const group = { id: 'nsg', name: 'NSG', rules: [rule({ sources: ['AzureLoadBalancer'] })] }
    expect(assessNsg(group, 'inbound', tuple, context).outcome).toBe('denied')
    expect(assessNsg(group, 'inbound', { ...tuple, sourceAddress: '168.63.129.16' }, { ...context, purpose: 'health-probe' }))
      .toMatchObject({ outcome: 'allowed', ruleId: 'allow-web' })
  })

  it('does not classify routed public VNet prefixes as the Internet service tag', () => {
    const group = { id: 'nsg', name: 'NSG', rules: [rule({ sources: ['Internet'] })] }
    expect(assessNsg(group, 'inbound', tuple, context).outcome).toBe('allowed')
    expect(assessNsg(group, 'inbound', tuple, { ...context, virtualNetworkPrefixes: ['10.1.0.0/16', '8.8.8.0/24'] }).ruleId).toBe('AllowVNetInBound')
    expect(assessNsg(group, 'inbound', tuple, { ...context, virtualNetworkComplete: false }).outcome).toBe('not-assessed')
  })

  it('never treats unknown capture, dynamic tags, ASGs or unsupported protocol as wildcard permission', () => {
    for (const change of [
      { sources: ['Storage.WestEurope'] }, { sources: ['asg:original-group'] }, { protocol: 'icmp' as const },
    ]) {
      expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule(change)] }, 'inbound', tuple, context).outcome).toBe('not-assessed')
    }
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule()], rulesStatus: 'unknown' }, 'inbound', tuple, context).outcome).toBe('not-assessed')
    const topology = network()
    topology.inventory!.nsgAssociations![1].status = 'unknown'
    expect(assessEndpointNsg(topology, owner, 'nic', 'app', 'inbound', tuple, context).outcome).toBe('not-assessed')
  })

  it('does not compare illustrative private SNAT addresses/ports as exact values', () => {
    const translated = { ...tuple, sourceAddress: '10.1.2.4', sourcePort: 12345 }
    const uncertain: NsgContext = { ...context, uncertainty: { sourceAddressPrefixes: ['10.1.2.0/24'], sourcePorts: [0, 65535] } }
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule({ sources: ['10.1.2.4'], sourcePorts: ['12345'] })] },
      'inbound', translated, uncertain).outcome).toBe('not-assessed')
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule({ sources: ['10.1.2.0/24'] })] }, 'inbound', translated, uncertain).outcome).toBe('allowed')
    expect(assessNsg({ id: 'nsg', name: 'NSG', rules: [rule({ sources: ['192.0.2.0/24'] })] }, 'inbound', translated, uncertain).ruleId).toBe('AllowVNetInBound')
  })

  it('rejects malformed/duplicate rules and associations while preserving supported original serialization', () => {
    const topology = network(), raw = JSON.stringify(topology)
    expect(JSON.stringify(parseAzNetTopology(topology))).toBe(raw)
    for (const mutate of [
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules.push(rule({ id: 'other', name: 'Other' })) },
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules[0].destinationPorts = ['65535-65536'] },
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules[0].sources = ['10.999.0.0/24'] },
      (topology: ReturnType<typeof network>) => { topology.inventory!.nsgAssociations![0].target.id = 'missing' },
      (topology: ReturnType<typeof network>) => { topology.inventory!.nsgAssociations!.push(structuredClone(topology.inventory!.nsgAssociations![0])) },
      (topology: ReturnType<typeof network>) => { topology.vnets[0].subnets[0].name = 'GatewaySubnet' },
      (topology: ReturnType<typeof network>) => { topology.vnets[0].subnets[0].name = 'AzureFirewallSubnet' },
    ]) {
      const next = network(); mutate(next)
      expect(() => validateInventory(next)).toThrow(/Inventory:/)
    }
    const next = structuredClone(topology)
    next.inventory!.nics = []
    pruneDeletedInventory(next, topology)
    expect(next.inventory!.nsgAssociations!.map((binding) => binding.target.kind)).toEqual(['subnet'])
    expect(next.inventory!.networkSecurityGroups).toHaveLength(2)
  })

  it('preserves effective routes when source NSG denial prevents outbound translation', () => {
    const topology = network()
    topology.inventory!.networkSecurityGroups![1].rules = [rule({ direction: 'outbound', action: 'deny', destinations: ['*'] })]
    topology.inventory!.publicIps = [{ id: 'pip', name: 'Public IP', sku: 'Standard', allocation: 'Static', address: '20.40.50.60' }]
    topology.inventory!.nics[0].ipConfigurations[0].publicIpId = 'pip'
    const simulation = simulateAzNet(topology), raw = JSON.stringify(simulation)
    const result = tracePacket(topology, { source: { kind: 'workload', workloadId: 'client', nicId: 'nic', ipConfigurationId: 'ip' },
      target: { kind: 'external', address: '8.8.8.8' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 }, simulation)
    expect(result).toMatchObject({ forward: { routing: 'reachable' }, security: 'denied', translation: 'not-assessed', nsg: { forward: { outcome: 'denied' } } })
    expect(result.forward.steps.at(-1)?.after).toBeNull()
    expect(result.reply.session).toBeUndefined()
    expect(JSON.stringify(simulation)).toBe(raw)
  })

  it('does not turn a default NSG outbound allow into an Internet method for a private subnet', () => {
    const topology = network()
    topology.vnets[0].subnets[0].defaultOutboundAccess = false
    const result = tracePacket(topology, { source: { kind: 'workload', workloadId: 'client', nicId: 'nic', ipConfigurationId: 'ip' },
      target: { kind: 'external', address: '8.8.8.8' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 })
    expect(result).toMatchObject({ forward: { routing: 'unreachable' }, egress: 'blocked', nsg: { forward: { outcome: 'allowed' } } })
    expect(result.reply.session).toBeUndefined()
  })

  it('exempts a conditional response from reverse-initiation rules but reassesses every new request', () => {
    const topology = network()
    topology.inventory!.nsgAssociations = [{ owner, target: { kind: 'nic', id: 'nic' }, nsgId: 'nic-nsg' }]
    topology.inventory!.networkSecurityGroups![1].rules = [rule({ action: 'deny', destinations: ['*'], destinationPorts: ['*'] })]
    topology.inventory!.workloads.push({ id: 'server', name: 'Server', nicIds: ['server-nic'] })
    topology.inventory!.nics.push({ id: 'server-nic', name: 'Server NIC', owner,
      ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.5' }] })
    const request: PacketRequest = { source: { kind: 'workload', workloadId: 'client', nicId: 'nic', ipConfigurationId: 'ip' },
      target: { kind: 'workload', workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' },
      protocol: 'tcp', sourcePort: 49152, destinationPort: 443 }
    const response = tracePacket(topology, request)
    expect(response).toMatchObject({ nsg: { forward: { outcome: 'allowed' }, reply: { outcome: 'allowed', conditionalResponse: true } },
      reply: { session: 'conditional-response' } })
    expect(tracePacket(topology, { ...request, source: request.target, target: request.source,
      sourcePort: request.destinationPort, destinationPort: request.sourcePort }).security).toBe('denied')
    topology.inventory!.networkSecurityGroups![1].rules.push(rule({ id: 'drop-new', name: 'DropNew', direction: 'outbound', action: 'deny', destinations: ['*'] }))
    expect(tracePacket(topology, request).security).toBe('denied')
  })

  it('does not invent exact stateful response checks beyond an unknown return translation boundary', () => {
    const topology = network()
    topology.inventory!.nsgAssociations = []
    topology.inventory!.workloads.push({ id: 'server', name: 'Server', nicIds: ['server-nic'] })
    topology.inventory!.nics.push({ id: 'server-nic', name: 'Server NIC', owner,
      ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.5' }] })
    const simulation = simulateAzNet(topology)
    const result = tracePacket(topology, { source: { kind: 'workload', workloadId: 'client', nicId: 'nic', ipConfigurationId: 'ip' },
      target: { kind: 'workload', workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' },
      protocol: 'tcp', sourcePort: 49152, destinationPort: 443 }, simulation)
    result.reply.steps.push({ entity: { kind: 'appliance', id: 'unknown-return-router' }, before: result.reply.tuple!, after: null,
      evidence: 'Return translation is unknown.' })
    const nsg = completePacketNsg(topology, result.target, result.forward, result.reply,
      { outcome: 'allowed', checks: result.nsg!.forward.checks.filter((check) => check.direction === 'outbound') }, simulation, 'snat')
    expect(nsg).toMatchObject({ forward: { outcome: 'allowed' }, reply: { outcome: 'not-assessed', checks: [] } })
    expect(nsg.reply.conditionalResponse).toBeUndefined()
  })

  it('enforces original NVA subnet/NIC filtering before and after private guest SNAT, stopping evidence at a deny', () => {
    const topology = network()
    topology.vnets[0].subnets.push({ id: 'router-subnet', name: 'Router', prefix: '10.1.2.0/24' })
    topology.vnets[0].subnets.push({ id: 'server-subnet', name: 'Server', prefix: '10.1.3.0/24' })
    topology.vnets[0].appliances = [{ id: 'router', name: 'NVA', kind: 'nva-vm', subnetId: 'router-subnet', privateIp: '10.1.2.4',
      enableIpForwarding: true, staticRoutes: [] }]
    topology.vnets[0].subnets[0].routeTableId = 'steering'
    topology.udrTables = [{ id: 'steering', name: 'Steering', disableBgpRoutePropagation: false,
      routes: [{ id: 'server-route', name: 'Server', prefix: '10.1.3.0/24', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] }]
    topology.inventory!.routerSnatPolicies = [{ owner: { kind: 'appliance', id: 'router' }, kind: 'nva-snat',
      sourcePrefixes: ['10.1.1.0/24'], destinationPrefixes: ['10.1.3.0/24'], protocol: 'any', publicIpIds: [] }]
    topology.inventory!.workloads.push({ id: 'router-vm', name: 'Router VM', backingDeviceId: 'router', nicIds: ['router-nic'] },
      { id: 'server', name: 'Server', nicIds: ['server-nic'] })
    topology.inventory!.nics.push({ id: 'router-nic', name: 'Router NIC', owner,
      ipConfigurations: [{ id: 'router-ip', name: 'Primary', subnetId: 'router-subnet', privateIp: '10.1.2.4' }] },
    { id: 'server-nic', name: 'Server NIC', owner,
      ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'server-subnet', privateIp: '10.1.3.5' }] })
    topology.inventory!.networkSecurityGroups!.push({ id: 'router-nsg', name: 'Router NSG', rules: [
      rule({ id: 'deny-original', name: 'DenyOriginal', direction: 'outbound', action: 'deny', sources: ['10.1.1.4'], destinations: ['*'] }),
    ] })
    topology.inventory!.nsgAssociations!.push({ owner, target: { kind: 'nic', id: 'router-nic' }, nsgId: 'router-nsg' },
      { owner, target: { kind: 'subnet', id: 'router-subnet' }, nsgId: 'router-nsg' })
    const request: PacketRequest = { source: { kind: 'workload', workloadId: 'client', nicId: 'nic', ipConfigurationId: 'ip' },
      target: { kind: 'workload', workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' },
      protocol: 'tcp', sourcePort: 49152, destinationPort: 443 }
    const allowed = tracePacket(parseAzNetTopology(topology), request)
    expect(allowed).toMatchObject({ translation: 'snat', nsg: { forward: { outcome: 'allowed' } } })
    const checks = allowed.nsg!.forward.checks.filter((check) => check.nsgId === 'router-nsg')
    expect(checks.map((check) => [check.direction, check.target.kind, check.tuple.sourceAddress])).toEqual([
      ['inbound', 'subnet', '10.1.1.4'], ['inbound', 'nic', '10.1.1.4'],
      ['outbound', 'nic', '10.1.2.4'], ['outbound', 'subnet', '10.1.2.4'],
    ])
    topology.inventory!.networkSecurityGroups!.at(-1)!.rules.push(rule({ id: 'drop-inbound', name: 'DropInbound',
      sources: ['10.1.1.4'], destinations: ['*'], action: 'deny' }))
    const denied = tracePacket(topology, request)
    expect(denied).toMatchObject({ forward: { routing: 'reachable' }, security: 'denied', translation: 'not-assessed' })
    expect(denied.forward.steps.some((step) => step.after && step.after.sourceAddress === '10.1.2.4')).toBe(false)
    expect(denied.forward.steps.at(-1)).toMatchObject({ entity: { kind: 'subnet', id: 'router-subnet' }, after: null })
    expect(denied.reply.session).toBeUndefined()
  })
})
