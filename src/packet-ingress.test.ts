import { describe, expect, it } from 'vitest'
import { createEmptyAzNetTopology } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { simulateAzNet } from './azure-net/engine'
import { tracePacket, type PacketRequest } from './packet-flow'
import { validateInventory, type RouterDnatPolicy } from './inventory'

const owner = { kind: 'vnet' as const, id: 'network' }
const target = { workloadId: 'server', nicId: 'nic', ipConfigurationId: 'ip' }
const request: PacketRequest = { source: { kind: 'external', address: '8.8.8.8' },
  target: { kind: 'public-ip', publicIpId: 'frontend' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443 }
function network() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{ id: 'network', name: 'Network', role: 'standalone', region: 'westeurope', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24', defaultOutboundAccess: false }], gateways: [], appliances: [] }]
  topology.inventory = { workloads: [{ id: 'server', name: 'Server', nicIds: ['nic'] }], nics: [{ id: 'nic', name: 'Server NIC', owner,
    ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4', publicIpId: 'frontend' }] }],
  publicIps: [{ id: 'frontend', name: 'Public frontend', sku: 'Standard', allocation: 'Static', address: '20.40.50.60' }],
  networkSecurityGroups: [{ id: 'nsg', name: 'Server NSG', rules: [{
    id: 'web', name: 'AllowWeb', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
    sources: ['8.8.8.8/32'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['443'],
  }] }], nsgAssociations: [{ owner, target: { kind: 'nic', id: 'nic' }, nsgId: 'nsg' }] }
  return topology
}
function router(kind: 'azure-firewall' | 'nva-vm', sourceTranslation: 'preserve' | 'interface' = 'preserve') {
  const topology = network()
  delete topology.inventory!.nics[0].ipConfigurations[0].publicIpId
  topology.vnets[0].subnets.push({ id: 'router-subnet', name: kind === 'azure-firewall' ? 'AzureFirewallSubnet' : 'Router',
    prefix: '10.1.2.0/24', defaultOutboundAccess: false })
  topology.vnets[0].appliances = [{ id: 'router', name: 'Ingress router', kind, subnetId: 'router-subnet', privateIp: '10.1.2.4',
    enableIpForwarding: true, staticRoutes: [] }]
  const rules: RouterDnatPolicy['rules'] = [{ id: 'web-mapping', name: 'Web mapping', priority: 100, protocol: 'tcp',
    sourcePrefixes: ['8.8.8.8/32'], publicIpId: 'frontend', frontendPort: 443, target, translatedPort: 8443 }]
  topology.inventory!.routerDnatPolicies = [kind === 'azure-firewall'
    ? { kind: 'firewall-dnat', owner: { kind: 'appliance', id: 'router' }, publicIpIds: ['frontend'], rules }
    : { kind: 'nva-dnat', owner: { kind: 'appliance', id: 'router' }, publicIpIds: ['frontend'], rules, sourceTranslation }]
  topology.inventory!.networkSecurityGroups![0].rules[0].destinationPorts = ['8443']
  if (kind === 'azure-firewall' || sourceTranslation === 'interface') topology.inventory!.networkSecurityGroups![0].rules[0].sources = ['10.1.2.0/24']
  if (kind === 'nva-vm') {
    topology.inventory!.workloads.push({ id: 'router-vm', name: 'Router VM', backingDeviceId: 'router', nicIds: ['router-nic'] })
    topology.inventory!.nics.push({ id: 'router-nic', name: 'Router NIC', owner,
      ipConfigurations: [{ id: 'router-ip', name: 'Primary', subnetId: 'router-subnet', privateIp: '10.1.2.4' }] })
    topology.inventory!.networkSecurityGroups!.push({ id: 'router-nsg', name: 'Router NSG', rules: [{
      id: 'router-web', name: 'AllowRouterWeb', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
      sources: ['8.8.8.8/32'], destinations: ['10.1.2.4'], sourcePorts: ['*'], destinationPorts: ['443'],
    }, {
      id: 'router-out', name: 'AllowRouterOut', priority: 100, direction: 'outbound', action: 'allow', protocol: 'tcp',
      sources: ['*'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['8443'],
    }] })
    topology.inventory!.nsgAssociations!.push({ owner, target: { kind: 'nic', id: 'router-nic' }, nsgId: 'router-nsg' })
  }
  return topology
}

describe('explicit public ingress and owned DNAT', () => {
  it('maps a Standard VM public frontend to its private NIC, filters that tuple and reverses only the conditional response', () => {
    const topology = parseAzNetTopology(network()), simulation = simulateAzNet(topology), before = JSON.stringify(simulation)
    const result = tracePacket(topology, request, simulation)
    expect(result).toMatchObject({ ingress: 'configured', translation: 'dnat', delivery: 'not-assessed', security: 'not-assessed',
      forward: { routing: 'reachable' }, reply: { routing: 'reachable', session: 'conditional-response' } })
    expect(result.nsg!.forward.checks.find((check) => check.nsgId === 'nsg')).toMatchObject({
      tuple: { sourceAddress: '8.8.8.8', destinationAddress: '10.1.1.4', destinationPort: 443 }, ruleId: 'web',
    })
    expect(result.reply.steps.at(-1)!.after).toMatchObject({ sourceAddress: '20.40.50.60', destinationAddress: '8.8.8.8' })
    expect(JSON.stringify(simulation)).toBe(before)
  })

  it('blocks absent/default-only NSGs and source/port misses without treating public translation as permission', () => {
    for (const change of [
      (topology: ReturnType<typeof network>) => { topology.inventory!.nsgAssociations = [] },
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules = [] },
      (topology: ReturnType<typeof network>) => { topology.inventory!.networkSecurityGroups![0].rules[0].sources = ['9.9.9.9/32'] },
    ]) {
      const topology = network(); change(topology)
      const result = tracePacket(topology, request)
      expect(result).toMatchObject({ ingress: 'blocked', security: 'denied', forward: { routing: 'reachable' } })
      expect(result.reply.session).toBeUndefined()
      expect(result.reply.steps).toEqual([])
    }
  })

  it('does not permit a private-IP Internet initiation or use NAT Gateway as an inbound publisher', () => {
    const topology = network()
    expect(tracePacket(topology, { ...request, target: { kind: 'workload', ...target } }).forward.routing).toBe('not-assessed')
    delete topology.inventory!.nics[0].ipConfigurations[0].publicIpId
    topology.inventory!.natGateways = [{ id: 'nat', name: 'NAT Gateway', sku: 'Standard', owner, subnetIds: ['app'], publicIpIds: ['frontend'] }]
    const blocked = tracePacket(parseAzNetTopology(topology), request)
    expect(blocked).toMatchObject({ ingress: 'blocked', translation: 'not-assessed' })
    expect(blocked.forward.reasons.join(' ')).toMatch(/not unsolicited/)
  })

  it('retains the original public-IP response owner when NAT Gateway has new-outbound precedence', () => {
    const topology = network()
    topology.inventory!.publicIps.push({ id: 'nat-ip', name: 'NAT public', sku: 'Standard', allocation: 'Static', address: '20.40.50.61' })
    topology.inventory!.natGateways = [{ id: 'nat', name: 'NAT Gateway', sku: 'Standard', owner, subnetIds: ['app'], publicIpIds: ['nat-ip'] }]
    const result = tracePacket(parseAzNetTopology(topology), request)
    expect(result.reply.steps.at(-1)!.after!.sourceAddress).toBe('20.40.50.60')
    expect(result.reply.steps.some((step) => step.entity.kind === 'nat-gateway')).toBe(false)
  })

  it('marks a black-holed VM reply unreachable without rewriting the forward mapping or effective routes', () => {
    const topology = network()
    topology.vnets[0].subnets[0].routeTableId = 'reply-drop'
    topology.udrTables = [{ id: 'reply-drop', name: 'Drop', disableBgpRoutePropagation: false,
      routes: [{ id: 'drop', name: 'Drop response', prefix: '8.8.8.8/32', nextHopType: 'None', enabled: true }] }]
    const result = tracePacket(parseAzNetTopology(topology), request)
    expect(result).toMatchObject({ ingress: 'configured', forward: { routing: 'reachable' }, reply: { routing: 'unreachable' } })
    expect(result.reply.session).toBeUndefined()
    expect(result.reply.steps.some((step) => step.after?.sourceAddress === '20.40.50.60')).toBe(false)
  })

  it('source-translates Firewall public DNAT to its original subnet domain, preserves client source port and routes its response owner', () => {
    const topology = parseAzNetTopology(router('azure-firewall'))
    const result = tracePacket(topology, request)
    expect(result).toMatchObject({ ingress: 'configured', translation: 'snat-dnat',
      forward: { routing: 'reachable' }, reply: { routing: 'reachable', session: 'conditional-response' } })
    const check = result.nsg!.forward.checks.find((check) => check.nsgId === 'nsg')!
    expect(check).toMatchObject({ tuple: { sourceAddress: '10.1.2.4', sourcePort: 49152, destinationAddress: '10.1.1.4', destinationPort: 8443 },
      uncertainty: { sourceAddressPrefixes: ['10.1.2.0/24'] }, outcome: 'allowed' })
    topology.inventory!.networkSecurityGroups![0].rules[0].sources = ['10.1.2.4/32']
    expect(tracePacket(topology, request).nsg!.forward.outcome).toBe('not-assessed')
  })

  it.each(['preserve', 'interface'] as const)('uses only explicit NVA %s-source DNAT and filters private platform/guest tuples', (mode) => {
    const topology = router('nva-vm', mode)
    if (mode === 'preserve') {
      topology.vnets[0].subnets[0].routeTableId = 'return-owner'
      topology.udrTables = [{ id: 'return-owner', name: 'Return through NVA', disableBgpRoutePropagation: false,
        routes: [{ id: 'return', name: 'Return owner', prefix: '8.8.8.8/32', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] }]
    }
    const result = tracePacket(parseAzNetTopology(topology), request)
    expect(result).toMatchObject({ ingress: 'configured', reply: { routing: 'reachable', session: 'conditional-response' } })
    const checks = result.nsg!.forward.checks.filter((check) => check.nsgId === 'router-nsg')
    expect(checks.map((check) => [check.direction, check.tuple.destinationAddress, check.tuple.destinationPort])).toEqual([
      ['inbound', '10.1.2.4', 443], ['outbound', '10.1.1.4', 8443],
    ])
  })

  it('exposes preserved-client DNAT asymmetry and does not apply an inverse mapping before the owner', () => {
    const topology = router('nva-vm')
    const result = tracePacket(parseAzNetTopology(topology), request)
    expect(result).toMatchObject({ ingress: 'configured', reply: { routing: 'unreachable' } })
    expect(result.reply.reasons.join(' ')).toMatch(/does not route through/)
    expect(result.reply.steps.some((step) => step.after?.sourceAddress === '20.40.50.60')).toBe(false)
  })

  it('stops NVA packet evidence before guest DNAT when the original ingress NIC denies it', () => {
    const topology = router('nva-vm', 'interface')
    topology.inventory!.networkSecurityGroups![1].rules[0].action = 'deny'
    const result = tracePacket(parseAzNetTopology(topology), request)
    expect(result).toMatchObject({ ingress: 'blocked', security: 'denied', forward: { routing: 'reachable' } })
    expect(result.forward.steps.some((step) => step.routeId === 'web-mapping')).toBe(false)
    expect(result.forward.steps.some((step) => step.after?.destinationAddress === '10.1.1.4')).toBe(false)
    expect(result.forward.steps.at(-1)).toMatchObject({ entity: { kind: 'nic', id: 'router-nic' }, after: null })
    expect(result.reply.steps).toEqual([])
    topology.inventory!.nsgAssociations = topology.inventory!.nsgAssociations!.filter((binding) => binding.target.id !== 'router-nic')
    expect(tracePacket(parseAzNetTopology(topology), request).security).toBe('denied')
  })

  it('does not infer backing-NIC permission or exact Firewall response allocation from missing or more-specific evidence', () => {
    const nva = router('nva-vm', 'interface')
    nva.inventory!.workloads = nva.inventory!.workloads.filter((workload) => workload.id !== 'router-vm')
    nva.inventory!.nics = nva.inventory!.nics.filter((nic) => nic.id !== 'router-nic')
    nva.inventory!.nsgAssociations = nva.inventory!.nsgAssociations!.filter((binding) => binding.target.id !== 'router-nic')
    expect(tracePacket(parseAzNetTopology(nva), request).ingress).toBe('not-assessed')
    const firewall = router('azure-firewall')
    firewall.vnets[0].subnets[0].routeTableId = 'partial-return'
    firewall.udrTables = [{ id: 'partial-return', name: 'Partial return', disableBgpRoutePropagation: false,
      routes: [{ id: 'drop-one', name: 'Drop one instance', prefix: '10.1.2.5/32', nextHopType: 'None', enabled: true }] }]
    const result = tracePacket(parseAzNetTopology(firewall), request)
    expect(result.reply.routing).toBe('not-assessed')
    expect(result.reply.session).toBeUndefined()
    expect(result.reply.steps.some((step) => step.after?.sourceAddress === '20.40.50.60')).toBe(false)
  })

  it('validates original rule targets/priorities and separates unknown rules, missing mappings and unsupported public SKUs', () => {
    for (const change of [
      (topology: ReturnType<typeof router>) => { topology.inventory!.routerDnatPolicies![0].rules[0].target.nicId = 'missing' },
      (topology: ReturnType<typeof router>) => { topology.inventory!.routerDnatPolicies![0].rules.push({ ...topology.inventory!.routerDnatPolicies![0].rules[0], id: 'other' }) },
      (topology: ReturnType<typeof router>) => { topology.inventory!.routerDnatPolicies![0].rules[0].sourcePrefixes = ['asg:unsupported'] },
    ]) {
      const topology = router('azure-firewall'); change(topology)
      expect(() => validateInventory(topology)).toThrow(/Inventory:/)
    }
    const topology = router('azure-firewall')
    topology.inventory!.routerDnatPolicies![0].rulesStatus = 'unknown'
    expect(tracePacket(topology, request).ingress).toBe('not-assessed')
    delete topology.inventory!.routerDnatPolicies![0].rulesStatus
    topology.inventory!.routerDnatPolicies![0].rules = []
    expect(tracePacket(topology, request).ingress).toBe('blocked')
    const basic = network()
    basic.inventory!.publicIps[0].sku = 'Basic'
    expect(tracePacket(basic, request).ingress).toBe('not-assessed')
  })
})
