import { describe, expect, it } from 'vitest'
import { simulateAzNet, traceAzNetFlow } from './engine'
import { createEmptyAzNetTopology, validateAzNetTopology } from './model'
import { parseAzNetTopology } from './admission'
import { applyAzHubRouteMap, pruneAzSiteRouteMaps } from './route-maps'
import type { RouteMapRule } from '../model'

function mixedTopology() {
  const topology = createEmptyAzNetTopology()
  topology.vwanHubs = [{
    id: 'wan', name: 'WAN', region: 'westeurope', preference: 'ExpressRoute',
    routingIntent: { private: false, internet: false },
  }]
  topology.vnets = [{
    id: 'classic', name: 'Classic', region: 'westeurope', role: 'hub-vnet', prefixes: ['10.0.0.0/16'],
    subnets: [{ id: 'classic-work', name: 'Work', prefix: '10.0.1.0/24' }],
    gateways: [{ id: 'er-gw', name: 'ER gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true }],
    appliances: [],
  }, {
    id: 'spoke', name: 'WAN spoke', region: 'westeurope', role: 'spoke-vnet', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'wan-work', name: 'Work', prefix: '10.1.1.0/24' }],
    gateways: [], appliances: [], vwanHubAttachment: { hubId: 'wan', enabled: true },
  }]
  topology.sites = [{ id: 'branch', name: 'Branch', asn: 65001, prefixes: ['172.16.0.0/24'] }]
  topology.erLocations = [{ id: 'msee', name: 'Amsterdam', peeringLocation: 'Amsterdam', globalReachEnabled: true }]
  topology.erLinks = [
    { id: 'classic-er', name: 'Classic ER', locationId: 'msee', targetKind: 'vnet-gateway', targetId: 'er-gw', enabled: true },
    { id: 'wan-er', name: 'WAN ER', locationId: 'msee', targetKind: 'vwan-hub', targetId: 'wan', enabled: true },
  ]
  topology.vpnConnections = [{ id: 'branch-vpn', name: 'Branch VPN', siteId: 'branch', targetKind: 'vwan-hub', targetId: 'wan', enabled: true, bgpEnabled: true }]
  return topology
}

const rule = (values: Partial<RouteMapRule> = {}): RouteMapRule => ({
  id: 'rule', prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate', ...values,
})

describe('Mixed native capability bridge', () => {
  it('rejects own-AS loops before replacement policies can hide them and after policies introduce them', () => {
    const topology = mixedTopology()
    const replacement = rule({ modifications: [{ property: 'asPath', action: 'replace', values: ['64496'] }] })
    topology.routeMaps = [{ id: 'replace', name: 'Replace AS path', hubId: 'wan', rules: [replacement] }]
    topology.vwanHubs[0].routeMapAssignments = [{ connectionId: 'branch-vpn', inboundMapId: 'replace' }]
    const advertisement = { prefix: '172.16.0.0/24', asPath: [65001, 65515] }
    expect(applyAzHubRouteMap(topology, 'wan', 'branch-vpn', 'inbound', [advertisement])).toEqual([])
    advertisement.asPath = [65001]
    expect(applyAzHubRouteMap(topology, 'wan', 'branch-vpn', 'inbound', [advertisement])[0].asPath).toEqual([64496])
    replacement.modifications![0].values = ['65520']
    expect(applyAzHubRouteMap(topology, 'wan', 'branch-vpn', 'inbound', [advertisement])).toEqual([])
  })

  it('exports selected VPN routes to classic ER and preserves original forwarding edges in both directions', () => {
    const topology = mixedTopology()
    const simulation = simulateAzNet(topology)
    expect(simulation.vwanHubTableCoverage.wan.defaultRouteTable.complete).toBe(true)
    expect(simulation.gatewayRibs['er-gw']).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.16.0.0/24', preferred: true }),
    ]))
    const forward = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'classic', subnetId: 'classic-work' }, '172.16.0.4')
    const reply = traceAzNetFlow(topology, simulation, { kind: 'site', siteId: 'branch' }, '10.0.1.4')
    expect(forward.status).toBe('delivered')
    expect(forward.traversedEdgeIds).toEqual(expect.arrayContaining(['classic-er', 'wan-er', 'branch-vpn']))
    expect(reply.status).toBe('delivered')
    expect(reply.traversedEdgeIds).toEqual(expect.arrayContaining(['classic-er', 'wan-er', 'branch-vpn']))
  })

  it('applies hub ingress and per-connection egress policies without changing IDs or unrelated classic routes', () => {
    const topology = mixedTopology()
    topology.routeMaps = [
      { id: 'ingress', name: 'Hub ingress', hubId: 'wan', rules: [rule({ action: 'prepend', prepend: [64496] })] },
      { id: 'egress', name: 'Hub egress', hubId: 'wan', rules: [rule({ id: 'egress-rule', prefixes: ['172.16.0.0/24'], action: 'drop' })] },
    ]
    topology.vwanHubs[0].routeMapAssignments = [
      { connectionId: 'branch-vpn', inboundMapId: 'ingress' }, { connectionId: 'wan-er', outboundMapId: 'egress' },
    ]
    expect(validateAzNetTopology(topology)).toEqual([])
    expect(parseAzNetTopology(topology)).toEqual(topology)
    const simulation = simulateAzNet(topology)
    expect(simulation.vwanHubTableCoverage.wan.defaultRouteTable.complete).toBe(true)
    expect(simulation.vwanHubRibs.wan).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.16.0.0/24', connectionId: 'branch-vpn', asPath: [64496, 65001], preferred: true }),
    ]))
    expect(simulation.gatewayRibs['er-gw'].some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    expect(simulation.gatewayRibs['er-gw'].some((route) => route.prefix === '10.1.0.0/16' && route.preferred)).toBe(true)
    pruneAzSiteRouteMaps(topology)
    expect(topology.routeMaps).toHaveLength(2)
    topology.erLinks = topology.erLinks.filter((link) => link.id !== 'wan-er')
    pruneAzSiteRouteMaps(topology)
    expect(topology.vwanHubs[0].routeMapAssignments).toEqual([{ connectionId: 'branch-vpn', inboundMapId: 'ingress' }])
    topology.vwanHubs = []
    pruneAzSiteRouteMaps(topology)
    expect(topology.routeMaps).toEqual([])
  })

  it('rejects cross-owner hub assignments and applies VNet policies to the original VNet connection', () => {
    const topology = mixedTopology()
    topology.routeMaps = [{ id: 'map', name: 'VNet ingress', hubId: 'wan', rules: [rule({ action: 'drop' })] }]
    topology.vwanHubs[0].routeMapAssignments = [{ connectionId: 'spoke', inboundMapId: 'map' }]
    expect(simulateAzNet(topology).vwanHubRibs.wan.some((route) => route.prefix === '10.1.0.0/16')).toBe(false)
    topology.routeMaps[0].hubId = undefined
    topology.routeMaps[0].siteId = 'branch'
    expect(() => parseAzNetTopology(topology)).toThrow(/same hub/)
  })

  it('forwards only summary contributors and never turns aggregate holes into reachability', () => {
    const topology = mixedTopology()
    topology.routeMaps = [{
      id: 'summary', name: 'Hub aggregate', hubId: 'wan',
      rules: [rule({ action: 'summarize', summaryPrefixes: ['172.16.0.0/16'] })],
    }]
    topology.vwanHubs[0].routeMapAssignments = [{ connectionId: 'branch-vpn', inboundMapId: 'summary' }]
    const simulation = simulateAzNet(topology)
    const source = { kind: 'subnet' as const, vnetId: 'spoke', subnetId: 'wan-work' }
    expect(traceAzNetFlow(topology, simulation, source, '172.16.0.4').status).toBe('delivered')
    expect(traceAzNetFlow(topology, simulation, source, '172.16.2.4').status).not.toBe('delivered')
  })

  it('uses the dedicated HRP comparison: SD-WAN is not a VPN gateway', () => {
    const topology = mixedTopology()
    topology.sites.push({ id: 'er-branch', name: 'ER branch', asn: 64496, prefixes: ['172.16.0.0/24'] })
    topology.erLinks.push({ id: 'branch-er', name: 'Branch ER', locationId: 'msee', targetKind: 'site', targetId: 'er-branch', enabled: true })
    topology.vpnConnections[0].transport = 'SDWAN'
    const selected = (value: ReturnType<typeof simulateAzNet>) => value.vwanHubRibs.wan.filter((route) => route.preferred && route.prefix === '172.16.0.0/24')
    expect(selected(simulateAzNet(topology))).toEqual([expect.objectContaining({ connectionId: 'branch-vpn', asPath: [65001] })])
    topology.vpnConnections[0].transport = 'VPN'
    expect(selected(simulateAzNet(topology))).toEqual([expect.objectContaining({ connectionId: 'wan-er', originProtocol: 'ExpressRoute' })])
    topology.vpnConnections[0].transport = 'SDWAN'
    topology.vpnConnections[0].bgpEnabled = false
    expect(() => parseAzNetTopology(topology)).toThrow(/SDWAN requires/)
  })

  it('retains configured ER link weights while ASPath preference remains path-first', () => {
    const topology = mixedTopology()
    topology.erLinks.push({ ...topology.erLinks[1], id: 'weighted-er', weight: 10, prepend: [64496] })
    const selected = () => simulateAzNet(topology).vwanHubRibs.wan.filter((route) =>
      route.preferred && route.prefix === '10.0.0.0/16')
    expect(selected()).toEqual([expect.objectContaining({ connectionId: 'weighted-er' })])
    topology.vwanHubs[0].preference = 'ASPath'
    expect(selected()).toEqual([expect.objectContaining({ connectionId: 'wan-er' })])
  })

  it('peers the original spoke NVA and carries mixed ER-to-NVA overlay flows in both directions', () => {
    const topology = mixedTopology()
    topology.vnets[1].appliances = [{
      id: 'original-nva', name: 'Spoke NVA', kind: 'nva-vm', subnetId: 'wan-work', privateIp: '10.1.1.5',
      asn: 65010, bgpEnabled: true, vwanBgpEnabled: true, enableIpForwarding: true, staticRoutes: [],
    }]
    topology.vpnConnections[0].targetKind = 'appliance'
    topology.vpnConnections[0].targetId = 'original-nva'
    expect(validateAzNetTopology(topology)).toEqual([])
    const simulation = simulateAzNet(topology)
    expect(simulation.controlPlaneComplete).toBe(true)
    expect(simulation.vwanHubRibs.wan).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '172.16.0.0/24', nextHopId: 'original-nva', hubTransport: 'SpokeNVA', asPath: [65010, 65001] }),
    ]))
    const forward = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'classic', subnetId: 'classic-work' }, '172.16.0.4')
    const reply = traceAzNetFlow(topology, simulation, { kind: 'site', siteId: 'branch' }, '10.0.1.4')
    expect(forward.status).toBe('delivered')
    expect(reply.status).toBe('delivered')
    expect(forward.traversedApplianceIds).toContain('original-nva')
    expect(reply.traversedApplianceIds).toContain('original-nva')
    expect(forward.traversedEdgeIds).toEqual(expect.arrayContaining(['wan-er', 'vhub-attach:spoke:wan', 'branch-vpn']))
    topology.vnets[1].appliances[0].bgpEnabled = false
    expect(simulateAzNet(topology).vwanHubRibs.wan.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    topology.vnets[1].appliances[0].asn = 4200000010
    expect(() => parseAzNetTopology(topology)).toThrow(/2-byte ASN/)
    topology.vnets[1].appliances[0].asn = 65010
    topology.vnets[1].appliances[0].kind = 'azure-firewall'
    expect(() => parseAzNetTopology(topology)).toThrow(/requires an NVA/)
  })

  it('models explicit static VPN prefixes, bypasses BGP maps, and assesses the independent static return path', () => {
    const topology = mixedTopology()
    topology.erLinks = []
    topology.vpnConnections[0].bgpEnabled = false
    topology.vpnConnections[0].staticPrefixes = ['172.16.0.0/25']
    topology.routeMaps = [{ id: 'drop', name: 'Inactive BGP policy', hubId: 'wan', rules: [rule({ action: 'drop' })] }]
    topology.vwanHubs[0].routeMapAssignments = [{ connectionId: 'branch-vpn', inboundMapId: 'drop' }]
    const simulation = simulateAzNet(topology)
    expect(simulation.vwanHubTableCoverage.wan.defaultRouteTable.complete).toBe(true)
    const source = { kind: 'subnet' as const, vnetId: 'spoke', subnetId: 'wan-work' }
    expect(traceAzNetFlow(topology, simulation, source, '172.16.0.4').status).toBe('delivered')
    expect(traceAzNetFlow(topology, simulation, source, '172.16.0.200').status).not.toBe('delivered')
    expect(traceAzNetFlow(topology, simulation, { kind: 'site', siteId: 'branch' }, '10.1.1.4').status).toBe('delivered')
  })

  it('converges site-local-preference selection without exporting that local attribute to other routers', () => {
    const topology = mixedTopology()
    topology.vpnConnections.push({ ...topology.vpnConnections[0], id: 'long-vpn', outboundPrepend: [64496, 64496] })
    topology.routeMaps = [{ id: 'preference', name: 'Prefer long path', siteId: 'branch', rules: [rule({ localPreference: 200 })] }]
    topology.sites[0].routeMapAssignments = [{ connectionId: 'long-vpn', inboundMapId: 'preference' }]
    expect(validateAzNetTopology(topology)).toEqual([])
    const simulation = simulateAzNet(topology)
    expect(simulation.controlPlaneComplete).toBe(true)
    expect(simulation.siteRibs.branch.filter((route) => route.preferred && route.prefix === '10.1.0.0/16')).toEqual([
      expect.objectContaining({ connectionId: 'long-vpn', localPreference: 200 }),
    ])
    expect(simulation.vwanHubRibs.wan.every((route) => route.localPreference === undefined)).toBe(true)
    topology.sites[0].routeMapAssignments = [{ connectionId: 'long-vpn', outboundMapId: 'preference' }]
    expect(validateAzNetTopology(topology).join(' ')).toMatch(/only on inbound/)
  })

  it('withdraws branch exports without withdrawing hub learning or VNet advertisements', () => {
    const topology = mixedTopology()
    topology.allowBranchToBranchTraffic = false
    const simulation = simulateAzNet(topology)
    expect(simulation.vwanHubRibs.wan.some((route) => route.prefix === '172.16.0.0/24' && route.preferred)).toBe(true)
    expect(simulation.gatewayRibs['er-gw'].some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
    expect(simulation.gatewayRibs['er-gw'].some((route) => route.prefix === '10.1.0.0/16' && route.preferred)).toBe(true)
    topology.vpnConnections[0].learnSiteRoutes = false
    expect(simulateAzNet(topology).vwanHubRibs.wan.some((route) => route.prefix === '172.16.0.0/24')).toBe(false)
  })

  it('exports remote hub winners over ER and retains original inter-hub/table forwarding', () => {
    const topology = mixedTopology()
    topology.vwanHubs.push({ ...topology.vwanHubs[0], id: 'remote', name: 'Remote' })
    topology.vnets.push({
      ...topology.vnets[1], id: 'remote-vnet', name: 'Remote VNet', prefixes: ['10.2.0.0/16'],
      subnets: [{ id: 'remote-work', name: 'Work', prefix: '10.2.1.0/24' }],
      vwanHubAttachment: { hubId: 'remote', enabled: true },
    })
    const simulation = simulateAzNet(topology)
    expect(simulation.controlPlaneComplete).toBe(true)
    expect(simulation.gatewayRibs['er-gw']).toEqual(expect.arrayContaining([
      expect.objectContaining({ prefix: '10.2.0.0/16', preferred: true }),
    ]))
    const forward = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'classic', subnetId: 'classic-work' }, '10.2.1.4')
    const reply = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'remote-vnet', subnetId: 'remote-work' }, '10.0.1.4')
    expect(forward.status).toBe('delivered')
    expect(reply.status).toBe('delivered')
    expect(forward.hops.filter((hop) => hop.nodeKind === 'vwan-hub').map((hop) => hop.nodeId)).toEqual(expect.arrayContaining(['wan', 'remote']))
    expect(forward.hops.filter((hop) => hop.hubTableId).every((hop) => hop.hubTableId === 'defaultRouteTable')).toBe(true)
  })

  it('advertises an Internet-intent default only on opt-in connections and respects outbound policy', () => {
    const topology = mixedTopology()
    topology.vwanHubs[0].routingIntent.internet = true
    topology.vpnConnections[0].propagateDefaultRoute = true
    topology.vnets[1].vwanHubAttachment!.propagateDefaultRoute = true
    let simulation = simulateAzNet(topology)
    expect(simulation.siteRibs.branch.some((route) => route.prefix === '0.0.0.0/0' && route.preferred)).toBe(true)
    expect(simulation.gatewayRibs['er-gw'].some((route) => route.prefix === '0.0.0.0/0')).toBe(false)
    topology.routeMaps = [{ id: 'default-filter', name: 'Filter default', hubId: 'wan', rules: [rule({ prefixes: ['0.0.0.0/0'], action: 'drop' })] }]
    topology.vwanHubs[0].routeMapAssignments = [{ connectionId: 'spoke', outboundMapId: 'default-filter' }]
    simulation = simulateAzNet(topology)
    expect(simulation.subnetTables['wan-work'].routes.some((route) => route.source === 'VirtualNetworkGateway' && route.prefix === '0.0.0.0/0')).toBe(false)
    topology.vpnConnections[0].propagateDefaultRoute = false
    expect(simulateAzNet(topology).siteRibs.branch.some((route) => route.prefix === '0.0.0.0/0')).toBe(false)
  })
})
