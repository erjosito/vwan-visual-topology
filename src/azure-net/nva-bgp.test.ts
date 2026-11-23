import { expect, it } from 'vitest'
import { nvaBgpTopology } from '../../tests/fixtures/nva-bgp'
import { simulateAzNet } from './engine'
import { parseAzNetJson } from './admission'
import { validateAzNetTopology } from './model'
import { azArsPolicyLinks } from './ars-route-maps'
import { bgpResourceKey, inspectAzBgp } from '../bgp-neighbors'

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

it('separates ARS-learned source provenance from received wire attributes without inventing managed endpoint IPs', () => {
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
    .toEqual([['west-ars', undefined, [65515, 65020], ['65020:1'], true], ['east-ars', undefined, [65515, 65021], ['65020:2'], true]])
  expect(duplicates.map((route) => [route.sourceRoute.nextHopId, route.sourceRoute.nextHopIp, route.sourceRoute.asPath]))
    .toEqual([['west-source', '10.10.1.4', [65020]], ['east-source', '10.11.1.4', [65021]]])
  expect(duplicates.every((route) => route.nextHopKind === 'route-server' && route.wireAttributes.nextHop === 'not-assessed')).toBe(true)
  expect(peers[0].routes.some((route) => route.prefix === '198.19.0.0/24')).toBe(true)
  expect(peers[1].routes.some((route) => route.prefix === '198.19.1.0/24')).toBe(true)
  expect(peers.flatMap((peer) => peer.routes).some((route) => route.prefix === '192.0.2.0/24' || 'preferred' in route)).toBe(false)
  expect(result.subnetTables['reader-subnet'].routes.some((route) => route.prefix === '198.18.0.0/24')).toBe(false)
  expect(azArsPolicyLinks(topology.vnets[0], topology).some((link) => link.id === 'vnet:shared')).toBe(false)
  expect(JSON.stringify(topology)).toBe(original)
  duplicates[0].sourceRoute.asPath.push(64512)
  expect(result.routeServerRibs['west-ars'].find((route) => route.prefix === '198.18.0.0/24')!.asPath).toEqual([65020])
})

it('gates different-VNet NVA reflection independently per ARS while retaining source learning, local NIC programming and VNet advertisements', () => {
  const topology = nvaBgpTopology()
  // Give the receiver an independent SDN propagation scope, not a new BGP eligibility rule.
  topology.vnetPeerings[0].aToB.allowGatewayTransit = true
  topology.vnetPeerings[0].bToA.useRemoteGateways = true
  topology.vnets[0].routeServer!.branchToBranchTraffic = false
  topology.vnets[1].routeServer!.branchToBranchTraffic = false
  const original = JSON.stringify(topology)
  const off = simulateAzNet(parseAzNetJson(original))
  for (const ars of ['west-ars', 'east-ars']) {
    expect(off.nvaBgpPeers!.reader.find((peer) => peer.routeServerId === ars)).toMatchObject({
      state: 'available', routes: [expect.objectContaining({ originProtocol: 'VNet', asPath: [65515] })],
      nvaReflection: { branchToBranch: false, scope: 'different-vnets', sameVnet: 'not-assessed' },
    })
    expect(off.routeServerRibs[ars].filter((route) => route.originProtocol === 'BGP-NVA')).toHaveLength(3)
  }
  expect(off.routeServerInbound!['west-ars']['nva:west-source'].map((route) => route.prefix)).toEqual(['198.18.0.0/24', '198.19.0.0/24'])
  expect(off.subnetTables['west-nvas'].routes).toEqual(expect.arrayContaining([
    expect.objectContaining({ prefix: '198.18.0.0/24', active: true, nextHopIp: '10.10.1.4', asPath: [65020] }),
  ]))
  expect(off.nvaBgpPeers!['west-source'][0].routes.some((route) => route.prefix === '192.0.2.0/24')).toBe(false)
  expect(off.routeServerOutbound!['west-ars']['nva:west-source'].some((route) => route.prefix === '192.0.2.0/24')).toBe(false)
  expect(off.routeServerOutbound!['west-ars']['vnet:shared'].some((route) => route.prefix === '198.18.0.0/24')).toBe(true)
  expect(off.subnetTables['reader-subnet'].routes.some((route) => route.prefix === '198.18.0.0/24' && route.active)).toBe(true)
  topology.vnets[0].routeServer!.branchToBranchTraffic = true
  const on = simulateAzNet(topology)
  expect(on.nvaBgpPeers!.reader[0].routes.filter((route) => route.originProtocol === 'BGP-NVA')).toHaveLength(2)
  expect(on.nvaBgpPeers!.reader[1]).toEqual(off.nvaBgpPeers!.reader[1])
  expect(on.nvaBgpPeers!['west-source'][0].routes.some((route) => route.prefix === '192.0.2.0/24')).toBe(true)
  expect(on.routeServerInbound).toEqual(off.routeServerInbound)
  expect(on.routeServerRibs).toEqual(off.routeServerRibs)
  expect(on.subnetTables).toEqual(off.subnetTables)
  const neighbors = (simulation: ReturnType<typeof simulateAzNet>) => inspectAzBgp(topology, simulation).neighbors
    .filter((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'appliance', id: 'reader' }))
  expect(neighbors(off)).toHaveLength(4)
  expect(neighbors(on).map((neighbor) => neighbor.id)).toEqual(neighbors(off).map((neighbor) => neighbor.id))
  expect(neighbors(off).every((neighbor) => neighbor.availability === 'available' && neighbor.received?.routes.length === 1)).toBe(true)
  expect(neighbors(on).map((neighbor) => neighbor.received!.routes.length).sort()).toEqual([1, 1, 3, 3])
  const unknown = inspectAzBgp(topology).neighbors.filter((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'appliance', id: 'reader' }))
  expect(unknown.every((neighbor) => neighbor.availability === 'not-assessed' && neighbor.received === undefined)).toBe(true)
  expect(JSON.stringify(parseAzNetJson(original))).toBe(original)
})

it('retains endpoint role identities through source filtering, withdrawal and restoration with an independent east control', () => {
  const topology = nvaBgpTopology()
  const source = topology.vnets[0].appliances[0]
  const baseline = simulateAzNet(topology)
  const identities = inspectAzBgp(topology, baseline).neighbors.map((neighbor) => neighbor.id)
  for (const prefixes of [['198.18.0.0/24'], [], ['198.18.0.0/24', '198.19.0.0/24']]) {
    source.advertisedPrefixes = prefixes
    source.advertisedRouteAttributes = prefixes.length ? [{ prefix: '198.18.0.0/24', communities: ['65020:1'] }] : []
    const original = JSON.stringify(topology)
    const result = simulateAzNet(parseAzNetJson(original))
    expect(result.nvaBgpPeers!.reader[0].routes.filter((route) => route.originProtocol === 'BGP-NVA').map((route) => route.prefix)).toEqual(prefixes)
    expect(result.nvaBgpPeers!.reader[1]).toEqual(baseline.nvaBgpPeers!.reader[1])
    const inspection = inspectAzBgp(topology, result)
    expect(inspection.neighbors.map((neighbor) => neighbor.id)).toEqual(identities)
    const west = inspection.neighbors.filter((neighbor) =>
      neighbor.localResourceKey === bgpResourceKey({ kind: 'appliance', id: 'reader' }) && neighbor.connectionId === 'vnet:shared' &&
      neighbor.remoteResourceKey === bgpResourceKey({ kind: 'route-server', id: 'west-ars' }))
    expect(west).toHaveLength(2)
    expect(west.every((neighbor) => neighbor.availability === 'available' && neighbor.received!.routes.length === prefixes.length + 1)).toBe(true)
    expect(west.flatMap((neighbor) => neighbor.received!.routes).every((route) => route.nextHop === undefined)).toBe(true)
    expect(JSON.stringify(topology)).toBe(original)
  }
})

it('retains legacy same-VNet prefix eligibility without claiming its flag behavior or wire attributes are qualified', () => {
  const topology = nvaBgpTopology()
  const west = topology.vnets[0]
  west.appliances.push({ ...topology.vnets[2].appliances[0], id: 'local-reader', subnetId: 'west-nvas', privateIp: '10.10.1.5', advertisedPrefixes: [] })
  west.routeServer!.peerApplianceIds.push('local-reader')
  west.routeServer!.branchToBranchTraffic = false
  const peer = simulateAzNet(topology).nvaBgpPeers!['local-reader'][0]
  const route = peer.routes.find((route) => route.prefix === '198.18.0.0/24')!
  expect(peer.nvaReflection?.sameVnet).toBe('not-assessed')
  expect(route).toMatchObject({ wireAttributes: { asPath: 'not-assessed', nextHop: 'not-assessed' }, sourceRoute: { asPath: [65020], nextHopIp: '10.10.1.4' } })
  expect(route.asPath).toBeUndefined()
  expect(route.nextHopIp).toBeUndefined()
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
    asPath: [65515, 64501, 65020], communities: ['65020:1', '65000:229'], routeMapTrace: [expect.stringContaining('West export')],
    sourceRoute: { asPath: [65020], communities: ['65020:1'], nextHopIp: '10.10.1.4' },
  })
  expect(peers[1].routes.find((route) => route.prefix === '198.18.0.0/24')?.asPath).toEqual([65515, 65021])
  west.routeMaps[0].rules[1].prepend = [65010]
  peers = simulateAzNet(topology).nvaBgpPeers!.reader
  expect(peers[0].routes.some((route) => route.prefix === '198.18.0.0/24')).toBe(false)
  const host = topology.vnets[2]
  host.appliances.push({ ...host.appliances[0], id: 'second-reader', name: 'Second NVA', asn: 65040, privateIp: '10.30.1.5', advertisedPrefixes: [] })
  west.peerApplianceIds.push('second-reader')
  const result = simulateAzNet(parseAzNetJson(JSON.stringify(topology)))
  expect(result.nvaBgpPeers!['second-reader'][0].routes.find((route) => route.prefix === '198.18.0.0/24')?.asPath).toEqual([65515, 65010, 65020])
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
