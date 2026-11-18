import { expect, it } from 'vitest'
import { nvaBgpTopology } from '../../tests/fixtures/nva-bgp'
import { simulateAzNet } from './engine'
import { parseAzNetJson } from './admission'
import { validateAzNetTopology } from './model'
import { azArsPolicyLinks } from './ars-route-maps'

it.each(['ExpressRoute', 'Vpn', 'none'] as const)('reports gateway-summary exports as unassessed for %s without inventing NVA received routes', (kind) => {
  for (const branchToBranch of [false, true]) {
    const topology = nvaBgpTopology()
    const west = topology.vnets[0]
    west.routeServer!.branchToBranchTraffic = branchToBranch
    if (kind !== 'none') {
      west.subnets.push({ id: 'gateway-subnet', name: 'GatewaySubnet', prefix: '10.10.254.0/27' })
      west.gateways.push({ id: 'gateway', name: 'Gateway', kind, enabled: true, bgpEnabled: true, asn: 65515, activeActive: true })
    }
    const baseline = simulateAzNet(topology)
    west.summarizedGatewayPrefixes = ['10.0.0.0/12', '203.0.113.0/24']
    const result = simulateAzNet(parseAzNetJson(JSON.stringify(topology)))
    for (const nvaId of ['west-source', 'reader']) {
      const peer = result.nvaBgpPeers![nvaId].find((peer) => peer.routeServerId === 'west-ars')!
      expect(peer.gatewaySummaryAssessment).toEqual({
        status: 'not-assessed', configuredPrefixes: ['10.0.0.0/12', '203.0.113.0/24'],
        gatewayIds: kind === 'none' ? [] : ['gateway'],
        gatewaySubnetId: kind === 'none' ? undefined : 'gateway-subnet',
        branchToBranch,
      })
      expect(peer.routes).toEqual(baseline.nvaBgpPeers![nvaId].find((peer) => peer.routeServerId === 'west-ars')!.routes)
    }
    expect(result.nvaBgpPeers!.reader.find((peer) => peer.routeServerId === 'east-ars')!.gatewaySummaryAssessment).toBeUndefined()
    expect(result.subnetTables['west-nvas'].routes).toEqual(baseline.subnetTables['west-nvas'].routes)
    west.summarizedGatewayPrefixes = ['10.0.0.0/8']
    expect(simulateAzNet(topology).nvaBgpPeers!.reader[0].gatewaySummaryAssessment!.configuredPrefixes).toEqual(['10.0.0.0/8'])
    west.summarizedGatewayPrefixes = []
    expect(simulateAzNet(topology).nvaBgpPeers!.reader[0].gatewaySummaryAssessment).toBeUndefined()
    delete west.summarizedGatewayPrefixes
    expect(simulateAzNet(topology)).toEqual(baseline)
  }
})

it('projects original per-NVA received candidates from two ARS without requiring gateway transit or selecting an NVA best path', () => {
  const topology = nvaBgpTopology()
  const original = JSON.stringify(topology)
  expect(validateAzNetTopology(topology)).toEqual([])
  const restored = parseAzNetJson(original)
  expect(restored).toEqual(topology)
  const result = simulateAzNet(restored)
  const peers = result.nvaBgpPeers!.reader
  expect(peers.map((peer) => [peer.routeServerId, peer.routeServerVnetId, peer.applianceId, peer.applianceVnetId, peer.state]))
    .toEqual([['west-ars', 'west', 'reader', 'shared', 'available'], ['east-ars', 'east', 'reader', 'shared', 'available']])
  expect(peers.every((peer) => peer.connectionId === 'vnet:shared' && peer.policyConnectionId === undefined)).toBe(true)
  const duplicates = peers.flatMap((peer) => peer.routes.filter((route) => route.prefix === '198.18.0.0/24'))
  expect(duplicates).toHaveLength(2)
  expect(duplicates.map((route) => [route.nextHopId, route.nextHopIp, route.asPath, route.communities, route.selectedByArs]))
    .toEqual([['west-source', '10.10.1.4', [65020], ['65020:1'], true], ['east-source', '10.11.1.4', [65021], ['65020:2'], true]])
  expect(peers[0].routes.some((route) => route.prefix === '198.19.0.0/24')).toBe(true)
  expect(peers[1].routes.some((route) => route.prefix === '198.19.1.0/24')).toBe(true)
  expect(peers.flatMap((peer) => peer.routes).some((route) => route.prefix === '192.0.2.0/24' || 'preferred' in route)).toBe(false)
  expect(result.subnetTables['reader-subnet'].routes.some((route) => route.prefix === '198.18.0.0/24')).toBe(false)
  expect(azArsPolicyLinks(topology.vnets[0], topology).some((link) => link.id === 'vnet:shared')).toBe(false)
  expect(JSON.stringify(topology)).toBe(original)
})

it('applies only supported outbound policy scopes, refreshes attributes, and rejects receiving-AS loops per original NVA', () => {
  const topology = nvaBgpTopology()
  const west = topology.vnets[0].routeServer!
  topology.vnetPeerings[0].aToB.allowGatewayTransit = true
  topology.vnetPeerings[0].bToA.useRemoteGateways = true
  west.routeMaps = [{ id: 'export', name: 'West export', rules: [{
    id: 'drop', prefixes: ['198.19.0.0/24'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate',
  }, {
    id: 'attributes', prefixes: ['198.18.0.0/24'], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend: [64501],
    modifications: [{ property: 'community', action: 'add', values: ['65000:229'] }], nextStep: 'terminate',
  }] }]
  west.routeMapAssignments = [{ connectionId: 'vnet:shared', outboundMapId: 'export' }]
  expect(validateAzNetTopology(topology)).toEqual([])
  let peers = simulateAzNet(topology).nvaBgpPeers!.reader
  expect(peers[0].policyConnectionId).toBe('vnet:shared')
  expect(peers[0].routes.some((route) => route.prefix === '198.19.0.0/24')).toBe(false)
  expect(peers[0].routes.find((route) => route.prefix === '198.18.0.0/24')).toMatchObject({
    asPath: [64501, 65020], communities: ['65020:1', '65000:229'], routeMapTrace: [expect.stringContaining('West export')],
  })
  expect(peers[1].routes.find((route) => route.prefix === '198.18.0.0/24')?.asPath).toEqual([65021])
  west.routeMaps[0].rules[1].prepend = [65010]
  peers = simulateAzNet(topology).nvaBgpPeers!.reader
  expect(peers[0].routes.some((route) => route.prefix === '198.18.0.0/24')).toBe(false)
  const host = topology.vnets[2]
  host.appliances.push({ ...host.appliances[0], id: 'second-reader', name: 'Second NVA', asn: 65040, privateIp: '10.30.1.5', advertisedPrefixes: [] })
  west.peerApplianceIds.push('second-reader')
  const result = simulateAzNet(parseAzNetJson(JSON.stringify(topology)))
  expect(result.nvaBgpPeers!['second-reader'][0].routes.find((route) => route.prefix === '198.18.0.0/24')?.asPath).toEqual([65010, 65020])
  expect(result.nvaBgpPeers!['west-source'][0].routes.some((route) => route.prefix === '192.0.2.0/24')).toBe(true)
  west.routeMaps[0].rules[1].prepend = []
  west.routeMaps[0].rules[0].prefixes = ['192.0.2.0/24']
  west.routeMapAssignments = [{ connectionId: 'nva:west-source', outboundMapId: 'export' }]
  expect(simulateAzNet(topology).nvaBgpPeers!['west-source'][0].routes.some((route) => route.prefix === '192.0.2.0/24')).toBe(false)
})

it('keeps unavailable peer identities and separates BGP reception from NIC forwarding and peer membership', () => {
  const topology = nvaBgpTopology()
  const reader = topology.vnets[2].appliances[0]
  reader.enableIpForwarding = false
  expect(simulateAzNet(topology).nvaBgpPeers!.reader.every((peer) => peer.state === 'available' && peer.routes.length > 0)).toBe(true)
  topology.vnets[1].routeServer!.enabled = false
  let peers = simulateAzNet(topology).nvaBgpPeers!.reader
  expect(peers[0].state).toBe('available')
  expect(peers[1]).toMatchObject({ routeServerId: 'east-ars', state: 'ars-disabled', routes: [] })
  topology.vnetPeerings[0].enabled = false
  expect(simulateAzNet(topology).nvaBgpPeers!.reader[0]).toMatchObject({ state: 'unreachable', routes: [] })
  topology.vnetPeerings[0].enabled = true
  topology.vnetPeerings[0].aToB.allowVirtualNetworkAccess = false
  expect(simulateAzNet(topology).nvaBgpPeers!.reader[0]).toMatchObject({ state: 'unreachable', routes: [] })
  topology.vnetPeerings[0].aToB.allowVirtualNetworkAccess = true
  reader.bgpEnabled = false
  expect(simulateAzNet(topology).nvaBgpPeers!.reader[0]).toMatchObject({ state: 'bgp-disabled', routes: [] })
  reader.bgpEnabled = true
  reader.asn = 65515
  expect(simulateAzNet(topology).nvaBgpPeers!.reader[0]).toMatchObject({ state: 'unsupported-asn', routes: [] })
  topology.vnets[0].routeServer!.peerApplianceIds = ['west-source']
  peers = simulateAzNet(topology).nvaBgpPeers!.reader
  expect(peers.map((peer) => peer.routeServerId)).toEqual(['east-ars'])
})
