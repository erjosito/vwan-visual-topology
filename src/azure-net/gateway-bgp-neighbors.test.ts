import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { importAzNetCapture } from './azure-import'
import { inspectAzBgp, inspectVwanBgp, bgpResourceKey } from '../bgp-neighbors'
import { simulateAzNet } from './engine'
import { parseAzNetJson } from './admission'
import { bgpNeighborTopology } from '../../tests/fixtures/bgp-neighbors'
import { example } from '../model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import GatewayBgpNeighborsPanel from './GatewayBgpNeighborsPanel'
import CapturedGatewayRoutes from './CapturedGatewayRoutes'
import { capturedArsRoutes as capturedBgpRoutes } from './captured-ars-routes'

const fixture = () => JSON.parse(readFileSync(resolve('tests', 'fixtures', 'gateway-bgp-capture.json'), 'utf8'))

const endpointCapture = () => {
  const capture = fixture()
  const id = '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/capture-test/providers/Microsoft.Network/virtualNetworkGateways/vpn-aa'
  capture.vnetGateways = [{
    id, name: 'vpn-aa', gatewayType: 'Vpn', activeActive: true,
    ipConfigurations: [{ id: `${id}/ipConfigurations/first` }, { id: `${id}/ipConfigurations/second` }],
    bgpSettings: { asn: 65515, bgpPeeringAddresses: [
      { ipconfigurationId: `${id}/ipConfigurations/second`, defaultBgpIpAddresses: ['10.1.0.5'], customBgpIpAddresses: ['169.254.21.2'], tunnelIpAddresses: ['198.51.100.2'] },
      { ipconfigurationId: `${id}/ipConfigurations/first`, defaultBgpIpAddresses: ['10.1.0.4'], customBgpIpAddresses: [], tunnelIpAddresses: ['198.51.100.1'] },
    ] },
  }]
  return capture
}

it('preserves native VPN IP-configuration associations independently of returned ordering, without assigning physical roles or session state', () => {
  const capture = endpointCapture()
  const before = JSON.stringify(capture)
  const result = importAzNetCapture(capture)
  const endpoints = result.observations!.vngBgpEndpoints!['vpn-aa']
  expect(endpoints.map((endpoint) => [endpoint.ipConfigurationId.split('/').at(-1), endpoint.defaultBgpIpAddresses]))
    .toEqual([['second', ['10.1.0.5']], ['first', ['10.1.0.4']]])
  expect(endpoints[0].customBgpIpAddresses).toEqual(['169.254.21.2'])
  expect(endpoints[0].tunnelIpAddresses).toEqual(['198.51.100.2'])
  expect(JSON.stringify(result.topology)).not.toContain('198.51.100.2')
  expect(JSON.stringify(capture)).toBe(before)
  const html = renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations: result.observations! }))
  expect(html).toContain('Native VPN IP configurations')
  expect(html).toContain('not physical instance identities')
  expect(html).not.toContain('<option value="198.51.100.2"')
  expect(html).toContain('<option value="169.254.21.2"')
  endpoints[0].defaultBgpIpAddresses.push('10.1.0.6')
  expect(JSON.stringify(capture)).toBe(before)
})

it('retains configuration-only endpoints without claiming neighbors or creating a standby session', () => {
  const capture = endpointCapture()
  delete capture.vngBgpPeerStatus
  capture.vnetGateways[0].activeActive = false
  capture.vnetGateways[0].bgpSettings.bgpPeeringAddresses = [capture.vnetGateways[0].bgpSettings.bgpPeeringAddresses[1]]
  const observations = importAzNetCapture(capture).observations!
  expect(observations.vngBgpEndpoints!['vpn-aa']).toHaveLength(1)
  expect(observations.vngBgpPeerStatus).toBeUndefined()
  const html = renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations }))
  expect(html).toContain('No neighbor observations were captured for this endpoint')
  expect(html).not.toContain('captured-gateway-neighbor-table')
})

it('does not invent associations for foreign configuration IDs, malformed IPs or oversized native endpoint inventories', () => {
  for (const corrupt of [
    (entry: Record<string, unknown>) => { entry.ipconfigurationId = '/foreign/ipConfigurations/second' },
    (entry: Record<string, unknown>) => { entry.defaultBgpIpAddresses = ['not-an-ip'] },
    (entry: Record<string, unknown>) => { entry.tunnelIpAddresses = Array(65).fill('198.51.100.2') },
  ]) {
    const capture = endpointCapture()
    corrupt(capture.vnetGateways[0].bgpSettings.bgpPeeringAddresses[0])
    const result = importAzNetCapture(capture)
    expect(result.observations!.vngBgpEndpoints!['vpn-aa']).toHaveLength(1)
    expect(result.unknownAddressing.some((item) => item.field === 'native VPN BGP endpoint association')).toBe(true)
  }
  const observations = importAzNetCapture(endpointCapture()).observations!
  observations.vngBgpEndpoints!['vpn-aa'][0].tunnelIpAddresses = ['invalid']
  const html = renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations }))
  expect(html).toContain('Malformed native endpoint metadata cannot establish an instance association')
})

it('retains both documented ARS neighbors and both original ARS resources without inventing endpoint IPs or changing the design', () => {
  const topology = bgpNeighborTopology()
  const simulation = simulateAzNet(topology)
  const before = JSON.stringify({ topology, simulation })
  const result = inspectAzBgp(topology, simulation)
  const reader = result.resources.find((resource) => resource.id === 'reader')!
  const neighbors = result.neighbors.filter((neighbor) => neighbor.localResourceKey === reader.key)
  expect(reader.instances).toHaveLength(1)
  expect(reader.instances[0].address).toBe('10.30.1.4')
  expect(neighbors).toHaveLength(4)
  expect(new Set(neighbors.map((neighbor) => neighbor.id)).size).toBe(4)
  expect(new Set(neighbors.map((neighbor) => neighbor.remoteResourceKey)).size).toBe(2)
  expect(neighbors.every((neighbor) => neighbor.availability === 'available')).toBe(true)
  expect(neighbors.flatMap((neighbor) => neighbor.received!.routes.filter((route) => route.prefix === '198.18.0.0/24'))).toHaveLength(4)
  for (const neighbor of neighbors) {
    const remote = result.resources.find((resource) => resource.key === neighbor.remoteResourceKey)!
    expect(remote.instances).toHaveLength(2)
    expect(remote.instances.every((instance) => instance.address === undefined)).toBe(true)
    const reversed = result.neighbors.find((candidate) => candidate.relationshipId === neighbor.relationshipId
      && candidate.localInstanceId === neighbor.remoteInstanceId && candidate.remoteInstanceId === neighbor.localInstanceId)!
    expect(reversed).toBeDefined()
    expect(reversed.id).not.toBe(neighbor.id)
    expect(reversed.advertised!.routes).toEqual(neighbor.received!.routes)
  }
  const west = result.resources.find((resource) => resource.id === 'west-ars')!
  expect(west.instances.map((instance) => result.neighbors.filter((neighbor) =>
    neighbor.localInstanceId === instance.id).length)).toEqual([2, 2])
  expect(JSON.stringify({ topology, simulation })).toBe(before)
  for (const vnet of topology.vnets) {
    vnet.name += ' renamed'
    if (vnet.routeServer) vnet.routeServer.name += ' renamed'
    for (const app of vnet.appliances) app.name += ' renamed'
  }
  expect(inspectAzBgp(parseAzNetJson(JSON.stringify(topology)), simulateAzNet(topology)).neighbors.map((neighbor) => neighbor.id))
    .toEqual(result.neighbors.map((neighbor) => neighbor.id))
})

it('distinguishes pre-policy NVA advertisements from post-policy ARS reception without mixing same-VNet peers', () => {
  const topology = bgpNeighborTopology()
  const ars = topology.vnets[0].routeServer!
  ars.routeMaps = [{ id: 'drop', name: 'Drop one original', rules: [{
    id: 'drop-route', prefixes: ['198.18.0.0/24'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate',
  }] }]
  ars.routeMapAssignments = [{ connectionId: 'nva:west-source', inboundMapId: 'drop' }]
  const simulation = simulateAzNet(topology)
  const result = inspectAzBgp(topology, simulation)
  const nva = result.neighbors.find((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'appliance', id: 'west-source' }))!
  const arsView = result.neighbors.find((neighbor) => neighbor.localInstanceId === nva.remoteInstanceId && neighbor.remoteInstanceId === nva.localInstanceId)!
  expect(nva.advertised!.routes.map((route) => route.prefix)).toContain('198.18.0.0/24')
  expect(arsView.received!.routes.map((route) => route.prefix)).not.toContain('198.18.0.0/24')
  expect(arsView.received!.scope).toBe('received-post-policy')
  expect(arsView.received!.routes.map((route) => route.prefix)).toContain('198.19.0.0/24')
  expect(nva.peerReceived!.routes).toEqual(arsView.received!.routes)
})

it('keeps known zero-prefix relationships distinct from disabled, unsupported and missing evidence', () => {
  const topology = bgpNeighborTopology()
  topology.vnets[0].appliances[0].advertisedPrefixes = []
  const get = () => inspectAzBgp(topology, simulateAzNet(topology)).neighbors.filter((neighbor) =>
    neighbor.localResourceKey === bgpResourceKey({ kind: 'appliance', id: 'west-source' }))
  expect(get().map((neighbor) => [neighbor.availability, neighbor.advertised?.routes])).toEqual([['available', []], ['available', []]])
  topology.vnets[0].routeServer!.enabled = false
  expect(get().map((neighbor) => [neighbor.availability, neighbor.received, neighbor.advertised]))
    .toEqual([['unavailable', undefined, undefined], ['unavailable', undefined, undefined]])
  topology.vnets[0].routeServer!.enabled = true
  topology.vnets[0].appliances[0].bgpEnabled = false
  expect(get().every((neighbor) => neighbor.availability === 'unavailable')).toBe(true)
  topology.vnets[0].appliances[0].bgpEnabled = true
  topology.vnets[0].appliances[0].asn = 65515
  expect(get().every((neighbor) => neighbor.availability === 'unavailable')).toBe(true)
  expect(inspectAzBgp(topology).neighbors.filter((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'appliance', id: 'west-source' }))
    .every((neighbor) => neighbor.availability === 'not-assessed' && neighbor.received === undefined)).toBe(true)
  const partial = { ...simulateAzNet(topology), controlPlaneComplete: false }
  expect(inspectAzBgp(topology, partial).neighbors.filter((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'appliance', id: 'reader' }))
    .every((neighbor) => neighbor.availability === 'not-assessed' && neighbor.received === undefined && neighbor.advertised === undefined)).toBe(true)
})

it('retains individual NVA provenance when two peered-VNet neighbors share a route-map connection', () => {
  const topology = bgpNeighborTopology()
  const host = topology.vnets.find((vnet) => vnet.id === 'shared')!
  host.appliances.push({
    ...host.appliances[0], id: 'reader-two', name: 'Another reader', privateIp: '10.30.1.5',
    advertisedPrefixes: ['192.0.2.0/24', '192.0.3.0/24'],
  })
  const ars = topology.vnets[0].routeServer!
  ars.peerApplianceIds.push('reader-two')
  ars.routeMaps = [{ id: 'shared-drop', name: 'Shared connection policy', rules: [{
    id: 'drop-original', prefixes: ['192.0.2.0/24'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate',
  }] }]
  ars.routeMapAssignments = [{ connectionId: 'vnet:shared', inboundMapId: 'shared-drop' }]
  const result = inspectAzBgp(topology, simulateAzNet(topology))
  for (const [id, received] of [['reader', []], ['reader-two', ['192.0.3.0/24']]] as const) {
    const peers = result.neighbors.filter((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'route-server', id: 'west-ars' })
      && neighbor.remoteResourceKey === bgpResourceKey({ kind: 'appliance', id }))
    expect(peers).toHaveLength(2)
    for (const peer of peers) {
      expect(peer.connectionId).toBe('vnet:shared')
      expect(peer.received!.routes.map((route) => route.prefix)).toEqual(received)
      expect(peer.received!.routes.every((route) => route.evidence.nextHopId === id)).toBe(true)
      const reverse = result.neighbors.find((neighbor) => neighbor.localInstanceId === peer.remoteInstanceId
        && neighbor.remoteInstanceId === peer.localInstanceId)!
      expect(reverse.advertised!.routes.map((route) => route.prefix)).toEqual(id === 'reader' ? ['192.0.2.0/24'] : ['192.0.2.0/24', '192.0.3.0/24'])
      expect(reverse.advertised!.routes.every((route) => route.evidence.nextHopId === id)).toBe(true)
    }
  }
})

it('shows two active VPN perspectives, a single standalone active perspective, and unknown legacy multiplicity without fabricating a full mesh', () => {
  const topology = bgpNeighborTopology()
  const result = inspectAzBgp(topology, simulateAzNet(topology))
  const aa = result.resources.find((resource) => resource.id === 'vpn-aa')!
  const standby = result.resources.find((resource) => resource.id === 'vpn-as')!
  expect(aa.instances.map((instance) => instance.role)).toEqual(['vpn-1', 'vpn-2'])
  expect(standby.instances.map((instance) => instance.role)).toEqual(['vpn-active'])
  for (const instance of [...aa.instances, ...standby.instances]) {
    expect(result.neighbors.filter((neighbor) => neighbor.localInstanceId === instance.id)).toHaveLength(1)
  }
  expect(result.neighbors.filter((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'site', id: 'branch' }))).toHaveLength(3)
  delete topology.vnets[0].gateways[0].activeActive
  const legacy = inspectAzBgp(topology, simulateAzNet(topology))
  expect(legacy.resources.find((resource) => resource.id === 'vpn-aa')!.instances).toEqual([])
  expect(legacy.managedRelationships.find((relationship) => relationship.connectionId === 'branch-aa')).toBeDefined()
  expect(legacy.managedRelationships.find((relationship) => relationship.connectionId === 'gateway:vpn-aa'))
    .toMatchObject({ enabled: false, reason: expect.stringContaining('65515') })
})

it('keeps disabled BGP, failure scenarios, B2B settings and opaque ER mappings distinct from actual session state', () => {
  const topology = bgpNeighborTopology()
  topology.vpnConnections[0].bgpEnabled = false
  topology.vnets[0].routeServer!.branchToBranchTraffic = false
  const result = inspectAzBgp(topology, simulateAzNet(topology), ['east'])
  expect(result.neighbors.filter((neighbor) => neighbor.connectionId === 'branch-aa')
    .every((neighbor) => neighbor.availability === 'unavailable' && neighbor.received === undefined)).toBe(true)
  expect(result.neighbors.filter((neighbor) => neighbor.localResourceKey === bgpResourceKey({ kind: 'route-server', id: 'east-ars' }))
    .every((neighbor) => neighbor.availability === 'unavailable')).toBe(true)
  expect(result.managedRelationships.find((relationship) => relationship.connectionId === 'gateway:vpn-aa'))
    .toMatchObject({ enabled: false, reason: expect.stringContaining('Branch-to-branch') })
  const er = result.resources.find((resource) => resource.id === 'edge-location')!
  expect(er.instances).toEqual([])
  expect(er.limitations.join(' ')).toContain('primary and secondary')
  expect(result.neighbors.some((neighbor) => neighbor.localResourceKey === er.key)).toBe(false)
  expect(result.managedRelationships.filter((relationship) => relationship.resourceKeys.includes(er.key))).toHaveLength(2)
  expect(inspectVwanBgp(example).resources.filter((resource) => resource.kind === 'vwan-hub')
    .every((resource) => resource.instances.length === 0)).toBe(true)
  expect(inspectVwanBgp(example).managedRelationships.length).toBeGreaterThan(0)
})

it('retains independently captured local BGP endpoints, distinct remote peers and actual zero counters without NIC observations', () => {
  const capture = fixture()
  const original = JSON.stringify(capture)
  const result = importAzNetCapture(capture)
  expect(result.observations?.vngBgpPeerStatus).toEqual(capture.vngBgpPeerStatus)
  expect(result.observations?.nicEffectiveRoutes).toEqual([])
  expect(result.observations?.capturedAt).toBe(capture.capturedAt)
  expect(result.observations?.observationVersion).toBeUndefined()
  expect(result.observations?.vngBgpPeerStatus?.['vpn-as'][0].routesReceived).toBeUndefined()
  expect(result.observations?.vngBgpPeerStatus?.['vpn-aa'][3].localAddress).toBeUndefined()
  expect(JSON.stringify(capture)).toBe(original)
  delete capture.capturedAt
  expect(importAzNetCapture(capture).observations?.capturedAt).toBe('')
  delete capture.vngBgpPeerStatus
  expect(importAzNetCapture(capture).observations).toBeUndefined()
})

it('rejects malformed or oversized neighbor observations rather than turning them into a successful empty table', () => {
  for (const value of [[], { 'vpn-aa': {} }, { 'vpn-aa': [null] },
    { 'vpn-aa': [{ asn: 4294967296 }] }, { 'vpn-aa': [{ routesReceived: -1 }] },
    { 'vpn-aa': [{ messagesSent: 0.1 }] }, { 'vpn-aa': [{ state: {} }] },
    { 'vpn-aa': Array.from({ length: 10001 }, () => ({})) }]) {
    const capture = fixture()
    capture.vngBgpPeerStatus = value
    expect(() => importAzNetCapture(capture)).toThrow(/BGP peer observation/)
  }
})

it.each(['arsLearnedRoutes', 'vngLearnedRoutes', 'arsAdvertisedRoutes'] as const)(
  'retains a BGP-only %s capture without depending on NIC routes or neighbor observations',
  (field) => {
    const capture = fixture()
    delete capture.vngBgpPeerStatus
    const routes = [
      { localAddress: '10.1.0.4', network: '203.0.113.0/24', nextHop: '10.1.0.4', asPath: '65515-65001', origin: 'Igp', weight: 0 },
      { localAddress: '10.1.0.5', network: '203.0.113.0/24', nextHop: '10.1.0.5', asPath: '65515-65001', origin: 'Igp', weight: 0 },
    ]
    capture[field] = { 'ars-a/same-peer': routes, 'ars-b/same-peer': [] }
    const original = JSON.stringify(capture)
    const result = importAzNetCapture(capture)
    expect(result.observations?.[field]).toEqual(capture[field])
    expect(result.observations?.nicEffectiveRoutes).toEqual([])
    expect(result.observations?.arsAdvertisedRoutes?.['ars-a/same-peer'][0].sourcePeer).toBeUndefined()
    expect(JSON.stringify(capture)).toBe(original)
  },
)

const routeFixture = () => JSON.parse(readFileSync(resolve('tests', 'fixtures', 'gateway-route-capture.json'), 'utf8'))
const advertisedFixture = () => JSON.parse(readFileSync(resolve('tests', 'fixtures', 'gateway-advertised-capture.json'), 'utf8'))

it('retains per-destination gateway advertisements without inventing a source peer, neighbor or saved route configuration', () => {
  const capture = advertisedFixture()
  delete capture.vngBgpPeerStatus
  delete capture.vngLearnedRoutes
  capture.sections = Object.fromEntries(Object.entries(capture.sections).filter(([key]) => key.startsWith('vngAdvertisedRoutes:')))
  capture.sections['vngAdvertisedRoutes:er-gateway'] = { state: 'failed', complete: false }
  const original = JSON.stringify(capture)
  const result = importAzNetCapture(capture)
  expect(result.observations!.vngAdvertisedRoutes).toEqual(capture.vngAdvertisedRoutes)
  expect(result.observations!.vngAdvertisedRoutes!['er-gateway']['192.0.2.9'][0].sourcePeer).toBeUndefined()
  expect(result.observations!.vngBgpPeerStatus).toBeUndefined()
  const html = renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations: result.observations! }))
  expect(html).toContain('Advertised to peer 192.0.2.9')
  expect(html).toContain('203.0.113.0/24')
  expect(html).not.toContain('198.51.100.0/24')
  expect(html).not.toContain('192.0.2.0/24')
  expect(html).toContain('do not prove peer acceptance')
  expect(html).toContain('Some peers or reads remain unknown')
  expect(html).not.toContain('data-testid="captured-gateway-neighbor-table"')
  expect(JSON.stringify(result.topology)).not.toContain('vngAdvertisedRoutes')
  expect(JSON.stringify(capture)).toBe(original)
})

it.each([null, [], { '192.0.2.9': null }, { '192.0.2.9': [{ network: '203.0.113.0/24', localAddress: {} }] },
  Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`peer-${i}`, []]))].map((value) => [value]))(
  'discloses malformed or oversized advertised observations instead of declaring complete empty coverage',
  (value) => {
    const capture = advertisedFixture()
    capture.vngAdvertisedRoutes = { 'er-gateway': value }
    const html = renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations: importAzNetCapture(capture).observations! }))
    expect(html).toContain('Malformed or oversized')
    expect(html).toContain('Unknown / incomplete')
  },
)

it('scopes native gateway routes by exact local address without reconciling contradictory counters or inventing a source peer', () => {
  const capture = routeFixture()
  const original = JSON.stringify(capture)
  const observations = importAzNetCapture(capture).observations!
  const html = renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations }))
  expect(html).toContain('203.0.113.0/24')
  expect(html).toContain('198.18.0.0/24')
  expect(html).not.toContain('198.51.100.0/24')
  expect(html).not.toContain('192.0.2.0/24')
  expect(html).toContain('truncated')
  expect(html).toContain('Unknown / incomplete')
  expect(html).toContain('>Connected<')
  expect(html).toContain('>0</td>')
  expect(html).toContain('Weight: 0')
  expect(html).toContain('65515-65001')
  expect(observations.vngLearnedRoutes).toEqual(capture.vngLearnedRoutes)
  expect(JSON.stringify(capture)).toBe(original)
})

it('matches only explicitly captured source peers, never forwarding next hops, and keeps unknown source rows inspectable', () => {
  const rows = routeFixture().vngLearnedRoutes['er-gateway'].filter((row: { localAddress?: string }) => row.localAddress === '10.1.0.4')
  const props = { gateway: 'er-gateway', address: '10.1.0.4', rows, rejected: false, onSourcePeerChange: () => {},
    selectedPage: 0, onPageChange: () => {} }
  const html = renderToStaticMarkup(createElement(CapturedGatewayRoutes, { ...props, sourcePeer: '["192.0.2.9"]' }))
  expect(html).toContain('198.51.100.1')
  expect(html).not.toContain('198.51.100.2')
  expect(html).not.toContain('198.18.0.0/24')
  const missing = renderToStaticMarkup(createElement(CapturedGatewayRoutes, { ...props, sourcePeer: '[""]' }))
  expect(missing).toContain('198.18.0.0/24')
  expect(missing).not.toContain('203.0.113.0/24')
})

it('shows route-only gateway captures without inventing neighbors and discloses malformed or empty route coverage', () => {
  const capture = routeFixture()
  delete capture.vngBgpPeerStatus
  capture.vngLearnedRoutes = { 'vpn-routes-only': capture.vngLearnedRoutes['vpn-routes-only'] }
  capture.sections = { 'vngLearnedRoutes:vpn-routes-only': capture.sections['vngLearnedRoutes:vpn-routes-only'] }
  const observations = importAzNetCapture(capture).observations!
  expect(renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations }))).toContain('172.16.0.0/16')
  expect(renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations }))).toContain('No neighbor observations')
  const parsed = capturedBgpRoutes([{ network: '172.16.0.0/16', localAddress: {} }])
  const html = renderToStaticMarkup(createElement(CapturedGatewayRoutes, {
    gateway: 'bad', rows: parsed.rows, rejected: parsed.rejected, section: { state: 'succeeded', complete: true },
    sourcePeer: '', onSourcePeerChange: () => {}, selectedPage: 0, onPageChange: () => {},
  }))
  expect(html).toContain('Malformed or oversized')
  expect(html).toContain('Unknown / incomplete')
  expect(html).toContain('Missing rows do not establish an empty learned-route table')
})

it('keeps native gateway route rows with null optional attributes, showing missing values rather than losing the prefix or inventing defaults', () => {
  const parsed = capturedBgpRoutes([{
    network: '172.16.0.0/16', localAddress: '10.1.0.4',
    sourcePeer: null, nextHop: null, asPath: null, origin: null, weight: null,
  }])
  expect(parsed).toEqual({ rows: [{ network: '172.16.0.0/16', localAddress: '10.1.0.4' }], rejected: false })
  expect(capturedBgpRoutes([{ network: null }])).toEqual({ rows: [], rejected: true })
})

it.each([[], { 'bad-gateway': null }, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`gateway-${i}`, []]))].map((value) => [value]))(
  'does not silently turn a malformed or oversized gateway route map into successful empty coverage',
  (vngLearnedRoutes) => {
    const capture = routeFixture()
    delete capture.vngBgpPeerStatus
    capture.vngLearnedRoutes = vngLearnedRoutes
    const observations = importAzNetCapture(capture).observations!
    expect(renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations }))).toContain('Malformed or oversized')
  },
)

it('retains failed gateway route command coverage even when no gateway returned a single route or neighbor row', () => {
  const capture = routeFixture()
  delete capture.vngBgpPeerStatus
  capture.vngLearnedRoutes = {}
  capture.sections = { 'vngLearnedRoutes:denied-gateway': { state: 'denied', complete: false } }
  const observations = importAzNetCapture(capture).observations!
  const html = renderToStaticMarkup(createElement(GatewayBgpNeighborsPanel, { observations }))
  expect(html).toContain('denied-gateway')
  expect(html).toContain('Gateway route capture coverage: denied · Unknown / incomplete')
  expect(html).toContain('Missing rows do not establish an empty learned-route table')
  expect(html).not.toContain('<tbody>')
})
