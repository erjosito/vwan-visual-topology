import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareAzNetWithObservations,
  importAzNetCapture,
} from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { applyAzArsRouteMap } from './ars-route-maps'
import type { RouteMapAdvertisement } from '../bgp'
import { analyzeAzNetConnectivity, azFindingFlows, azFindingImpact, groupAzNetFindings, runAzNetDiagnostics } from './diagnostics'
import { getAzNetEndpoints } from './endpoints'
import {
  lookupSubnetEffectiveRoute,
  simulateAzNet,
  traceAzNetFlow,
  traceAzNetPair,
} from './engine'
import {
  AZURE_NET_SAMPLES,
  createEmptyAzNetTopology,
  validateAzNetTopology,
  type AzNetTopology,
} from './model'
import {
  ER_PEERING_LOCATIONS_CATALOG,
  evaluateErSkuRegionalCompatibility,
  findErPeeringLocationEntry,
} from '../er-locations-catalog'
import { pruneAzSiteRouteMaps } from './route-maps'
import { pruneAzArsRouteMaps } from './ars-route-maps'
import type { RouteMapRule } from '../model'
import { AZNET_MAX_JSON_LENGTH, parseAzNetJson, parseAzNetTopology } from './admission'
import { AZNET_STORAGE_KEY, loadAzWorkspace } from './workspace'
import { azDisplayResult, azRoutingInput } from './routing-input'
import { analyzeAzResilience } from '../failure-analysis'

describe('Azure Networking Simulator Engine & Diagnostics', () => {
  function transitTopology(transport: 'ExpressRoute' | 'Vpn' = 'ExpressRoute'): AzNetTopology {
    const topology = createEmptyAzNetTopology()
    topology.vnets = [
      {
        id: 'hub', name: 'Hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
        subnets: [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
        gateways: [{ id: 'gw', name: 'Gateway', kind: transport, asn: 65515, enabled: true, bgpEnabled: true }],
        appliances: [],
      },
      {
        id: 'spoke', name: 'Spoke', role: 'spoke', region: 'West Europe', prefixes: ['10.1.0.0/16'],
        subnets: [{ id: 'work', name: 'Workload', prefix: '10.1.1.0/24' }],
        gateways: [], appliances: [],
      },
    ]
    topology.vnetPeerings = [{
      id: 'peer', name: 'Hub-Spoke', enabled: true, vnetAId: 'hub', vnetBId: 'spoke',
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
    }]
    topology.sites = [{ id: 'site', name: 'On-prem', asn: 65001, prefixes: ['172.16.0.0/24'] }]
    if (transport === 'ExpressRoute') {
      topology.erLocations = [{ id: 'er', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
      topology.erLinks = [
        { id: 'er-gw', name: 'Gateway circuit', locationId: 'er', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true },
        { id: 'er-site', name: 'Site circuit', locationId: 'er', targetKind: 'site', targetId: 'site', enabled: true },
      ]
    } else {
      topology.vpnConnections = [{ id: 'vpn', name: 'S2S', siteId: 'site', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true }]
    }
    return topology
  }

  const expectedPair = { scope: 'pair', sourceKey: 'subnet:spoke:work', destinationKey: 'site:site:172.16.0.0/24' } as const

  it('totally admits bounded v2 shapes and rejects malformed, duplicate and dangling inputs', () => {
    const valid = transitTopology()
    const bad: unknown[] = [null, [], 42, { ...valid, vnets: [null] }, { ...valid, siteLinks: undefined },
      { ...valid, vnetPeerings: [{ ...valid.vnetPeerings[0], aToB: null }] },
      { ...valid, sites: [{ ...valid.sites[0], asn: '65001' }] },
      { ...valid, erLinks: [{ ...valid.erLinks[0], targetKind: 'mystery' }] },
      { ...valid, vnets: [...valid.vnets, valid.vnets[0]] },
      { ...valid, erLinks: [{ ...valid.erLinks[0], targetId: 'missing' }] },
      { ...valid, name: 'x'.repeat(4097) },
      { ...valid, sites: [{ ...valid.sites[0], prefixes: Array(4097).fill('10.0.0.0/24') }] },
      { ...valid, extension: Array(130).fill('x'.repeat(16_384)) },
      { ...valid, extension: Array.from({ length: 30 }, () => Array(4096).fill(null)) },
      { ...valid, vnets: [{ ...valid.vnets[0], x: Infinity }] },
      { ...valid, udrTables: [{ id: 'table', name: 'Table', disableBgpRoutePropagation: false }] },
      { ...valid, sites: [{ ...valid.sites[0], routeMapAssignments: [{ connectionId: 'missing' }] }] },
    ]
    for (const candidate of bad) {
      expect(() => parseAzNetTopology(candidate)).toThrow()
      expect(() => validateAzNetTopology(candidate)).not.toThrow()
      expect(validateAzNetTopology(candidate).length).toBeGreaterThan(0)
    }
    expect(() => parseAzNetJson(' '.repeat(AZNET_MAX_JSON_LENGTH + 1))).toThrow('4 MB')
    const incomplete = structuredClone(valid)
    incomplete.vnets[1].subnets[0].prefix = ''
    expect(parseAzNetTopology(incomplete)).toEqual(incomplete)
    expect(validateAzNetTopology(incomplete).join(' ')).toContain('invalid CIDR')
    const extended = { ...valid, futureObservation: { status: 'new-status', routes: [] } }
    expect(parseAzNetTopology(extended)).toEqual(extended)
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(valid)))).toEqual(valid)
  })

  it('preserves unreadable workspace and snapshot originals without writing during admission', () => {
    const raw = '{ damaged workspace'
    const loaded = loadAzWorkspace({ getItem: () => raw }, '#s=not-valid-json')
    expect(loaded.topology).toEqual(createEmptyAzNetTopology())
    expect(loaded.recovery.map((r) => r.raw)).toEqual([raw, '#s=not-valid-json'])
    const inaccessible = loadAzWorkspace({ getItem: () => { throw new Error('Access denied') } }, '')
    expect(inaccessible.recovery[0].message).toContain('Access denied')
    const restored = loadAzWorkspace({ getItem: (key) => key === AZNET_STORAGE_KEY ? JSON.stringify({ topology: transitTopology() }) : null }, '')
    expect(restored.topology).toEqual(transitTopology())
    expect(restored.recovery).toEqual([])
  })

  it('keeps canonical routing output identical on small fixtures and rebinds duplicate and changed names', () => {
    const advanced = arsTopology()
    const ars = advanced.vnets[0].routeServer!
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    ars.routeMaps![0].rules[0] = { ...ars.routeMaps![0].rules[0], action: 'permit',
      matchConditions: [{ property: 'asPath', match: 'contains', values: ['65010'] }],
      modifications: [{ property: 'community', action: 'add', values: ['65001:9'] }] }
    advanced.vnets[0].appliances[0].advertisedRouteAttributes = [{ prefix: '192.168.10.0/24', asPath: [64501], communities: ['65001:1'] }]
    sitePolicy(advanced, 'vpn', 'inboundMapId', [{ action: 'prepend', prepend: [65001] }])
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(advanced)))).toEqual(advanced)
    for (const original of [transitTopology(), advanced, remoteArsTopology(), ...AZURE_NET_SAMPLES.map((s) => s.topology)]) {
      const { routing, names } = azRoutingInput(original)
      const rawSim = simulateAzNet(routing)
      const sim = simulateAzNet(original)
      expect(azDisplayResult(rawSim, names)).toEqual(sim)
      const request = { scope: 'landscape' as const }
      expect(azDisplayResult(analyzeAzNetConnectivity(routing, rawSim, request), names))
        .toEqual(analyzeAzNetConnectivity(original, sim, request))
      expect(azDisplayResult(runAzNetDiagnostics(routing, rawSim, { includePairAnalysis: false }), names))
        .toEqual(runAzNetDiagnostics(original, sim, { includePairAnalysis: false }))
    }
    const original = transitTopology()
    original.vnets[0].name = 'Duplicate name'
    original.vnets[1].name = 'Duplicate name'
    const before = azRoutingInput(original)
    const cachedSimulation = simulateAzNet(before.routing)
    const cachedPair = traceAzNetPair(before.routing, cachedSimulation,
      { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '10.1.1.4', { kind: 'site', siteId: 'site' }, '172.16.0.4')
    original.vnets[1].name = 'Renamed workload'
    original.vnets[1].x = 800
    original.vnets[1].label = 'Decoration'
    const after = azRoutingInput(original)
    expect(after.revision).toBe(before.revision)
    expect(azDisplayResult(cachedSimulation, after.names)).toEqual(simulateAzNet(original))
    expect(azDisplayResult(cachedPair, after.names)).toEqual(traceAzNetPair(original, simulateAzNet(original),
      { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '10.1.1.4', { kind: 'site', siteId: 'site' }, '172.16.0.4'))
    const budget = { maxMillis: 10_000 }
    const cachedFailure = analyzeAzResilience(before.routing, budget, validateAzNetTopology(original))
    expect(azDisplayResult(cachedFailure, after.names)).toEqual(analyzeAzResilience(original, budget))
  })

  it('invalidates every representative routing-sensitive edit, not just collection identity', () => {
    const base = transitTopology()
    const revision = azRoutingInput(base).revision
    const edits: ((t: AzNetTopology) => void)[] = [
      (t) => { t.vnets[0].region = 'eastus' },
      (t) => { t.vnetPeerings[0].enabled = false },
      (t) => { t.erLinks[0].targetId = 'another-gateway' },
      (t) => { t.vnets[0].subnets[0].name = 'renamed-infrastructure' },
      (t) => { t.vnets[1].subnets[0].name = 'AzureFirewallSubnet' },
      (t) => { delete t.erLocations[0].peeringLocation; t.erLocations[0].name = 'London' },
      (t) => { t.vpnConnections.push({ id: 'vpn', name: 'VPN', siteId: 'site', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true, bgpEnabled: false, staticPrefixes: ['10.0.0.0/8'] }) },
      (t) => { t.routeMaps = [{ id: 'policy', name: 'Policy', siteId: 'site', rules: [{ id: 'rule', prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate', modifications: [{ property: 'community', action: 'add', values: ['65001:9'] }] }] }] },
    ]
    for (const edit of edits) {
      const next = structuredClone(base); edit(next)
      expect(azRoutingInput(next).revision).not.toBe(revision)
    }
  })

  function coexistenceTopology() {
    const topology = transitTopology()
    topology.vnets[0].subnets.push({ id: 'firewall', name: 'AzureFirewallSubnet', prefix: '10.0.1.0/26' })
    topology.vnets[0].gateways.unshift({
      id: 'vpn-gw', name: 'VPN gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true,
    })
    topology.vpnConnections = [{
      id: 'vpn', name: 'VPN backup', siteId: 'site', targetKind: 'vnet-gateway', targetId: 'vpn-gw', enabled: true, bgpEnabled: true,
    }]
    topology.sites[0].asn = 65010
    topology.sites[0].prefixes = ['172.16.10.0/24']
    return topology
  }

  it('prefers coexisting ER over a shorter VPN path without ARS for local and gateway-transit subnets', () => {
    const topology = coexistenceTopology()
    const result = simulateAzNet(topology)
    for (const id of ['firewall', 'work']) {
      const routes = result.subnetTables[id].routes.filter((route) => route.prefix === '172.16.10.0/24')
      expect(routes.find((route) => route.nextHopResourceId === 'gw')).toMatchObject({ active: true, asPath: [12076, 65010] })
      expect(routes.find((route) => route.nextHopResourceId === 'vpn-gw')).toMatchObject({ active: false, asPath: [65010] })
    }
    const trace = traceAzNetFlow(topology, result, { kind: 'subnet', vnetId: 'hub', subnetId: 'firewall' }, '172.16.10.4')
    expect(trace.status).toBe('delivered')
    expect(trace.traversedEdgeIds).toContain('er-gw')
    expect(trace.traversedEdgeIds).not.toContain('vpn')
  })

  it('keeps VPN failover, more-specific VPN routes and same-prefix UDR overrides with coexisting gateways', () => {
    const topology = coexistenceTopology()
    topology.vpnConnections[0].staticPrefixes = ['172.16.10.0/25']
    topology.vpnConnections[0].bgpEnabled = false
    let result = simulateAzNet(topology)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '172.16.10.4')?.nextHopResourceId).toBe('vpn-gw')
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '172.16.10.200')?.nextHopResourceId).toBe('gw')
    topology.vpnConnections[0].bgpEnabled = true
    topology.erLinks.find((link) => link.id === 'er-gw')!.enabled = false
    result = simulateAzNet(topology)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '172.16.10.4')?.nextHopResourceId).toBe('vpn-gw')
    topology.erLinks.find((link) => link.id === 'er-gw')!.enabled = true
    topology.udrTables = [{
      id: 'override', name: 'Explicit override', disableBgpRoutePropagation: false,
      routes: [{ id: 'drop', name: 'Drop site', prefix: '172.16.10.0/24', nextHopType: 'None', enabled: true }],
    }]
    topology.vnets[0].subnets.find((subnet) => subnet.id === 'firewall')!.routeTableId = 'override'
    result = simulateAzNet(topology)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '172.16.10.4')).toMatchObject({ source: 'User', nextHopType: 'None' })
  })

  it('retains explicit ARS preference and restores ER coexistence preference when ARS is disabled', () => {
    const topology = coexistenceTopology()
    topology.vnets[0].routeServer = {
      id: 'ars', name: 'ARS', enabled: true, branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: [],
    }
    let result = simulateAzNet(topology)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '172.16.10.4')?.nextHopResourceId).toBe('vpn-gw')
    topology.vnets[0].routeServer.enabled = false
    result = simulateAzNet(topology)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '172.16.10.4')?.nextHopResourceId).toBe('gw')
  })

  const coexistenceEvidence = JSON.parse(readFileSync(resolve('verification', 'issue-81-coexistence.json'), 'utf8')) as {
    cases: {
      name: string
      topology: AzNetTopology
      forwarding: Record<string, { transport: string }>
      native: Record<string, { prefix: string; asPath: number[]; origin?: string }[]>
    }[]
  }
  it.each(coexistenceEvidence.cases)('matches independent Azure coexistence forwarding and BGP evidence: $name', ({ topology, forwarding, native }) => {
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    const result = simulateAzNet(topology)
    for (const [address, observed] of Object.entries(forwarding)) {
      const route = lookupSubnetEffectiveRoute(result.subnetTables['dut-workload'], address)
      if (observed.transport === 'none') {
        expect(route?.nextHopType).toBe('None')
        expect(traceAzNetFlow(topology, result, { kind: 'subnet', vnetId: 'dut', subnetId: 'dut-workload' }, address).status).toBe('dropped-blackhole')
      } else {
        expect(route?.nextHopResourceId).toBe(observed.transport === 'ER' ? 'dut-er' : 'dut-vpn')
      }
    }
    for (const [layer, gateway] of [['dut-er-learned', 'dut-er'], ['dut-vpn-learned', 'dut-vpn']] as const) {
      for (const observed of native[layer].filter((route) => route.origin === 'EBgp')) {
        expect(result.gatewayRibs[gateway].find((route) => route.prefix === observed.prefix)?.asPath).toEqual(observed.asPath)
      }
    }
    for (const observed of native['circuit-primary-routes']) {
      expect(result.erLocationRibs.circuit.find((route) => route.prefix === observed.prefix)?.asPath).toEqual(observed.asPath)
    }
  })

  it('discards withdrawn benchmark routes instead of sending them to Internet, while preserving explicit default steering', () => {
    const topology = coexistenceTopology()
    topology.sites[0].prefixes = ['198.18.81.0/24']
    let result = simulateAzNet(topology)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '198.18.81.1')?.nextHopResourceId).toBe('gw')
    topology.udrTables = [{ id: 'policy', name: 'Workload policy', disableBgpRoutePropagation: true, routes: [] }]
    topology.vnets[0].subnets.find((subnet) => subnet.id === 'firewall')!.routeTableId = 'policy'
    result = simulateAzNet(topology)
    expect(result.gatewayRibs.gw.some((route) => route.prefix === '198.18.81.0/24')).toBe(true)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '198.18.81.1')).toMatchObject({
      prefix: '198.18.0.0/15', source: 'System', nextHopType: 'None',
    })
    expect(traceAzNetFlow(topology, result, { kind: 'subnet', vnetId: 'hub', subnetId: 'firewall' }, '198.18.81.1').status).toBe('dropped-blackhole')
    topology.udrTables[0].routes = [{
      id: 'default', name: 'Explicit NVA default', prefix: '0.0.0.0/0',
      nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: true,
    }]
    result = simulateAzNet(topology)
    expect(lookupSubnetEffectiveRoute(result.subnetTables.firewall, '198.18.81.1')).toMatchObject({
      prefix: '0.0.0.0/0', source: 'User', nextHopType: 'VirtualAppliance',
    })
  })

  function sitePolicy(topology: AzNetTopology, connectionId: string, direction: 'inboundMapId' | 'outboundMapId', rules: Partial<RouteMapRule>[]) {
    topology.routeMaps = [{
      id: 'site-map', name: 'Site policy', siteId: 'site',
      rules: rules.map((rule, index) => ({
        id: `policy-rule-${index}`, prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate', ...rule,
      })),
    }]
    topology.sites[0].routeMapAssignments = [{ connectionId, [direction]: 'site-map' }]
  }

  function arsTopology(transport: 'ExpressRoute' | 'Vpn' = 'Vpn') {
    const topology = transitTopology(transport)
    const hub = topology.vnets[0]
    hub.subnets.push({ id: 'nvas', name: 'NVAs', prefix: '10.0.2.0/24' })
    hub.appliances = ['one', 'two'].map((id, index) => ({
      id, name: `NVA ${id}`, kind: 'nva-vm', subnetId: 'nvas', privateIp: `10.0.2.${4 + index}`,
      asn: 65010 + index, bgpEnabled: true, enableIpForwarding: true, advertisedPrefixes: ['192.168.10.0/24'], staticRoutes: [],
    }))
    hub.routeServer = {
      id: 'ars', name: 'ARS', enabled: true, branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: ['one', 'two'],
      routeMaps: [{
        id: 'ars-map', name: 'ARS policy',
        rules: [{ id: 'ars-rule', prefixes: ['192.168.10.0/24'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }],
      }],
    }
    return topology
  }

  it('runs ARS inbound policies before selection without withdrawing the NVA origin', () => {
    const topology = arsTopology()
    const ars = topology.vnets[0].routeServer!
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    let result = simulateAzNet(topology)
    expect(result.routeServerRibs.ars.filter((route) => route.prefix === '192.168.10.0/24').map((route) => route.nextHopId)).toEqual(['two'])
    expect(topology.vnets[0].appliances[0].advertisedPrefixes).toEqual(['192.168.10.0/24'])
    ars.routeMaps![0].rules[0].action = 'prepend'
    ars.routeMaps![0].rules[0].prepend = [64501]
    result = simulateAzNet(topology)
    expect(result.routeServerRibs.ars.find((route) => route.nextHopId === 'one')?.asPath).toEqual([64501, 65010])
    expect(result.routeServerRibs.ars.find((route) => route.nextHopId === 'one')?.preferred).toBe(false)
    expect(result.routeServerRibs.ars.find((route) => route.nextHopId === 'two')?.preferred).toBe(true)
  })

  it('combines AS-path/community conditions with AND and applies multiple order-independent modifications before selection', () => {
    const topology = arsTopology()
    const ars = topology.vnets[0].routeServer!
    const base = { ...ars.routeMaps![0].rules[0], action: 'permit' as const, nextStep: 'continue' as const }
    ars.routeMaps![0].rules = [
      { ...base, id: 'tag', matchConditions: [{ property: 'asPath', match: 'contains', values: ['64501', '65010'] }],
        modifications: [{ property: 'community', action: 'add', values: ['65001:100', '65001:200'] }] },
      { ...base, id: 'replace', nextStep: 'terminate', matchConditions: [
        { property: 'asPath', match: 'equals', values: ['65010'] },
        { property: 'community', match: 'equals', values: ['65001:100'] },
        { property: 'community', match: 'contains', values: ['65001:200', '65001:999'] },
      ], modifications: [
        { property: 'asPath', action: 'replace', values: ['64501', '64502'] },
        { property: 'community', action: 'add', values: ['65001:300'] },
        { property: 'community', action: 'remove', values: ['65001:200'] },
      ] },
    ]
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    expect(validateAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual([])
    const result = simulateAzNet(topology)
    const route = result.routeServerRibs.ars.find((route) => route.nextHopId === 'one')!
    expect(route.asPath).toEqual([64501, 64502])
    expect(route.communities).toEqual(['65001:100', '65001:300'])
    expect(route.preferred).toBe(false)
    expect(result.routeServerRibs.ars.find((route) => route.nextHopId === 'two')?.preferred).toBe(true)
    ars.routeMaps![0].rules[1].modifications!.reverse()
    expect(simulateAzNet(topology).routeServerRibs.ars).toEqual(result.routeServerRibs.ars)
    ars.routeMaps![0].rules[1].matchConditions![0].values = ['65010', '64501']
    const unmatched = simulateAzNet(topology).routeServerRibs.ars.find((route) => route.nextHopId === 'one')!
    expect(unmatched.asPath).toEqual([65010])
    expect(unmatched.communities).toEqual(['65001:100', '65001:200'])
  })

  it('clears replaceable attributes, protects Azure communities and strips same-rule attributes from summaries without changing inputs', () => {
    const topology = arsTopology()
    const ars = topology.vnets[0].routeServer!
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    const rule = ars.routeMaps![0].rules[0]
    rule.action = 'permit'
    rule.modifications = [
      { property: 'asPath', action: 'replace', values: [] },
      { property: 'community', action: 'replace', values: [] },
    ]
    const input: RouteMapAdvertisement[] = [{ prefix: '192.168.10.0/24', asPath: [65010], communities: ['65001:100', '65517:12001'] }]
    const original = structuredClone(input)
    expect(applyAzArsRouteMap(ars, 'nva:one', 'inbound', input)[0]).toMatchObject({ asPath: [], communities: ['65517:12001'] })
    rule.action = 'summarize'; rule.summaryPrefixes = ['192.168.0.0/16']
    rule.modifications[0].values = ['64510']
    rule.modifications[1].values = ['65001:300']
    const summary = applyAzArsRouteMap(ars, 'nva:one', 'inbound', input)[0]
    expect(summary).toMatchObject({ prefix: '192.168.0.0/16', asPath: [], communities: [] })
    expect(summary.forwardingRoutes).toEqual(original)
    expect(input).toEqual(original)
    rule.modifications = [{ property: 'community', action: 'remove', values: ['65517:12001'] }]
    expect(validateAzNetTopology(topology).join(' ')).toContain('cannot remove Azure-reserved communities')
    rule.modifications = [{ property: 'asPath', action: 'replace', values: ['65515'] }]
    expect(validateAzNetTopology(topology).join(' ')).toContain('Azure-reserved')
  })

  it('uses peer source attributes before policy, preserves them in JSON and rejects AS loops before modifications', () => {
    const topology = arsTopology()
    const app = topology.vnets[0].appliances[0]
    app.advertisedRouteAttributes = [{ prefix: '192.168.10.0/24', asPath: [65020], communities: ['65001:100'] }]
    const ars = topology.vnets[0].routeServer!
    const rule = ars.routeMaps![0].rules[0]
    rule.action = 'permit'
    rule.matchConditions = [{ property: 'asPath', match: 'equals', values: ['65010', '65020'] },
      { property: 'community', match: 'equals', values: ['65001:100'] }]
    rule.modifications = [{ property: 'asPath', action: 'replace', values: [] }]
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    const roundTrip = JSON.parse(JSON.stringify(topology))
    expect(validateAzNetTopology(roundTrip)).toEqual([])
    expect(simulateAzNet(roundTrip).routeServerRibs.ars.find((route) => route.nextHopId === 'one')).toMatchObject({
      asPath: [], communities: ['65001:100'], preferred: true,
    })
    app.advertisedRouteAttributes[0].asPath = [65515]
    expect(simulateAzNet(topology).routeServerRibs.ars.some((route) => route.nextHopId === 'one')).toBe(false)
    app.advertisedRouteAttributes[0].asPath = [65020]
    topology.vnets[0].appliances[1].advertisedPrefixes = []
    ars.routeMapAssignments = []
    expect(simulateAzNet(topology).routeServerOutbound!.ars['nva:two'].some((route) => route.prefix === '192.168.10.0/24')).toBe(true)
    ars.routeMapAssignments = [{ connectionId: 'nva:two', outboundMapId: 'ars-map' }]
    rule.modifications = [{ property: 'asPath', action: 'replace', values: ['65011'] }]
    expect(simulateAzNet(topology).routeServerOutbound!.ars['nva:two'].some((route) => route.prefix === '192.168.10.0/24')).toBe(false)
    app.advertisedRouteAttributes[0].communities = ['65001:100 65001:200']
    expect(validateAzNetTopology(topology).join(' ')).toContain('one community each')
  })

  it('does not let editor IDs or modification ordering change attribute results', () => {
    const topology = arsTopology()
    const ars = topology.vnets[0].routeServer!
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    const rule = ars.routeMaps![0].rules[0]
    rule.action = 'permit'
    rule.modifications = [
      { id: 'a', property: 'asPath', action: 'add', values: ['64510'] },
      { id: 'z', property: 'asPath', action: 'add', values: ['64520'] },
    ]
    const before = simulateAzNet(topology).routeServerRibs.ars
    rule.modifications.reverse()
    rule.modifications[0].id = 'a'; rule.modifications[1].id = 'z'
    expect(simulateAzNet(topology).routeServerRibs.ars).toEqual(before)
    rule.modifications[0].id = 'z'
    expect(validateAzNetTopology(topology).join(' ')).toContain('Duplicate ARS')
  })

  it.each([
    { property: 'community', values: ['65536:1'], expected: '2-byte ASN:value' },
    { property: 'community', values: ['65001:1,'], expected: 'one community each' },
    { property: 'asPath', values: ['4200000001'], expected: '2-byte ASNs' },
  ] as const)('rejects invalid $property match values $values', ({ property, values, expected }) => {
    const topology = arsTopology()
    topology.vnets[0].routeServer!.routeMaps![0].rules[0].matchConditions = [{ property, match: 'equals', values: [...values] }]
    expect(validateAzNetTopology(topology).join(' ')).toContain(expected)
  })

  function remoteArsTopology() {
    const topology = arsTopology()
    const [hub, spoke] = topology.vnets
    const remote = hub.appliances.shift()!
    spoke.appliances.push({ ...remote, subnetId: spoke.subnets[0].id, privateIp: '10.1.1.4' })
    hub.appliances[0].advertisedPrefixes = ['192.168.20.0/24']
    hub.routeServer!.routeMapAssignments = [{ connectionId: `vnet:${spoke.id}`, inboundMapId: 'ars-map' }]
    return topology
  }

  it('filters remote NVA/spoke propagation without removing local On-link routes or the source advertisements', () => {
    const topology = remoteArsTopology()
    const [hub, spoke] = topology.vnets
    const ars = hub.routeServer!
    ars.routeMaps![0].rules[0].prefixes.push(spoke.prefixes[0])
    expect(validateAzNetTopology(topology)).toEqual([])
    const result = simulateAzNet(topology)
    expect(result.routeServerRibs.ars.some((route) => route.prefix === '192.168.10.0/24')).toBe(false)
    expect(result.routeServerRibs.ars.find((route) => route.prefix === spoke.prefixes[0])?.nextHopName).toContain('On-link')
    expect(result.routeServerInbound!.ars[`vnet:${spoke.id}`]).toEqual([])
    expect(result.routeServerOutbound!.ars['nva:two'].some((route) => route.prefix === spoke.prefixes[0])).toBe(false)
    expect(result.siteRibs.site.some((route) => route.prefix === spoke.prefixes[0] || route.prefix === '192.168.10.0/24')).toBe(false)
    expect(spoke.appliances[0].advertisedPrefixes).toEqual(['192.168.10.0/24'])
    expect(result.subnetTables[spoke.subnets[0].id].routes.some((route) => route.prefix === spoke.prefixes[0] && route.nextHopType === 'VnetLocal')).toBe(true)
    ars.routeMaps![0].rules[0].action = 'permit'
    const restored = simulateAzNet(topology)
    expect(restored.routeServerRibs.ars.find((route) => route.prefix === '192.168.10.0/24')?.nextHopId).toBe('one')
    topology.vnetPeerings[0].enabled = false
    expect(simulateAzNet(topology).routeServerRibs.ars.some((route) => route.prefix === '192.168.10.0/24')).toBe(false)
  })

  it('applies spoke outbound maps only to that spoke, retaining ARS best paths and branch-to-branch gates', () => {
    const topology = remoteArsTopology()
    const [hub, spoke] = topology.vnets
    const ars = hub.routeServer!
    ars.routeMaps![0].rules[0].prefixes = ['192.168.20.0/24']
    ars.routeMapAssignments = [{ connectionId: `vnet:${spoke.id}`, outboundMapId: 'ars-map' }]
    const result = simulateAzNet(topology)
    expect(result.routeServerRibs.ars.find((route) => route.prefix === '192.168.20.0/24')?.preferred).toBe(true)
    expect(result.routeServerOutbound!.ars[`vnet:${spoke.id}`].some((route) => route.prefix === '192.168.20.0/24')).toBe(false)
    expect(result.subnetTables[spoke.subnets[0].id].routes.some((route) => route.prefix === '192.168.20.0/24')).toBe(false)
    expect(result.subnetTables[hub.subnets[0].id].routes.some((route) => route.prefix === '192.168.20.0/24')).toBe(true)
    expect(result.siteRibs.site.some((route) => route.prefix === '192.168.20.0/24')).toBe(true)
    ars.branchToBranchTraffic = false
    expect(simulateAzNet(topology).siteRibs.site.some((route) => route.prefix === '192.168.20.0/24')).toBe(false)
    topology.vnetPeerings[0].aToB.allowGatewayTransit = false
    expect(validateAzNetTopology(topology).join(' ')).toContain('eligible gateway-transit peered spoke')
  })

  it('does not reintroduce scoped outbound gateway routes through the remote-gateway fallback', () => {
    const topology = remoteArsTopology()
    const [hub, spoke] = topology.vnets
    const ars = hub.routeServer!
    ars.routeMapAssignments = []
    expect(simulateAzNet(topology).subnetTables[spoke.subnets[0].id].routes.some((route) => route.prefix === '172.16.0.0/24')).toBe(true)
    ars.routeMaps![0].rules[0].prefixes = ['172.16.0.0/24']
    ars.routeMapAssignments = [{ connectionId: `vnet:${spoke.id}`, outboundMapId: 'ars-map' }]
    const result = simulateAzNet(topology)
    expect(result.routeServerRibs.ars.some((route) => route.prefix === '172.16.0.0/24' && route.preferred)).toBe(true)
    expect(result.subnetTables[spoke.subnets[0].id].routes.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    expect(result.subnetTables[hub.subnets[0].id].routes.some((route) => route.prefix === '172.16.0.0/24')).toBe(true)
  })

  it('traces remote NVA summary destinations across real peering without filling aggregate holes', () => {
    const topology = remoteArsTopology()
    const ars = topology.vnets[0].routeServer!
    const rule = ars.routeMaps![0].rules[0]
    rule.action = 'summarize'; rule.summaryPrefixes = ['192.168.0.0/16']
    rule.modifications = [{ property: 'asPath', action: 'replace', values: ['64510'] },
      { property: 'community', action: 'add', values: ['65001:100'] }]
    const result = simulateAzNet(topology)
    const summary = result.routeServerRibs.ars.find((route) => route.prefix === '192.168.0.0/16')!
    expect(summary).toMatchObject({ asPath: [], communities: [] })
    const source = { kind: 'subnet', vnetId: 'hub', subnetId: 'gateway' } as const
    const real = traceAzNetFlow(topology, result, source, '192.168.10.4')
    expect(real.status).toBe('delivered')
    expect(real.traversedEdgeIds).toContain('peer')
    expect(traceAzNetFlow(topology, result, source, '192.168.99.4').status).not.toBe('delivered')
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('matches original ARS outbound attributes before %s adds its transport ASNs', (transport) => {
    const topology = arsTopology(transport)
    const hub = topology.vnets[0]
    hub.appliances[1].advertisedPrefixes = []
    hub.appliances[0].advertisedRouteAttributes = [{ prefix: '192.168.10.0/24', communities: ['65001:100'] }]
    const ars = hub.routeServer!
    const rule = ars.routeMaps![0].rules[0]
    rule.action = 'permit'
    rule.matchConditions = [{ property: 'asPath', match: 'equals', values: ['65010'] },
      { property: 'community', match: 'equals', values: ['65001:100'] }]
    rule.modifications = [{ property: 'asPath', action: 'replace', values: ['64510'] },
      { property: 'community', action: 'replace', values: ['65001:300'] }]
    ars.routeMapAssignments = [{ connectionId: 'gateway:gw', outboundMapId: 'ars-map' }]
    const result = simulateAzNet(topology)
    expect(result.routeServerOutbound!.ars['gateway:gw'].find((route) => route.prefix === '192.168.10.0/24')).toMatchObject({
      asPath: [64510], communities: ['65001:300'],
    })
    expect(result.siteRibs.site.find((route) => route.prefix === '192.168.10.0/24')).toMatchObject({
      asPath: transport === 'Vpn' ? [65515, 64510] : [12076, 64510], communities: ['65001:300'],
    })
  })

  it('exports advanced ARS definitions, local and peered-spoke associations with explicit manual-gateway warnings', () => {
    const topology = remoteArsTopology()
    topology.vnets[0].subnets.push({ id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.0.254.0/27' })
    const ars = topology.vnets[0].routeServer!
    ars.routeMapAssignments!.push({ connectionId: 'nva:two', outboundMapId: 'ars-map' }, { connectionId: 'gateway:gw', inboundMapId: 'ars-map' })
    const rule = ars.routeMaps![0].rules[0]
    rule.action = 'permit'
    rule.matchConditions = [{ property: 'asPath', match: 'contains', values: ['65010'] }, { property: 'community', match: 'equals', values: ['65001:100'] }]
    rule.modifications = [{ property: 'asPath', action: 'replace', values: [] }, { property: 'community', action: 'replace', values: ['65001:300'] }]
    expect(validateAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual([])
    const exported = generateAzNetBicep(topology)
    expect(exported.text).toContain("matchCondition: 'Contains', asPath: [ '65010' ]")
    expect(exported.text).toContain("type: 'Replace', parameters: [ { asPath: [  ] } ]")
    expect(exported.text).toContain('hubVirtualNetworkConnection: { id: ars_spoke_ars_spoke.id }')
    expect(exported.text).toContain('outboundRouteMap: { id: ars_map_ars_ars_map.id }')
    expect(exported.warnings.join(' ')).toContain('requires manual configuration in the Azure portal')
    const directory = resolve('test-artifacts', 'azure-files', 'bicep')
    mkdirSync(directory, { recursive: true })
    writeFileSync(resolve(directory, 'ars-policies.bicep'), exported.text)
    expect(generateAzNetBicep(topology, { includeRouteServers: false }).warnings.join(' ')).toContain('omitted because Route Server deployment is disabled')
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('keeps ARS outbound gateway filtering separate from ARS selection over %s', (transport) => {
    const topology = arsTopology(transport)
    const ars = topology.vnets[0].routeServer!
    const before = simulateAzNet(topology).routeServerRibs.ars
    ars.routeMapAssignments = [{ connectionId: 'gateway:gw', outboundMapId: 'ars-map' }]
    const result = simulateAzNet(topology)
    expect(result.routeServerRibs.ars).toEqual(before)
    expect(result.gatewayRibs.gw.some((route) => route.prefix === '192.168.10.0/24')).toBe(false)
    expect(result.routeServerOutbound?.ars['gateway:gw'].some((route) => route.prefix === '192.168.10.0/24')).toBe(false)
    expect(result.siteRibs.site.some((route) => route.prefix === '192.168.10.0/24')).toBe(false)
    expect(result.siteRibs.site.some((route) => route.prefix === '10.0.0.0/16')).toBe(true)
    ars.routeMaps![0].rules[0].action = 'prepend'
    ars.routeMaps![0].rules[0].prepend = [64520]
    const prepended = simulateAzNet(topology)
    expect(prepended.routeServerRibs.ars).toEqual(before)
    expect(prepended.gatewayRibs.gw.find((route) => route.prefix === '192.168.10.0/24')?.asPath[0]).toBe(64520)
    ars.routeMapAssignments = [{ connectionId: 'gateway:gw', inboundMapId: 'ars-map' }]
    ars.routeMaps![0].rules[0].action = 'drop'
    ars.routeMaps![0].rules[0].prefixes = ['172.16.0.0/24']
    const inbound = simulateAzNet(topology)
    expect(inbound.gatewayRibs.gw.some((route) => route.prefix === '172.16.0.0/24')).toBe(true)
    expect(inbound.routeServerRibs.ars.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
  })

  it('keeps equal-prefix gateway alternatives distinct in ARS RIBs and policy previews', () => {
    const topology = arsTopology()
    topology.vpnConnections.push({ ...topology.vpnConnections[0], id: 'backup', name: 'Backup' })
    const result = simulateAzNet(topology)
    for (const routes of [
      result.routeServerRibs.ars,
      result.routeServerInbound!.ars['gateway:gw'],
      result.routeServerOutbound!.ars['nva:one'],
    ]) {
      const alternatives = routes.filter((route) => route.prefix === '172.16.0.0/24')
      expect(alternatives).toHaveLength(2)
      expect(new Set(alternatives.map((route) => route.id)).size).toBe(2)
      expect(new Set(alternatives.map((route) => route.connectionId))).toEqual(new Set(['vpn', 'backup']))
    }
  })

  it('does not advertise ARS policies toward inactive peer or gateway sessions', () => {
    const topology = arsTopology()
    topology.vnets[0].gateways[0].enabled = false
    topology.vnets[0].appliances[0].bgpEnabled = false
    const result = simulateAzNet(topology)
    expect(result.routeServerOutbound?.ars['gateway:gw']).toBeUndefined()
    expect(result.routeServerOutbound?.ars['nva:one']).toBeUndefined()
    expect(result.routeServerOutbound?.ars['nva:two'].some((route) => route.prefix === '10.0.0.0/16')).toBe(true)
    topology.vnets[0].gateways[0].enabled = true
    topology.vnets[0].routeServer!.branchToBranchTraffic = false
    expect(simulateAzNet(topology).routeServerOutbound?.ars['gateway:gw']).toBeUndefined()
  })

  it('protects the ARS own-VNet advertisement and preserves unmatched routes on a peer', () => {
    const topology = arsTopology()
    const ars = topology.vnets[0].routeServer!
    ars.routeMapAssignments = [{ connectionId: 'nva:one', outboundMapId: 'ars-map' }]
    ars.routeMaps![0].rules[0].prefixes = []
    let result = simulateAzNet(topology)
    expect(result.routeServerOutbound?.ars['nva:one'].map((route) => route.prefix)).toEqual(['10.0.0.0/16'])
    ars.routeMaps![0].rules[0].prefixes = ['172.16.0.0/24']
    result = simulateAzNet(topology)
    expect(result.routeServerOutbound?.ars['nva:one'].some((route) => route.prefix === '10.1.0.0/16')).toBe(true)
    expect(result.routeServerOutbound?.ars['nva:one'].some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    expect(result.routeServerRibs.ars.some((route) => route.prefix === '172.16.0.0/24')).toBe(true)
  })

  it('summarizes ARS peer inputs while clearing AS paths and retaining forwarding destinations', () => {
    const topology = arsTopology()
    const ars = topology.vnets[0].routeServer!
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    ars.routeMaps![0].rules[0] = {
      ...ars.routeMaps![0].rules[0], action: 'summarize', summaryPrefixes: ['192.168.0.0/16'],
    }
    const route = simulateAzNet(topology).routeServerRibs.ars.find((route) => route.prefix === '192.168.0.0/16')
    expect(route?.asPath).toEqual([])
    expect(route?.forwardingRoutes?.[0].prefix).toBe('192.168.10.0/24')
    expect(route?.explanation).toContain('ARS route map "ARS policy"')
  })

  it.each([65515, 8074, 65535, 70000])('rejects unsupported ARS prepend ASN %s without limiting site policies', (asn) => {
    const topology = arsTopology()
    topology.vnets[0].routeServer!.routeMaps![0].rules[0].prepend = [asn]
    expect(validateAzNetTopology(topology).join(' ')).toContain('2-byte ASNs')
    topology.vnets[0].routeServer!.routeMaps![0].rules[0].prepend = [65010]
    expect(validateAzNetTopology(topology)).toEqual([])
  })

  it('round-trips ARS maps, rejects unsupported associations and prunes deleted peers and maps', () => {
    const topology = arsTopology()
    const ars = topology.vnets[0].routeServer!
    ars.routeMapAssignments = [{ connectionId: 'nva:one', inboundMapId: 'ars-map' }]
    expect(validateAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual([])
    const advanced = structuredClone(topology)
    Object.assign(advanced.vnets[0].routeServer!.routeMaps![0].rules[0], { communityMatch: ['65001:100'] })
    expect(validateAzNetTopology(advanced).join(' ')).toContain('not modeled')
    ars.routeMapAssignments[0].connectionId = 'vnet:missing'
    expect(validateAzNetTopology(topology).join(' ')).toContain('local BGP peer or gateway')
    ars.routeMapAssignments[0].connectionId = 'nva:one'
    ars.peerApplianceIds = ['two']
    pruneAzArsRouteMaps(topology)
    expect(ars.routeMapAssignments).toEqual([])
    ars.routeMapAssignments = [{ connectionId: 'nva:two', outboundMapId: 'ars-map' }]
    ars.routeMaps = []
    pruneAzArsRouteMaps(topology)
    expect(ars.routeMapAssignments).toEqual([])
    expect(generateAzNetBicep(arsTopology()).warnings.join(' ')).toContain('skipped because no RouteServerSubnet')
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('applies site-owned outbound and inbound drop policies independently over %s', (transport) => {
    const topology = transitTopology(transport)
    const connection = transport === 'Vpn' ? 'vpn' : 'er-site'
    sitePolicy(topology, connection, 'outboundMapId', [{ action: 'drop', prefixes: ['172.16.0.0/24'] }])
    expect(validateAzNetTopology(topology)).toEqual([])
    let result = simulateAzNet(topology)
    expect(result.gatewayRibs.gw.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    expect(result.siteRibs.site.some((route) => route.prefix === '10.1.0.0/16')).toBe(true)
    expect(result.warnings.join(' ')).toContain('filtered: 172.16.0.0/24')
    sitePolicy(topology, connection, 'inboundMapId', [{ action: 'drop', prefixes: ['10.1.0.0/16'] }])
    result = simulateAzNet(topology)
    expect(result.gatewayRibs.gw.some((route) => route.prefix === '172.16.0.0/24')).toBe(true)
    expect(result.siteRibs.site.some((route) => route.prefix === '10.1.0.0/16')).toBe(false)
    expect(result.siteRibs.site.some((route) => route.prefix === '10.0.0.0/16')).toBe(true)
  })

  it('uses shared ordered continue/prepend rules before VPN path selection and rejects inbound AS loops', () => {
    const topology = transitTopology('Vpn')
    topology.vpnConnections.push({ ...topology.vpnConnections[0], id: 'backup', name: 'Backup' })
    sitePolicy(topology, 'vpn', 'outboundMapId', [
      { action: 'prepend', prefixes: ['172.16.0.0/16'], match: 'contains', prepend: [65001], nextStep: 'continue' },
      { action: 'prepend', prepend: [4200000000] },
    ])
    let result = simulateAzNet(topology)
    expect(result.gatewayRibs.gw.find((route) => route.id.includes(':vpn:vpn:'))?.asPath).toEqual([4200000000, 65001, 65001])
    expect(result.gatewayRibs.gw.find((route) => route.id.includes(':vpn:backup:'))?.preferred).toBe(true)
    expect(result.gatewayRibs.gw.find((route) => route.id.includes(':vpn:vpn:'))?.explanation).toContain('Site route map "Site policy"')
    const flow = traceAzNetFlow(topology, result, { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '172.16.0.4')
    expect(flow.status).toBe('delivered')
    expect(flow.traversedEdgeIds).toContain('backup')
    expect(flow.traversedEdgeIds).not.toContain('vpn')
    sitePolicy(topology, 'vpn', 'inboundMapId', [{ action: 'prepend', prepend: [65099] }])
    result = simulateAzNet(topology)
    expect(result.siteRibs.site.find((route) => route.prefix === '10.1.0.0/16' && route.preferred)?.connectionId).toBe('backup')
    const returning = traceAzNetFlow(topology, result, { kind: 'site', siteId: 'site' }, '10.1.1.4')
    expect(returning.status).toBe('delivered')
    expect(returning.traversedEdgeIds).toContain('backup')
    expect(returning.traversedEdgeIds).not.toContain('vpn')
    topology.vpnConnections.pop()
    sitePolicy(topology, 'vpn', 'inboundMapId', [{ action: 'prepend', prepend: [65001] }])
    result = simulateAzNet(topology)
    expect(result.siteRibs.site.some((route) => route.originProtocol === 'VPN')).toBe(false)
  })

  it('summarizes site advertisements without changing local routes and leaves static VPN routes unfiltered', () => {
    const topology = transitTopology('Vpn')
    sitePolicy(topology, 'vpn', 'outboundMapId', [{
      action: 'summarize', prefixes: ['172.16.0.0/24'], summaryPrefixes: ['172.16.0.0/16'],
    }])
    let result = simulateAzNet(topology)
    expect(result.gatewayRibs.gw.map((route) => route.prefix)).toEqual(['172.16.0.0/16'])
    expect(result.gatewayRibs.gw[0].asPath).toEqual([65001])
    expect(result.gatewayRibs.gw[0].forwardingRoutes?.[0].prefix).toBe('172.16.0.0/24')
    expect(traceAzNetFlow(topology, result, { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '172.16.99.4').status).not.toBe('delivered')
    expect(result.siteRibs.site.some((route) => route.prefix === '172.16.0.0/24' && route.nextHopKind === 'local')).toBe(true)
    topology.vpnConnections[0].bgpEnabled = false
    topology.routeMaps![0].rules[0].action = 'drop'
    result = simulateAzNet(topology)
    expect(result.gatewayRibs.gw[0].prefix).toBe('172.16.0.0/24')
    expect(result.gatewayRibs.gw[0].asPath).toEqual([])
  })

  it('applies both site-link policy directions, validates ownership and cleans deleted connection references', () => {
    const topology = transitTopology('Vpn')
    topology.sites.push({ id: 'branch', name: 'Branch', asn: 65002, prefixes: ['192.168.0.0/24'] })
    topology.siteLinks.push({ id: 'backdoor', name: 'Backdoor', siteAId: 'site', siteBId: 'branch', enabled: true })
    sitePolicy(topology, 'backdoor', 'outboundMapId', [{ action: 'drop', prefixes: ['172.16.0.0/24'] }])
    expect(simulateAzNet(topology).siteRibs.branch.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    topology.routeMaps![0].rules[0].action = 'permit'
    topology.routeMaps!.push({ id: 'branch-map', name: 'Branch import', siteId: 'branch',
      rules: [{ ...topology.routeMaps![0].rules[0], id: 'branch-rule', action: 'drop' }] })
    topology.sites[1].routeMapAssignments = [{ connectionId: 'backdoor', inboundMapId: 'branch-map' }]
    expect(simulateAzNet(topology).siteRibs.branch.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    expect(validateAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual([])
    topology.routeMaps![0].rules[0].prepend = [-1]
    expect(validateAzNetTopology(topology).join(' ')).toContain('Invalid ASN')
    topology.routeMaps![0].rules[0].prepend = []
    topology.sites[1].routeMapAssignments[0].inboundMapId = 'site-map'
    expect(validateAzNetTopology(topology).join(' ')).toContain('same site')
    topology.siteLinks = []
    pruneAzSiteRouteMaps(topology)
    expect(topology.sites.every((site) => !site.routeMapAssignments?.length)).toBe(true)
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(generateAzNetBicep(topology).warnings.join(' ')).toContain('not deployed')
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('coalesces site inbound summaries across all advertisements on %s', (transport) => {
    const topology = transitTopology(transport)
    sitePolicy(topology, transport === 'Vpn' ? 'vpn' : 'er-site', 'inboundMapId', [{
      action: 'summarize', match: 'contains', prefixes: ['10.0.0.0/8'], summaryPrefixes: ['10.0.0.0/8'],
    }])
    const summaries = simulateAzNet(topology).siteRibs.site.filter((route) => route.prefix === '10.0.0.0/8')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].forwardingRoutes).toHaveLength(2)
    expect(summaries[0].asPath).toEqual([])
  })

  it.each(['appliance', 'vwan-hub'] as const)('applies site route maps and traces both directions on %s VPN attachments', (targetKind) => {
    const topology = transitTopology('Vpn')
    const connection = topology.vpnConnections[0]
    connection.targetKind = targetKind
    connection.targetId = 'target'
    if (targetKind === 'appliance') {
      topology.vnets[0].subnets.push({ id: 'nva-subnet', name: 'NVA', prefix: '10.0.2.0/24' })
      topology.vnets[0].appliances.push({
        id: 'target', name: 'BGP NVA', kind: 'nva-vm', subnetId: 'nva-subnet', privateIp: '10.0.2.4',
        asn: 65010, bgpEnabled: true, enableIpForwarding: true, staticRoutes: [],
      })
      topology.vnets[0].routeServer = {
        id: 'ars', name: 'ARS', enabled: true, branchToBranchTraffic: false,
        hubRoutingPreference: 'ASPath', peerApplianceIds: ['target'],
      }
    } else {
      topology.vwanHubs.push({
        id: 'target', name: 'Virtual hub', region: 'West Europe', preference: 'ASPath',
        routingIntent: { private: false, internet: false },
      })
      for (const vnet of topology.vnets) vnet.vwanHubAttachment = { hubId: 'target', enabled: true }
    }
    let result = simulateAzNet(topology)
    expect(traceAzNetFlow(topology, result, { kind: 'site', siteId: 'site' }, '10.1.1.4').status).toBe('delivered')
    expect(traceAzNetFlow(topology, result, { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '172.16.0.4').status).toBe('delivered')
    sitePolicy(topology, 'vpn', 'inboundMapId', [{ action: 'drop', prefixes: ['10.1.0.0/16'] }])
    result = simulateAzNet(topology)
    expect(result.siteRibs.site.some((route) => route.prefix === '10.1.0.0/16')).toBe(false)
    sitePolicy(topology, 'vpn', 'outboundMapId', [{ action: 'drop', prefixes: ['172.16.0.0/24'] }])
    result = simulateAzNet(topology)
    const rib = targetKind === 'appliance' ? result.routeServerRibs.ars : result.vwanHubRibs.target
    expect(rib.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
  })

  it.each([
    ['', true, false],
    ['10.0.0.0/8', false, false],
    ['192.168.0.0/16', true, false],
    ['10.1.1.0/24', true, false],
    ['10.0.0.0/8', true, true],
    ['10.1.0.0/16', true, true],
  ] as const)('suppresses peering routes only with a full active replacement (%s, enabled=%s)', (prefix, enabled, suppressed) => {
    const topology = transitTopology()
    topology.udrTables = [{
      id: 'return', name: 'Return table', disableBgpRoutePropagation: false, disablePeeringRoutePropagation: true,
      routes: prefix ? [{ id: 'replacement', name: 'Replacement', prefix, enabled, nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4' }] : [],
    }]
    topology.vnets[0].subnets[0].routeTableId = 'return'
    const table = simulateAzNet(topology).subnetTables.gateway
    expect(table.peeringPropagationDisabled).toBe(true)
    expect(table.suppressedPeeringRoutes.length > 0).toBe(suppressed)
    expect(table.routes.some((route) => route.active && route.nextHopType === 'VNetPeering')).toBe(!suppressed)
    expect(lookupSubnetEffectiveRoute(table, '10.1.2.4')?.nextHopType).toBe(suppressed ? 'VirtualAppliance' : 'VNetPeering')
  })

  function inspectedTransitTopology() {
    const topology = transitTopology('Vpn')
    topology.vnets[0].subnets.push({ id: 'fw-subnet', name: 'AzureFirewallSubnet', prefix: '10.0.2.0/24' })
    topology.vnets[0].appliances.push({
      id: 'fw', name: 'Inspection firewall', kind: 'azure-firewall', subnetId: 'fw-subnet',
      privateIp: '10.0.2.4', enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [],
    })
    topology.udrTables = [
      { id: 'return', name: 'Return table', disableBgpRoutePropagation: false, disablePeeringRoutePropagation: true, routes: [] },
      { id: 'outbound', name: 'Outbound table', disableBgpRoutePropagation: true,
        routes: [{ id: 'fw-default', name: 'Inspect outbound', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4', enabled: true }] },
    ]
    topology.vnets[0].subnets[0].routeTableId = 'return'
    topology.vnets[1].subnets[0].routeTableId = 'outbound'
    return topology
  }

  it('reports the real return-path asymmetry when peering suppression is configured without a UDR', () => {
    const topology = inspectedTransitTopology()
    const simulation = simulateAzNet(topology)
    const finding = analyzeAzNetConnectivity(topology, simulation, expectedPair).findings[0]
    expect(finding).toMatchObject({ category: 'asymmetric-firewall-bypass', severity: 'warning' })
    expect(finding.summary).toContain('No active covering UDR to suppress VNet peering routes in Hub/GatewaySubnet')
    expect(finding.summary).not.toContain('matched only the 0.0.0.0/0 Internet')
    expect(lookupSubnetEffectiveRoute(simulation.subnetTables.gateway, '10.1.1.4')?.nextHopType).toBe('VNetPeering')
    topology.udrTables[0].routes.push({
      id: 'return-fw', name: 'Inspect return', prefix: '10.0.0.0/8', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4', enabled: true,
    })
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings).toEqual([])
  })

  it('groups a shared return-UDR cause while retaining each flow and recomputing partial repairs', () => {
    const topology = inspectedTransitTopology()
    topology.vnets[1].subnets.push({ id: 'work2', name: 'Workload 2', prefix: '10.1.2.0/24', routeTableId: 'outbound' })
    topology.sites[0].prefixes.push('172.17.0.0/24')
    const analyze = () => {
      const simulation = simulateAzNet(topology)
      return groupAzNetFindings([
        ...runAzNetDiagnostics(topology, simulation, { includePairAnalysis: false }),
        ...analyzeAzNetConnectivity(topology, simulation, { scope: 'onprem' }).findings,
      ]).filter((entry) => entry.category === 'asymmetric-firewall-bypass')
    }
    const [root] = analyze()
    expect(analyze()).toHaveLength(1)
    expect(azFindingImpact([root], getAzNetEndpoints(topology))).toEqual({ pairs: 4, workloads: 2, sites: 1, prefixes: 4 })
    expect(azFindingFlows([root])).toHaveLength(4)
    expect(root.occurrences?.every((entry) => entry.sampleFlow)).toBe(true)
    topology.udrTables[0].routes.push({
      id: 'partial-return', name: 'Partial repair', prefix: '10.1.1.0/24',
      nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4', enabled: true,
    })
    const [remaining] = analyze()
    expect(remaining.id).toBe(root.id)
    expect(azFindingImpact([remaining], getAzNetEndpoints(topology)).pairs).toBe(2)
    expect(azFindingFlows([remaining]).every((entry) => entry.sampleFlow?.source.kind === 'subnet' &&
      entry.sampleFlow.source.subnetId === 'work2')).toBe(true)
    topology.udrTables[0].routes[0].prefix = '10.1.0.0/16'
    expect(analyze()).toEqual([])
  })

  it('keeps independent return-route objects and connectivity faults separate despite equal messages', () => {
    const topology = inspectedTransitTopology()
    const first = analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings[0]
    topology.vnets[0].subnets[0].id = 'other-gateway-subnet'
    const second = analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings[0]
    expect(first.summary).toBe(second.summary)
    expect(groupAzNetFindings([first, second])).toHaveLength(2)
    const disconnected = transitTopology('Vpn')
    disconnected.vpnConnections[0].enabled = false
    const failed = analyzeAzNetConnectivity(disconnected, simulateAzNet(disconnected), expectedPair).findings[0]
    expect(groupAzNetFindings([first, failed]).map((entry) => entry.category))
      .toEqual(['asymmetric-firewall-bypass', 'connectivity-failure'])
  })

  it.each([
    ['Disabled', '10.1.1.20/32', true, 'InterfaceEndpoint'],
    ['NetworkSecurityGroupEnabled', '10.1.1.20/32', true, 'InterfaceEndpoint'],
    ['RouteTableEnabled', '', true, 'InterfaceEndpoint'],
    ['RouteTableEnabled', '0.0.0.0/0', true, 'InterfaceEndpoint'],
    ['RouteTableEnabled', '10.1.0.0/16', true, 'InterfaceEndpoint'],
    ['RouteTableEnabled', '10.9.0.0/24', true, 'InterfaceEndpoint'],
    ['RouteTableEnabled', '10.1.0.0/20', false, 'InterfaceEndpoint'],
    ['Enabled', '10.1.0.0/20', true, 'VirtualAppliance'],
    ['RouteTableEnabled', '10.1.1.20/32', true, 'VirtualAppliance'],
  ] as const)('requires PE route policies and a qualifying active UDR (%s, %s, enabled=%s)', (policy, prefix, enabled, nextHopType) => {
    const topology = transitTopology()
    topology.vnets[1].prefixes = ['10.1.0.0/20', '10.9.0.0/16']
    Object.assign(topology.vnets[1].subnets[0], {
      privateEndpointNetworkPolicies: policy,
      privateEndpoints: [{ id: 'pe', name: 'Private endpoint', ipAddress: '10.1.1.20', serviceName: 'Storage' }],
    })
    topology.udrTables = [{
      id: 'pe-table', name: 'PE inspection', disableBgpRoutePropagation: false,
      routes: prefix ? [{ id: 'pe-udr', name: 'PE next hop', prefix, enabled, nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4' }] : [],
    }]
    topology.vnets[0].subnets[0].routeTableId = 'pe-table'
    const table = simulateAzNet(topology).subnetTables.gateway
    expect(lookupSubnetEffectiveRoute(table, '10.1.1.20')?.nextHopType).toBe(nextHopType)
    expect(table.routes.find((route) => route.nextHopType === 'InterfaceEndpoint')?.active).toBe(nextHopType === 'InterfaceEndpoint')
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('summarizes covered VNet advertisements over %s and retains uncovered spaces', (transport) => {
    const topology = transitTopology(transport)
    topology.vnets[0].prefixes.push('192.168.0.0/16')
    topology.vnets[1].prefixes.push('10.32.0.0/16')
    const advertised = () => simulateAzNet(topology).siteRibs.site.filter((r) => r.preferred && r.nextHopKind !== 'local')
    const original = advertised()
    topology.vnets[0].summarizedGatewayPrefixes = []
    expect(advertised()).toEqual(original)
    topology.vnets[0].summarizedGatewayPrefixes = ['10.0.0.0/15', '198.18.0.0/15']
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(advertised().map((r) => r.prefix).sort()).toEqual(['10.0.0.0/15', '10.32.0.0/16', '192.168.0.0/16', '198.18.0.0/15'].sort())
    expect(advertised().find((r) => r.prefix === '10.0.0.0/15')?.explanation).toContain('Advertised gateway summary')
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings).toEqual([])
    topology.vnets[0].summarizedGatewayPrefixes = ['10.0.0.0/17']
    expect(advertised().map((r) => r.prefix)).toContain('10.0.0.0/16')
    topology.vnets[0].summarizedGatewayPrefixes = []
    expect(advertised()).toEqual(original)
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('ignores remote-spoke summaries and requires GatewaySubnet for %s summaries', (transport) => {
    const topology = transitTopology(transport)
    topology.vnets[1].summarizedGatewayPrefixes = ['198.18.0.0/15']
    const advertised = () => simulateAzNet(topology).siteRibs.site.filter((r) => r.preferred && r.nextHopKind !== 'local').map((r) => r.prefix)
    expect(advertised().sort()).toEqual(['10.0.0.0/16', '10.1.0.0/16'])
    topology.vnets[0].summarizedGatewayPrefixes = ['10.0.0.0/15']
    topology.vnets[0].subnets = []
    expect(advertised().sort()).toEqual(['10.0.0.0/16', '10.1.0.0/16'])
    expect(runAzNetDiagnostics(topology, simulateAzNet(topology))).toContainEqual(expect.objectContaining({
      category: 'gateway-prefix-summary', vnetId: 'hub', summary: expect.stringContaining('Stored only'),
    }))
    topology.vnets[0].gateways[0].enabled = false
    expect(advertised()).toEqual([])
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('does not turn a %s advertised summary into forwarding or gateway transit', (transport) => {
    const topology = transitTopology(transport)
    topology.vnets[0].summarizedGatewayPrefixes = ['10.0.0.0/8']
    let simulation = simulateAzNet(topology)
    expect(simulation.subnetTables.gateway.routes.some((r) => r.prefix === '10.0.0.0/8' && r.nextHopType !== 'None')).toBe(false)
    const hole = traceAzNetFlow(topology, simulation, { kind: 'site', siteId: 'site' }, '10.99.1.4')
    expect(hole.status).toBe('dropped-blackhole')
    expect(hole.hops.some((h) => h.nodeKind === 'vnet-gateway')).toBe(true)
    topology.vnets[0].summarizedGatewayPrefixes.push('198.18.0.0/15')
    simulation = simulateAzNet(topology)
    expect(traceAzNetFlow(topology, simulation, { kind: 'site', siteId: 'site' }, '198.18.1.4').status).toBe('dropped-blackhole')
    topology.vnetPeerings[0].aToB.allowGatewayTransit = false
    topology.vnetPeerings[0].bToA.useRemoteGateways = false
    simulation = simulateAzNet(topology)
    expect(traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '172.16.0.4').status).not.toBe('delivered')
  })

  it('keeps NVA prefixes learned through ARS while summarizing only VNet address spaces', () => {
    const topology = transitTopology()
    const hub = topology.vnets[0]
    hub.summarizedGatewayPrefixes = ['10.0.0.0/8']
    hub.subnets.push({ id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.0.3.0/27' },
      { id: 'nva-subnet', name: 'NVA', prefix: '10.0.2.0/24' })
    hub.routeServer = { id: 'ars', name: 'Route Server', enabled: true, branchToBranchTraffic: true,
      hubRoutingPreference: 'ExpressRoute', peerApplianceIds: ['nva'], subnetId: 'ars-subnet' }
    hub.appliances.push({ id: 'nva', name: 'Router', kind: 'nva-vm', subnetId: 'nva-subnet', privateIp: '10.0.2.4',
      enableIpForwarding: true, bgpEnabled: true, asn: 65020, advertisedPrefixes: ['10.50.0.0/16'], staticRoutes: [] })
    const routes = simulateAzNet(topology).siteRibs.site.filter((r) => r.preferred).map((r) => r.prefix)
    expect(routes).toContain('10.0.0.0/8')
    expect(routes).toContain('10.50.0.0/16')
  })

  it.each([
    [['10.0.0.0/8', '10.1.0.0/16'], 'overlap'],
    [['10.0.0.0/8', '10.0.0.0/8'], 'overlap'],
    [['fd00::/48'], 'IPv4'],
    [['10.1.1.4/24'], 'invalid advertised gateway prefix'],
    ['10.0.0.0/8', 'must be an array'],
    [[42], 'invalid advertised gateway prefix'],
  ])('rejects invalid advertised gateway prefix lists %j', (prefixes, error) => {
    const topology = transitTopology()
    topology.vnets[0].summarizedGatewayPrefixes = prefixes as unknown as string[]
    expect(validateAzNetTopology(topology).join(' ')).toContain(error)
  })

  it('imports ARM and flattened SDK gateway summaries, round-trips JSON, and exports the supported ARM shape', () => {
    const properties = {
      addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
      summarizedGatewayPrefixes: { addressPrefixes: ['10.0.0.0/8', '198.18.0.0/15'] },
      subnets: [],
    }
    for (const format of [{ properties }, properties]) {
      const capture = { kind: 'azure-network-capture', version: 2, resourceGroup: 'rg',
        vnets: [{ id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/hub', name: 'Hub', location: 'westeurope', ...format }] }
      const imported = importAzNetCapture(capture).topology
      expect(imported.vnets[0].summarizedGatewayPrefixes).toEqual(['10.0.0.0/8', '198.18.0.0/15'])
      expect(validateAzNetTopology(JSON.parse(JSON.stringify(imported)))).toEqual([])
      const exported = generateAzNetBicep(imported).text
      expect(exported).toContain('Microsoft.Network/virtualNetworks@2025-07-01')
      expect(exported).toContain("summarizedGatewayPrefixes: {\n      addressPrefixes: [\n        '10.0.0.0/8'\n        '198.18.0.0/15'")
      imported.vnets[0].summarizedGatewayPrefixes = []
      expect(generateAzNetBicep(imported).text).toContain('summarizedGatewayPrefixes: {\n      addressPrefixes: [\n      ]')
    }
    const bad = { ...properties, summarizedGatewayPrefixes: { addressPrefixes: ['10.0.0.0/8', '10.1.0.0/16'] } }
    expect(() => importAzNetCapture({ kind: 'azure-network-capture', version: 2, resourceGroup: 'rg', vnets: [{ name: 'Hub', ...bad }] })).toThrow(/overlap/)
  })

  it('checks distinct on-premises sites across their prefixes in landscape scope and clears repaired failures', () => {
    const topology = createEmptyAzNetTopology()
    topology.sites = [
      { id: 'a', name: 'A', asn: 65001, prefixes: ['10.10.0.0/24', '10.11.0.0/24', '10.10.0.0/24'] },
      { id: 'b', name: 'B', asn: 65002, prefixes: ['10.20.0.0/24'] },
      { id: 'c', name: 'C', asn: 65003, prefixes: ['10.30.0.0/24'] },
    ]
    const scope = { scope: 'landscape' } as const
    const disconnected = analyzeAzNetConnectivity(topology, simulateAzNet(topology), scope)
    expect(disconnected).toMatchObject({ checked: 5, total: 5, complete: true })
    expect(disconnected.findings).toHaveLength(5)
    expect(new Set(disconnected.findings.map((finding) => finding.id)).size).toBe(5)
    for (const finding of disconnected.findings) {
      expect(finding).toMatchObject({ category: 'connectivity-failure', severity: 'error' })
      expect(finding.sampleFlow!.source).not.toEqual(finding.sampleFlow!.destination)
      expect(finding.summary).toContain('Forward')
      expect(finding.summary).toContain('Return')
    }
    topology.siteLinks = [
      { id: 'ab', name: 'A-B', siteAId: 'a', siteBId: 'b', enabled: true },
      { id: 'bc', name: 'B-C', siteAId: 'b', siteBId: 'c', enabled: true },
    ]
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), scope).findings).toEqual([])
  })

  it('includes workload and distinct-site pairs without treating infrastructure or self pairs as workloads', () => {
    const topology = transitTopology()
    topology.vnets[0].subnets.push({ id: 'hub-work', name: 'Hub workload', prefix: '10.0.1.0/24' })
    topology.sites.push({ id: 'other', name: 'Other site', asn: 65002, prefixes: ['172.18.0.0/24'] })
    const report = analyzeAzNetConnectivity(topology, simulateAzNet(topology), { scope: 'landscape' })
    expect(report).toMatchObject({ checked: 6, total: 6, complete: true })
    expect(report.findings.some((finding) => finding.sourceKey?.startsWith('site:') &&
      finding.destinationKey?.startsWith('site:'))).toBe(true)
    expect(report.findings.some((finding) => finding.sourceKey?.endsWith(':gateway') ||
      finding.destinationKey?.endsWith(':gateway'))).toBe(false)
  })

  it('exposes incomplete landscape coverage when the shared pair budget is exhausted', () => {
    const topology = createEmptyAzNetTopology()
    topology.sites = Array.from({ length: 22 }, (_, i) => ({
      id: `site-${i}`, name: `Site ${i}`, asn: 65000 + i, prefixes: [`10.${i}.0.0/24`],
    }))
    const report = analyzeAzNetConnectivity(topology, simulateAzNet(topology), { scope: 'landscape' })
    expect(report).toMatchObject({ checked: 200, total: 231, complete: false })
    expect(report.findings).toHaveLength(200)
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('analyzes %s transit loss in both directions and clears findings after repair', (transport) => {
    const topology = transitTopology(transport)
    const analyze = () => analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair)
    expect(analyze()).toMatchObject({ checked: 1, total: 1, complete: true, findings: [] })
    for (const disabled of ['remote', 'transit', 'both']) {
      topology.vnetPeerings[0].bToA.useRemoteGateways = disabled === 'transit'
      topology.vnetPeerings[0].aToB.allowGatewayTransit = disabled === 'remote'
      const finding = analyze().findings[0]
      expect(finding).toMatchObject({ category: 'connectivity-failure', severity: 'error', peeringId: 'peer' })
      expect(finding.summary).toContain('Return')
      expect(finding.summary).toContain('useRemoteGateways / allowGatewayTransit')
      topology.vnetPeerings[0].bToA.useRemoteGateways = true
      topology.vnetPeerings[0].aToB.allowGatewayTransit = true
      expect(analyze().findings).toEqual([])
    }
  })

  it('distinguishes intentional suppression from a failed expected flow and honors alternate UDR paths', () => {
    const topology = JSON.parse(readFileSync(resolve(process.cwd(), 'samples', 'azure-net', 'uc1-hub-spoke-nva-ars-baseline.json'), 'utf8')) as AzNetTopology
    const table = topology.udrTables.find((t) => t.id === 'rt-spoke1')!
    table.disableBgpRoutePropagation = true
    table.routes.push({
      id: 'branch', name: 'Branch via NVA', prefix: '10.250.0.0/16', nextHopType: 'VirtualAppliance',
      nextHopIp: '10.100.2.4', enabled: true,
    })
    const scope = { scope: 'pair', sourceKey: 'subnet:vnet-spoke1:sub-spoke1-work', destinationKey: 'site:site-branch1:10.250.0.0/16' } as const
    const simulation = simulateAzNet(topology)
    expect(simulation.subnetTables['sub-spoke1-work'].suppressedBgpRoutes.length).toBeGreaterThan(0)
    expect(analyzeAzNetConnectivity(topology, simulation, scope).findings).toEqual([])
    table.routes = table.routes.filter((r) => r.id !== 'branch')
    const isolatedSimulation = simulateAzNet(topology)
    expect(runAzNetDiagnostics(topology, isolatedSimulation)).toContainEqual(expect.objectContaining({
      category: 'bgp-routes-suppressed', subnetId: 'sub-spoke1-work', severity: 'info',
    }))
    expect(analyzeAzNetConnectivity(topology, isolatedSimulation, scope).findings[0]?.category).toBe('connectivity-failure')
  })

  it('reports a missing ER return advertisement even when a UDR preserves the outbound path', () => {
    const topology = transitTopology()
    topology.udrTables = [{
      id: 'rt', name: 'Explicit next hop', disableBgpRoutePropagation: false,
      routes: [{ id: 'onprem', name: 'On-prem', prefix: '172.16.0.0/24', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4', enabled: true }],
    }]
    topology.vnets[0].subnets.push({ id: 'nva-sub', name: 'NVA', prefix: '10.0.2.0/24' })
    topology.vnets[0].appliances.push({
      id: 'nva', name: 'Router', kind: 'nva-vm', subnetId: 'nva-sub', privateIp: '10.0.2.4',
      enableIpForwarding: true, staticRoutes: [],
    })
    topology.vnets[1].subnets[0].routeTableId = 'rt'
    topology.vnetPeerings[0].bToA.useRemoteGateways = false
    const simulation = simulateAzNet(topology)
    const pair = traceAzNetPair(topology, simulation,
      { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '10.1.1.4',
      { kind: 'site', siteId: 'site' }, '172.16.0.4')
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).not.toBe('delivered')
    expect(analyzeAzNetConnectivity(topology, simulation, expectedPair).findings[0].summary).toContain('Return')
  })

  it('does not report lost gateway transit when an alternate local ER path still delivers both ways', () => {
    const topology = transitTopology()
    topology.vnetPeerings[0].aToB.allowGatewayTransit = false
    topology.vnetPeerings[0].bToA.useRemoteGateways = false
    topology.vnets[1].gateways.push({
      id: 'spoke-gw', name: 'Alternate gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true,
    })
    topology.vnets[1].subnets.push({ id: 'spoke-gateway', name: 'GatewaySubnet', prefix: '10.1.255.0/27' })
    topology.erLinks.push({
      id: 'alternate', name: 'Alternate circuit connection', locationId: 'er',
      targetKind: 'vnet-gateway', targetId: 'spoke-gw', enabled: true,
    })
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings).toEqual([])
  })

  it.each(['blackhole', 'unreachable', 'loop'] as const)('reports an actual %s in the expected forwarding path', (failure) => {
    const topology = transitTopology()
    topology.udrTables.push({
      id: 'bad-path', name: 'Broken route', disableBgpRoutePropagation: false,
      routes: [{
        id: 'broken', name: 'Broken', prefix: '172.16.0.0/24', enabled: true,
        nextHopType: failure === 'blackhole' ? 'None' : 'VirtualAppliance',
        nextHopIp: failure === 'loop' ? '10.0.2.4' : '10.0.99.4',
      }],
    })
    topology.vnets[1].subnets[0].routeTableId = 'bad-path'
    if (failure === 'loop') {
      topology.vnets[0].subnets.push({ id: 'nva-sub', name: 'NVA', prefix: '10.0.2.0/24', routeTableId: 'bad-path' })
      topology.vnets[0].appliances.push({
        id: 'nva', name: 'Looping router', kind: 'nva-vm', subnetId: 'nva-sub', privateIp: '10.0.2.4',
        enableIpForwarding: true,
        staticRoutes: [{ id: 'to-second', prefix: '172.16.0.0/24', nextHopKind: 'appliance', nextHopIp: '10.0.2.5', enabled: true }],
      }, {
        id: 'second-nva', name: 'Second router', kind: 'nva-vm', subnetId: 'nva-sub', privateIp: '10.0.2.5',
        enableIpForwarding: true,
        staticRoutes: [{ id: 'to-first', prefix: '172.16.0.0/24', nextHopKind: 'appliance', nextHopIp: '10.0.2.4', enabled: true }],
      })
    }
    const simulation = simulateAzNet(topology)
    const trace = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '172.16.0.4')
    expect(trace.status).toBe(failure === 'loop' ? 'loop' : failure === 'blackhole' ? 'dropped-blackhole' : 'dropped-no-route')
    const finding = analyzeAzNetConnectivity(topology, simulation, expectedPair).findings[0]
    expect(finding).toMatchObject({ category: 'connectivity-failure', severity: 'error' })
    expect(finding.summary).toContain(trace.summaryReason)
  })

  it('still flags invalid GatewaySubnet propagation while leaving informational findings non-actionable', () => {
    const topology = transitTopology()
    topology.udrTables.push({ id: 'gateway-table', name: 'Gateway', disableBgpRoutePropagation: true, routes: [] })
    topology.vnets[0].subnets[0].routeTableId = 'gateway-table'
    expect(runAzNetDiagnostics(topology, simulateAzNet(topology)))
      .toContainEqual(expect.objectContaining({ category: 'gateway-subnet-bgp-disabled', severity: 'error' }))
  })

  it('keeps intentional isolation outside the expected scope and exposes limits and removed endpoints', () => {
    const topology = transitTopology()
    topology.vnets.push({
      id: 'isolated', name: 'Isolated', role: 'spoke', region: 'West Europe', prefixes: ['10.9.0.0/16'],
      subnets: [{ id: 'isolated-work', name: 'Work', prefix: '10.9.1.0/24' }], gateways: [], appliances: [],
    })
    topology.sites[0].prefixes.push('172.17.0.0/24')
    const simulation = simulateAzNet(topology)
    expect(analyzeAzNetConnectivity(topology, simulation, expectedPair).findings).toEqual([])
    const all = analyzeAzNetConnectivity(topology, simulation, { scope: 'all' })
    expect(all.findings.some((f) => f.vnetId === 'isolated')).toBe(true)
    expect(all).toMatchObject({ total: 5, checked: 5, complete: true })
    expect(analyzeAzNetConnectivity(topology, simulation, { scope: 'all' }, 1))
      .toMatchObject({ total: 5, checked: 1, complete: false })
    topology.sites[0].prefixes.reverse()
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings).toEqual([])
    topology.sites[0].prefixes = ['172.17.0.0/24']
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair))
      .toMatchObject({ total: 1, checked: 0, complete: false })
    topology.vnets[1].subnets = []
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair))
      .toMatchObject({ total: 1, checked: 0, complete: false })
    expect(getAzNetEndpoints(topology).filter((e) => e.group === 'site').map((e) => e.prefix))
      .toEqual(['172.17.0.0/24'])
  })

  it('finds stateful asymmetry in the scoped pair without treating harmless path differences as faults', () => {
    const topology = AZURE_NET_SAMPLES[0].topology
    const analysis = analyzeAzNetConnectivity(topology, simulateAzNet(topology), {
      scope: 'pair', sourceKey: 'subnet:vnet-spoke-data:sub-data-db', destinationKey: 'site:site-munich-hq:172.16.10.0/24',
    })
    expect(analysis.findings[0]).toMatchObject({ category: 'asymmetric-firewall-bypass', severity: 'warning' })
    expect(analysis.findings[0].summary).toContain('AzFW-Hub-WEU')
    const harmless = transitTopology()
    harmless.vnets[0].gateways.push({
      id: 'vpn-gw', name: 'VPN return gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true,
    })
    harmless.vpnConnections.push({
      id: 'vpn-return', name: 'VPN return path', siteId: 'site', targetKind: 'vnet-gateway',
      targetId: 'vpn-gw', bgpEnabled: true, enabled: true, inboundPrepend: [65002, 65002, 65002],
    })
    const simulation = simulateAzNet(harmless)
    // Model an independent on-premises preference for the VPN return route.
    simulation.siteRibs.site = simulation.siteRibs.site.map((route) => ({
      ...route, preferred: route.originProtocol === 'VPN' || route.originProtocol === 'VNet',
    }))
    const pair = traceAzNetPair(harmless, simulation,
      { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '10.1.1.4',
      { kind: 'site', siteId: 'site' }, '172.16.0.4')
    expect(pair.forward.traversedEdgeIds).toContain('er-gw')
    expect(pair.reverse.traversedEdgeIds).toContain('vpn-return')
    expect(pair.symmetricInspection).toBe(true)
    expect(analyzeAzNetConnectivity(harmless, simulation, expectedPair).findings).toEqual([])
  })

  it('validates all 5 canonical Azure Networking sample topologies and keeps samples/azure-net + public/docs/samples/azure-net in sync', () => {
    const samplesDir = resolve(process.cwd(), 'samples', 'azure-net')
    const publicDir = resolve(process.cwd(), 'public', 'docs', 'samples', 'azure-net')

    for (const sample of AZURE_NET_SAMPLES) {
      const errors = validateAzNetTopology(sample.topology)
      expect(errors, `Sample ${sample.id} had validation errors`).toEqual([])
      const sim = simulateAzNet(sample.topology)
      expect(Object.keys(sim.subnetTables).length).toBeGreaterThan(0)
      const bicep = generateAzNetBicep(sample.topology)
      expect(bicep.resourceCount).toBeGreaterThan(0)

      const samplePath = resolve(samplesDir, `${sample.id}.json`)
      const onDisk = JSON.parse(readFileSync(samplePath, 'utf-8')) as AzNetTopology
      expect(onDisk).toEqual(sample.topology)
    }

    const sampleFiles = readdirSync(samplesDir).filter((f) => f.endsWith('.json'))
    expect(sampleFiles.length).toBeGreaterThanOrEqual(14)
    for (const file of sampleFiles) {
      const srcPath = resolve(samplesDir, file)
      const pubPath = resolve(publicDir, file)
      const srcTopo = JSON.parse(readFileSync(srcPath, 'utf-8')) as AzNetTopology
      const pubTopo = JSON.parse(readFileSync(pubPath, 'utf-8')) as AzNetTopology
      expect(validateAzNetTopology(srcTopo), `${file} validation`).toEqual([])
      expect(pubTopo, `${file} public mirror`).toEqual(srcTopo)
    }
  })

  it('evaluates Private Endpoint /32 LPM override and GatewaySubnet asymmetric firewall bypass in Sample 1', () => {
    const topo = AZURE_NET_SAMPLES[0].topology
    const sim = simulateAzNet(topo)
    const spokeDataDbTable = sim.subnetTables['sub-data-db']
    expect(spokeDataDbTable).toBeDefined()

    // 10.2.2.15 is the Private Endpoint in VNet-Spoke-Data -> /32 InterfaceEndpoint beats 10.0.0.0/8 UDR in sub-data-db and peered VNet-Hub-WEU
    const peWinner = lookupSubnetEffectiveRoute(spokeDataDbTable, '10.2.2.15')
    expect(peWinner?.nextHopType).toBe('InterfaceEndpoint')
    expect(peWinner?.prefix).toBe('10.2.2.15/32')

    // 10.1.1.10 is a VM in VNet-Spoke-App -> matches 10.0.0.0/8 UDR to Azure Firewall (10.0.1.4)
    const vmWinner = lookupSubnetEffectiveRoute(spokeDataDbTable, '10.1.1.10')
    expect(vmWinner?.nextHopType).toBe('VirtualAppliance')
    expect(vmWinner?.nextHopIp).toBe('10.0.1.4')

    // VNet-Spoke-Data (10.2.1.4) <-> Munich Core DC (172.16.10.4) has an asymmetric firewall bypass on GatewaySubnet
    const pair = traceAzNetPair(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-data', subnetId: 'sub-data-db' },
      '10.2.1.4',
      { kind: 'site', siteId: 'site-munich-hq' },
      '172.16.10.4',
    )
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).toBe('delivered')
    expect(pair.symmetricInspection).toBe(false)
    expect(pair.asymmetricBypassApplianceNames[0]).toContain('AzFW-Hub-WEU')

    const findings = runAzNetDiagnostics(topo, sim)
    expect(findings.some((f) => f.category === 'gateway-subnet-missing-udr')).toBe(true)
    expect(findings.some((f) => f.category === 'private-endpoint-udr-bypass')).toBe(true)
  })

  it('propagates Azure Route Server (ASN 65515) BGP routes and detects disableBgpRoutePropagation blackholes in Sample 2', () => {
    const topo = AZURE_NET_SAMPLES[1].topology
    const sim = simulateAzNet(topo)

    // VNet-Spoke-SAP (sub-sap-app) learns 192.168.100.0/24 from ARS via SDWAN-Edge-NVA (10.100.2.10)
    const sapAppTable = sim.subnetTables['sub-sap-app']
    const sdwanRoute = lookupSubnetEffectiveRoute(sapAppTable, '192.168.100.10')
    expect(sdwanRoute?.source).toBe('RouteServer')
    expect(sdwanRoute?.nextHopType).toBe('VirtualAppliance')
    expect(sdwanRoute?.nextHopIp).toBe('10.100.2.10')

    // sub-sap-db has disableBgpRoutePropagation=true -> BGP routes suppressed -> drops private flow
    const brokenTable = sim.subnetTables['sub-sap-db']
    expect(brokenTable.bgpPropagationDisabled).toBe(true)
    expect(brokenTable.suppressedBgpRoutes.length).toBeGreaterThan(0)

    const brokenTrace = traceAzNetFlow(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-erp', subnetId: 'sub-sap-db' },
      '192.168.100.10',
    )
    expect(brokenTrace.status).toBe('dropped-blackhole')

    const findings = runAzNetDiagnostics(topo, sim)
    expect(findings).toContainEqual(expect.objectContaining({ category: 'bgp-routes-suppressed', severity: 'info' }))
  })

  it('traces multi-region Managed VNRA 100 Gbps transit and catches allowVirtualNetworkAccess=false in Sample 3', () => {
    const topo = AZURE_NET_SAMPLES[2].topology
    const sim = simulateAzNet(topo)

    // VNet-Spoke-WEU-A -> VNet-Spoke-NEU-B succeeds across both regional VNRAs
    const okPair = traceAzNetPair(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-r1-a', subnetId: 'sub-r1a-work' },
      '10.11.1.4',
      { kind: 'subnet', vnetId: 'vnet-spoke-r2-b', subnetId: 'sub-r2b-work' },
      '10.21.1.4',
    )
    expect(okPair.forward.status).toBe('delivered')
    expect(okPair.reverse.status).toBe('delivered')
    expect(okPair.forward.traversedApplianceIds).toEqual(['app-vnra-r1', 'app-vnra-r2'])

    // VNet-Spoke-NEU-C has allowVirtualNetworkAccess=false on its peering with VNet-Hub-Region2-NEU
    const blockedTrace = traceAzNetFlow(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-r2-c', subnetId: 'sub-r2c-work' },
      '10.11.1.4',
    )
    expect(blockedTrace.status).toBe('dropped-peering-access')

    const findings = runAzNetDiagnostics(topo, sim)
    expect(findings.some((f) => f.category === 'vnra-peering-access-disabled')).toBe(true)
  })

  const vnraArchive = JSON.parse(readFileSync(resolve('verification', 'issue-98-vnra-archive.json'), 'utf8')) as {
    nicRoutes: { subnetId: string; prefix: string; nativeSource: string; nativeState: string; nextHopType: string; nextHopIp: string | null }[]
    nextHops: { subnetId: string; destinationIp: string; nextHopType: string; nextHopIp: string }[]
    cases: {
      id: string
      topology: AzNetTopology
      probes: {
        sourceVnetId: string; sourceSubnetId: string; sourceIp: string
        destinationVnetId: string; destinationSubnetId: string; destinationIp: string; received: number
      }[]
    }[]
  }

  it('matches recorded VNRA pre-fix NIC routes and next hops even while peering access blocks forwarding', () => {
    const result = simulateAzNet(vnraArchive.cases[0].topology)
    for (const observed of vnraArchive.nicRoutes) {
      expect(result.subnetTables[observed.subnetId].routes).toContainEqual(expect.objectContaining({
        prefix: observed.prefix, source: observed.nativeSource === 'Default' ? 'System' : observed.nativeSource,
        nextHopType: observed.nextHopType, active: observed.nativeState === 'Active',
        ...(observed.nextHopIp ? { nextHopIp: observed.nextHopIp } : {}),
      }))
    }
    for (const observed of vnraArchive.nextHops) {
      expect(lookupSubnetEffectiveRoute(result.subnetTables[observed.subnetId], observed.destinationIp)).toMatchObject({
        nextHopType: observed.nextHopType, nextHopIp: observed.nextHopIp,
      })
    }
    const disconnected = structuredClone(vnraArchive.cases[0].topology)
    disconnected.vnetPeerings.forEach((peering) => { peering.enabled = false })
    expect(simulateAzNet(disconnected).subnetTables['spoke1-vnet-vm-subnet'].routes.some((route) => route.nextHopType === 'VNetPeering')).toBe(false)
  })

  it.each(vnraArchive.cases)('replays recorded VNRA bidirectional reachability: $id', ({ topology, probes }) => {
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    expect(validateAzNetTopology(topology)).toEqual([])
    const result = simulateAzNet(topology)
    for (const observed of probes) {
      const pair = traceAzNetPair(topology, result,
        { kind: 'subnet', vnetId: observed.sourceVnetId, subnetId: observed.sourceSubnetId }, observed.sourceIp,
        { kind: 'subnet', vnetId: observed.destinationVnetId, subnetId: observed.destinationSubnetId }, observed.destinationIp)
      expect(pair.forward.status).toBe(observed.received ? 'delivered' : 'dropped-peering-access')
      expect(pair.reverse.status).toBe(observed.received ? 'delivered' : 'dropped-peering-access')
      if (observed.received) {
        const order = observed.sourceVnetId === 'spoke1-vnet' ? ['vnra1', 'vnra2'] : ['vnra2', 'vnra1']
        expect(pair.forward.traversedApplianceIds).toEqual(order)
        expect(pair.reverse.traversedApplianceIds).toEqual([...order].reverse())
      }
    }
  })

  const udrArchive = JSON.parse(readFileSync(resolve('verification', 'issue-98-udr-archive.json'), 'utf8')) as {
    spokeRoutes: { prefix: string; nativeSource: string; nativeState: string; nextHopType: string; nextHopIp: string | null }[]
    cases: {
      id: string; topology: AzNetTopology
      routes: { prefix: string; nativeSource: string; nativeState: string; nextHopType: string; nextHopIp: string | null }[]
    }[]
  }

  it.each(udrArchive.cases)('matches recorded summary/explicit UDR selection without enabling the blocked preview feature: $id', ({ topology, routes }) => {
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    expect(validateAzNetTopology(topology)).toEqual([])
    const result = simulateAzNet(topology)
    for (const [subnetId, observedRoutes] of [['probe', routes], ['work1', udrArchive.spokeRoutes]] as const) {
      for (const observed of observedRoutes) {
        expect(result.subnetTables[subnetId].routes).toContainEqual(expect.objectContaining({
          prefix: observed.prefix, source: observed.nativeSource === 'Default' ? 'System' : observed.nativeSource,
          active: observed.nativeState === 'Active', nextHopType: observed.nextHopType,
          ...(observed.nextHopIp ? { nextHopIp: observed.nextHopIp } : {}),
        }))
      }
    }
    for (let n = 1; n <= 10; n++) {
      const observedWinner = routes.find((r) => r.prefix === `10.${n}.0.0/16` && r.nativeState === 'Active')!
      expect(lookupSubnetEffectiveRoute(result.subnetTables.probe, `10.${n}.1.4`)).toMatchObject({
        prefix: observedWinner.prefix, source: observedWinner.nativeSource === 'Default' ? 'System' : 'User',
        nextHopType: observedWinner.nextHopType,
      })
    }
  })

  const s4Archive = JSON.parse(readFileSync(resolve('verification', 'issue-98-udr-s4-archive.json'), 'utf8')) as {
    hub: AzNetTopology['vnets'][number]; overlay: Partial<AzNetTopology>; baseCase: string
    azurePrefixes: string[]; sdwanAsPath: number[]; mseeAsPath: number[]
    erGatewayRoutes: { prefix: string; asPath: number[] }[]
    probes: { site: string; sourceIp: string; destinationIp: string; received: number; forwardPackets: number; returnPackets: number }[]
  }
  const s4Topology = () => {
    const topology = structuredClone(udrArchive.cases.find((entry) => entry.id === s4Archive.baseCase)!.topology)
    topology.vnets[0] = structuredClone(s4Archive.hub)
    return Object.assign(topology, structuredClone(s4Archive.overlay))
  }
  it('matches recorded S4 SD-WAN local-origin, MSEE and ER gateway BGP paths', () => {
    const topology = s4Topology()
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    const result = simulateAzNet(topology)
    for (const prefix of s4Archive.azurePrefixes) {
      expect(result.siteRibs.sdwan.filter((route) => route.prefix === prefix && route.preferred))
        .toEqual([expect.objectContaining({ prefix, asPath: s4Archive.sdwanAsPath })])
      expect(result.erLocationRibs.er).toContainEqual(expect.objectContaining({ prefix, asPath: s4Archive.mseeAsPath, preferred: true }))
    }
    for (const observed of s4Archive.erGatewayRoutes) {
      expect(result.gatewayRibs['ergw-hub']).toContainEqual(expect.objectContaining({ ...observed, preferred: true }))
    }
  })
  it('matches recorded S4 NIC routes and retains summary-bypass LPM without preview suppression', () => {
    const result = simulateAzNet(s4Topology())
    for (const observed of udrArchive.cases[0].routes) {
      expect(result.subnetTables.probe.routes).toContainEqual(expect.objectContaining({
        prefix: observed.prefix, source: observed.nativeSource === 'Default' ? 'System' : observed.nativeSource,
        active: observed.nativeState === 'Active', nextHopType: observed.nextHopType,
        ...(observed.nextHopIp ? { nextHopIp: observed.nextHopIp } : {}),
      }))
    }
    for (const prefix of ['172.16.0.0/16', ...s4Archive.erGatewayRoutes.map((route) => route.prefix)]) {
      expect(result.subnetTables.probe.routes).toContainEqual(expect.objectContaining({ prefix, source: 'VirtualNetworkGateway', active: true, nextHopType: 'VirtualNetworkGateway' }))
    }
    expect(result.subnetTables.probe.routes).toContainEqual(expect.objectContaining({ prefix: '10.0.0.0/16', source: 'System', active: true, nextHopType: 'VnetLocal' }))
    for (const route of [
      { prefix: '10.1.0.0/16', source: 'System', nextHopType: 'VnetLocal' },
      { prefix: '10.0.0.0/16', source: 'System', nextHopType: 'VNetPeering' },
      { prefix: '10.0.0.0/8', source: 'User', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4' },
    ]) expect(result.subnetTables.work1.routes).toContainEqual(expect.objectContaining({ ...route, active: true }))
    for (const prefix of ['172.16.0.0/16', '172.17.0.0/16', '172.18.0.0/16']) {
      expect(lookupSubnetEffectiveRoute(result.subnetTables.work1, prefix.replace('0.0/16', '1.4'))).toMatchObject({ prefix, source: 'User', nextHopIp: '10.0.1.4' })
    }
    expect(lookupSubnetEffectiveRoute(result.subnetTables.probe, '10.1.1.4')).toMatchObject({ prefix: '10.1.0.0/16', source: 'System', nextHopType: 'VNetPeering' })
    expect(lookupSubnetEffectiveRoute(result.subnetTables.nva, '172.17.1.4')).toMatchObject({ prefix: '172.17.0.0/16', source: 'User', nextHopIp: '10.0.2.4' })
  })
  it.each(s4Archive.probes)('detects recorded S4 asymmetric inspection without emulating conntrack: $site', (probe) => {
    const topology = s4Topology()
    const pair = traceAzNetPair(topology, simulateAzNet(topology), { kind: 'site', siteId: probe.site }, probe.sourceIp,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'work1' }, probe.destinationIp)
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).toBe('delivered')
    expect(pair.forward.traversedApplianceIds).not.toContain('vm-hub-nva')
    expect(pair.reverse.traversedApplianceIds).toContain('vm-hub-nva')
    expect(pair.symmetricInspection).toBe(false)
    expect(pair.asymmetricBypassApplianceNames).toContain('vm-hub-nva (vnet-hub)')
    if (probe.site === 'sdwan') {
      topology.vpnConnections.find((connection) => connection.id === 'sdwan-overlay')!.enabled = false
      const disabled = traceAzNetPair(topology, simulateAzNet(topology), { kind: 'site', siteId: probe.site }, probe.sourceIp,
        { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'work1' }, probe.destinationIp)
      expect(disabled.reverse.status).toBe('dropped-no-route')
    }
  })

  const hublessArchive = JSON.parse(readFileSync(resolve('verification', 'issue-98-ars-hubless-archive.json'), 'utf8')) as {
    topology: AzNetTopology
    learned: { peerId: string; prefix: string; asPath: number[] }[]
    cases: { id: string; nva2DefaultSuffix: number[]; nva2DefaultAsPath: number[]; defaultNextHops: string[] }[]
  }

  it.each(hublessArchive.cases)('matches recorded hubless ARS remote-peer paths and NIC default selection: $id', (entry) => {
    const topology = structuredClone(hublessArchive.topology)
    topology.vnets[1].appliances[0].advertisedRouteAttributes![0].asPath = entry.nva2DefaultSuffix
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    const result = simulateAzNet(topology)
    for (const observed of hublessArchive.learned) {
      const asPath = observed.peerId === 'nva2' && observed.prefix === '0.0.0.0/0' ? entry.nva2DefaultAsPath : observed.asPath
      expect(result.routeServerRibs['ars-poland']).toContainEqual(expect.objectContaining({
        prefix: observed.prefix, nextHopId: observed.peerId, asPath,
      }))
    }
    expect(result.subnetTables['c1-work'].routes.filter((route) => route.active && route.prefix === '0.0.0.0/0')
      .map((route) => route.nextHopIp).sort()).toEqual(entry.defaultNextHops)
  })

  it('keeps remote BGP reachability separate from spoke route injection and rejects disabled or one-way-access peerings', () => {
    for (const fault of ['disabled', 'access-denied'] as const) {
      const topology = structuredClone(hublessArchive.topology)
      if (fault === 'disabled') topology.vnetPeerings[0].enabled = false
      else topology.vnetPeerings[0].bToA.allowVirtualNetworkAccess = false
      const result = simulateAzNet(topology)
      expect(result.routeServerRibs['ars-poland'].some((route) => route.nextHopId === 'nva1')).toBe(false)
      expect(result.subnetTables['c1-work'].routes.filter((route) => route.active && route.prefix === '0.0.0.0/0')
        .map((route) => route.nextHopIp)).toEqual(['10.20.1.4'])
    }
    const topology = structuredClone(hublessArchive.topology)
    topology.vnetPeerings[2].bToA.useRemoteGateways = false
    const result = simulateAzNet(topology)
    expect(result.routeServerRibs['ars-poland'].filter((route) => route.prefix === '0.0.0.0/0')).toHaveLength(2)
    expect(result.subnetTables['c1-work'].routes.some((route) => route.source === 'RouteServer')).toBe(false)
  })

  it('models Hybrid Secured vWAN Hub and Classic Hub-and-Spoke coexistence in Sample 4', () => {
    const topo = AZURE_NET_SAMPLES[3].topology
    const sim = simulateAzNet(topo)

    const pair = traceAzNetPair(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-vwan-spoke-1', subnetId: 'sub-vwan-ai' },
      '10.50.1.4',
      { kind: 'subnet', vnetId: 'vnet-legacy-spoke', subnetId: 'sub-leg-core' },
      '10.61.1.4',
    )
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).toBe('delivered')
    expect(pair.symmetricInspection).toBe(true)
  })

  it('validates UC1–UC5 JSON topologies, GatewaySubnet proxy parity, and Bicep generation', () => {
    const ucFiles = [
      'uc1-hub-spoke-nva-ars-baseline.json',
      'uc2-gateway-subnet-missing-udr-asymmetry.json',
      'uc3-bgp-propagation-and-peering-gates.json',
      'uc4-private-endpoint-udr-override.json',
      'uc5-ars-branch-to-branch-and-bgp-selection.json',
    ]

    const loaded: Record<string, AzNetTopology> = {}
    for (const file of ucFiles) {
      const raw = readFileSync(resolve(process.cwd(), 'samples', 'azure-net', file), 'utf-8')
      const topo = JSON.parse(raw) as AzNetTopology
      expect(validateAzNetTopology(topo), `${file} schema validation`).toEqual([])
      const bicep = generateAzNetBicep(topo)
      expect(bicep.resourceCount, `${file} bicep resourceCount`).toBeGreaterThan(0)
      expect(bicep.text).toContain("resource vnet_vnet_hub 'Microsoft.Network/virtualNetworks@")
      expect(bicep.text).toContain("name: 'snet-gw-proxy'")
      expect(bicep.text).toContain('id: rt_rt_gw_subnet.id')
      loaded[file] = topo
    }

    // UC1: snet-gw-proxy and GatewaySubnet have identical effective routes and symmetric inspection
    const uc1 = loaded['uc1-hub-spoke-nva-ars-baseline.json']
    const sim1 = simulateAzNet(uc1)
    const gwSubRoutes = sim1.subnetTables['sub-hub-gw'].routes
    const proxyRoutes = sim1.subnetTables['sub-hub-gw-proxy'].routes
    expect(proxyRoutes.map((r) => `${r.prefix}:${r.source}:${r.nextHopType}:${r.active}`)).toEqual(
      gwSubRoutes.map((r) => `${r.prefix}:${r.source}:${r.nextHopType}:${r.active}`),
    )
    const uc1Pair = traceAzNetPair(
      uc1,
      sim1,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.1.4',
      { kind: 'site', siteId: 'site-branch1' },
      '192.168.100.4',
    )
    expect(uc1Pair.symmetricInspection).toBe(true)

    // UC2: Missing UDR on rt-gw-subnet causes asymmetric bypass on return path
    const uc2 = loaded['uc2-gateway-subnet-missing-udr-asymmetry.json']
    const sim2 = simulateAzNet(uc2)
    const uc2Pair = traceAzNetPair(
      uc2,
      sim2,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.1.4',
      { kind: 'site', siteId: 'site-branch1' },
      '192.168.100.4',
    )
    expect(uc2Pair.symmetricInspection).toBe(false)
    // The sample's site prefix is 10.250.0.0/16, not the NVA advertisement above.
    // An unrelated firewall UDR is not proof of asymmetric site connectivity.
    expect(runAzNetDiagnostics(uc2, sim2).some((f) => f.category === 'gateway-subnet-missing-udr')).toBe(false)

    // UC3: disableBgpRoutePropagation on rt-spoke2 + allowForwardedTraffic=false on vnet-spoke1
    const uc3 = loaded['uc3-bgp-propagation-and-peering-gates.json']
    const sim3 = simulateAzNet(uc3)
    expect(sim3.subnetTables['sub-spoke2-work'].bgpPropagationDisabled).toBe(true)
    const spoke2ToSpoke1Flow = traceAzNetFlow(
      uc3,
      sim3,
      { kind: 'subnet', vnetId: 'vnet-spoke2', subnetId: 'sub-spoke2-work' },
      '10.101.1.4',
    )
    expect(spoke2ToSpoke1Flow.status).toBe('dropped-peering-forwarded-traffic')

    // UC4: RouteTableEnabled allows /32 UDR to override Private Endpoint InterfaceEndpoint
    const uc4 = loaded['uc4-private-endpoint-udr-override.json']
    const sim4 = simulateAzNet(uc4)
    const peWinner4 = lookupSubnetEffectiveRoute(sim4.subnetTables['sub-spoke2-work'], '10.101.2.4')
    expect(peWinner4?.source).toBe('User')
    expect(peWinner4?.nextHopType).toBe('VirtualAppliance')
    expect(peWinner4?.nextHopIp).toBe('10.100.2.4')

    // UC5: ARS branchToBranchTraffic=false suppresses NVA<->VNG transit
    const uc5 = loaded['uc5-ars-branch-to-branch-and-bgp-selection.json']
    const sim5 = simulateAzNet(uc5)
    const arsRib5 = sim5.routeServerRibs['ars-hub']
    expect(arsRib5.some((r) => r.prefix === '192.168.100.0/24' && r.preferred)).toBe(true)
    expect(sim1.gatewayRibs['vng-hub-vpn'].some((r) => r.prefix === '192.168.100.0/24')).toBe(true)
    const vngRib5 = sim5.gatewayRibs['vng-hub-vpn']
    expect(vngRib5.some((r) => r.prefix === '192.168.100.0/24')).toBe(false)
  })

  it('imports azure-network-capture v2 JSON and compares NIC effective routes including GatewaySubnet proxy', () => {
    const rawUc1 = readFileSync(
      resolve(process.cwd(), 'samples', 'azure-net', 'uc1-hub-spoke-nva-ars-baseline.json'),
      'utf-8',
    )
    const uc1 = JSON.parse(rawUc1) as AzNetTopology
    const sim1 = simulateAzNet(uc1)
    const proxySimulated = sim1.subnetTables['sub-hub-gw-proxy'].routes

    const capture = {
      kind: 'azure-network-capture',
      version: 2,
      resourceGroup: 'rg-aznet-sim-lab',
      vnets: [
        {
          id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet-aznet-hub',
          name: 'vnet-aznet-hub',
          location: 'swedencentral',
          addressSpace: { addressPrefixes: ['10.100.0.0/16'] },
          subnets: [
            {
              id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet-aznet-hub/subnets/GatewaySubnet',
              name: 'GatewaySubnet',
              addressPrefix: '10.100.0.0/26',
              routeTable: {
                id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/routeTables/rt-gw-subnet',
              },
            },
            {
              id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet-aznet-hub/subnets/snet-gw-proxy',
              name: 'snet-gw-proxy',
              addressPrefix: '10.100.4.0/24',
              routeTable: {
                id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/routeTables/rt-gw-subnet',
              },
            },
          ],
        },
      ],
      routeTables: [
        {
          id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/routeTables/rt-gw-subnet',
          name: 'rt-gw-subnet',
          disableBgpRoutePropagation: false,
          routes: [
            {
              name: 'udr-gw-to-spoke1-via-nva',
              addressPrefix: '10.101.0.0/16',
              nextHopType: 'VirtualAppliance',
              nextHopIpAddress: '10.100.2.4',
            },
          ],
        },
      ],
      nicEffectiveRoutes: [
        {
          nicName: 'nic-vm-gw-proxy',
          nicId: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/networkInterfaces/nic-vm-gw-proxy',
          vnetName: 'vnet-aznet-hub',
          subnetName: 'snet-gw-proxy',
          effectiveRoutes: proxySimulated.map((r) => ({
            addressPrefix: [r.prefix],
            nextHopType: r.nextHopType,
            nextHopIpAddress: r.nextHopIp ? [r.nextHopIp] : [],
            source: r.source === 'RouteServer' ? 'VirtualNetworkGateway' : r.source,
            state: r.active ? 'Active' : 'Invalid',
          })),
        },
      ],
    }

    const imported = importAzNetCapture(capture)
    expect(imported.topology.vnets).toHaveLength(1)
    expect(imported.observations).toBeDefined()

    const directCompare = compareAzNetWithObservations(uc1, sim1, imported.observations!)
    expect(directCompare.subnetComparisons).toHaveLength(1)
    expect(directCompare.subnetComparisons[0].proxyForGatewaySubnet).toBe(true)
    expect(directCompare.subnetComparisons[0].mismatchCount).toBe(0)
    expect(directCompare.totalMatchedRoutes).toBeGreaterThan(0)
  })

  it('reproduces all 8 empirical live Azure captures (uc1..uc8) with zero effective-route mismatches', () => {
    const pairs: Array<[string, string]> = [
      ['uc1-capture.json', 'uc1-hub-spoke-nva-ars-baseline.json'],
      ['uc2-capture.json', 'uc2-gateway-subnet-missing-udr-asymmetry.json'],
      ['uc3-capture.json', 'uc3-bgp-propagation-and-peering-gates.json'],
      ['uc4-capture.json', 'uc4-private-endpoint-udr-override.json'],
      ['uc5-capture.json', 'uc5-ars-branch-to-branch-and-bgp-selection.json'],
      ['uc6-capture.json', 'uc6-ars-default-route-self-blackhole.json'],
      ['uc7-capture.json', 'uc7-bgp-lpm-bypasses-summary-udr.json'],
      ['uc8-capture.json', 'uc8-udr-next-hop-types-and-vng-transit-trap.json'],
    ]

    for (const [capFile, sampleFile] of pairs) {
      const capRaw = readFileSync(
        resolve(process.cwd(), 'verification', 'azure-net-2026-11-03', capFile),
        'utf-8',
      )
      const cap = JSON.parse(capRaw)
      const imp = importAzNetCapture(cap)
      expect(imp.observations, `${capFile} observations`).toBeDefined()

      const impSim = simulateAzNet(imp.topology)
      const impCmp = compareAzNetWithObservations(imp.topology, impSim, imp.observations!)
      const mismatched = impCmp.subnetComparisons.flatMap((sc) =>
        sc.rows.filter((r) => !r.matched).map((r) => ({ vnet: sc.vnetName, subnet: sc.subnetName, ...r })),
      )
      expect(mismatched, `${capFile} imported mismatches`).toEqual([])
      expect(impCmp.totalMismatchedRoutes, `${capFile} imported mismatches`).toBe(0)
      expect(impCmp.totalMatchedRoutes, `${capFile} imported matches`).toBeGreaterThanOrEqual(27)

      const sampleRaw = readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', sampleFile),
        'utf-8',
      )
      const sample = JSON.parse(sampleRaw) as AzNetTopology
      const sampleSim = simulateAzNet(sample)
      const sampleCmp = compareAzNetWithObservations(sample, sampleSim, imp.observations!)
      expect(sampleCmp.totalMismatchedRoutes, `${capFile} vs ${sampleFile} mismatches`).toBe(0)
      expect(sampleCmp.totalMatchedRoutes, `${capFile} vs ${sampleFile} matches`).toBeGreaterThanOrEqual(25)
    }
  })

  it('validates Phase 2 unusual scenarios (UC6..UC9) and reserved ASN / static route edge cases', () => {
    // UC6: NVA advertises 0.0.0.0/0 to ARS -> ARS injects 0.0.0.0/0 -> 10.100.2.4 into snet-nva, causing self-loop
    const uc6 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc6-ars-default-route-self-blackhole.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc6)).toEqual([])
    expect(generateAzNetBicep(uc6).resourceCount).toBeGreaterThan(0)
    const sim6 = simulateAzNet(uc6)
    const nvaDefaultWinner = lookupSubnetEffectiveRoute(sim6.subnetTables['sub-hub-nva'], '8.8.8.8')
    expect(nvaDefaultWinner?.source).toBe('RouteServer')
    expect(nvaDefaultWinner?.nextHopIp).toBe('10.100.2.4')
    const spokeToInternet6 = traceAzNetFlow(
      uc6,
      sim6,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '8.8.8.8',
    )
    expect(spokeToInternet6.status).toBe('loop')
    const diag6 = runAzNetDiagnostics(uc6, sim6)
    expect(diag6.some((f) => f.category === 'ars-default-route-self-loop')).toBe(true)

    // Remediating UC6 by adding UDR 0.0.0.0/0 -> Internet on rt-hub-nva breaks the self-loop
    const uc6Fixed = JSON.parse(JSON.stringify(uc6)) as AzNetTopology
    uc6Fixed.udrTables.find((t) => t.id === 'rt-hub-nva')!.routes.push({
      id: 'udr-nva-internet',
      name: 'default-to-internet',
      prefix: '0.0.0.0/0',
      nextHopType: 'Internet',
      enabled: true,
    })
    const sim6Fixed = simulateAzNet(uc6Fixed)
    const nvaDefaultFixed = lookupSubnetEffectiveRoute(sim6Fixed.subnetTables['sub-hub-nva'], '8.8.8.8')
    expect(nvaDefaultFixed?.source).toBe('User')
    expect(nvaDefaultFixed?.nextHopType).toBe('Internet')
    const spokeToInternet6Fixed = traceAzNetFlow(
      uc6Fixed,
      sim6Fixed,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '8.8.8.8',
    )
    expect(spokeToInternet6Fixed.status).toBe('delivered')
    expect(spokeToInternet6Fixed.traversedApplianceIds).toContain('app-hub-nva')

    // UC7: More-specific /16 BGP route (10.250.0.0/16) wins by LPM over summary /8 UDR (10.0.0.0/8 -> NVA)
    const uc7 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc7-bgp-lpm-bypasses-summary-udr.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc7)).toEqual([])
    const sim7 = simulateAzNet(uc7)
    const lpm16Winner = lookupSubnetEffectiveRoute(sim7.subnetTables['sub-spoke1-work'], '10.250.0.100')
    expect(lpm16Winner?.prefix).toBe('10.250.0.0/16')
    expect(lpm16Winner?.source).toBe('VirtualNetworkGateway')
    const lpm8Winner = lookupSubnetEffectiveRoute(sim7.subnetTables['sub-spoke1-work'], '10.200.1.4')
    expect(lpm8Winner?.prefix).toBe('10.0.0.0/8')
    expect(lpm8Winner?.source).toBe('User')
    const pair7 = traceAzNetPair(
      uc7,
      sim7,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.1.4',
      { kind: 'site', siteId: 'site-branch1' },
      '10.250.0.100',
    )
    expect(pair7.forward.status).toBe('delivered')
    expect(pair7.reverse.status).toBe('delivered')
    expect(pair7.symmetricInspection).toBe(false)
    const diag7 = runAzNetDiagnostics(uc7, sim7)
    expect(diag7.some((f) => f.category === 'bgp-lpm-bypasses-udr')).toBe(true)
    expect(diag7.some((f) => f.category === 'asymmetric-firewall-bypass')).toBe(true)

    // UC8: NextHopType=None blackhole, NextHopType=Internet override, and invalid NextHopType=VirtualNetworkGateway for Spoke2
    const uc8 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc8-udr-next-hop-types-and-vng-transit-trap.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc8)).toEqual([])
    const sim8 = simulateAzNet(uc8)
    const carveoutFlow = traceAzNetFlow(
      uc8,
      sim8,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.128.10',
    )
    expect(carveoutFlow.status).toBe('dropped-blackhole')
    const spoke1ToSpoke2InvalidVng = traceAzNetFlow(
      uc8,
      sim8,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.102.1.4',
    )
    expect(spoke1ToSpoke2InvalidVng.status).toBe('dropped-no-route')
    const diag8 = runAzNetDiagnostics(uc8, sim8)
    expect(diag8.some((f) => f.category === 'udr-vng-vnet-transit')).toBe(true)

    // UC9: VNet-to-VNet transit hairpin via shared ExpressRoute MSEE (ASN 12076)
    const uc9 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc9-expressroute-hairpin-two-vnets.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc9)).toEqual([])
    const sim9 = simulateAzNet(uc9)
    const spokeAToSpokeB = traceAzNetFlow(
      uc9,
      sim9,
      { kind: 'subnet', vnetId: 'vnet-spoke-a', subnetId: 'sub-spoke-a-work' },
      '10.201.1.4',
    )
    expect(spokeAToSpokeB.status).toBe('delivered')
    expect(spokeAToSpokeB.hops.some((h) => h.nodeKind === 'er-location')).toBe(true)

    // Reserved ASN (65515 / 12076) on NVA peering with ARS is rejected
    const ucReservedAsn = JSON.parse(JSON.stringify(uc6Fixed)) as AzNetTopology
    ucReservedAsn.vnets[0].appliances[0].asn = 65515
    const simReserved = simulateAzNet(ucReservedAsn)
    expect(
      simReserved.routeServerRibs['ars-hub'].some((r) => r.prefix === '192.168.100.0/24'),
    ).toBe(false)
  })

  it('validates disablePeeringRoutePropagation (Preview), PeerBypass diagnostics, defaultOutboundAccess, and ExpressRoute MSEE Hairpin diagnostics', () => {
    // 1. ExpressRoute MSEE Hairpin diagnostic on UC9
    const uc9 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc9-expressroute-hairpin-two-vnets.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    const sim9 = simulateAzNet(uc9)
    const diag9 = runAzNetDiagnostics(uc9, sim9)
    expect(diag9.some((f) => f.category === 'expressroute-msee-hairpin')).toBe(true)

    // 2. Peering LPM bypasses summary UDR + disablePeeringRoutePropagation suppression
    const peerTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    // Add a direct spoke-to-spoke peering between VNet-Spoke-App (10.1.0.0/16) and VNet-Spoke-Data (10.2.0.0/16)
    peerTopo.vnetPeerings.push({
      id: 'peer-app-data-direct',
      name: 'Spoke-App ↔ Spoke-Data Direct',
      vnetAId: 'vnet-spoke-app',
      vnetBId: 'vnet-spoke-data',
      enabled: true,
      aToB: {
        allowVirtualNetworkAccess: true,
        allowForwardedTraffic: true,
        allowGatewayTransit: false,
        useRemoteGateways: false,
      },
      bToA: {
        allowVirtualNetworkAccess: true,
        allowForwardedTraffic: true,
        allowGatewayTransit: false,
        useRemoteGateways: false,
      },
    })
    const rtSpokeApp = peerTopo.udrTables.find((t) => t.id === 'rt-spoke-to-fw')!
    rtSpokeApp.routes = [
      {
        id: 'udr-summary-rfc1918',
        name: 'summary-10-8-to-fw',
        prefix: '10.0.0.0/8',
        nextHopType: 'VirtualAppliance',
        nextHopIp: '10.0.1.4',
        enabled: true,
      },
    ]
    const simPeerBefore = simulateAzNet(peerTopo)
    const diagPeerBefore = runAzNetDiagnostics(peerTopo, simPeerBefore)
    expect(diagPeerBefore.some((f) => f.category === 'peering-lpm-bypasses-udr')).toBe(true)
    const winnerBefore = lookupSubnetEffectiveRoute(
      simPeerBefore.subnetTables['sub-app-web'],
      '10.2.1.10',
    )
    expect(winnerBefore?.source).toBe('System')
    expect(winnerBefore?.nextHopType).toBe('VNetPeering')

    // Enable disablePeeringRoutePropagation on rt-spoke-to-fw -> VNetPeering route is suppressed and 10.0.0.0/8 UDR wins
    rtSpokeApp.disablePeeringRoutePropagation = true
    const simPeerAfter = simulateAzNet(peerTopo)
    const appWebTableAfter = simPeerAfter.subnetTables['sub-app-web']
    expect(appWebTableAfter.peeringPropagationDisabled).toBe(true)
    expect(appWebTableAfter.suppressedPeeringRoutes.length).toBeGreaterThan(0)
    const winnerAfter = lookupSubnetEffectiveRoute(appWebTableAfter, '10.2.1.10')
    expect(winnerAfter?.source).toBe('User')
    expect(winnerAfter?.nextHopType).toBe('VirtualAppliance')
    const diagPeerAfter = runAzNetDiagnostics(peerTopo, simPeerAfter)
    expect(diagPeerAfter.some((f) => f.category === 'peering-lpm-bypasses-udr')).toBe(false)

    // 3. Subnet defaultOutboundAccess=false and Internet egress tracing
    const egressTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    const spokeWebSub = egressTopo.vnets
      .find((v) => v.id === 'vnet-spoke-app')!
      .subnets.find((s) => s.id === 'sub-app-web')!
    // Remove 0.0.0.0/0 UDR from rt-spoke-to-fw so sub-app-web relies on System 0.0.0.0/0 -> Internet
    const rtApp = egressTopo.udrTables.find((t) => t.id === 'rt-spoke-to-fw')!
    rtApp.routes = rtApp.routes.filter((r) => r.prefix !== '0.0.0.0/0')

    // With defaultOutboundAccess undefined/true, spoke bypasses Hub Firewall directly to Internet
    const simEgressOpen = simulateAzNet(egressTopo)
    const openInternetTrace = traceAzNetFlow(
      egressTopo,
      simEgressOpen,
      { kind: 'subnet', vnetId: 'vnet-spoke-app', subnetId: 'sub-app-web' },
      '20.50.60.70',
    )
    expect(openInternetTrace.status).toBe('delivered')
    const diagEgressOpen = runAzNetDiagnostics(egressTopo, simEgressOpen)
    expect(diagEgressOpen.some((f) => f.category === 'subnet-internet-bypasses-firewall')).toBe(true)

    // With defaultOutboundAccess=false and no explicit egress, outbound Internet flow is dropped
    spokeWebSub.defaultOutboundAccess = false
    const simEgressBlocked = simulateAzNet(egressTopo)
    const blockedInternetTrace = traceAzNetFlow(
      egressTopo,
      simEgressBlocked,
      { kind: 'subnet', vnetId: 'vnet-spoke-app', subnetId: 'sub-app-web' },
      '20.50.60.70',
    )
    expect(blockedInternetTrace.status).toBe('dropped-no-outbound-access')
    const diagEgressBlocked = runAzNetDiagnostics(egressTopo, simEgressBlocked)
    expect(diagEgressBlocked.some((f) => f.category === 'subnet-default-outbound-disabled')).toBe(
      true,
    )

    // 4. Optional diagram node labels validate cleanly up to 120 chars and reject overly long strings
    const labeledTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    labeledTopo.vnets[0].label = 'Core Security Hub'
    labeledTopo.sites[0].label = 'Primary On-Prem DC'
    expect(validateAzNetTopology(labeledTopo)).toEqual([])
    labeledTopo.vnets[0].label = 'x'.repeat(121)
    expect(validateAzNetTopology(labeledTopo).some((e) => e.includes('120 characters'))).toBe(true)
  })

  it('validates #43-#49: ER peering locations catalog, ER SKU regional restrictions, ER Global Reach, peering/gateway transit diagnostics, and empty default topology', () => {
    // #43: Internal catalog of 149 ExpressRoute peering locations & providers
    expect(ER_PEERING_LOCATIONS_CATALOG.length).toBeGreaterThanOrEqual(140)
    const frankfurt = findErPeeringLocationEntry('Frankfurt')
    expect(frankfurt).toBeDefined()
    expect(frankfurt?.geopoliticalRegion).toBe('Europe')
    expect(frankfurt?.localAzureRegions).toContain('Germany West Central')

    // #44: ExpressRoute SKU regional compatibility evaluator (Local / Standard / Premium)
    expect(evaluateErSkuRegionalCompatibility('Local', 'Frankfurt', 'germanywestcentral').allowed).toBe(true)
    expect(evaluateErSkuRegionalCompatibility('Local', 'Frankfurt', 'westeurope').allowed).toBe(false)
    expect(evaluateErSkuRegionalCompatibility('Standard', 'Frankfurt', 'westeurope').allowed).toBe(true)
    expect(evaluateErSkuRegionalCompatibility('Standard', 'Frankfurt', 'eastus').allowed).toBe(false)
    expect(evaluateErSkuRegionalCompatibility('Premium', 'Frankfurt', 'eastus').allowed).toBe(true)

    // #44 in AzNet engine & diagnostics: ER Local at Frankfurt connected to Hub VNet in westeurope is blocked
    const erLocalTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    erLocalTopo.erLocations[0].peeringLocation = 'Frankfurt'
    erLocalTopo.erLocations[0].sku = 'Local'
    const simErLocal = simulateAzNet(erLocalTopo)
    const diagErLocal = runAzNetDiagnostics(erLocalTopo, simErLocal)
    expect(diagErLocal.some((f) => f.category === 'er-sku-regional-mismatch')).toBe(true)
    // Upgrade to Standard (both Frankfurt and westeurope are in Europe) -> allowed
    erLocalTopo.erLocations[0].sku = 'Standard'
    const simErStd = simulateAzNet(erLocalTopo)
    const diagErStd = runAzNetDiagnostics(erLocalTopo, simErStd)
    expect(diagErStd.some((f) => f.category === 'er-sku-regional-mismatch')).toBe(false)

    // #45: ExpressRoute Global Reach circuit-to-circuit connectivity between two on-premises sites
    const grTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    grTopo.erLocations.push({
      id: 'er-loc-amsterdam',
      name: 'ER-Amsterdam-Primary',
      peeringLocation: 'Amsterdam',
      sku: 'Standard',
      x: 110,
      y: 440,
    })
    grTopo.sites.push({
      id: 'site-amsterdam-dc',
      name: 'Amsterdam Branch DC',
      asn: 65020,
      prefixes: ['172.20.0.0/16'],
      x: 30,
      y: 440,
    })
    grTopo.erLinks.push({
      id: 'erlink-ams-site',
      name: 'Amsterdam-to-MSEE',
      locationId: 'er-loc-amsterdam',
      targetKind: 'site',
      targetId: 'site-amsterdam-dc',
      enabled: true,
      weight: 0,
      prepend: [],
    })
    grTopo.erGlobalReachLinks = [
      {
        id: 'gr-fra-ams',
        name: 'GlobalReach-FRA-AMS',
        locationAId: grTopo.erLocations[0].id,
        locationBId: 'er-loc-amsterdam',
        enabled: true,
      },
    ]
    expect(validateAzNetTopology(grTopo)).toEqual([])
    const simGr = simulateAzNet(grTopo)
    const grTrace = traceAzNetFlow(
      grTopo,
      simGr,
      { kind: 'site', siteId: 'site-munich-hq' },
      '172.20.1.10',
    )
    expect(grTrace.status).toBe('delivered')
    expect(grTrace.hops.some((h) => h.detail.includes('Global Reach'))).toBe(true)

    // #48: Disabling useRemoteGateways or allowGatewayTransit flags broken spoke-to-onprem connectivity
    const brokenTransitTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    const hubAppPeering = brokenTransitTopo.vnetPeerings.find((p) => p.id === 'peer-hub-app')!
    hubAppPeering.bToA.useRemoteGateways = false
    const simBrokenTransit = simulateAzNet(brokenTransitTopo)
    const diagBrokenTransit = runAzNetDiagnostics(brokenTransitTopo, simBrokenTransit)
    expect(diagBrokenTransit.some((f) => f.category === 'spoke-onprem-gateway-transit-disabled')).toBe(true)

    // Empty default topology helper
    const emptyTopo = createEmptyAzNetTopology()
    expect(emptyTopo.vnets).toEqual([])
    expect(emptyTopo.sites).toEqual([])
    expect(emptyTopo.erLocations).toEqual([])
  })
})

