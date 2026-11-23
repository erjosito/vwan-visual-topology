import { expect, it } from 'vitest'
import { indirectFirewallTopology } from './indirect-firewall-sample'
import { parseAzNetTopology } from './admission'
import { simulateAzNet, traceAzNetFlow } from './engine'
import { applyAzRoutingIntentEdit } from './routing-intent'

const direct = { kind: 'subnet', vnetId: 'direct', subnetId: 'direct-work' } as const
const indirect = { kind: 'subnet', vnetId: 'indirect', subnetId: 'indirect-work' } as const

it('routes both directions over the original VNet connection, spoke Firewall and peering without attaching the indirect spoke', () => {
  const topology = parseAzNetTopology(indirectFirewallTopology())
  const result = simulateAzNet(topology)
  expect(result.vwanHubTableCoverage.wan.defaultRouteTable.complete).toBe(true)
  expect(result.vwanHubRibs.wan).toContainEqual(expect.objectContaining({
    prefix: '10.2.0.0/16', nextHopId: 'fw', nextHopIp: '10.0.0.4', originProtocol: 'Static', preferred: true,
  }))
  for (const flow of [traceAzNetFlow(topology, result, direct, '10.2.1.4'), traceAzNetFlow(topology, result, indirect, '10.1.1.4')]) {
    expect(flow.status, flow.summaryReason).toBe('delivered')
    expect(flow.traversedApplianceIds).toContain('fw')
    expect(flow.traversedEdgeIds).toEqual(expect.arrayContaining(['vhub-attach:security:wan', 'indirect-peering']))
  }
  expect(topology.vnets[2].vwanHubAttachment).toBeUndefined()
  expect(JSON.parse(JSON.stringify(topology))).toEqual(topology)
})

it.each([[false, true], [true, false], [true, true]])('retains supported propagated connection statics with intent private=%s internet=%s', (privatePolicy, internet) => {
  const before = indirectFirewallTopology()
  const topology = structuredClone(before)
  Object.assign(topology.vwanHubs[0].routingIntent, { private: privatePolicy, internet })
  applyAzRoutingIntentEdit(before, topology)
  const result = simulateAzNet(topology)
  expect(result.vwanHubTableCoverage.wan.defaultRouteTable.complete).toBe(true)
  expect(result.vwanHubRibs.wan).toContainEqual(expect.objectContaining({
    prefix: '10.2.0.0/16', nextHopId: 'fw', originProtocol: 'Static', preferred: true,
  }))
  for (const flow of [traceAzNetFlow(topology, result, direct, '10.2.1.4'), traceAzNetFlow(topology, result, indirect, '10.1.1.4')]) {
    expect(flow.status, flow.summaryReason).toBe('delivered')
    expect(flow.traversedApplianceIds).toContain('fw')
    expect(flow.traversedEdgeIds).toContain('indirect-peering')
  }
})

it('does not make the peering transitive or a one-way route into bidirectional connectivity', () => {
  const topology = indirectFirewallTopology()
  topology.udrTables[0].routes = []
  let result = simulateAzNet(topology)
  expect(traceAzNetFlow(topology, result, direct, '10.2.1.4').status).toBe('delivered')
  expect(traceAzNetFlow(topology, result, indirect, '10.1.1.4').status).not.toBe('delivered')
  topology.vnetPeerings[0].enabled = false
  result = simulateAzNet(topology)
  expect(traceAzNetFlow(topology, result, direct, '10.2.1.4').status).not.toBe('delivered')
  topology.vnetPeerings[0].enabled = true
  topology.vnetPeerings[0].bToA.allowForwardedTraffic = false
  result = simulateAzNet(topology)
  expect(traceAzNetFlow(topology, result, direct, '10.2.1.4').status).not.toBe('delivered')
})

it('withdraws disabled connection routes and respects None propagation', () => {
  const topology = indirectFirewallTopology()
  topology.vnets[0].vwanHubAttachment!.enabled = false
  let result = simulateAzNet(topology)
  expect(result.vwanHubRibs.wan.some((route) => route.prefix === '10.2.0.0/16')).toBe(false)
  topology.vnets[0].vwanHubAttachment!.enabled = true
  topology.vnets[0].vwanHubAttachment!.hubRouting = {
    status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['noneRouteTable'], labels: [],
  }
  result = simulateAzNet(topology)
  expect(result.vwanHubRibs.wan.some((route) => route.prefix === '10.2.0.0/16')).toBe(false)
})

it('propagates original connection static routes across hubs without fabricating a direct attachment', () => {
  const topology = indirectFirewallTopology()
  topology.vwanHubs.push({ ...structuredClone(topology.vwanHubs[0]), id: 'remote', name: 'Remote hub', region: 'northeurope' })
  topology.vnets[1].vwanHubAttachment!.hubId = 'remote'
  const result = simulateAzNet(topology)
  expect(result.vwanHubRibs.remote).toContainEqual(expect.objectContaining({
    prefix: '10.2.0.0/16', nextHopKind: 'vwan-hub', nextHopId: 'wan', originHubTableId: 'defaultRouteTable', preferred: true,
  }))
  for (const flow of [traceAzNetFlow(topology, result, direct, '10.2.1.4'), traceAzNetFlow(topology, result, indirect, '10.1.1.4')]) {
    expect(flow.status, flow.summaryReason).toBe('delivered')
    expect(flow.traversedApplianceIds).toContain('fw')
  }
})

it('does not bypass disabled Firewall forwarding or accept conflicting static next hops', () => {
  const topology = indirectFirewallTopology()
  topology.vnets[0].appliances[0].enableIpForwarding = false
  let result = simulateAzNet(topology)
  expect(traceAzNetFlow(topology, result, direct, '10.2.1.4').status).not.toBe('delivered')
  topology.vnets[0].appliances.push({ ...structuredClone(topology.vnets[0].appliances[0]), id: 'second', privateIp: '10.0.0.5' })
  topology.vnets[0].vwanHubAttachment!.staticRoutes!.push({ name: 'Conflicting route', addressPrefixes: ['10.2.0.0/16'], nextHopIpAddress: '10.0.0.5' })
  result = simulateAzNet(topology)
  expect(traceAzNetFlow(topology, result, direct, '10.2.1.4').status).toBe('not-assessed')
})

it('advertises the static indirect prefix to a VPN branch without inventing Firewall BGP sessions', () => {
  const topology = indirectFirewallTopology()
  topology.sites.push({ id: 'branch', name: 'Branch', asn: 65001, prefixes: ['172.16.0.0/24'] })
  topology.vpnConnections.push({
    id: 'vpn', name: 'Branch VPN', siteId: 'branch', targetKind: 'vwan-hub', targetId: 'wan', enabled: true, bgpEnabled: true,
  })
  topology.udrTables[0].routes.push({ ...topology.udrTables[0].routes[0], id: 'branch-return', prefix: '172.16.0.0/24' })
  const result = simulateAzNet(topology)
  expect(result.siteRibs.branch).toContainEqual(expect.objectContaining({ prefix: '10.2.0.0/16', preferred: true }))
  const forward = traceAzNetFlow(topology, result, { kind: 'site', siteId: 'branch' }, '10.2.1.4')
  const reverse = traceAzNetFlow(topology, result, indirect, '172.16.0.4')
  for (const flow of [forward, reverse]) {
    expect(flow.status, flow.summaryReason).toBe('delivered')
    expect(flow.traversedApplianceIds).toContain('fw')
  }
  expect(topology.vnets[0].appliances[0].bgpEnabled).toBeUndefined()
})

it('validates newly recognized route shapes and bounds rather than merely retaining them', () => {
  const topology = indirectFirewallTopology()
  const route = topology.vnets[0].vwanHubAttachment!.staticRoutes![0]
  topology.vnets[0].vwanHubAttachment!.staticRoutes!.push(structuredClone(route))
  expect(() => parseAzNetTopology(topology)).toThrow('duplicate VNet connection static route name')
  topology.vnets[0].vwanHubAttachment!.staticRoutes = Array.from({ length: 65 }, (_, index) => ({ ...route, name: String(index) }))
  expect(() => parseAzNetTopology(topology)).toThrow('exceed 64 routes or 256 prefixes')
  expect(() => parseAzNetTopology({
    ...indirectFirewallTopology(), vnets: [{ ...indirectFirewallTopology().vnets[0],
      vwanHubAttachment: { hubId: 'wan', enabled: true, staticRoutes: 'not-an-array' } }],
  })).toThrow('must be an array')
})

it('keeps unsupported or unknown static-next-hop configurations explicitly unassessed', () => {
  for (const variant of ['unknown-hop', 'overlap', 'default', 'not-propagated'] as const) {
    const topology = indirectFirewallTopology()
    const attachment = topology.vnets[0].vwanHubAttachment!
    if (variant === 'unknown-hop') attachment.staticRoutes![0].nextHopIpAddress = '10.0.0.99'
    if (variant === 'overlap') attachment.staticRoutes![0].addressPrefixes = ['10.0.0.0/8']
    if (variant === 'default') attachment.staticRoutes![0].addressPrefixes = ['0.0.0.0/0']
    if (variant === 'not-propagated') attachment.propagateStaticRoutes = false
    const result = simulateAzNet(topology)
    expect(result.vwanHubTableCoverage.wan.defaultRouteTable.complete, variant).toBe(false)
    expect(traceAzNetFlow(topology, result, direct, '10.2.1.4').status, variant).toBe('not-assessed')
  }
})
