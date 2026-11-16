import { describe, expect, it } from 'vitest'
import { validateTopology } from './validation'
import { pruneDeletedInventory, validateInventory, type InventoryTopology, type NetworkInventory } from './inventory'
import { packetEndpointOptions, tracePacket, type PacketRequest } from './packet-flow'
import { createEmptyAzNetTopology } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { getAzNetEndpoints } from './azure-net/endpoints'
import { simulateAzNet, traceAzNetFlow } from './azure-net/engine'
import { simulate } from './routing'
import { traceNodePath } from './paths'

function inventory(kind: 'vnet' | 'spoke'): NetworkInventory {
  return {
    workloads: [{ id: 'vm:a:1', name: 'Application', nicIds: ['nic-a'] }, { id: 'vm-b', name: 'Database', nicIds: ['nic-b'] }],
    nics: [
      { id: 'nic-a', name: 'App NIC', owner: { kind, id: 'network' }, ipConfigurations: [{ id: 'ip-a', name: 'Primary', subnetId: 'app', privateIp: '10.1.1.4' }] },
      { id: 'nic-b', name: 'DB NIC', owner: { kind, id: 'network' }, ipConfigurations: [{ id: 'ip-b', name: 'Primary', subnetId: 'db', privateIp: '10.1.2.4' }] },
    ], publicIps: [],
  }
}
function topology(mode: 'vwan' | 'azure-net'): InventoryTopology {
  const subnets = [{ id: 'app', name: 'App', prefix: '10.1.1.0/24' }, { id: 'db', name: 'DB', prefix: '10.1.2.0/24' }]
  if (mode === 'vwan') return validateTopology({
    version: 1, name: 'Workloads', hubs: [], sites: [], connections: [], siteLinks: [],
    spokes: [{ id: 'network', name: 'Network', prefixes: ['10.1.0.0/16'], subnets }], inventory: inventory('spoke'),
  })
  const network = createEmptyAzNetTopology()
  network.vnets = [{ id: 'network', name: 'Network', region: 'swedencentral', role: 'spoke', prefixes: ['10.1.0.0/16'], subnets, gateways: [], appliances: [] }]
  network.inventory = inventory('vnet')
  return parseAzNetTopology(network)
}
const request: PacketRequest = {
  source: { kind: 'workload', workloadId: 'vm:a:1', nicId: 'nic-a', ipConfigurationId: 'ip-a' },
  target: { kind: 'workload', workloadId: 'vm-b', nicId: 'nic-b', ipConfigurationId: 'ip-b' },
  protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
}

describe('owned workload inventory and packet adapters', () => {
  it.each(['vwan', 'azure-net'] as const)('preserves %s identities and exactly delegates routing to its native engine', (mode) => {
    const network = topology(mode)
    const before = JSON.stringify(network)
    const result = tracePacket(network, request)
    expect([result.forward.routing, result.reply.routing]).toEqual(['reachable', 'reachable'])
    expect(result.reply.tuple).toEqual({ sourceAddress: '10.1.2.4', destinationAddress: '10.1.1.4', protocol: 'tcp', sourcePort: 443, destinationPort: 49152 })
    expect(result.delivery).toBe('not-assessed')
    expect(result.security).toBe('not-assessed')
    expect(result.translation).toBe('not-assessed')
    expect(result.forward.steps[0].entity).toEqual({ kind: 'workload', id: 'vm:a:1' })
    expect(result.forward.steps.at(-1)!.entity).toEqual({ kind: 'workload', id: 'vm-b' })
    if (network.version === 1) {
      expect(result.forward.native).toEqual(traceNodePath(network, simulate(network), { kind: 'spoke', id: 'network' }, '10.1.2.4'))
      expect(validateTopology(JSON.parse(before))).toEqual(network)
    } else {
      expect(result.forward.native).toEqual(traceAzNetFlow(network, simulateAzNet(network), { kind: 'subnet', vnetId: 'network', subnetId: 'app' }, '10.1.2.4'))
      expect(parseAzNetTopology(JSON.parse(before))).toEqual(network)
      const option = getAzNetEndpoints(network).find((option) => option.group === 'named-workload')
      expect(option).toMatchObject({ defaultIp: '10.1.1.4', ref: { kind: 'subnet', vnetId: 'network', subnetId: 'app' } })
    }
    expect(JSON.stringify(network)).toBe(before)
    expect(packetEndpointOptions(network)[0].key).toBe('["workload","vm:a:1","nic-a","ip-a"]')
  })

  it.each(['vwan', 'azure-net'] as const)('rejects invalid %s ownership, addressing and public-IP associations', (mode) => {
    const network = topology(mode)
    const cases: ((inventory: NetworkInventory) => void)[] = [
      (inventory) => { inventory.nics[0].owner.id = 'missing' },
      (inventory) => { inventory.nics[0].ipConfigurations[0].subnetId = 'missing' },
      (inventory) => { inventory.nics[0].ipConfigurations[0].privateIp = '10.2.0.4' },
      (inventory) => { inventory.nics[0].ipConfigurations[0].privateIp = '10.1.1.2' },
      (inventory) => { inventory.workloads[0].nicIds.push('nic-b') },
      (inventory) => { inventory.nics[0].ipConfigurations[0].publicIpId = 'missing' },
      (inventory) => { inventory.publicIps.push({ id: 'pip', name: 'Public', address: '10.1.1.4' }) },
      (inventory) => { inventory.workloads[0].backingDeviceId = 'missing' },
    ]
    for (const edit of cases) {
      const changed = structuredClone(network)
      edit(changed.inventory!)
      expect(() => validateInventory(changed)).toThrow(/Inventory:/)
    }
  })

  it.each(['vwan', 'azure-net'] as const)('validates %s NSG rules and original associations with the same admission checks', (mode) => {
    const network = topology(mode)
    network.inventory!.networkSecurityGroups = [{ id: 'nsg', name: 'Application NSG', rules: [{
      id: 'web', name: 'AllowWeb', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
      sources: ['*'], destinations: ['10.1.1.4'], sourcePorts: ['*'], destinationPorts: ['443'],
    }] }]
    network.inventory!.nsgAssociations = [{ owner: network.inventory!.nics[0].owner,
      target: { kind: 'subnet', id: 'app' }, nsgId: 'nsg' }]
    validateInventory(network)
    const cases: ((inventory: NetworkInventory) => void)[] = [
      (inventory) => { inventory.networkSecurityGroups![0].rules.push({ ...inventory.networkSecurityGroups![0].rules[0], id: 'duplicate', name: 'Duplicate' }) },
      (inventory) => { inventory.networkSecurityGroups![0].rules[0].sources = ['10.999.0.0/24'] },
      (inventory) => { inventory.networkSecurityGroups![0].rules[0].destinationPorts = ['65535-65536'] },
      (inventory) => { inventory.nsgAssociations![0].target.id = 'missing' },
      (inventory) => { inventory.nsgAssociations![0].nsgId = 'missing' },
    ]
    for (const edit of cases) {
      const changed = structuredClone(network)
      edit(changed.inventory!)
      expect(() => validateInventory(changed)).toThrow(/Inventory:/)
    }
  })

  it('keeps unknown addresses and unsupported Internet ingress explicitly unassessed', () => {
    const network = topology('azure-net')
    delete network.inventory!.nics[0].ipConfigurations[0].privateIp
    const unknown = tracePacket(network, request)
    expect(packetEndpointOptions(network, '不明')[0].label).toBe('Application / App NIC / Primary (不明)')
    expect([unknown.forward.routing, unknown.reply.routing]).toEqual(['not-assessed', 'not-assessed'])
    expect(unknown.forward.tuple).toBeUndefined()
    network.inventory!.nics[0].ipConfigurations[0].privateIp = '10.1.1.4'
    network.inventory!.publicIps.push({ id: 'pip', name: 'App PIP', address: '20.50.60.80' })
    network.inventory!.nics[0].ipConfigurations[0].publicIpId = 'pip'
    validateInventory(network)
    expect(tracePacket(network, { ...request, source: { kind: 'external', address: '20.50.60.70' } }).forward.routing).toBe('not-assessed')
    expect(() => tracePacket(network, { ...request, target: { kind: 'external', address: '10.1.2.4' } })).toThrow(/explicit public IPv4/)
    for (const edit of [{ protocol: 'icmp' }, { sourcePort: 0 }, { destinationPort: 65536 }]) {
      expect(() => tracePacket(network, { ...request, ...edit } as PacketRequest)).toThrow(/TCP\/UDP/)
    }
  })

  it('keeps cross-VNet routing native and independently evaluates an explicitly dropped reply', () => {
    const network = topology('azure-net')
    if (network.version !== 2) throw new Error('Azure topology required')
    network.vnets.push({ id: 'second', name: 'Second network', role: 'spoke', region: 'westeurope', prefixes: ['10.2.0.0/16'],
      subnets: [{ id: 'second-db', name: 'DB', prefix: '10.2.2.0/24', routeTableId: 'reply-drop' }], gateways: [], appliances: [] })
    const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
    network.vnetPeerings.push({ id: 'peer', name: 'Peer', vnetAId: 'network', vnetBId: 'second', enabled: true, aToB: flags, bToA: { ...flags } })
    network.udrTables.push({ id: 'reply-drop', name: 'Reply drop', disableBgpRoutePropagation: false,
      routes: [{ id: 'drop', name: 'Drop', prefix: '10.1.0.0/16', nextHopType: 'None', enabled: true }] })
    const nic = network.inventory!.nics[1]
    nic.owner.id = 'second'
    nic.ipConfigurations[0].subnetId = 'second-db'
    nic.ipConfigurations[0].privateIp = '10.2.2.4'
    validateInventory(network)
    const simulation = simulateAzNet(network), result = tracePacket(network, request, simulation)
    expect([result.forward.routing, result.reply.routing]).toEqual(['reachable', 'unreachable'])
    expect(result.forward.native).toEqual(traceAzNetFlow(network, simulation, { kind: 'subnet', vnetId: 'network', subnetId: 'app' }, '10.2.2.4'))
    const nativeReply = traceAzNetFlow(network, simulation, { kind: 'subnet', vnetId: 'second', subnetId: 'second-db' }, '10.1.1.4')
    expect(result.reply.native).toEqual(nativeReply)
    const route = nativeReply.hops.find((hop) => hop.matchedRoute)?.matchedRoute
    expect(route).toBeDefined()
    expect(result.reply.steps.some((step) => step.routeId === route!.id)).toBe(true)
  })

  it('rejects private endpoint collisions and retains one backing workload when its router is removed', () => {
    const network = topology('azure-net')
    if (network.version !== 2) throw new Error('Azure topology required')
    network.vnets[0].subnets[0].privateEndpoints = [{ id: 'pe', name: 'PE', ipAddress: '10.1.1.4', serviceName: 'Storage' }]
    expect(() => validateInventory(network)).toThrow(/private endpoint address/)
    delete network.vnets[0].subnets[0].privateEndpoints
    network.vnets[0].appliances = [{ id: 'router', name: 'Router', kind: 'nva-vm', subnetId: 'app', privateIp: '10.1.1.4', enableIpForwarding: true, staticRoutes: [] }]
    expect(() => validateInventory(network)).toThrow(/backing identity/)
    network.inventory!.workloads[0].backingDeviceId = 'router'
    validateInventory(network)
    const next = structuredClone(network)
    next.vnets[0].appliances = []
    pruneDeletedInventory(next, network)
    expect(next.inventory!.workloads[0]).toEqual({ id: 'vm:a:1', name: 'Application', nicIds: ['nic-a'] })
    validateInventory(next)
  })
})
