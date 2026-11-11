import { describe, expect, it } from 'vitest'
import type { Topology } from './model'
import { createEmptyAzNetTopology, sampleHubSpokeFirewallUdr } from './azure-net/model'
import { simulate } from './routing'
import { traceNodePath } from './paths'
import { simulateAzNet, traceAzNetPair } from './azure-net/engine'
import { analyzeAzResilience, analyzeVwanResilience } from './failure-analysis'
import { projectAzFailures, projectVwanFailures, regionKey, type FailureDomain } from './failures'
import { validateTopology } from './validation'

export function vwanFailureFixture(): Topology {
  return {
    version: 1, name: 'Failure domains',
    hubs: [
      { id: 'west', name: 'West hub', region: 'West Europe', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } },
      { id: 'east', name: 'East hub', region: 'East US', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } },
    ],
    spokes: [{ id: 'work', name: 'Workload', region: 'East US', hubId: 'east', prefixes: ['10.1.0.0/24'] }],
    sites: [
      { id: 'a', name: 'A', asn: 65001, prefixes: ['172.16.0.0/24'] },
      { id: 't', name: 'Transit', asn: 65002, prefixes: [] },
      { id: 'b', name: 'B', asn: 65003, prefixes: ['172.17.0.0/24'] },
    ],
    connections: [{ id: 'b-vpn', name: 'B VPN', hubId: 'east', siteId: 'b', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] }],
    siteLinks: [{ id: 'a-t', name: 'A transit', a: 'a', b: 't', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }],
    erLocations: [{ id: 'loc', name: 'Amsterdam', sku: 'Premium' }],
    erLinks: [
      { id: 'er-hub', name: 'Hub circuit', locationId: 'loc', hubId: 'west', enabled: true, learnSiteRoutes: false },
      { id: 'er-transit', name: 'Transit circuit', locationId: 'loc', siteId: 't', enabled: true, learnSiteRoutes: true },
    ],
  }
}

export function azFailureFixture(full = false) {
  const t = createEmptyAzNetTopology()
  t.name = 'Failure domains'
  t.vnets = [
    { id: 'west', name: 'West VNet', region: 'West Europe', role: 'hub', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'gateway-subnet', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
      gateways: [{ id: 'gw', name: 'ER gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true }], appliances: [] },
    { id: 'work', name: 'Workload', region: 'East US', role: 'spoke', prefixes: ['10.1.0.0/16'],
      subnets: [{ id: 'work-subnet', name: 'Workload', prefix: '10.1.1.0/24' }], gateways: [], appliances: [] },
  ]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  t.vnetPeerings = [{ id: 'peer', name: 'Global peering', enabled: true, vnetAId: 'west', vnetBId: 'work',
    aToB: { ...flags, allowGatewayTransit: true }, bToA: { ...flags, useRemoteGateways: true } }]
  t.sites = vwanFailureFixture().sites
  t.siteLinks = [{ id: 'a-t', name: 'A transit', siteAId: 'a', siteBId: 't', enabled: true }]
  t.erLocations = [{ id: 'loc', name: 'Amsterdam', sku: 'Premium', globalReachEnabled: true }]
  t.erLinks = [
    { id: 'er-hub', name: 'Hub circuit', locationId: 'loc', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true },
    { id: 'er-transit', name: 'Transit circuit', locationId: 'loc', targetKind: 'site', targetId: 't', enabled: true },
    { id: 'er-b', name: 'B circuit', locationId: 'loc', targetKind: 'site', targetId: 'b', enabled: true },
  ]
  if (full) {
    t.vwanHubs = [{ id: 'vhub', name: 'West Virtual Hub', region: 'westeurope', preference: 'ExpressRoute', routingIntent: { private: false, internet: false } }]
    t.vnets[1].vwanHubAttachment = { hubId: 'vhub', enabled: true }
    t.erLinks[0] = { ...t.erLinks[0], targetKind: 'vwan-hub', targetId: 'vhub' }
    t.vnetPeerings = []
  }
  return t
}

const faults: FailureDomain[] = [
  { kind: 'region', id: 'westeurope', name: 'West Europe' },
  { kind: 'er-location', id: 'loc', name: 'Amsterdam' },
  { kind: 'site', id: 't', name: 'Transit' },
]

describe('reversible offline failure overlays', () => {
  it('withdraws each VWAN transit domain, selects a surviving alternate, and preserves baseline/administrative flags', () => {
    const t = vwanFailureFixture(), original = JSON.stringify(t)
    const trace = (active: Topology) => traceNodePath(active, simulate(active), { kind: 'site', id: 'a' }, '10.1.0.1')
    expect(trace(t).every((p) => p.status === 'delivered')).toBe(true)
    for (const fault of faults) {
      const failed = projectVwanFailures(t, [fault])
      expect(trace(failed.active).every((p) => p.status === 'unreachable')).toBe(true)
      expect(failed.active.spokes.some((v) => v.id === 'work')).toBe(true)
    }
    t.connections.push({ ...t.connections[0], id: 'backup', siteId: 'a' })
    for (const fault of faults) expect(trace(projectVwanFailures(t, [fault]).active).every((p) => p.status === 'delivered')).toBe(true)
    t.connections.pop()
    expect(JSON.stringify(t)).toBe(original)
    expect(simulate(projectVwanFailures(t).active)).toEqual(simulate(t))
  })

  for (const full of [false, true]) it(`withdraws Azure region, ER and transit site and independently recomputes return (${full ? 'full' : 'hub-spoke'})`, () => {
    const t = azFailureFixture(full), original = JSON.stringify(t)
    const trace = (active: typeof t) => traceAzNetPair(active, simulateAzNet(active), { kind: 'site', siteId: 'a' }, '172.16.0.1',
      { kind: 'subnet', vnetId: 'work', subnetId: 'work-subnet' }, '10.1.1.1')
    expect(trace(t).forward.status).toBe('delivered')
    expect(trace(t).reverse.status).toBe('delivered')
    for (const fault of faults) {
      const failed = projectAzFailures(t, [fault])
      expect(trace(failed.active).forward.status).not.toBe('delivered')
      expect(trace(failed.active).reverse.status).not.toBe('delivered')
      if (fault.kind === 'region') {
        expect(failed.affected.gw).toEqual([fault])
        expect(failed.active.erLocations).toHaveLength(1)
        expect(failed.active.vnets.map((v) => v.id)).toEqual(['work'])
      }
    }
    expect(JSON.stringify(t)).toBe(original)
    expect(simulateAzNet(projectAzFailures(t).active)).toEqual(simulateAzNet(t))
  })

  it('never infers VNet region from attachment or an ER location; canonicalizes explicit region metadata and preserves it on validation', () => {
    const t = vwanFailureFixture()
    delete t.spokes[0].region
    const p = projectVwanFailures(t, [{ kind: 'region', id: 'eastus', name: 'East US' }])
    expect(p.unassessed).toContain('work: missing or unrecognized Azure region; regional availability unassessed.')
    expect(p.affected.work).toBeUndefined()
    t.spokes[0].region = 'eastus'
    expect(validateTopology(t).spokes[0].region).toBe('eastus')
    expect(regionKey(' WEST Europe ')).toBe(regionKey('westeurope'))
    expect(regionKey('ambiguous-region')).toBeUndefined()
    const invalid = azFailureFixture()
    invalid.vnets[0].region = 123 as unknown as string
    expect(projectAzFailures(invalid).unassessed).toHaveLength(1)
    expect(analyzeAzResilience(invalid).complete).toBe(false)
  })

  it('removes all regional Azure children, attachments and Global Reach at a failed location without conflating the domains', () => {
    const t = azFailureFixture(true)
    t.vnets[0].routeServer = { id: 'ars', name: 'ARS', enabled: true, branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: [] }
    t.vnets[0].appliances = [{ id: 'fw', name: 'FW', kind: 'azure-firewall', subnetId: 'gateway-subnet', privateIp: '10.0.255.4', enableIpForwarding: true, staticRoutes: [] }]
    t.erLocations.push({ id: 'other', name: 'London' })
    t.erGlobalReachLinks = [{ id: 'gr', name: 'GR', locationAId: 'loc', locationBId: 'other', enabled: true }]
    const region = projectAzFailures(t, [faults[0]])
    expect(['west', 'ars', 'gw', 'fw', 'vhub', 'gateway-subnet'].every((id) => region.affected[id])).toBe(true)
    expect(region.active.vnets[0].vwanHubAttachment).toBeUndefined()
    expect(region.active.erGlobalReachLinks).toHaveLength(1)
    const location = projectAzFailures(t, [faults[1]])
    expect(location.active.erGlobalReachLinks).toEqual([])
    expect(location.active.vnets).toHaveLength(2)
    expect(location.active.vwanHubs).toHaveLength(1)
  })

  it('keeps overlapping fault causes separate and withdraws a regional spoke NVA without inventing an individual VNet fault', () => {
    const t = vwanFailureFixture()
    t.spokes.push({ id: 'nva-vnet', name: 'NVA host', region: 'West Europe', hubId: 'west', prefixes: ['10.0.0.0/24'] })
    t.sites.push({ id: 'nva', name: 'NVA', asn: 65020, prefixes: [], role: 'spoke-nva' })
    t.connections.push({ ...t.connections[0], id: 'nva-peer', hubId: 'west', siteId: 'nva', transport: 'SpokeNVA', spokeId: 'nva-vnet', peerIp: '10.0.0.4' })
    const failed = projectVwanFailures(t, faults)
    expect(failed.affected.nva).toEqual([faults[0]])
    expect(failed.affected['er-transit'].map((f) => f.kind).sort()).toEqual(['er-location', 'site'])
    expect(failed.domains.some((d) => d.kind === 'site' && d.id === 'nva')).toBe(false)
    const restoredRegionOnly = projectVwanFailures(t, faults.slice(1))
    expect(restoredRegionOnly.affected.nva).toBeUndefined()
    expect(restoredRegionOnly.affected['er-transit']).toHaveLength(2)
    expect(t.connections.every((c) => c.enabled)).toBe(true)
  })
})

describe('actual N-1 domain routing rather than degree heuristics', () => {
  it('names site/ER/region transit gaps only for baseline-working surviving endpoints, and verifies a real independent alternate', () => {
    const t = vwanFailureFixture()
    const report = analyzeVwanResilience(t)
    expect(report.baselineFaults).toBe(0)
    expect(report.complete).toBe(true)
    expect(faults.every((fault) => report.gaps.some((gap) => gap.fault.kind === fault.kind && gap.fault.id === fault.id))).toBe(true)
    expect(report.gaps.some((g) => g.fault.kind === 'site' && ['a', 'b'].includes(g.fault.id))).toBe(false)
    expect(report.endpointUnavailable).toBeGreaterThan(0)
    t.connections.push({ ...t.connections[0], id: 'backup', siteId: 'a' })
    expect(analyzeVwanResilience(t).gaps.filter((g) => faults.some((f) => f.kind === g.fault.kind && f.id === g.fault.id))).toEqual([])
  })

  for (const full of [false, true]) it(`separates shared-domain circuits, baseline faults and surviving-site alternate (${full ? 'full' : 'hub-spoke'})`, () => {
    const t = azFailureFixture(full)
    t.erLinks.push({ ...t.erLinks[1], id: 'apparent-backup' })
    const report = analyzeAzResilience(t)
    expect(report.baselineWorking).toBe(3)
    expect(faults.every((fault) => report.gaps.some((g) => g.fault.kind === fault.kind && g.fault.id === fault.id))).toBe(true)
    expect(report.gaps.some((g) => g.fault.kind === 'site' && ['a', 'b'].includes(g.fault.id))).toBe(false)
    t.siteLinks.push({ id: 'independent', name: 'Independent WAN', siteAId: 'a', siteBId: 'b', enabled: true })
    for (const fault of faults) {
      const active = projectAzFailures(t, [fault]).active
      const alternate = traceAzNetPair(active, simulateAzNet(active), { kind: 'site', siteId: 'a' }, '172.16.0.1', { kind: 'site', siteId: 'b' }, '172.17.0.1')
      expect(alternate.forward.status).toBe('delivered')
      expect(alternate.reverse.status).toBe('delivered')
    }
    expect(analyzeAzResilience(t).gaps.filter((g) => g.endpointIds.includes('a') && g.endpointIds.includes('b'))).toEqual([])
    t.erLinks = []
    const broken = analyzeAzResilience(t)
    expect(broken.baselineFaults).toBeGreaterThan(0)
    expect(broken.gaps.every((g) => g.endpointIds.includes('a') && g.endpointIds.includes('b'))).toBe(true)
  })

  it('honors declared intent/exclusions and does not declare resilience for empty, ambiguous or truncated scope', () => {
    const t = vwanFailureFixture()
    const deny = { id: 'isolation', source: { kind: 'site' as const, id: 'a' }, target: { kind: 'spoke' as const, id: 'work' },
      sourcePrefix: '172.16.0.0/24', destinationPrefix: '10.1.0.0/24', expectation: 'deny' as const }
    expect(analyzeVwanResilience(t, [deny]).totalPairs).toBe(0)
    expect(analyzeVwanResilience(t, [deny]).complete).toBe(false)
    expect(analyzeVwanResilience(t, [], { maxCases: 1 }).complete).toBe(false)
    expect(analyzeAzResilience(azFailureFixture(), { maxPairs: 1 }).complete).toBe(false)
    delete t.spokes[0].region
    expect(analyzeVwanResilience(t).complete).toBe(false)
    expect(analyzeVwanResilience(t).gaps.some((gap) => gap.fault.kind === 'region')).toBe(false)
    t.sites.push({ id: 'ambiguous', name: 'Duplicate ownership', asn: 65020, prefixes: ['172.16.0.0/24'] })
    expect(analyzeVwanResilience(t).baselineUnknown).toBeGreaterThan(0)
  })

  it('detects return-only backup failure rather than counting a forward route as protection', () => {
    const t = vwanFailureFixture()
    t.connections.push({ ...t.connections[0], id: 'backup', siteId: 'a', learnSiteRoutes: false })
    const report = analyzeVwanResilience(t)
    const gap = report.gaps.find((g) => g.fault.kind === 'er-location' && g.endpointIds.includes('a') && g.endpointIds.includes('work'))
    expect(gap?.failed.forward.join(' ')).toContain('unreachable')
    expect(gap?.failed.reverse.join(' ')).toContain('delivered')
  })

  it('keeps baseline stateful-inspection asymmetry separate from hypothetical resilience gaps', () => {
    const t = structuredClone(sampleHubSpokeFirewallUdr)
    const report = analyzeAzResilience(t)
    expect(report.baselineFaults).toBeGreaterThan(0)
    expect(report.gaps.every((gap) => gap.baseline.working && gap.baseline.assessed)).toBe(true)
    expect(report.limitations.join(' ')).toContain('stateful')
  })
})
