import { expect, it } from 'vitest'
import { vpnInstanceTopology, vpnMigrationSnapshots } from '../../tests/fixtures/vpn-instance'
import { inspectAzBgp } from '../bgp-neighbors'
import { executePlatform } from '../platform/service'
import { parseAzNetTopology } from './admission'
import { generateAzNetBicep } from './bicep-export'
import { simulateAzNet, traceAzNetFlow, traceAzNetPair } from './engine'
import { vpnTunnelKey } from './vpn-sessions'
import { importAzNetCapture } from './azure-import'

const key = (tunnel: string) => vpnTunnelKey(tunnel === 'internet-west' ? 'backup' : 'private', tunnel)
const pair = (topology = vpnInstanceTopology()) => traceAzNetPair(topology, simulateAzNet(topology),
  { kind: 'subnet', vnetId: 'hub', subnetId: 'app' }, '10.244.1.4', { kind: 'site', siteId: 'cpe' }, '10.246.1.4')

it('retains three configured adjacencies, explicit instance bindings and per-session routes on one CPE', () => {
  const topology = parseAzNetTopology(vpnInstanceTopology())
  const result = simulateAzNet(topology)
  expect(result.controlPlaneComplete).toBe(true)
  expect(Object.values(result.vpnTunnels!)).toHaveLength(3)
  expect(Object.values(result.vpnTunnels!).every((session) => session.state === 'available')).toBe(true)
  expect(result.vpnTunnels![key('private-west')]).toMatchObject({
    azureInstanceId: 'instance-west', cpeResourceId: 'cpe', bgp: { azureAddress: '10.244.255.30', cpeAddress: '10.245.254.6', initiator: 'either' },
    underlay: { state: 'available', outwardRoute: '10.244.0.0/16', returnRoute: '10.245.0.10/32' },
  })
  expect(result.vpnTunnels![key('internet-west')]).toMatchObject({
    bgp: { azureAddress: '169.254.21.2', cpeAddress: '169.254.21.1', initiator: 'cpe-required' },
  })
  const routes = result.gatewayRibs.vpn.filter((route) => route.prefix === '10.246.1.0/24')
  expect(routes.filter((route) => route.preferred).map((route) => route.vpnTunnelId).sort()).toEqual(['private-east', 'private-west'])
  expect(routes.find((route) => route.vpnTunnelId === 'internet-west')?.asPath).toEqual([64513, 64513, 64513])
  const inspection = inspectAzBgp(topology, result)
  expect(inspection.neighbors.filter((neighbor) => neighbor.localResourceKey === '["site","cpe"]')).toHaveLength(3)
  expect(new Set(inspection.neighbors.map((neighbor) => neighbor.relationshipId)).size).toBe(3)
  expect(inspection.neighbors.every((neighbor) => neighbor.availability === 'available')).toBe(true)
  expect(pair(topology).forward.vpnTunnelPaths).toContainEqual({ connectionId: 'private', tunnelIds: ['private-west', 'private-east'], protection: 'intended-ipsec' })
})

it.each(['initiation', 'custom-mapping', 'listener', 'source', 'context', 'remote-asn', 'gateway-bgp', 'outer-instance'] as const)(
  'withdraws only the ineligible adjacency without inventing static fallback: %s', (failure) => {
    const topology = vpnInstanceTopology()
    const backup = topology.vpnConnections[1], tunnel = backup.tunnels![0]
    if (failure === 'initiation') tunnel.bgp!.cpeInitiates = false
    if (failure === 'custom-mapping') backup.gatewayCustomBgpIpAddresses![0].customBgpIpAddress = '169.254.22.2'
    if (failure === 'listener') tunnel.bgp!.cpePeerAddress = '10.244.255.30'
    if (failure === 'source') topology.sites[0].vpnRouting!.localAddresses = ['10.245.254.6']
    if (failure === 'context') tunnel.bgp!.routingContextId = 'wrong-fib'
    if (failure === 'remote-asn') tunnel.bgp!.cpeRemoteAsn = 65514
    if (failure === 'gateway-bgp') topology.vnets[0].gateways[0].bgpEnabled = false
    if (failure === 'outer-instance') tunnel.transport.azureEndpoint = '198.51.100.11'
    const result = simulateAzNet(topology)
    expect(result.vpnTunnels![key('internet-west')].state).toBe('unavailable')
    expect(result.gatewayRibs.vpn.some((route) => route.connectionId === 'backup')).toBe(false)
    if (failure !== 'gateway-bgp') expect(result.vpnTunnels![key('private-east')].state).toBe('available')
  })

it('preserves independent observations, including an unexpected default-source attempt alongside valid APIPA', () => {
  const topology = vpnInstanceTopology()
  topology.vpnConnections[1].tunnels![0].observations = [
    { id: 'attempt', source: 'synthetic capture A', timestamp: '2026-11-25T10:00:00Z', azureAddress: '10.244.255.30', cpeAddress: '169.254.21.1', initiator: 'azure', state: 'attempt' },
    { id: 'exchange', source: 'synthetic capture B', timestamp: '2026-11-25T10:00:01Z', azureAddress: '169.254.21.2', cpeAddress: '169.254.21.1', initiator: 'cpe', state: 'observed exchange' },
  ]
  const snapshot = JSON.stringify(topology)
  const result = simulateAzNet(topology)
  expect(result.vpnTunnels![key('internet-west')].observations.map((entry) => entry.comparison)).toEqual(['mismatch', 'match'])
  expect(result.vpnTunnels![key('internet-west')].state).toBe('available')
  expect(result.vpnTunnels![key('private-west')].state).toBe('available')
  expect(JSON.stringify(topology)).toBe(snapshot)
})

it('explains shared-FIB peer redirection separately from workload preference and exposes the selected route', () => {
  const topology = vpnInstanceTopology()
  topology.sites[0].vpnRouting!.peerRoutes[0].nextHop = { kind: 'tunnel', connectionId: 'backup', tunnelId: 'internet-west' }
  const result = simulateAzNet(topology)
  expect(result.vpnTunnels![key('private-west')]).toMatchObject({
    state: 'unavailable', code: 'PEER_WRONG_TUNNEL', bgp: {
      cpeToAzure: { address: '10.244.255.30', sourceAddress: '10.245.254.6', contextId: 'shared-fib',
        routes: [{ tunnelId: 'internet-west', connectionId: 'backup', prefix: '10.244.255.30/32' }] },
    },
  })
  expect(result.vpnTunnels![key('private-east')].state).toBe('available')
  delete topology.sites[0].routeMapAssignments
  topology.vpnConnections[1].outboundPrepend = []
  expect(simulateAzNet(topology).vpnTunnels![key('private-east')].state).toBe('available')
})

it('uses the same longest-prefix/source-qualified CPE FIB for peer bindings and workload forwarding', () => {
  const topology = vpnInstanceTopology()
  topology.sites[0].vpnRouting!.peerRoutes.push({
    id: 'workload-policy', prefix: '10.244.0.0/16', sourceAddress: '10.246.1.4', enabled: true,
    nextHop: { kind: 'tunnel', connectionId: 'backup', tunnelId: 'internet-west' },
  })
  const result = simulateAzNet(topology)
  expect(Object.values(result.vpnTunnels!).every((tunnel) => tunnel.state === 'available')).toBe(true)
  expect(result.vpnTunnels![key('private-west')].bgp.cpeToAzure?.routes[0].tunnelId).toBe('private-west')
  const traces = pair(topology)
  expect(traces.forward.traversedEdgeIds).toContain('private')
  expect(traces.reverse.traversedEdgeIds).toContain('backup')
  expect(traces.reverse.vpnTunnelPaths).toContainEqual({ connectionId: 'backup', tunnelIds: ['internet-west'], protection: 'intended-ipsec' })
  expect(traces.reverse.hops.find((hop) => hop.cpeLookup)?.cpeLookup).toMatchObject({
    sourceAddress: '10.246.1.4', contextId: 'shared-fib', routes: [{ prefix: '10.244.0.0/16', tunnelId: 'internet-west' }],
  })
  const otherSource = traceAzNetFlow(topology, result, { kind: 'site', siteId: 'cpe' }, '10.244.1.4', { sourceAddress: '10.246.1.5' })
  expect(otherSource.traversedEdgeIds).toContain('private')
  expect(traceAzNetFlow(topology, result, { kind: 'site', siteId: 'cpe' }, '10.244.1.4').status).toBe('not-assessed')
})

it.each(['drop', 'er-link', 'disabled-tunnel'] as const)('honors a selected shared-FIB workload %s instead of silently using dynamic VPN routes', (kind) => {
  const topology = vpnInstanceTopology()
  topology.vpnConnections[0].tunnels![1].enabled = false
  topology.sites[0].vpnRouting!.peerRoutes.push({
    id: 'workload-next-hop', prefix: '10.244.1.0/24', enabled: true,
    nextHop: kind === 'drop' ? { kind: 'drop' } : kind === 'er-link' ? { kind: 'er-link', linkId: 'er-cpe' }
      : { kind: 'tunnel', connectionId: 'private', tunnelId: 'private-east' },
  })
  const trace = pair(topology).reverse
  expect(trace.status).toBe(kind === 'drop' ? 'dropped-blackhole' : kind === 'er-link' ? 'delivered' : 'dropped-no-route')
  expect(trace.traversedEdgeIds).not.toContain('private')
  expect(trace.traversedEdgeIds).not.toContain('backup')
  if (kind === 'er-link') expect(trace.vpnTunnelPaths?.every((path) => path.protection === 'direct-er-without-ipsec')).toBe(true)
})

it('does not hide an outer-endpoint static override in a separate underlay FIB', () => {
  const topology = vpnInstanceTopology()
  topology.sites[0].vpnRouting!.peerRoutes.push({
    id: 'recursive-outer', prefix: '10.244.255.0/27', enabled: true,
    nextHop: { kind: 'tunnel', connectionId: 'private', tunnelId: 'private-west' },
  })
  const result = simulateAzNet(topology)
  expect(result.vpnTunnels![key('private-west')]).toMatchObject({ state: 'unavailable', code: 'ER_UNDERLAY_INELIGIBLE' })
  expect(result.vpnTunnels![key('private-east')].state).toBe('unavailable')
  expect(result.vpnTunnels![key('internet-west')].state).toBe('available')
})

it('keeps missing instance ownership unknown and rejects reserved GatewaySubnet BGP addresses', () => {
  const topology = vpnInstanceTopology()
  delete topology.vnets[0].gateways[0].vpnInstances![0].privateIpAddress
  expect(simulateAzNet(topology).vpnTunnels![key('private-west')].state).toBe('not-assessed')
  topology.vnets[0].gateways[0].vpnInstances![1].defaultBgpIpAddresses = ['10.244.255.0']
  expect(simulateAzNet(topology).vpnTunnels![key('private-east')].code).toBe('DEFAULT_BGP_MAPPING_INVALID')
})

it.each(['private-outer', 'public-outer', 'default-bgp', 'apipa-range', 'other-cpe'] as const)(
  'rejects ambiguous/invalid instance or peer ownership: %s', (failure) => {
    const topology = vpnInstanceTopology()
    const instances = topology.vnets[0].gateways[0].vpnInstances!
    if (failure === 'private-outer') instances[1].privateIpAddress = instances[0].privateIpAddress
    if (failure === 'public-outer') instances[1].publicIpAddress = instances[0].publicIpAddress
    if (failure === 'default-bgp') instances[1].defaultBgpIpAddresses = [...instances[0].defaultBgpIpAddresses]
    if (failure === 'apipa-range') {
      instances[0].customBgpIpAddresses = ['169.254.20.2']
      topology.vpnConnections[1].gatewayCustomBgpIpAddresses![0].customBgpIpAddress = '169.254.20.2'
    }
    if (failure === 'other-cpe') topology.vpnConnections[0].bgpPeer!.address = '169.254.21.2'
    const assessment = simulateAzNet(topology).vpnTunnels![key(failure === 'private-outer' || failure === 'default-bgp' ? 'private-west' : 'internet-west')]
    expect(assessment.state).toBe('unavailable')
    expect(assessment.code).toBe(failure.endsWith('outer') ? 'OUTER_MAPPING_AMBIGUOUS' : failure === 'default-bgp'
      ? 'DEFAULT_BGP_MAPPING_AMBIGUOUS' : failure === 'apipa-range' ? 'CUSTOM_BGP_MAPPING_INVALID' : 'APIPA_ADDRESS_COLLISION')
  })

it('fails closed on dynamic self/cross-overlay peer-route feedback rather than bootstrapping a session from its own routes', () => {
  const topology = vpnInstanceTopology()
  topology.sites[0].vpnRouting!.peerRoutes = []
  const result = simulateAzNet(topology)
  expect(result.vpnTunnels![key('private-west')].code).toBe('PEER_ROUTE_RECURSION')
  expect(result.vpnTunnels![key('internet-west')].code).toBe('PEER_NO_ROUTE')
  expect(result.controlPlaneComplete).toBe(false)
  expect(pair(topology).forward.status).toBe('not-assessed')
})

it('withdraws/restores both private tunnels from ER-only failure, leaving Internet independent', () => {
  const topology = vpnInstanceTopology()
  topology.erLinks[0].enabled = false
  const result = simulateAzNet(topology)
  expect(result.vpnTunnels![key('private-west')].state).toBe('unavailable')
  expect(result.vpnTunnels![key('private-east')].state).toBe('unavailable')
  expect(result.vpnTunnels![key('internet-west')].state).toBe('available')
  expect(result.gatewayRibs.vpn.filter((route) => route.preferred).map((route) => route.vpnTunnelId)).toEqual(['internet-west'])
  expect(pair(topology).forward.traversedEdgeIds).toContain('backup')
  expect(pair(topology).reverse.traversedEdgeIds).toContain('backup')
  topology.erLinks[0].enabled = true
  expect(simulateAzNet(topology).gatewayRibs.vpn.filter((route) => route.preferred)).toHaveLength(2)
})

it.each(['instance', 'tunnel'] as const)('scopes a single %s failure to its original identities', (failure) => {
  const topology = vpnInstanceTopology()
  if (failure === 'instance') topology.vnets[0].gateways[0].vpnInstances![1].enabled = false
  else topology.vpnConnections[0].tunnels![1].enabled = false
  const result = simulateAzNet(topology)
  expect(result.vpnTunnels![key('private-east')].state).toBe('unavailable')
  expect(result.vpnTunnels![key('private-west')].state).toBe('available')
  expect(result.vpnTunnels![key('internet-west')].state).toBe('available')
  expect(result.gatewayRibs.vpn.filter((route) => route.preferred).map((route) => route.vpnTunnelId)).toEqual(['private-west'])
})

it('retains ordered identity-preserving static/BGP snapshots while explicitly declining SA/history reproduction', () => {
  const snapshots = vpnMigrationSnapshots()
  const results = snapshots.map(({ topology }) => simulateAzNet(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))))
  const original = JSON.stringify(snapshots)
  const internet = snapshots.map(({ topology }) => topology.vpnConnections[1])
  expect(new Set(internet.map((connection) => connection.id)).size).toBe(1)
  expect(new Set(internet.map((connection) => connection.tunnels![0].id)).size).toBe(1)
  expect(internet.every((connection) => connection.tunnels![0].ipsec === 'available')).toBe(true)
  expect(results[0].gatewayRibs.vpn.find((route) => route.prefix === '10.246.1.0/24')).toMatchObject({ connectionId: 'backup', asPath: [] })
  expect(results[1].gatewayRibs.vpn.filter((route) => route.prefix === '10.246.1.0/24')).toHaveLength(2)
  expect(results[2].gatewayRibs.vpn.filter((route) => route.prefix === '10.246.1.0/24')).toHaveLength(2)
  expect(results[3].vpnTunnels![key('internet-west')].bgp.state).toBe('available')
  expect(results[4].vpnTunnels![key('internet-west')].bgp.state).toBe('disabled')
  expect(results[4].gatewayRibs.vpn.some((route) => route.connectionId === 'backup')).toBe(false)
  expect(results[4].vpnTunnels![key('private-west')].state).toBe('available')
  expect(results.every((result) => result.vpnTransitionAssessment?.state === 'not-assessed')).toBe(true)
  expect(JSON.stringify(snapshots)).toBe(original)
})

it('installs explicit CPE static prefixes without depending on BGP origination or applying BGP import filters', () => {
  const topology = vpnMigrationSnapshots()[0].topology
  topology.vpnConnections[1].staticAzurePrefixes = ['10.244.1.0/24']
  topology.sites[0].routeMapAssignments!.push({ connectionId: 'backup', inboundMapId: 'deny-backup' })
  topology.routeMaps!.push({ id: 'deny-backup', name: 'No backup BGP imports', siteId: 'cpe', rules: [{
    id: 'deny-all', prefixes: ['10.244.0.0/16'], match: 'contains', action: 'drop', prepend: [], summaryPrefixes: [], nextStep: 'terminate',
  }] })
  const result = simulateAzNet(parseAzNetTopology(topology))
  expect(result.siteRibs.cpe.find((route) => route.prefix === '10.244.1.0/24')).toMatchObject({
    preferred: true, connectionId: 'backup', originProtocol: 'Static', vpnStatic: true, asPath: [],
  })
  expect(pair(topology).reverse.status).toBe('delivered')
})

it('keeps Azure export prepends independent of CPE import selection and identifies direct ER bypass', () => {
  const topology = vpnInstanceTopology()
  delete topology.sites[0].routeMapAssignments
  const result = simulateAzNet(topology)
  expect(result.gatewayRibs.vpn.filter((route) => route.preferred).every((route) => route.connectionId === 'private')).toBe(true)
  expect(result.siteRibs.cpe.filter((route) => route.preferred && route.prefix === '10.244.0.0/16').some((route) => route.connectionId === 'backup')).toBe(true)
  topology.sites[0].routeMapAssignments = [{ connectionId: 'private', inboundMapId: 'prefer-private' }]
  topology.erLinks[1].advertisedPrefixes!.push('10.246.1.0/24')
  expect(pair(topology).forward.vpnTunnelPaths?.every((path) => path.protection === 'direct-er-without-ipsec')).toBe(true)
  expect(pair(topology).reverse.vpnTunnelPaths?.find((path) => path.connectionId === 'private')?.protection).toBe('intended-ipsec')
})

it('round-trips explicit membership, rejects malformed fields, and will not silently export ordinary Internet VPN', () => {
  const topology = vpnInstanceTopology()
  expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
  topology.vpnConnections[0].tunnels![0].gatewayInstanceId = 'unmapped'
  expect(simulateAzNet(topology).vpnTunnels![key('private-west')].code).toBe('INSTANCE_MAPPING_UNKNOWN')
  expect(() => generateAzNetBicep(topology)).toThrow('not deployed')
  const malformed = JSON.parse(JSON.stringify(topology))
  malformed.vpnConnections[0].tunnels[0].bgp.cpeLocalAddress = 'not-an-ip'
  expect(() => parseAzNetTopology(malformed)).toThrow('IPv4')
  malformed.vpnConnections[0].tunnels[0].bgp.cpeLocalAddress = '10.245.254.6'
  malformed.vpnConnections[0].tunnels[1].id = malformed.vpnConnections[0].tunnels[0].id
  expect(() => parseAzNetTopology(malformed)).toThrow('duplicate ID')
})

it('publishes binding/dependency/route provenance in headless simulation and refuses unsupported assertions', () => {
  const topology = vpnInstanceTopology()
  const result = executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology } })
  expect(result.status).toBe('complete')
  expect('vpnTunnels' in result.simulation!).toBe(true)
  expect(result.bgpNeighbors!.neighbors.filter((neighbor) => neighbor.vpnTunnel?.tunnelId === 'private-west')).toHaveLength(2)
  expect(result.bgpNeighbors!.neighbors.find((neighbor) => neighbor.vpnTunnel?.tunnelId === 'internet-west')?.vpnTunnel?.routeProvenance.gateway[0].asPath).toEqual([64513, 64513, 64513])
  expect(executePlatform({ contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology },
    requirements: [{ id: 'no-fake-established', kind: 'vpn-established' }] }).status).toBe('invalid')
})

it('grades exact headless binding/dependency assertions, including ER-only failure and unknown ownership', () => {
  const topology = vpnInstanceTopology()
  const request = { contractVersion: 1, operation: 'evaluate', document: { mode: 'full', topology }, requirements: [
    { id: 'private-binding', kind: 'vpn-tunnel', connectionId: 'private', tunnelId: 'private-west', expectation: 'eligible',
      binding: { azureAddress: '10.244.255.30', cpeAddress: '10.245.254.6', gatewayInstanceId: 'instance-west' }, underlayState: 'available' },
    { id: 'backup-binding', kind: 'vpn-tunnel', connectionId: 'backup', tunnelId: 'internet-west', expectation: 'eligible',
      binding: { azureAddress: '169.254.21.2', cpeAddress: '169.254.21.1', gatewayInstanceId: 'instance-west' } },
  ] }
  expect(executePlatform(request).assessments.map((assessment) => assessment.outcome)).toEqual(['satisfied', 'satisfied'])
  topology.erLinks[0].enabled = false
  expect(executePlatform(request).assessments.map((assessment) => assessment.outcome)).toEqual(['violated', 'satisfied'])
  Object.assign(request.requirements[0], { expectation: 'ineligible', underlayState: 'unavailable' })
  expect(executePlatform(request).assessments.map((assessment) => assessment.outcome)).toEqual(['satisfied', 'satisfied'])
  request.requirements[0].tunnelId = 'unconfigured-internet-east'
  expect(executePlatform(request).assessments[0].outcome).toBe('not assessed')
  request.requirements[0].tunnelId = 'private-west'
  request.requirements[0].binding.azureAddress = '169.254.21.2'
  expect(executePlatform(request).assessments[0].outcome).toBe('violated')
})

it('compares ordered snapshots with preserved source evidence and explicit control/forwarding deltas, not SA history', () => {
  const snapshots = vpnMigrationSnapshots()
  const previous = snapshots[2].topology, current = snapshots[3].topology
  const previousJson = JSON.stringify(previous), currentJson = JSON.stringify(current)
  const result = executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology: current },
    vpnTransition: { previousTopology: previous, event: { id: snapshots[3].id, description: snapshots[3].event } } })
  expect(result.status).toBe('complete')
  expect(result.vpnTransition).toMatchObject({
    kind: 'authored-snapshot-comparison', inPlaceReproduction: 'not-assessed',
    sourceSnapshots: { before: previous, after: current },
  })
  const delta = result.vpnTransition!.tunnels.find((tunnel) => tunnel.key === key('internet-west'))!
  expect(delta).toMatchObject({
    identity: 'retained', declaredIpsecChanged: false,
    before: { bgp: { state: 'disabled' } }, after: { bgp: { state: 'available' } },
  })
  expect(result.vpnTransition!.routeDeltas.map((table) => table.table)).toContain('gateway:vpn')
  expect(result.vpnTransition!.routeDeltas.map((table) => table.table)).toContain('site:cpe')
  expect(JSON.stringify(previous)).toBe(previousJson)
  expect(JSON.stringify(current)).toBe(currentJson)
})

it.each([true, false])('imports native mappings by original IP configuration, preserving unmapped configuration without inventing CPE membership (ARM=%s)', (nested) => {
  const shape = (name: string, properties: object) => ({ id: `/synthetic/${name}`, name, ...(nested ? { properties } : properties) })
  const topology = importAzNetCapture({
    kind: 'azure-network-capture', version: 2, resourceGroup: 'synthetic',
    vnets: [{ name: 'hub', addressSpace: { addressPrefixes: ['10.244.0.0/16'] }, subnets: [] }],
    vnetGateways: [{ ...shape('vpn', {
      gatewayType: 'Vpn', activeActive: true, enableBgp: true, enablePrivateIpAddress: true,
      ipConfigurations: [
        { id: '/synthetic/vpn/ipConfigurations/west', properties: { privateIPAddress: '10.244.255.4' } },
        { id: '/synthetic/vpn/ipConfigurations/east', properties: { privateIPAddress: '10.244.255.5' } },
      ],
      bgpSettings: { asn: 65515, unmappedFlag: true, bgpPeeringAddresses: [
        { ipconfigurationId: '/synthetic/vpn/ipConfigurations/east', defaultBgpIpAddresses: ['10.244.255.29'], customBgpIpAddresses: ['169.254.22.2'], tunnelIpAddresses: ['198.51.100.11'] },
        { ipconfigurationId: '/synthetic/vpn/ipConfigurations/west', defaultBgpIpAddresses: ['10.244.255.30'], customBgpIpAddresses: ['169.254.21.2'], tunnelIpAddresses: ['198.51.100.10'] },
      ] },
    }), vnetName: 'hub' }],
    localNetworkGateways: [shape('lng', { gatewayIpAddress: '203.0.113.20', bgpSettings: { asn: 64513, bgpPeeringAddress: '169.254.21.1' },
      localNetworkAddressSpace: { addressPrefixes: ['10.246.1.0/24'] } })],
    vpnConnections: [shape('backup', { enableBgp: true, useLocalAzureIpAddress: false, connectionMode: 'ResponderOnly',
      sharedKey: 'redacted', virtualNetworkGateway1: { id: '/synthetic/vpn' }, localNetworkGateway2: { id: '/synthetic/lng' },
      gatewayCustomBgpIpAddresses: [{ ipConfigurationId: '/synthetic/vpn/ipConfigurations/west', customBgpIpAddress: '169.254.21.2', unmappedField: 'retained' }],
    })],
  }).topology
  const instances = topology.vnets[0].gateways[0].vpnInstances!
  expect(instances.find((instance) => instance.ipConfigurationId.endsWith('/west'))).toMatchObject({
    privateIpAddress: '10.244.255.4', defaultBgpIpAddresses: ['10.244.255.30'], publicIpAddress: '198.51.100.10',
  })
  expect(topology.vnets[0].gateways[0].capturedVpnConfiguration?.bgpSettings.unmappedFlag).toBe(true)
  const connection = topology.vpnConnections[0]
  expect(connection).toMatchObject({ tunnels: [], useLocalAzureIpAddress: false, bgpPeer: { address: '169.254.21.1', asn: 64513 } })
  expect(connection.capturedConfiguration?.connection).toMatchObject({
    connectionMode: 'ResponderOnly', gatewayCustomBgpIpAddresses: [{ unmappedField: 'retained' }],
  })
  expect(JSON.stringify(topology)).not.toContain('sharedKey')
  expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
  const simulation = simulateAzNet(topology)
  expect(simulation.controlPlaneComplete).toBe(false)
  expect(inspectAzBgp(topology, simulation).neighbors).toHaveLength(0)
})
