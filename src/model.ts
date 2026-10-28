export type Preference = 'ExpressRoute' | 'VPN' | 'ASPath'
export type Transport = 'ExpressRoute' | 'VPN' | 'SDWAN'
export type RouteKind = 'bgp' | 'vpn-static'

export interface Hub {
  id: string
  name: string
  region: string
  preference: Preference
  routingIntent: { private: boolean; internet: boolean; privatePrefixes: string[] }
}

export interface Site {
  id: string
  name: string
  asn: number
  prefixes: string[]
}

export interface PrependRule {
  id: string
  prefixes: string[]
  match: 'equals' | 'contains'
  prepend: number[]
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
  hubId: string
  prefixes: string[]
}

export interface Advertisement {
  id: string
  prefix: string
  asPath: number[]
  kind: RouteKind
}

export interface Connection {
  id: string
  name: string
  hubId: string
  siteId: string
  transport: Transport
  enabled: boolean
  routes: Advertisement[]
  learnSiteRoutes: boolean
  inbound: PrependRule[]
  outbound: PrependRule[]
}

export interface Topology {
  version: 1
  name: string
  hubs: Hub[]
  sites: Site[]
  spokes: Spoke[]
  siteLinks: SiteLink[]
  connections: Connection[]
}

export const transportLabels: Record<Transport, string> = {
  ExpressRoute: 'ExpressRoute',
  VPN: 'S2S VPN',
  SDWAN: 'SD-WAN NVA',
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
    { id: 'dc', name: 'London datacenter', asn: 65010, prefixes: [] },
    { id: 'ny', name: 'New York office', asn: 65020, prefixes: [] },
    { id: 'branch', name: 'Berlin branch', asn: 65030, prefixes: [] },
  ],
  spokes: [
    { id: 'eu-apps', name: 'Europe applications', hubId: 'eu', prefixes: ['10.1.0.0/16'] },
    { id: 'us-apps', name: 'Americas applications', hubId: 'us', prefixes: ['10.2.0.0/16'] },
  ],
  siteLinks: [],
  connections: [
    { id: 'er-eu', name: 'London primary', hubId: 'eu', siteId: 'dc', transport: 'ExpressRoute', enabled: true, learnSiteRoutes: false, inbound: [], outbound: [],
      routes: [
        { id: 'r1', prefix: '10.20.0.0/16', asPath: [12076, 65010], kind: 'bgp' },
        { id: 'r2', prefix: '10.20.10.0/24', asPath: [12076, 65010], kind: 'bgp' },
      ] },
    { id: 'vpn-eu', name: 'London backup', hubId: 'eu', siteId: 'dc', transport: 'VPN', enabled: true, learnSiteRoutes: false, inbound: [], outbound: [],
      routes: [{ id: 'r3', prefix: '10.20.0.0/16', asPath: [65010, 65010, 65010], kind: 'bgp' }] },
    { id: 'vpn-us', name: 'New York VPN', hubId: 'us', siteId: 'ny', transport: 'VPN', enabled: true, learnSiteRoutes: false, inbound: [], outbound: [],
      routes: [
        { id: 'r4', prefix: '10.30.0.0/16', asPath: [65020], kind: 'bgp' },
        { id: 'r5', prefix: '10.20.0.0/16', asPath: [65020, 65010], kind: 'bgp' },
      ] },
    { id: 'sdwan-eu', name: 'Berlin SD-WAN', hubId: 'eu', siteId: 'branch', transport: 'SDWAN', enabled: true, learnSiteRoutes: false, inbound: [], outbound: [],
      routes: [{ id: 'r6', prefix: '10.40.0.0/16', asPath: [65100, 65030], kind: 'bgp' }] },
  ],
}
