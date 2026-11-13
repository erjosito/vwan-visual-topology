export type Preference = 'ExpressRoute' | 'VPN' | 'ASPath'
export type Transport = 'ExpressRoute' | 'VPN' | 'SDWAN' | 'SpokeNVA'
export type RouteKind = 'bgp' | 'vpn-static'
export type LayoutMode = 'layered' | 'constellation'
export interface NodePosition { x: number; y: number }
export interface DiagramLayout {
  mode: LayoutMode
  positions: Partial<Record<LayoutMode, Record<string, NodePosition>>>
}

export interface Hub {
  id: string
  name: string
  label?: string
  region: string
  preference: Preference
  routingIntent: { private: boolean; internet: boolean; privatePrefixes: string[] }
  routeMapAssignments?: RouteMapAssignment[]
}

export interface Site {
  id: string
  name: string
  label?: string
  asn: number
  prefixes: string[]
  role?: 'spoke-nva'
  routeMapAssignments?: RouteMapAssignment[]
  vpnStaticRoutes?: VpnStaticRoute[]
}

export interface VpnStaticRoute { id: string; prefix: string; connectionId: string }
export type ErCircuitSku = 'Local' | 'Standard' | 'Premium'
export interface ErLocation {
  id: string
  name: string
  label?: string
  peeringLocation?: string
  sku?: ErCircuitSku
  globalReachEnabled?: boolean
  globalReachLocationIds?: string[]
}
export interface ErLink {
  id: string
  name: string
  locationId: string
  hubId?: string
  siteId?: string
  enabled: boolean
  learnSiteRoutes: boolean
  propagateDefaultRoute?: boolean
}
export interface RouteMapAssignment { connectionId: string; inboundMapId?: string; outboundMapId?: string }
export interface RouterSelection { kind: 'hub' | 'site'; id: string }
export type RouteMapDirection = 'inbound' | 'outbound'
export interface PrependRule {
  id: string
  prefixes: string[]
  match: 'equals' | 'contains'
  prepend: number[]
}

export interface RouteMapCondition {
  id?: string
  property: 'prefix' | 'asPath' | 'community'
  match: 'equals' | 'contains'
  values: string[]
}

export interface RouteMapModification {
  id?: string
  property: 'asPath' | 'community'
  action: 'add' | 'replace' | 'remove'
  values: string[]
}

export interface RouteMapRule {
  id: string
  prefixes: string[]
  match: 'equals' | 'contains'
  action: 'permit' | 'drop' | 'summarize' | 'prepend'
  summaryPrefixes: string[]
  prepend: number[]
  nextStep: 'continue' | 'terminate'
  matchConditions?: RouteMapCondition[]
  modifications?: RouteMapModification[]
  localPreference?: number
}

export interface RouteMap {
  id: string
  name: string
  hubId?: string
  siteId?: string
  rules: RouteMapRule[]
}

export interface PeerPolicy {
  prefixes: string[]
  prepend: number[]
  receivePrepend?: number[]
}

export interface SiteLink {
  id: string
  name: string
  a: string
  b: string
  enabled: boolean
  aToB: PeerPolicy
  bToA: PeerPolicy
}

export interface Spoke {
  id: string
  name: string
  region?: string
  label?: string
  hubId?: string
  prefixes: string[]
  nvaSpokeIds?: string[]
  propagateDefaultRoute?: boolean
}

export interface Connection {
  id: string
  name: string
  hubId: string
  siteId: string
  transport: Transport
  enabled: boolean
  learnSiteRoutes: boolean
  propagateDefaultRoute?: boolean
  inbound: PrependRule[]
  outbound: PrependRule[]
  inboundMapId?: string
  outboundMapId?: string
  spokeId?: string
  peerIp?: string
}

export type AzureObservationStatus = 'complete' | 'empty' | 'denied' | 'failed' | 'truncated' | 'unsupported'

export interface AzureObservedRoute {
  addressPrefixes: string[]
  nextHopType: string
  nextHops: string[]
  routeOrigin: string
  asPath: string
}

export interface AzureObservedTable {
  hubId: string
  hubResourceId: string
  resourceId: string
  resourceType: string
  status: AzureObservationStatus
  capturedAt: string
  apiVersion: string
  routes: AzureObservedRoute[]
  warnings: string[]
}

export interface AzureImportInfo {
  capturedAt: string
  collectorVersion: string
  wanId: string
  warnings: string[]
  hubs: { hubId: string; resourceId: string; addressPrefix: string; limitations: string[] }[]
  spokes?: { spokeId: string; resourceId: string; virtualNetworkId: string }[]
  tables?: AzureObservedTable[]
}

export interface Topology {
  version: 1
  name: string
  allowBranchToBranchTraffic?: boolean
  hubs: Hub[]
  sites: Site[]
  spokes: Spoke[]
  siteLinks: SiteLink[]
  connections: Connection[]
  routeMaps?: RouteMap[]
  erLocations?: ErLocation[]
  erLinks?: ErLink[]
  layout?: DiagramLayout
  azureImport?: AzureImportInfo
}

export type ObjectKind = 'hub' | 'spoke' | 'site' | 'connection' | 'siteLink' | 'erLocation' | 'erLink'
export interface ObjectSelection { kind: ObjectKind; id: string }

export const objectLabels: Record<ObjectKind, string> = {
  hub: 'hub', spoke: 'spoke', site: 'site', connection: 'connection', siteLink: 'on-premises link', erLocation: 'ER location', erLink: 'ER connection',
}

export function topologyObject(topology: Topology, selection: ObjectSelection) {
  const collections = { hub: topology.hubs, spoke: topology.spokes, site: topology.sites, connection: topology.connections, siteLink: topology.siteLinks, erLocation: topology.erLocations ?? [], erLink: topology.erLinks ?? [] }
  return collections[selection.kind].find((item) => item.id === selection.id)
}

export const transportLabels: Record<Transport, string> = {
  ExpressRoute: 'ExpressRoute',
  VPN: 'S2S VPN',
  SDWAN: 'SD-WAN NVA',
  SpokeNVA: 'Spoke BGP NVA',
}

export function siteLabel(topology: Topology, id: string): string {
  return topology.connections.some((connection) => connection.transport === 'SpokeNVA' && connection.siteId === id) ? 'Spoke BGP NVA' : 'site'
}

export const preferenceLabels: Record<Preference, string> = {
  ExpressRoute: 'ExpressRoute',
  VPN: 'VPN',
  ASPath: 'AS Path',
}

export const routeLabels: Record<RouteKind, string> = {
  bgp: 'BGP',
  'vpn-static': 'VPN site static',
}

export const example: Topology = {
  version: 1,
  name: 'Global branch network',
  hubs: [
    { id: 'eu', name: 'Europe hub', region: 'West Europe', preference: 'ExpressRoute', routingIntent: { private: false, internet: false, privatePrefixes: [] } },
    { id: 'us', name: 'Americas hub', region: 'East US', preference: 'ASPath', routingIntent: { private: false, internet: false, privatePrefixes: [] } },
  ],
  sites: [
    { id: 'dc', name: 'London datacenter', asn: 65010, prefixes: ['10.20.0.0/16', '10.20.10.0/24'] },
    { id: 'ny', name: 'New York office', asn: 65020, prefixes: ['10.30.0.0/16'] },
    { id: 'branch', name: 'Berlin branch', asn: 65030, prefixes: ['10.40.0.0/16'] },
  ],
  spokes: [
    { id: 'eu-apps', name: 'Europe applications', region: 'West Europe', hubId: 'eu', prefixes: ['10.1.0.0/16'] },
    { id: 'us-apps', name: 'Americas applications', region: 'East US', hubId: 'us', prefixes: ['10.2.0.0/16'] },
  ],
  siteLinks: [],
  connections: [
    { id: 'er-eu', name: 'London primary', hubId: 'eu', siteId: 'dc', transport: 'ExpressRoute', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] },
    { id: 'vpn-eu', name: 'London backup', hubId: 'eu', siteId: 'dc', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] },
    { id: 'vpn-us', name: 'New York VPN', hubId: 'us', siteId: 'ny', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] },
    { id: 'sdwan-eu', name: 'Berlin SD-WAN', hubId: 'eu', siteId: 'branch', transport: 'SDWAN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] },
  ],
}
