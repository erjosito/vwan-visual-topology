import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { parseAzNetJson } from './admission'
import { simulateAzNet, traceAzNetFlow } from './engine'
import { validateAzNetTopology } from './model'
import { generateAzNetBicep } from './bicep-export'
import { importAzNetCapture } from './azure-import'
import { peeringPrefixes } from './subnet-peering'
import { executePlatform } from '../platform/service'
import { nvaBgpTopology } from '../../tests/fixtures/nva-bgp'

const fixture = () => parseAzNetJson(readFileSync(resolve('public', 'docs', 'samples', 'azure-net', 'subnet-peering.json'), 'utf8'))
const endpoint = (side: string, index = 1) => ({ kind: 'subnet' as const, vnetId: `vnet-${side}`, subnetId: `${side}${index}` })

it('retains preview routes in all local subnets but forwards only between participating subnets in either direction', () => {
  const topology = fixture()
  const original = JSON.stringify(topology)
  const simulation = simulateAzNet(topology)
  for (const [side, remote, destination] of [['a', 'b', '10.81.1.4'], ['b', 'a', '10.80.1.4']]) {
    for (const index of [1, 2]) {
      expect(simulation.subnetTables[`${side}${index}`].routes.filter((route) => route.nextHopType === 'VNetPeering').map((route) => route.prefix))
        .toEqual([remote === 'a' ? '10.80.1.0/24' : '10.81.1.0/24'])
      expect(traceAzNetFlow(topology, simulation, endpoint(side, index), destination).status)
        .toBe(index === 1 ? 'delivered' : 'dropped-peering-access')
    }
  }
  expect(traceAzNetFlow(topology, simulation, endpoint('a'), '10.81.2.4').status).not.toBe('delivered')
  expect(JSON.stringify(topology)).toBe(original)
  topology.vnetPeerings[0].aToB.allowVirtualNetworkAccess = false
  const blocked = simulateAzNet(topology)
  expect(blocked.subnetTables.a1.routes.some((route) => route.prefix === '10.81.1.0/24')).toBe(true)
  expect(traceAzNetFlow(topology, blocked, endpoint('a'), '10.81.1.4').status).toBe('dropped-peering-access')
})

it('refreshes membership by stable original IDs through edits, rename and JSON round trips without widening to a VNet', () => {
  const topology = fixture()
  topology.vnets[0].subnets[0].name = 'Renamed participating subnet'
  expect(validateAzNetTopology(topology)).toEqual([])
  topology.vnetPeerings[0].scope = { type: 'subnets', subnetAIds: ['a2'], subnetBIds: ['b2'] }
  const restored = parseAzNetJson(JSON.stringify(topology))
  const simulation = simulateAzNet(restored)
  expect(traceAzNetFlow(restored, simulation, endpoint('a', 2), '10.81.2.4').status).toBe('delivered')
  expect(traceAzNetFlow(restored, simulation, endpoint('a'), '10.81.2.4').status).toBe('dropped-peering-access')
  expect(simulation.subnetTables.a1.routes.filter((route) => route.nextHopType === 'VNetPeering').map((route) => route.prefix)).toEqual(['10.81.2.0/24'])
  const peer = restored.vnetPeerings[0]
  ;[peer.vnetAId, peer.vnetBId] = [peer.vnetBId, peer.vnetAId]
  peer.scope = { type: 'subnets', subnetAIds: ['b2'], subnetBIds: ['a2'] }
  expect(traceAzNetFlow(restored, simulateAzNet(restored), endpoint('a', 2), '10.81.2.4').status).toBe('delivered')
})

it('preserves legacy whole-VNet scope and its full address-space routes', () => {
  const topology = fixture()
  delete topology.vnetPeerings[0].scope
  const baseline = simulateAzNet(topology)
  expect(baseline.subnetTables.a2.routes.filter((route) => route.nextHopType === 'VNetPeering').map((route) => route.prefix)).toEqual(['10.81.0.0/16'])
  expect(traceAzNetFlow(topology, baseline, endpoint('a', 2), '10.81.2.4').status).toBe('delivered')
  topology.vnetPeerings[0].scope = { type: 'whole-vnet' }
  expect(simulateAzNet(topology)).toEqual(baseline)
})

it('rejects empty, duplicated, deleted, wrong-owner and oversized membership, duplicate pairs and overlapping participating address spaces', () => {
  for (const ids of [[], ['a1', 'a1'], ['deleted'], ['b1'], Array.from({ length: 201 }, (_, index) => `a${index}`)]) {
    const topology = fixture()
    topology.vnetPeerings[0].scope = { type: 'subnets', subnetAIds: ids, subnetBIds: ['b1'] }
    expect(validateAzNetTopology(topology).length).toBeGreaterThan(0)
    expect(simulateAzNet(topology).controlPlaneComplete).toBe(false)
  }
  const duplicate = fixture()
  duplicate.vnetPeerings.push({ ...duplicate.vnetPeerings[0], id: 'duplicate' })
  expect(validateAzNetTopology(duplicate).join()).toMatch(/only one peering link/)
  const overlap = fixture()
  overlap.vnets[1].prefixes.push('10.80.0.0/16')
  expect(validateAzNetTopology(overlap).join()).toMatch(/participating address space/)
  const acrossLinks = fixture()
  acrossLinks.vnets.push({ ...structuredClone(acrossLinks.vnets[1]), id: 'vnet-c', name: 'C',
    subnets: [{ id: 'c1', name: 'C', prefix: '10.81.2.0/24' }] })
  acrossLinks.vnetPeerings.push({ ...structuredClone(acrossLinks.vnetPeerings[0]), id: 'a-c', vnetBId: 'vnet-c',
    scope: { type: 'subnets', subnetAIds: ['a2'], subnetBIds: ['c1'] } })
  expect(validateAzNetTopology(acrossLinks).join()).toMatch(/overlap across peering links/)
  for (const wholeLink of [0, 1]) {
    const mixed = structuredClone(acrossLinks)
    delete mixed.vnetPeerings[wholeLink].scope
    for (const peerings of [mixed.vnetPeerings, [...mixed.vnetPeerings].reverse()]) {
      mixed.vnetPeerings = peerings
      expect(validateAzNetTopology(mixed).join()).toMatch(/overlap across peering links/)
      expect(simulateAzNet(mixed).controlPlaneComplete).toBe(false)
    }
  }
})

it('fails closed for unsupported composition and never certifies its partial tables or inferred remote ARS reachability', () => {
  const topology = nvaBgpTopology()
  topology.vnetPeerings[0].scope = { type: 'subnets', subnetAIds: ['west-nvas'], subnetBIds: ['reader-subnet'] }
  const simulation = simulateAzNet(topology)
  expect(simulation.controlPlaneComplete).toBe(false)
  expect(simulation.nvaBgpPeers!.reader[0]).toMatchObject({ state: 'subnet-peering-not-assessed', routes: [] })
  expect(traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'west', subnetId: 'west-nvas' }, '10.30.1.4').status).toBe('not-assessed')
  const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
    requirements: [{ id: 'unknown-route', kind: 'route', table: 'reader-subnet', prefix: '198.18.0.0/24', expectation: 'absent' }] })
  expect(result.assessments[0].outcome).toBe('not assessed')
  const delegated = fixture()
  delegated.vnets[1].subnets[1].delegations = ['Microsoft.NetApp/volumes']
  expect(simulateAzNet(delegated).controlPlaneComplete).toBe(false)
})

it('allows exactly 200 owned subnets per side and 1,000 remote subnets across links, rejecting only the excess configuration', () => {
  const topology = fixture()
  topology.vnets[1].subnets = Array.from({ length: 201 }, (_, index) => ({
    id: `b-${index}`, name: `B ${index}`, prefix: `10.81.${index}.0/24`,
  }))
  topology.vnetPeerings[0].scope = { type: 'subnets', subnetAIds: ['a1'], subnetBIds: topology.vnets[1].subnets.slice(0, 200).map((subnet) => subnet.id) }
  expect(validateAzNetTopology(topology)).toEqual([])
  topology.vnetPeerings[0].scope.subnetBIds.push('b-200')
  expect(validateAzNetTopology(topology).join()).toMatch(/1-200/)
  topology.vnetPeerings[0].scope.subnetBIds.pop()
  for (let index = 2; index <= 5; index++) {
    const id = `remote-${index}`
    topology.vnets.push({ id, name: id, role: 'standalone', region: 'westeurope', prefixes: [`10.${80 + index}.0.0/16`],
      subnets: Array.from({ length: 200 }, (_, subnet) => ({ id: `${id}-${subnet}`, name: `Subnet ${subnet}`, prefix: `10.${80 + index}.${subnet}.0/24` })),
      gateways: [], appliances: [] })
    topology.vnetPeerings.push({ ...structuredClone(topology.vnetPeerings[0]), id: `peer-${index}`, vnetBId: id,
      scope: { type: 'subnets', subnetAIds: ['a1'], subnetBIds: topology.vnets.at(-1)!.subnets.map((subnet) => subnet.id) } })
  }
  expect(validateAzNetTopology(topology)).toEqual([])
  topology.vnets.push({ id: 'excess', name: 'Excess', role: 'standalone', region: 'westeurope', prefixes: ['10.90.0.0/16'],
    subnets: [{ id: 'excess-subnet', name: 'Excess', prefix: '10.90.1.0/24' }], gateways: [], appliances: [] })
  topology.vnetPeerings.push({ ...structuredClone(topology.vnetPeerings[0]), id: 'peer-excess', vnetBId: 'excess',
    scope: { type: 'subnets', subnetAIds: ['a1'], subnetBIds: ['excess-subnet'] } })
  expect(validateAzNetTopology(topology).join()).toMatch(/1,000/)
})

function capture() {
  const topology = fixture()
  const arm = (id: string) => `/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test/providers/Microsoft.Network/virtualNetworks/${id}`
  return { kind: 'azure-network-capture', version: 2, resourceGroup: 'test',
    vnets: topology.vnets.map((vnet, index) => ({
      id: arm(vnet.id), name: vnet.name, location: vnet.region, addressSpace: { addressPrefixes: vnet.prefixes },
      subnets: vnet.subnets.map((subnet) => ({ id: `${arm(vnet.id)}/subnets/${subnet.name}`, name: subnet.name, addressPrefix: subnet.prefix })),
      virtualNetworkPeerings: [{ name: `direction-${index}`, remoteVirtualNetwork: { id: arm(topology.vnets[1 - index].id) },
        peerCompleteVnets: false, localSubnetNames: [vnet.subnets[0].name], remoteSubnetNames: [topology.vnets[1 - index].subnets[0].name],
        enableOnlyIPv6Peering: false, allowVirtualNetworkAccess: true }],
    })) }
}

it('imports matching captured directions by owned subnet IDs and exports both exact mirrored subnet-name lists', () => {
  const topology = importAzNetCapture(capture()).topology
  expect(validateAzNetTopology(topology)).toEqual([])
  const peering = topology.vnetPeerings[0]
  for (const vnet of topology.vnets) expect(peeringPrefixes(peering, vnet)).toEqual([vnet.subnets[0].prefix])
  const exported = generateAzNetBicep(topology)
  const directory = resolve('test-artifacts', 'azure-files', 'bicep')
  mkdirSync(directory, { recursive: true })
  writeFileSync(resolve(directory, 'subnet-peering.bicep'), exported.text)
  expect(exported.text.match(/peerCompleteVnets: false/g)).toHaveLength(2)
  expect(exported.text).toContain("localSubnetNames: ['Participating A']")
  expect(exported.text).toContain("remoteSubnetNames: ['Participating A']")
  expect(exported.text).toContain("localSubnetNames: ['Participating B']")
  expect(exported.warnings.join()).toMatch(/deleting\/recreating/)
})

it('does not silently widen asymmetric, incomplete, IPv6 or unresolvable captured subnet scopes to whole VNets', () => {
  const mismatched = capture()
  mismatched.vnets[1].virtualNetworkPeerings[0].localSubnetNames = ['Unselected B']
  expect(() => importAzNetCapture(mismatched)).toThrow(/mismatched/)
  const missing = capture()
  missing.vnets[1].virtualNetworkPeerings = []
  expect(() => importAzNetCapture(missing)).toThrow(/both captured directions/)
  const ipv6 = capture()
  ipv6.vnets[0].virtualNetworkPeerings[0].enableOnlyIPv6Peering = true
  expect(() => importAzNetCapture(ipv6)).toThrow(/IPv6/)
  const deleted = capture()
  deleted.vnets[0].virtualNetworkPeerings[0].localSubnetNames = ['deleted']
  expect(() => importAzNetCapture(deleted)).toThrow(/unknown or ambiguous subnet/)
})
