import { createEmptyAzNetTopology, type AzNetTopology, type AzVNet, type AzVnetPeering } from '../azure-net/model'
import type { Requirement, FlowRequirement } from '../platform/contract'
import { haLessonPacket, haLessonTopology } from './ha-scenario'

export const curriculumV2Packet = haLessonPacket
export const curriculumV2LessonIds = [
  'v2-peering', 'v2-firewall', 'v2-wan', 'v2-secured-wan', 'v2-static-vpn', 'v2-bgp',
  'v2-expressroute', 'v2-er-locations', 'v2-vpn-backup', 'v2-nva-ha', 'v2-segmentation', 'v2-handover',
] as const
export type CurriculumV2LessonId = typeof curriculumV2LessonIds[number]
const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
const peer = (a: string, b: string): AzVnetPeering => ({
  id: `peer-${a}-${b}`, name: `${a} — ${b}`, vnetAId: a, vnetBId: b, enabled: true,
  scope: { type: 'whole-vnet' }, aToB: { ...flags }, bToA: { ...flags },
})
const net = (id: string, name: string, octet: number): AzVNet => ({
  id, name, region: 'swedencentral', role: 'spoke', prefixes: [`10.${octet}.0.0/16`],
  subnets: [{ id: `${id}-work`, name: 'Workload', prefix: `10.${octet}.1.0/24` }], gateways: [], appliances: [],
})
const udr = (id: string, prefix: string, nextHopIp: string, enabled = false) => ({
  id, name: id, prefix, nextHopType: 'VirtualAppliance' as const, nextHopIp, enabled,
})
function base() {
  const t = createEmptyAzNetTopology()
  t.vnets = [net('app', 'Application', 21), net('partner', 'Partner', 22), net('tenant', 'Restricted tenant', 23)]
  t.vnets[0].subnets.push({ id: 'app-ops', name: 'Operations', prefix: '10.21.2.0/24' })
  return t
}
const attachment = (hubId: string, enabled: boolean, table = 'defaultRouteTable', propagated = [table], labels: string[] = []) => ({
  hubId, enabled, hubRouting: { status: 'configured' as const, associatedTableId: table, propagatedTableIds: propagated, labels },
})
function firewall() {
  const t = base(), hub = net('hub', 'Customer-owned inspection hub', 20)
  hub.role = 'hub'
  hub.subnets = [{ id: 'firewall-subnet', name: 'AzureFirewallSubnet', prefix: '10.20.1.0/26' }]
  hub.appliances = [{ id: 'azure-firewall', name: 'Azure Firewall', kind: 'azure-firewall', subnetId: 'firewall-subnet',
    privateIp: '10.20.1.4', enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [] }]
  t.vnets.push(hub)
  t.vnetPeerings = [peer('app', 'partner'), peer('partner', 'hub')]
  for (const [id, prefix] of [['app', '10.22.0.0/16'], ['partner', '10.21.0.0/16']]) {
    t.vnets.find((v) => v.id === id)!.subnets[0].routeTableId = `${id}-policy`
    t.udrTables.push({ id: `${id}-policy`, name: `${id} inspection policy`, disableBgpRoutePropagation: false,
      routes: id === 'app' ? [udr('private-summary', '10.0.0.0/8', '10.20.1.4'), udr('partner-inspection', prefix, '10.20.1.4')]
        : [udr('application-return', prefix, '10.20.1.4')] })
  }
  return t
}
function wan(secured = false) {
  const t = base()
  t.vnets.push(net('shared', 'Local shared service', 24))
  t.vwanHubs = [{ id: 'wan-hub', name: 'Managed regional virtual hub', region: 'swedencentral', preference: 'ExpressRoute',
    routingIntent: { private: false, internet: false }, ...(secured ? { firewall: { id: 'hub-firewall', name: 'Hub Azure Firewall' } } : {}) }]
  for (const v of t.vnets.filter((v) => v.id !== 'tenant')) v.vwanHubAttachment = attachment('wan-hub', v.id === 'partner' || (secured && v.id === 'app'))
  return t
}
function hybrid(kind: 'static' | 'bgp' | 'er' | 'locations' | 'backup') {
  const t = base(), hub = net('hybrid-hub', 'Classic hybrid gateway hub', 20)
  hub.role = 'hub'
  hub.subnets = [{ id: 'gateway-subnet', name: 'GatewaySubnet', prefix: '10.20.255.0/27' }]
  const vpn = { id: 'vpn-gateway', name: 'Warehouse VPN gateway', kind: 'Vpn' as const, asn: 65515, bgpEnabled: true,
    enabled: true, sku: 'VpnGw2', vpnType: 'RouteBased' as const, vpnGatewayGeneration: 'Generation2' as const, activeActive: false }
  const er = { id: 'er-gateway', name: 'ExpressRoute gateway', kind: 'ExpressRoute' as const, asn: 65515, bgpEnabled: true, enabled: true, sku: 'Standard' }
  hub.gateways = kind === 'static' || kind === 'bgp' ? [vpn] : kind === 'backup' ? [er, vpn] : [er]
  t.vnets.push(hub)
  const sharing = peer('hybrid-hub', 'app')
  sharing.aToB.allowGatewayTransit = true
  sharing.bToA.useRemoteGateways = kind !== 'static'
  t.vnetPeerings = [sharing, peer('app', 'partner')]
  t.sites = [{ id: 'warehouse', name: 'Warehouse edge', asn: 65022,
    prefixes: kind === 'bgp' ? ['172.22.0.0/24', '172.22.1.0/24'] : ['172.22.0.0/24'] }]
  if (kind === 'static' || kind === 'bgp' || kind === 'backup') t.vpnConnections = [{
    id: 'warehouse-vpn', name: 'Warehouse site-to-site VPN', siteId: 'warehouse', targetKind: 'vnet-gateway', targetId: 'vpn-gateway',
    enabled: kind === 'bgp', bgpEnabled: kind === 'backup', staticPrefixes: kind === 'static' ? ['172.22.99.0/24'] : ['172.22.0.0/24'],
  }]
  if (kind === 'bgp') {
    t.vnets[0].subnets[0].routeTableId = 'workload-routes'
    t.udrTables = [{ id: 'workload-routes', name: 'Application route publication', disableBgpRoutePropagation: true, routes: [] }]
  }
  if (['er', 'locations', 'backup'].includes(kind)) {
    t.erLocations = [{ id: 'location-a', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
    t.erLinks = [
      { id: 'warehouse-er-a', name: 'Warehouse private peering A (aggregate)', locationId: 'location-a', targetKind: 'site', targetId: 'warehouse', enabled: kind !== 'er' },
      { id: 'azure-er-a', name: 'Azure gateway attachment A', locationId: 'location-a', targetKind: 'vnet-gateway', targetId: 'er-gateway', enabled: kind !== 'er' },
    ]
    if (kind === 'locations') {
      t.erLocations.push({ id: 'location-b', name: 'London', peeringLocation: 'London', sku: 'Standard' })
      t.erLinks.push(
        { id: 'warehouse-er-b', name: 'Warehouse private peering B (aggregate)', locationId: 'location-b', targetKind: 'site', targetId: 'warehouse', enabled: false },
        { id: 'azure-er-b', name: 'Azure gateway attachment B', locationId: 'location-b', targetKind: 'vnet-gateway', targetId: 'er-gateway', enabled: true },
      )
    }
  }
  return t
}
function ha() {
  const t = haLessonTopology()
  t.vnets.find((v) => v.id === 'remote')!.name = 'Partner'
  t.vnets.push(net('tenant', 'Restricted tenant', 83))
  const hub = t.vnets.find((v) => v.id === 'hub')!
  hub.subnets.push({ id: 'gateway-subnet', name: 'GatewaySubnet', prefix: '10.80.255.0/27' })
  hub.gateways.push({ id: 'er-gateway', name: 'Existing ER gateway', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true })
  t.sites = [{ id: 'warehouse', name: 'Warehouse context', asn: 65022, prefixes: ['172.22.0.0/24'] }]
  t.erLocations = [{ id: 'location-a', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
  t.erLinks = [
    { id: 'warehouse-er-a', name: 'Warehouse ER context', locationId: 'location-a', targetKind: 'site', targetId: 'warehouse', enabled: true },
    { id: 'azure-er-a', name: 'Azure ER context', locationId: 'location-a', targetKind: 'vnet-gateway', targetId: 'er-gateway', enabled: true },
  ]
  return t
}
function segmented(capstone = false) {
  const t = createEmptyAzNetTopology(), offset = capstone ? 40 : 0
  t.vwanHubs = [
    { id: 'west-hub', name: 'West managed hub', region: 'swedencentral', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false }, routeTables: [
        { id: 'workloads', name: 'Workloads', labels: [capstone ? 'shared' : 'workloads-local'] },
        { id: 'local-services', name: 'Local services', labels: [] },
        { id: 'tenant-only', name: 'Restricted tenant', labels: ['tenant'] },
      ] },
    { id: 'east-hub', name: 'East managed hub', region: 'westeurope', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false }, routeTables: [{ id: 'regional-services', name: 'Regional services', labels: ['shared'] }] },
  ]
  t.vnets = [net('west-app', capstone ? 'New checkout API' : 'Application', 101 + offset),
    net('west-local', capstone ? 'New inventory API' : 'Local shared service', 102 + offset),
    net('east-service', capstone ? 'New order service' : 'Regional shared service', 103 + offset),
    net('west-ops', 'Operations', 104 + offset), net('west-tenant', 'Restricted tenant', 105 + offset)]
  t.vnets[0].vwanHubAttachment = attachment('west-hub', true, 'workloads',
    capstone ? ['workloads', 'local-services', 'defaultRouteTable'] : ['workloads', 'local-services'], capstone ? [] : ['shared'])
  t.vnets[1].vwanHubAttachment = attachment('west-hub', true, 'local-services', capstone ? ['local-services', 'workloads'] : ['local-services'])
  t.vnets[2].region = 'westeurope'
  t.vnets[2].vwanHubAttachment = attachment('east-hub', true, 'regional-services', ['regional-services'], capstone ? [] : ['shared'])
  t.vnets[3].vwanHubAttachment = attachment('west-hub', true, 'workloads', ['workloads'])
  t.vnets[4].vwanHubAttachment = attachment('west-hub', true, 'tenant-only', ['tenant-only'], ['tenant'])
  // Previously taught ER is context, not a third capstone fault or a new technology.
  if (capstone) {
    t.sites = [{ id: 'warehouse', name: 'New warehouse', asn: 65022, prefixes: ['172.26.0.0/24'] }]
    t.erLocations = [{ id: 'location-a', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
    t.erLinks = [
      { id: 'warehouse-er-a', name: 'Working warehouse private peering', locationId: 'location-a', targetKind: 'site', targetId: 'warehouse', enabled: true },
      { id: 'azure-er-a', name: 'Working west hub attachment', locationId: 'location-a', targetKind: 'vwan-hub', targetId: 'west-hub', enabled: true,
        hubRouting: { status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['workloads'], labels: [] } },
    ]
  }
  return t
}
export const curriculumV2Topologies: Record<CurriculumV2LessonId, AzNetTopology> = {
  'v2-peering': base(), 'v2-firewall': firewall(), 'v2-wan': wan(), 'v2-secured-wan': wan(true),
  'v2-static-vpn': hybrid('static'), 'v2-bgp': hybrid('bgp'), 'v2-expressroute': hybrid('er'),
  'v2-er-locations': hybrid('locations'), 'v2-vpn-backup': hybrid('backup'), 'v2-nva-ha': ha(),
  'v2-segmentation': segmented(), 'v2-handover': segmented(true),
}
for (const [id, t] of Object.entries(curriculumV2Topologies)) t.name = `Retailer comparison — ${id}`

const subnet = (vnetId: string, subnetId = `${vnetId}-work`) => ({ kind: 'subnet' as const, vnetId, subnetId })
function flow(id: string, source: FlowRequirement['source'], target: FlowRequirement['target'], sourceAddress: string, destinationAddress: string,
  expectation: 'allow' | 'deny' = 'allow', extra: Partial<FlowRequirement> = {}): FlowRequirement {
  return { id, kind: 'flow', source, target, sourceAddress, destinationAddress, expectation, ...extra }
}
const basic = (extra: Partial<FlowRequirement> = {}): Requirement[] => [
  flow('original-application-partner', subnet('app'), subnet('partner'), '10.21.1.10', '10.22.1.10', 'allow', extra),
  flow('operations', subnet('app'), subnet('app', 'app-ops'), '10.21.1.10', '10.21.2.10'),
  flow('application-to-tenant', subnet('app'), subnet('tenant'), '10.21.1.10', '10.23.1.10', 'deny'),
  flow('tenant-to-application', subnet('tenant'), subnet('app'), '10.23.1.10', '10.21.1.10', 'deny'),
]
const warehouse = (additional = false): Requirement[] => [
  ...basic(),
  flow('original-application-warehouse', subnet('app'), { kind: 'site', siteId: 'warehouse' }, '10.21.1.10', '172.22.0.10'),
  ...(additional ? [flow('new-warehouse-service', subnet('app'), { kind: 'site', siteId: 'warehouse' }, '10.21.1.10', '172.22.1.10')] : []),
]
export function curriculumV2HaRequirements(backend: 'primary' | 'standby'): Requirement[] {
  const octet = backend === 'primary' ? 1 : 2
  return [
    { id: 'original-ha-packet', kind: 'packet', packet: curriculumV2Packet, sourceAddress: '10.81.1.10', destinationAddress: '10.82.1.10',
      expectation: 'configured', requiredBackend: { workloadId: `${backend}-vm`, nicId: `${backend}-nic`, ipConfigurationId: `${backend}-ip`, address: `10.80.${octet}.4` } },
    flow('same-backend-both-directions', subnet('application', 'work'), subnet('remote', 'remote-work'), '10.81.1.10', '10.82.1.10',
      'allow', { applianceChain: { forward: [backend], reverse: [backend] } }),
    flow('operations', subnet('application', 'work'), subnet('application', 'ops'), '10.81.1.10', '10.81.2.10'),
    flow('application-to-tenant', subnet('application', 'work'), subnet('tenant'), '10.81.1.10', '10.83.1.10', 'deny'),
    flow('tenant-to-application', subnet('tenant'), subnet('application', 'work'), '10.83.1.10', '10.81.1.10', 'deny'),
  ]
}
export function curriculumV2SegmentRequirements(capstone = false): Requirement[] {
  const o = capstone ? 40 : 0, address = (n: number) => `10.${n + o}.1.10`
  return [
    flow('original-regional-service', subnet('west-app'), subnet('east-service'), address(101), address(103)),
    flow('local-service', subnet('west-app'), subnet('west-local'), address(101), address(102)),
    flow('operations', subnet('west-app'), subnet('west-ops'), address(101), address(104)),
    flow('application-to-tenant', subnet('west-app'), subnet('west-tenant'), address(101), address(105), 'deny'),
    flow('tenant-to-application', subnet('west-tenant'), subnet('west-app'), address(105), address(101), 'deny'),
    { id: 'source-regional-route', kind: 'route', table: 'west-hub', hubTableId: 'workloads', prefix: `10.${103 + o}.0.0/16`, expectation: 'present' },
    { id: 'independent-reply-route', kind: 'route', table: 'east-hub', hubTableId: 'regional-services', prefix: `10.${101 + o}.0.0/16`, expectation: 'present' },
    { id: 'local-publication', kind: 'route', table: 'west-hub', hubTableId: 'workloads', prefix: `10.${102 + o}.0.0/16`, expectation: 'present' },
    { id: 'tenant-not-published', kind: 'route', table: 'west-hub', hubTableId: 'workloads', prefix: `10.${105 + o}.0.0/16`, expectation: 'absent' },
    { id: 'tenant-cannot-initiate', kind: 'route', table: 'west-hub', hubTableId: 'tenant-only', prefix: `10.${101 + o}.0.0/16`, expectation: 'absent' },
    { id: 'default-not-substituted', kind: 'route', table: 'west-hub', hubTableId: 'defaultRouteTable', prefix: `10.${103 + o}.0.0/16`, expectation: 'absent' },
    ...(capstone ? [flow('working-warehouse', subnet('west-app'), { kind: 'site' as const, siteId: 'warehouse' }, address(101), '172.26.0.10')] : []),
  ]
}
export const curriculumV2Requirements: Record<CurriculumV2LessonId, Requirement[]> = {
  'v2-peering': basic(), 'v2-firewall': basic({ applianceChain: { forward: ['azure-firewall'], reverse: ['azure-firewall'] } }),
  'v2-wan': [...basic(), flow('new-shared-service', subnet('app'), subnet('shared'), '10.21.1.10', '10.24.1.10')],
  'v2-secured-wan': [...basic({ requiredFirewallHubId: 'wan-hub' }),
    flow('new-shared-inspection', subnet('app'), subnet('shared'), '10.21.1.10', '10.24.1.10', 'allow', { requiredFirewallHubId: 'wan-hub' })],
  'v2-static-vpn': warehouse(), 'v2-bgp': warehouse(true), 'v2-expressroute': warehouse(),
  'v2-er-locations': warehouse(), 'v2-vpn-backup': warehouse(), 'v2-nva-ha': curriculumV2HaRequirements('standby'),
  'v2-segmentation': curriculumV2SegmentRequirements(), 'v2-handover': curriculumV2SegmentRequirements(true),
}

