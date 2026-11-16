import { describe, expect, it } from 'vitest'
import { createEmptyAzNetTopology } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { simulateAzNet } from './azure-net/engine'
import { validateInventory } from './inventory'
import { tracePacket, type PacketRequest } from './packet-flow'
import { executePlatform } from './platform/service'
import { generateAzNetBicep } from './azure-net/bicep-export'
import { importAzNetCapture } from './azure-net/azure-import'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Topology } from './model'

function network() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{ id: 'network', name: 'Network', region: 'westeurope', role: 'spoke',
    prefixes: ['10.1.0.0/16'], subnets: [
      { id: 'app', name: 'App', prefix: '10.1.1.0/24', defaultOutboundAccess: false },
      { id: 'router-subnet', name: 'Router', prefix: '10.1.2.0/24' },
    ], gateways: [], appliances: [] }]
  topology.inventory = {
    workloads: [{ id: 'vm', name: 'Workload', nicIds: ['nic'] }],
    nics: [{ id: 'nic', name: 'NIC', owner: { kind: 'vnet', id: 'network' },
      ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] }],
    publicIps: [{ id: 'egress-ip', name: 'Egress IP', address: '20.40.50.60', sku: 'Standard', allocation: 'Static' }],
    natGateways: [{ id: 'nat', name: 'NAT Gateway', sku: 'Standard', owner: { kind: 'vnet', id: 'network' },
      subnetIds: ['app'], publicIpIds: ['egress-ip'] }],
  }
  return topology
}
const request: PacketRequest = {
  source: { kind: 'workload', workloadId: 'vm', nicId: 'nic', ipConfigurationId: 'ip' },
  target: { kind: 'external', address: '8.8.8.8' }, protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
}

describe('explicit route-first Internet egress', () => {
  function throughRouter(kind: 'azure-firewall' | 'nva-vm') {
    const topology = network()
    topology.vnets[0].subnets[0].routeTableId = 'steering'
    topology.vnets[0].subnets[1].name = kind === 'azure-firewall' ? 'AzureFirewallSubnet' : 'Router'
    topology.udrTables = [{ id: 'steering', name: 'Steering', disableBgpRoutePropagation: false,
      routes: [{ id: 'default', name: 'Default', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] }]
    topology.vnets[0].appliances = [{ id: 'router', name: 'Router', kind, subnetId: 'router-subnet', privateIp: '10.1.2.4',
      enableIpForwarding: true, staticRoutes: [] }]
    topology.inventory!.publicIps.push({ id: 'router-pip', name: 'Router public IP', address: '20.40.50.70', sku: 'Standard', allocation: 'Static' })
    topology.inventory!.routerSnatPolicies = [kind === 'azure-firewall'
      ? { owner: { kind: 'appliance', id: 'router' }, kind: 'firewall-network-rules', publicIpIds: ['router-pip'], zoneRedundant: false }
      : { owner: { kind: 'appliance', id: 'router' }, kind: 'nva-snat', publicIpIds: ['router-pip'],
        sourcePrefixes: ['10.1.1.0/24'], destinationPrefixes: ['0.0.0.0/0'], protocol: 'any' }]
    return topology
  }

  it('models Firewall private handoff to its own subnet NAT Gateway, never double public NAT or source-subnet bypass', () => {
    const topology = throughRouter('azure-firewall')
    let result = tracePacket(parseAzNetTopology(topology), request)
    expect(result).toMatchObject({ translation: 'snat', reply: { routing: 'reachable', session: 'conditional-response' } })
    expect(result.forward.steps.some((step) => step.entity.kind === 'nat-gateway')).toBe(false)
    expect(result.forward.steps.filter((step) => step.before.sourceAddress !== step.after?.sourceAddress).at(-1)?.after?.sourceAddress).toBe('20.40.50.70')
    topology.inventory!.natGateways![0].subnetIds = ['router-subnet']
    result = tracePacket(parseAzNetTopology(topology), request)
    const translations = result.forward.steps.filter((step) => step.before.sourceAddress !== step.after?.sourceAddress)
    expect(translations.map((step) => step.after?.sourceAddress)).toEqual(['10.1.2.4', '20.40.50.60'])
    expect(result.reply.steps.slice(0, 2).map((step) => step.after?.destinationAddress)).toEqual(['10.1.2.4', '10.1.1.4'])
    expect(result.reply.routing).toBe('reachable')
    expect(translations[0].evidence).toContain('not a prediction')
  })

  it('requires an explicit NVA guest rule, then uses the router outbound method and independently checks its static return routes', () => {
    const topology = throughRouter('nva-vm')
    let result = tracePacket(parseAzNetTopology(topology), request)
    expect(result.forward.steps.filter((step) => step.before.sourceAddress !== step.after?.sourceAddress).map((step) => step.after?.sourceAddress))
      .toEqual(['10.1.2.4', '20.40.50.70'])
    expect(result.reply.routing).toBe('reachable')
    topology.vnets[0].appliances[0].staticRoutes = [{ id: 'bad-return', prefix: '10.1.1.0/24', nextHopKind: 'drop', enabled: true }]
    result = tracePacket(parseAzNetTopology(topology), request)
    expect(result).toMatchObject({ translation: 'snat', forward: { routing: 'reachable' }, reply: { routing: 'unreachable' } })
    expect(result.reply.steps.some((step) => step.evidence.toLowerCase().includes('discard'))).toBe(true)
    topology.vnets[0].appliances.push({ id: 'unknown-return-router', name: 'Unknown return router', kind: 'nva-vm',
      subnetId: 'router-subnet', privateIp: '10.1.2.5', enableIpForwarding: true, staticRoutes: [] })
    topology.vnets[0].appliances[0].staticRoutes[0] = { id: 'second-router', prefix: '10.1.1.0/24',
      nextHopKind: 'appliance', nextHopIp: '10.1.2.5', enabled: true }
    result = tracePacket(parseAzNetTopology(topology), request)
    expect(result.reply.routing).toBe('not-assessed')
    expect(result.reply.steps.at(-1)?.after).toBeNull()
    topology.vnets[0].appliances[0].staticRoutes[0].prefix = 'invalid'
    expect(tracePacket(topology, request).reply.routing).toBe('not-assessed')
    delete topology.inventory!.routerSnatPolicies
    expect(tracePacket(topology, request)).toMatchObject({ translation: 'not-assessed', egress: 'not-assessed' })
  })

  it('honors Firewall private/shared defaults and replacing ranges; always-SNAT uses private translation for owned internal destinations', () => {
    const topology = throughRouter('azure-firewall')
    topology.inventory!.workloads.push({ id: 'target', name: 'Target', nicIds: ['target-nic'] })
    topology.vnets[0].subnets.push({ id: 'target-subnet', name: 'Target', prefix: '10.1.3.0/24' })
    topology.inventory!.nics.push({ id: 'target-nic', name: 'Target NIC', owner: { kind: 'vnet', id: 'network' },
      ipConfigurations: [{ id: 'target-ip', name: 'Primary', subnetId: 'target-subnet', privateIp: '10.1.3.4' }] })
    topology.udrTables[0].routes.push({ id: 'target-udr', name: 'Inspect Target', prefix: '10.1.3.0/24',
      nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true })
    const internal: PacketRequest = { ...request, target: { kind: 'workload', workloadId: 'target', nicId: 'target-nic', ipConfigurationId: 'target-ip' } }
    expect(tracePacket(parseAzNetTopology(topology), internal).translation).toBe('none')
    topology.vnets[0].prefixes.push('100.64.0.0/16')
    topology.vnets[0].subnets[2].prefix = '100.64.3.0/24'
    topology.inventory!.nics[1].ipConfigurations[0].privateIp = '100.64.3.4'
    topology.udrTables[0].routes[1].prefix = '100.64.3.0/24'
    expect(tracePacket(parseAzNetTopology(topology), internal).translation).toBe('none')
    const policy = topology.inventory!.routerSnatPolicies![0]
    if (policy.kind !== 'firewall-network-rules') throw new Error('Firewall fixture')
    policy.privateRanges = ['255.255.255.255/32']
    const result = tracePacket(parseAzNetTopology(topology), internal)
    expect(result).toMatchObject({ translation: 'snat', forward: { routing: 'reachable' }, reply: { routing: 'reachable' } })
    expect(result.forward.steps.find((step) => step.before.sourceAddress !== step.after?.sourceAddress)?.after?.sourceAddress).toBe('10.1.2.4')
    topology.vnets[0].subnets[2].routeTableId = 'deny-response'
    topology.udrTables.push({ id: 'deny-response', name: 'Discard return to translator', disableBgpRoutePropagation: false,
      routes: [{ id: 'response-drop', name: 'Drop', prefix: '10.1.2.0/24', nextHopType: 'None', enabled: true }] })
    const dropped = tracePacket(parseAzNetTopology(topology), internal)
    expect(dropped).toMatchObject({ translation: 'snat', forward: { routing: 'reachable' }, reply: { routing: 'unreachable' } })
    expect(dropped.reply.steps.some((step) => step.evidence.startsWith('Inverse translation'))).toBe(false)
    policy.privateRanges = ['0.0.0.0/0']
    expect(tracePacket(topology, request)).toMatchObject({ translation: 'none', egress: 'blocked', forward: { routing: 'unreachable' } })
    topology.inventory!.natGateways![0].subnetIds = ['router-subnet']
    expect(tracePacket(topology, request).translation).toBe('not-assessed')
  })

  it('keeps native VWAN Firewall SNAT at the original hub and does not apply source-spoke NAT', () => {
    const inventory = structuredClone(network().inventory!)
    for (const nic of inventory.nics) nic.owner.kind = 'spoke'
    inventory.natGateways![0].owner.kind = 'spoke'
    inventory.publicIps.push({ id: 'fw-ip', name: 'Firewall public IP', address: '20.40.50.70', sku: 'Standard', allocation: 'Static' })
    inventory.routerSnatPolicies = [{ owner: { kind: 'hub', id: 'hub' }, kind: 'firewall-network-rules', publicIpIds: ['fw-ip'] }]
    const topology: Topology = { version: 1, name: 'Native Firewall', hubs: [{ id: 'hub', name: 'Hub', region: 'westeurope',
      preference: 'ExpressRoute', routingIntent: { internet: true, private: false, privatePrefixes: [] } }],
      spokes: [{ id: 'network', name: 'Network', hubId: 'hub', prefixes: ['10.1.0.0/16'], subnets: [{ id: 'app', name: 'App', prefix: '10.1.1.0/24' }] }],
      sites: [], connections: [], siteLinks: [], inventory }
    validateInventory(topology)
    const result = tracePacket(topology, request)
    expect(result).toMatchObject({ translation: 'snat', egress: 'configured', reply: { routing: 'reachable', session: 'conditional-response' } })
    expect(result.forward.steps.some((step) => step.entity.kind === 'nat-gateway')).toBe(false)
    expect(result.forward.steps.find((step) => step.before.sourceAddress !== step.after?.sourceAddress)?.after?.sourceAddress).toBe('20.40.50.70')
  })

  it('rejects wrong original SNAT owners, duplicate pools, malformed ranges and mismatched policy kinds', () => {
    for (const edit of [
      (topology: ReturnType<typeof network>) => { topology.inventory!.routerSnatPolicies![0].owner.id = 'missing' },
      (topology: ReturnType<typeof network>) => { topology.inventory!.routerSnatPolicies![0].publicIpIds = ['egress-ip'] },
      (topology: ReturnType<typeof network>) => { Reflect.set(topology.inventory!.routerSnatPolicies![0], 'privateRanges', ['invalid']) },
      (topology: ReturnType<typeof network>) => { topology.vnets[0].appliances[0].kind = 'nva-vm' },
    ]) {
      const topology = throughRouter('azure-firewall'); edit(topology)
      expect(() => parseAzNetTopology(topology)).toThrow(/Inventory:/)
    }
  })

  it.each(['tcp', 'udp'] as const)('models %s NAT Gateway translation and only its conditional response without adding a route', (protocol) => {
    const topology = parseAzNetTopology(network()), before = JSON.stringify(topology)
    const simulation = simulateAzNet(topology)
    const result = tracePacket(topology, { ...request, protocol }, simulation)
    expect(result).toMatchObject({ translation: 'snat', egress: 'configured', delivery: 'not-assessed', security: 'not-assessed',
      forward: { routing: 'reachable' }, reply: { routing: 'reachable', session: 'conditional-response' } })
    const step = result.forward.steps.find((step) => step.entity.kind === 'nat-gateway')!
    expect(step.before).toEqual({ sourceAddress: '10.1.1.4', destinationAddress: '8.8.8.8', protocol, sourcePort: 49152, destinationPort: 443 })
    expect(step.after).toMatchObject({ sourceAddress: '20.40.50.60', destinationAddress: '8.8.8.8', protocol, destinationPort: 443 })
    expect(step.evidence).toContain('illustrative')
    expect(result.reply.steps[0].before).toEqual({ sourceAddress: '8.8.8.8', destinationAddress: '20.40.50.60',
      protocol, sourcePort: 443, destinationPort: step.after!.sourcePort })
    expect(result.reply.steps[0].after).toEqual({ sourceAddress: '8.8.8.8', destinationAddress: '10.1.1.4',
      protocol, sourcePort: 443, destinationPort: 49152 })
    expect(simulation.subnetTables.app.routes.some((route) => route.nextHopType === 'Internet')).toBe(true)
    expect(simulation.subnetTables.app.routes.some((route) => route.nextHopResourceId === 'nat')).toBe(false)
    expect(JSON.stringify(topology)).toBe(before)
  })

  it('keeps a private subnet blocked without an explicit method and preserves legacy defaults without inventing SNAT', () => {
    const topology = network()
    delete topology.inventory!.natGateways
    const blocked = tracePacket(topology, request)
    expect(blocked).toMatchObject({ translation: 'not-assessed', egress: 'blocked', forward: { routing: 'unreachable' } })
    expect(simulateAzNet(topology).subnetTables.app.routes.some((route) => route.nextHopType === 'Internet')).toBe(true)
    delete topology.vnets[0].subnets[0].defaultOutboundAccess
    const legacy = tracePacket(topology, request)
    expect(legacy).toMatchObject({ translation: 'not-assessed', egress: 'legacy-implicit', forward: { routing: 'reachable' }, reply: { routing: 'not-assessed' } })
    expect(topology.vnets[0].subnets[0].defaultOutboundAccess).toBeUndefined()
  })

  it('chooses NAT Gateway over an instance public IP, and uses that explicit instance mapping when NAT is removed', () => {
    const topology = network()
    topology.inventory!.publicIps.push({ id: 'instance-ip', name: 'Instance IP', address: '20.40.50.70', sku: 'Standard', allocation: 'Static' })
    topology.inventory!.nics[0].ipConfigurations[0].publicIpId = 'instance-ip'
    validateInventory(topology)
    const nat = tracePacket(topology, request)
    expect(nat.forward.steps.find((step) => step.entity.kind === 'nat-gateway')!.after!.sourceAddress).toBe('20.40.50.60')
    delete topology.inventory!.natGateways
    const instance = tracePacket(topology, request)
    expect(instance).toMatchObject({ translation: 'snat', egress: 'configured', forward: { routing: 'reachable' } })
    expect(instance.forward.steps.find((step) => step.entity.kind === 'public-ip')!.after).toMatchObject({ sourceAddress: '20.40.50.70', sourcePort: 49152 })
  })

  it('never infers an ultimate public mapping from an unknown captured association or an unsupported instance SKU', () => {
    const topology = network()
    delete topology.inventory!.natGateways
    topology.inventory!.nics[0].ipConfigurations[0].publicIpId = 'egress-ip'
    topology.vnets[0].subnets[0].internetEgressStatus = 'unknown'
    expect(tracePacket(parseAzNetTopology(topology), request)).toMatchObject({ translation: 'not-assessed', egress: 'not-assessed' })
    delete topology.vnets[0].subnets[0].internetEgressStatus
    topology.inventory!.publicIps[0].sku = 'StandardV2'
    expect(tracePacket(parseAzNetTopology(topology), request).translation).toBe('not-assessed')
    for (const kind of ['azure-firewall', 'nva-vm'] as const) {
      const routed = throughRouter(kind)
      routed.vnets[0].subnets[1].internetEgressStatus = 'unknown'
      expect(tracePacket(parseAzNetTopology(routed), request)).toMatchObject({ translation: 'not-assessed', egress: 'not-assessed' })
    }
  })

  it('uses the selected route before NAT: an NVA UDR or explicit discard cannot be bypassed', () => {
    const topology = network()
    topology.vnets[0].subnets[0].routeTableId = 'steering'
    topology.udrTables = [{ id: 'steering', name: 'Steering', disableBgpRoutePropagation: false,
      routes: [{ id: 'default', name: 'Default', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.1.2.4', enabled: true }] }]
    topology.vnets[0].appliances = [{ id: 'router', name: 'NVA', kind: 'nva-vm', subnetId: 'router-subnet', privateIp: '10.1.2.4',
      enableIpForwarding: true, staticRoutes: [] }]
    const routed = tracePacket(topology, request)
    expect(routed).toMatchObject({ translation: 'not-assessed', egress: 'not-assessed', forward: { routing: 'reachable' } })
    expect(routed.forward.steps.some((step) => step.entity.kind === 'nat-gateway')).toBe(false)
    topology.udrTables[0].routes[0].nextHopType = 'None'
    expect(tracePacket(topology, request)).toMatchObject({ translation: 'not-assessed', forward: { routing: 'unreachable' } })
  })

  it('keeps unallocated public addresses unknown and supports a bounded illustrative address from a public prefix', () => {
    const topology = network()
    delete topology.inventory!.publicIps[0].address
    expect(tracePacket(topology, request)).toMatchObject({ translation: 'not-assessed', egress: 'not-assessed',
      forward: { routing: 'reachable' }, reply: { routing: 'not-assessed' } })
    topology.inventory!.publicIpPrefixes = [{ id: 'prefix', name: 'Prefix', sku: 'Standard', prefixLength: 31, prefix: '20.40.50.64/31' }]
    topology.inventory!.natGateways![0].publicIpIds = []
    topology.inventory!.natGateways![0].publicIpPrefixIds = ['prefix']
    validateInventory(topology)
    expect(tracePacket(topology, request).forward.steps.find((step) => step.entity.kind === 'nat-gateway')!.after!.sourceAddress).toBe('20.40.50.64')
    delete topology.inventory!.publicIpPrefixes[0].prefix
    expect(tracePacket(topology, request).translation).toBe('not-assessed')
  })

  it('never turns an unsolicited Internet initiation into a NAT Gateway response', () => {
    const result = tracePacket(network(), { ...request, source: request.target, target: request.source })
    expect(result.forward.routing).toBe('not-assessed')
    expect(result.forward.session).toBeUndefined()
    expect(result.translation).toBe('not-assessed')
  })

  it('keeps the same explicit egress result through the local platform contract', () => {
    expect(executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: network() }, packet: request }))
      .toMatchObject({ status: 'complete', packet: { translation: 'snat', egress: 'configured', reply: { session: 'conditional-response' } } })
  })

  it('exports original subnet NAT associations and private flags, but does not pin illustrative public addresses', () => {
    const topology = network()
    topology.inventory!.publicIpPrefixes = [{ id: 'prefix', name: 'Prefix', sku: 'Standard', prefixLength: 31, prefix: '20.40.50.64/31' }]
    topology.inventory!.natGateways![0].publicIpPrefixIds = ['prefix']
    const exported = generateAzNetBicep(topology)
    expect(exported.text).toContain('Microsoft.Network/natGateways@2024-05-01')
    expect(exported.text).toContain('Microsoft.Network/publicIPPrefixes@2024-05-01')
    expect(exported.text).toContain('defaultOutboundAccess: false')
    expect(exported.text).toContain('natGateway: { id: nat_nat.id }')
    expect(exported.text).not.toContain('20.40.50.60')
    expect(exported.text).not.toContain('20.40.50.64')
    expect(exported.warnings.join(' ')).toContain('not pinned')
    const directory = resolve('test-artifacts', 'azure-files', 'bicep')
    mkdirSync(directory, { recursive: true })
    writeFileSync(resolve(directory, 'nat-egress.bicep'), exported.text)
  })

  it('retains captured NAT/public ownership and private flags; missing or unsupported associations stay unknown', () => {
    const prefix = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network'
    const raw = {
      kind: 'azure-network-capture', version: 2, resourceGroup: 'network',
      vnets: [{ id: `${prefix}/virtualNetworks/network`, name: 'network', location: 'westeurope',
        addressSpace: { addressPrefixes: ['10.1.0.0/16'] },
        subnets: [{ id: `${prefix}/virtualNetworks/network/subnets/app`, name: 'app', addressPrefix: '10.1.1.0/24',
          defaultOutboundAccess: false, natGateway: { id: `${prefix}/natGateways/nat` } }] }],
      publicIpAddresses: [{ id: `${prefix}/publicIPAddresses/pip`, name: 'pip', sku: { name: 'Standard' },
        publicIPAllocationMethod: 'Static', ipAddress: '20.40.50.60' }],
      natGateways: [{ id: `${prefix}/natGateways/nat`, name: 'nat', sku: { name: 'Standard' },
        publicIpAddresses: [{ id: `${prefix}/publicIPAddresses/pip` }],
        subnets: [{ id: `${prefix}/virtualNetworks/network/subnets/app` }] }],
    }
    for (const mode of ['known', 'missing-gateway', 'unsupported-sku', 'missing-pool', 'outside-owner', 'unknown-address']) {
      const input = structuredClone(raw)
      if (mode === 'missing-gateway') input.natGateways = []
      if (mode === 'unsupported-sku') input.natGateways[0].sku.name = 'StandardV2'
      if (mode === 'missing-pool') input.publicIpAddresses = []
      if (mode === 'outside-owner') input.natGateways[0].subnets.push({ id: `${prefix}/virtualNetworks/outside/subnets/missing` })
      if (mode === 'unknown-address') Reflect.deleteProperty(input.publicIpAddresses[0], 'ipAddress')
      const imported = importAzNetCapture(input)
      const topology = imported.topology, owner = topology.vnets[0], subnet = owner.subnets[0]
      topology.inventory ??= { workloads: [], nics: [], publicIps: [] }
      topology.inventory.workloads = [{ id: 'vm', name: 'VM', nicIds: ['nic'] }]
      topology.inventory.nics = [{ id: 'nic', name: 'NIC', owner: { kind: 'vnet', id: owner.id },
        ipConfigurations: [{ id: 'ip', name: 'Primary', subnetId: subnet.id, privateIp: '10.1.1.4' }] }]
      expect(subnet.defaultOutboundAccess).toBe(false)
      const result = tracePacket(parseAzNetTopology(topology), request)
      if (mode === 'known') {
        expect(topology.inventory.natGateways![0]).toMatchObject({ owner: { kind: 'vnet', id: owner.id }, subnetIds: [subnet.id] })
        expect(result.translation).toBe('snat')
      } else if (mode === 'unknown-address') {
        expect(result).toMatchObject({ translation: 'not-assessed', forward: { routing: 'reachable' } })
      } else {
        expect(subnet.internetEgressStatus).toBe('unknown')
        expect(result).toMatchObject({ translation: 'not-assessed', forward: { routing: 'not-assessed' } })
        expect(imported.unknownAddressing.length).toBeGreaterThan(0)
      }
    }
  })

  it('rejects unsupported SKU, wrong subnet ownership, duplicate associations and invalid public pools', () => {
    const edits: ((topology: ReturnType<typeof network>) => void)[] = [
      (topology) => { Reflect.set(topology.inventory!.natGateways![0], 'sku', 'StandardV2') },
      (topology) => { Reflect.set(topology.inventory!.natGateways![0].owner, 'kind', 'hub') },
      (topology) => { topology.inventory!.natGateways![0].subnetIds = ['missing'] },
      (topology) => { topology.vnets[0].subnets[0].name = 'GatewaySubnet' },
      (topology) => { topology.inventory!.natGateways!.push({ ...structuredClone(topology.inventory!.natGateways![0]), id: 'duplicate' }) },
      (topology) => { topology.inventory!.nics[0].ipConfigurations[0].publicIpId = 'egress-ip' },
      (topology) => { topology.inventory!.publicIps[0].sku = 'Basic' },
      (topology) => { topology.inventory!.publicIps[0].allocation = 'Dynamic' },
      (topology) => { topology.inventory!.natGateways![0].publicIpIds = [] },
      (topology) => {
        topology.inventory!.publicIpPrefixes = [{ id: 'prefix', name: 'Prefix', sku: 'Standard', prefixLength: 28, prefix: '20.40.51.0/28' }]
        topology.inventory!.natGateways![0].publicIpPrefixIds = ['prefix']
      },
    ]
    for (const edit of edits) {
      const topology = network()
      edit(topology)
      expect(() => parseAzNetTopology(topology)).toThrow(/Inventory:/)
    }
  })
})
