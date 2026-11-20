import { expect, it } from 'vitest'
import { vpnErTopology } from '../../tests/fixtures/vpn-er'
import { executePlatform } from '../platform/service'
import { inspectAzBgp } from '../bgp-neighbors'
import { parseAzNetTopology } from './admission'
import { importAzNetCapture } from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { lookupSubnetEffectiveRoute, simulateAzNet, traceAzNetPair } from './engine'

const pair = (topology = vpnErTopology()) => traceAzNetPair(topology, simulateAzNet(topology),
  { kind: 'subnet', vnetId: 'hub', subnetId: 'app' }, '10.0.1.4', { kind: 'site', siteId: 'site' }, '192.168.10.4')

it('resolves independent private endpoint routes and models both workload directions over the overlay on one site', () => {
  const topology = parseAzNetTopology(vpnErTopology())
  const simulation = simulateAzNet(topology)
  expect(simulation.vpnUnderlays!.s2s).toMatchObject({ state: 'available', outwardRoute: '10.0.0.0/16', returnRoute: '172.16.0.0/24' })
  expect(lookupSubnetEffectiveRoute(simulation.subnetTables.app, '192.168.10.4')?.nextHopResourceId).toBe('vpn')
  expect(simulation.gatewayRibs['er-gw'].some((route) => route.prefix === '192.168.10.0/24')).toBe(false)
  expect(simulation.gatewayRibs.vpn.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
  const flow = pair(topology)
  for (const direction of [flow.forward, flow.reverse]) {
    expect(direction.status).toBe('delivered')
    expect(direction.vpnProtection?.[0].protection).toBe('intended-ipsec')
    expect(direction.hops.some((hop) => hop.detail.includes('172.16.0.4 <-> 10.0.255.4'))).toBe(true)
  }
})

it.each(['site-link', 'azure-link', 'er-gateway', 'endpoint-route', 'recursive', 'gateway-subnet-udr', 'private-ip-off'] as const)(
  'withdraws dependent VPN routes when the ER underlay fails: %s', (failure) => {
    const topology = vpnErTopology()
    if (failure === 'site-link') topology.erLinks[1].enabled = false
    if (failure === 'azure-link') topology.erLinks[0].enabled = false
    if (failure === 'er-gateway') topology.vnets[0].gateways[1].enabled = false
    if (failure === 'endpoint-route') topology.erLinks[1].advertisedPrefixes = []
    if (failure === 'recursive') topology.erLinks[1].advertisedPrefixes = ['192.168.10.0/24']
    if (failure === 'private-ip-off') topology.vnets[0].gateways[0].enablePrivateIpAddress = false
    if (failure === 'gateway-subnet-udr') {
      topology.vnets[0].subnets[0].routeTableId = 'drop'
      topology.udrTables.push({ id: 'drop', name: 'Endpoint blackhole', region: 'West Europe', disableBgpRoutePropagation: false,
        routes: [{ id: 'drop-endpoint', name: 'Drop endpoint', prefix: '172.16.0.4/32', nextHopType: 'None', enabled: true }] })
    }
    const simulation = simulateAzNet(topology)
    expect(simulation.vpnUnderlays!.s2s.state).toBe('unavailable')
    expect(simulation.gatewayRibs.vpn.some((route) => route.originProtocol === 'VPN')).toBe(false)
    expect(pair(topology).forward.traversedEdgeIds).not.toContain('s2s')
    const bgp = inspectAzBgp(topology, simulation)
    expect(bgp.neighbors.filter((neighbor) => neighbor.connectionId === 's2s').every((neighbor) => neighbor.availability !== 'available')).toBe(true)
    expect(bgp.managedRelationships.filter((relationship) => relationship.connectionId === 's2s').every((relationship) => !relationship.enabled)).toBe(true)
  })

it('preserves independent Internet VPN and ER routes when a private overlay fails', () => {
  const topology = vpnErTopology()
  topology.vpnConnections.push({ id: 'internet', name: 'Independent Internet VPN', siteId: 'site', targetId: 'vpn',
    targetKind: 'vnet-gateway', bgpEnabled: true, enabled: true, advertisedPrefixes: ['192.168.10.0/24'] })
  topology.erLinks[0].enabled = false
  expect(simulateAzNet(topology).gatewayRibs.vpn.some((route) => route.connectionId === 'internet')).toBe(true)
  topology.erLinks[0].enabled = true
  topology.vpnConnections[0].enabled = false
  const result = simulateAzNet(topology)
  expect(result.gatewayRibs['er-gw'].some((route) => route.prefix === '172.16.0.0/24')).toBe(true)
})

it('selects more-specific overlay routes and reports direct ER aggregate fallback when the overlay is withdrawn', () => {
  const topology = vpnErTopology()
  topology.sites[0].prefixes.push('192.168.0.0/16')
  topology.erLinks[1].advertisedPrefixes!.push('192.168.0.0/16')
  expect(pair(topology).forward.vpnProtection?.[0].protection).toBe('intended-ipsec')
  topology.vpnConnections[0].advertisedPrefixes = []
  const forward = pair(topology).forward
  expect(forward.status).toBe('delivered')
  expect(forward.vpnProtection?.[0].protection).toBe('direct-er-without-ipsec')
  expect(forward.summaryReason).toContain('without IPsec')
})

it('prefers equal-prefix direct ER at Azure and does not infer a protected return path without on-prem policy', () => {
  const topology = vpnErTopology()
  topology.erLinks[1].advertisedPrefixes!.push('192.168.10.0/24')
  const flow = pair(topology)
  expect(flow.forward.vpnProtection?.[0].protection).toBe('direct-er-without-ipsec')
  expect(flow.reverse.vpnProtection?.[0].protection).toBe('intended-ipsec')
  delete topology.sites[0].routeMapAssignments
  const reverse = pair(topology).reverse
  expect(reverse.vpnProtection?.[0].protection).toBe('direct-er-without-ipsec')
})

it.each(['static', 'active-active', 'unknown-capability', 'missing-path'] as const)('reports unsupported scope honestly: %s', (scope) => {
  const topology = vpnErTopology()
  if (scope === 'static') topology.vpnConnections[0].bgpEnabled = false
  if (scope === 'active-active') topology.vnets[0].gateways[0].activeActive = true
  if (scope === 'unknown-capability') delete topology.vnets[0].gateways[0].publicIpSku
  if (scope === 'missing-path') delete topology.vpnConnections[0].underlay
  const simulation = simulateAzNet(topology)
  expect(simulation.vpnUnderlays!.s2s.state).toBe('not-assessed')
  expect(pair(topology).forward.status).toBe('not-assessed')
})

it('round-trips explicit scopes, rejects malformed fields and refuses a misleading public-VPN Bicep export', () => {
  const topology = vpnErTopology()
  expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
  expect(() => generateAzNetBicep(topology)).toThrow('not deployed')
  const malformed = JSON.parse(JSON.stringify(topology))
  malformed.vpnConnections[0].underlay.onPremEndpoint = 'invalid'
  expect(() => parseAzNetTopology(malformed)).toThrow('IPv4')
  delete topology.vpnConnections[0].underlay
  delete topology.vpnConnections[0].useLocalAzureIpAddress
  expect(simulateAzNet(topology).vpnUnderlays).toBeUndefined()
})

it('publishes the same outer context and directional protection in headless evidence', () => {
  const topology = vpnErTopology()
  const result = executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
    requirements: [{ id: 'overlay', kind: 'flow', source: { kind: 'subnet', vnetId: 'hub', subnetId: 'app' },
      target: { kind: 'site', siteId: 'site' }, sourceAddress: '10.0.1.4', destinationAddress: '192.168.10.4', expectation: 'allow' }] })
  expect(result.status).toBe('complete')
  expect(result.assessments[0].outcome).toBe('satisfied')
  expect(JSON.stringify(result.assessments[0].evidence)).toContain('intended-ipsec')
  expect(JSON.stringify(result.simulation)).toContain('172.16.0.4')
})

it.each([true, false])('does not import captured private VPN as independent Internet VPN (ARM=%s)', (nested) => {
  const shape = (name: string, properties: object) => ({ id: `/synthetic/${name}`, name, ...(nested ? { properties } : properties) })
  const topology = importAzNetCapture({
    kind: 'azure-network-capture', version: 2, resourceGroup: 'synthetic',
    vnets: [{ name: 'hub', addressSpace: { addressPrefixes: ['10.0.0.0/16'] }, subnets: [] }],
    vnetGateways: [{ ...shape('vpn', { gatewayType: 'Vpn', enablePrivateIpAddress: true }), vnetName: 'hub' }],
    localNetworkGateways: [shape('site', { localNetworkAddressSpace: { addressPrefixes: ['172.16.0.0/24'] } })],
    vpnConnections: [shape('private', { useLocalAzureIpAddress: true, virtualNetworkGateway1: { id: '/synthetic/vpn' },
      localNetworkGateway2: { id: '/synthetic/site' } })],
  }).topology
  expect(topology.vnets[0].gateways[0].enablePrivateIpAddress).toBe(true)
  expect(topology.vpnConnections[0].useLocalAzureIpAddress).toBe(true)
  expect(Object.values(simulateAzNet(topology).vpnUnderlays!)[0].state).toBe('not-assessed')
})
