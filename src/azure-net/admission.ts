import type { AzNetTopology } from './model'
import { azArsPolicyLinks } from './ars-route-maps'

export const AZNET_MAX_JSON_LENGTH = 4_000_000
const MAX_ITEMS = 4096
type Shape = (value: unknown, path: string) => void
const fail = (path: string, reason: string): never => { throw new Error(`${path}: ${reason}`) }
const text: Shape = (v, p) => { if (typeof v !== 'string' || v.length > 4096 || v.includes('\0')) fail(p, 'expected text of at most 4096 characters without NUL') }
const id: Shape = (v, p) => { if (typeof v !== 'string' || !v || v.length > 120 || v.includes('\0') || ['__proto__', 'constructor', 'prototype'].includes(v)) fail(p, 'expected a nonempty ID of at most 120 characters without NUL or reserved object keys') }
const bool: Shape = (v, p) => { if (typeof v !== 'boolean') fail(p, 'expected boolean') }
const number: Shape = (v, p) => { if (typeof v !== 'number' || !Number.isFinite(v)) fail(p, 'expected finite number') }
const asn: Shape = (v, p) => { number(v, p); if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 4294967294) fail(p, 'Invalid ASN') }
const choice = (...values: unknown[]): Shape => (v, p) => { if (!values.includes(v)) fail(p, `expected ${values.join(' / ')}`) }
const array = (item: Shape): Shape => (v, p) => {
  if (!Array.isArray(v) || v.length > MAX_ITEMS) fail(p, `must be an array of at most ${MAX_ITEMS} items`)
  const entries = v as unknown[]
  entries.forEach((entry, i) => item(entry, `${p}[${i}]`))
}
const object = (required: Record<string, Shape>, optional: Record<string, Shape> = {}): Shape => (v, p) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(p, 'expected object')
  const record = v as Record<string, unknown>
  for (const [key, check] of Object.entries(required)) check(record[key], `${p}.${key}`)
  for (const [key, check] of Object.entries(optional)) if (record[key] !== undefined) check(record[key], `${p}.${key}`)
}
const named = { id, name: text }
const positioned = { label: (v: unknown, p: string) => { text(v, p); if ((v as string).length > 120) fail(p, 'label exceeds 120 characters') }, x: number, y: number }
const strings = array(text), asns = array(asn)
const assignment = object({ connectionId: id }, { inboundMapId: id, outboundMapId: id })
const rule = object({
  id, prefixes: strings, match: choice('equals', 'contains'), action: choice('permit', 'drop', 'summarize', 'prepend'),
  summaryPrefixes: strings, prepend: asns, nextStep: choice('continue', 'terminate'),
}, {
  matchConditions: array(object({ property: choice('prefix', 'asPath', 'community'), match: choice('equals', 'contains'), values: strings }, { id })),
  modifications: array(object({ property: choice('asPath', 'community'), action: choice('add', 'replace', 'remove'), values: strings }, { id })),
})
const maps = array(object({ ...named, rules: array(rule) }, { siteId: id, hubId: id }))
const flags = object({ allowVirtualNetworkAccess: bool, allowForwardedTraffic: bool, allowGatewayTransit: bool, useRemoteGateways: bool })
const schema = object({
  version: choice(2), kind: choice('azure-network-topology'), name: text,
  vnets: array(object({
    ...named, region: text, prefixes: strings, role: choice('hub-vnet', 'spoke-vnet', 'transit-vnet', 'shared-services', 'hub', 'spoke', 'transit', 'standalone'),
    subnets: array(object({ ...named, prefix: text }, {
      routeTableId: id, defaultOutboundAccess: bool,
      privateEndpointNetworkPolicies: choice('Disabled', 'Enabled', 'RouteTableEnabled', 'NetworkSecurityGroupEnabled'),
      privateEndpoints: array(object({ ...named, ipAddress: text, serviceName: text })),
    })),
    gateways: array(object({ ...named, kind: choice('ExpressRoute', 'Vpn'), asn, bgpEnabled: bool, enabled: bool }, { activeActive: bool })),
    appliances: array(object({
      ...named, kind: choice('azure-firewall', 'nva-vm', 'vnra'), subnetId: id, privateIp: text, enableIpForwarding: bool,
      staticRoutes: array(object({ id, prefix: text, nextHopKind: choice('subnet', 'gateway', 'appliance', 'internet', 'drop'), enabled: bool }, { nextHopIp: text })),
    }, {
      asn, bgpEnabled: bool, inspectsTraffic: bool, advertisedPrefixes: strings,
      advertisedRouteAttributes: array(object({ prefix: text }, { asPath: asns, communities: strings })),
    })),
  }, {
    ...positioned, summarizedGatewayPrefixes: (v, p) => {
      if (!Array.isArray(v)) fail(p, 'advertised gateway prefixes must be an array')
      array((entry, path) => { if (typeof entry !== 'string') fail(path, 'invalid advertised gateway prefix'); text(entry, path) })(v, p)
    },
    vwanHubAttachment: object({ hubId: id, enabled: bool }, { propagateDefaultRoute: bool }),
    routeServer: object({
      ...named, enabled: bool, branchToBranchTraffic: bool,
      hubRoutingPreference: choice('ExpressRoute', 'VpnGateway', 'ASPath'), peerApplianceIds: array(id),
    }, { subnetId: id, routeMaps: maps, routeMapAssignments: array(assignment) }),
  })),
  vnetPeerings: array(object({ ...named, vnetAId: id, vnetBId: id, enabled: bool, aToB: flags, bToA: flags })),
  udrTables: array(object({
    ...named, disableBgpRoutePropagation: bool,
    routes: array(object({ ...named, prefix: text, nextHopType: choice('VirtualAppliance', 'VirtualNetworkGateway', 'VnetLocal', 'Internet', 'None'), enabled: bool }, { nextHopIp: text })),
  }, { disablePeeringRoutePropagation: bool })),
  vwanHubs: array(object({
    ...named, region: text, preference: choice('ExpressRoute', 'VPN', 'ASPath'), routingIntent: object({ private: bool, internet: bool }),
  }, { ...positioned, prefix: text })),
  erLocations: array(object(named, { ...positioned, globalReachEnabled: bool, sku: choice('Local', 'Standard', 'Premium'), peeringLocation: text })),
  erLinks: array(object({ ...named, locationId: id, targetKind: choice('vnet-gateway', 'vwan-hub', 'site'), targetId: id, enabled: bool }, { weight: number, prepend: asns })),
  sites: array(object({ ...named, asn, prefixes: strings }, { ...positioned, routeMapAssignments: array(assignment) })),
  vpnConnections: array(object({
    ...named, siteId: id, targetKind: choice('vnet-gateway', 'vwan-hub', 'appliance'), targetId: id, bgpEnabled: bool, enabled: bool,
  }, { staticPrefixes: strings, inboundPrepend: asns, outboundPrepend: asns })),
  siteLinks: array(object({ ...named, siteAId: id, siteBId: id, enabled: bool })),
}, {
  subtitle: text, routeMaps: maps,
  erGlobalReachLinks: array(object({ ...named, locationAId: id, locationBId: id, enabled: bool })),
  layout: object({ mode: choice('layered', 'constellation'), positions: (v, p) => {
    object({})(v, p)
    for (const [mode, positions] of Object.entries(v as object)) {
      choice('layered', 'constellation')(mode, p)
      object({})(positions, p)
      for (const [key, position] of Object.entries(positions as object)) { id(key, p); object({ x: number, y: number })(position, p) }
    }
  } }),
})

// Bound even unknown extension/observation fields; retain them for forward-compatible round trips.
function boundedJson(input: unknown): unknown {
  let count = 0, characters = 0
  const ancestors = new Set<object>()
  const visit = (value: unknown, depth: number): unknown => {
    if (++count > 100_000 || depth > 32) fail('Topology', 'input exceeds aggregate/depth limit')
    if (typeof value === 'string') {
      characters += value.length
      if (value.length > 16_384 || characters > 2_000_000) fail('Topology', 'input exceeds text limit')
      return value
    }
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value
    if (!value || typeof value !== 'object' || ancestors.has(value)) fail('Topology', 'expected acyclic JSON data')
    ancestors.add(value as object)
    let result: unknown
    if (Array.isArray(value)) {
      if (value.length > MAX_ITEMS) fail('Topology', 'collection exceeds 4096 items')
      result = value.map((entry) => visit(entry, depth + 1))
    } else {
      const entries = Object.entries(value as object)
      if (entries.length > MAX_ITEMS) fail('Topology', 'object exceeds 4096 fields')
      result = Object.fromEntries(entries.filter(([, entry]) => entry !== undefined).map(([key, entry]) => {
        characters += key.length
        if (characters > 2_000_000) fail('Topology', 'input exceeds text limit')
        if (key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('Topology', 'invalid object key')
        return [key, visit(entry, depth + 1)]
      }))
    }
    ancestors.delete(value as object)
    return result
  }
  return visit(input, 0)
}

export function parseAzNetJson(text: string): AzNetTopology {
  if (text.length > AZNET_MAX_JSON_LENGTH) fail('Topology', 'JSON exceeds 4 MB limit')
  return parseAzNetTopology(JSON.parse(text))
}

/** Structural admission, not a requirement that an editable design already routes successfully. */
export function parseAzNetTopology(input: unknown): AzNetTopology {
  const clean = boundedJson(input)
  schema(clean, 'Topology')
  const topology = clean as AzNetTopology
  const ids = new Set<string>()
  const unique = (items: { id: string }[], scope = ids) => {
    for (const item of items) {
      if (scope.has(item.id)) fail(item.id, 'duplicate ID')
      scope.add(item.id)
    }
  }
  const ref = (value: string | undefined, items: { id: string }[], path: string) => {
    if (value !== undefined && !items.some((item) => item.id === value)) fail(path, `dangling reference "${value}"`)
  }
  const allAppliances = topology.vnets.flatMap((vnet) => vnet.appliances)
  const gateways = topology.vnets.flatMap((vnet) => vnet.gateways)
  unique([...topology.vnets, ...topology.vwanHubs, ...topology.erLocations, ...topology.sites, ...topology.udrTables,
    ...topology.vnetPeerings, ...topology.erLinks, ...(topology.erGlobalReachLinks ?? []), ...topology.vpnConnections, ...topology.siteLinks])
  const policies = (owner: { routeMaps?: AzNetTopology['routeMaps']; routeMapAssignments?: { connectionId: string; inboundMapId?: string; outboundMapId?: string }[] }, links: { id: string }[]) => {
    unique(owner.routeMaps ?? [])
    for (const map of owner.routeMaps ?? []) {
      unique(map.rules, new Set())
      for (const rule of map.rules) {
        const rows = [...(rule.matchConditions ?? []), ...(rule.modifications ?? [])].filter((row): row is typeof row & { id: string } => row.id !== undefined)
        if (new Set(rows.map((row) => row.id)).size !== rows.length) fail(map.id, 'Duplicate ARS condition/modification ID')
      }
    }
    const assigned = new Set<string>()
    for (const a of owner.routeMapAssignments ?? []) {
      if (assigned.has(a.connectionId)) fail(a.connectionId, 'duplicate assignment')
      assigned.add(a.connectionId)
      ref(a.connectionId, links, 'Policy connection')
      ref(a.inboundMapId, owner.routeMaps ?? [], 'Inbound map')
      ref(a.outboundMapId, owner.routeMaps ?? [], 'Outbound map')
    }
  }
  policies({ routeMaps: topology.routeMaps }, [])
  for (const map of topology.routeMaps ?? []) {
    ref(map.siteId, topology.sites, 'Route-map site')
    ref(map.hubId, topology.vwanHubs, 'Route-map hub')
  }
  for (const site of topology.sites) policies({
    routeMaps: [], routeMapAssignments: site.routeMapAssignments?.map((a) => ({ connectionId: a.connectionId })),
  }, [...topology.erLinks.filter((l) => l.targetKind === 'site' && l.targetId === site.id), ...topology.vpnConnections.filter((l) => l.siteId === site.id), ...topology.siteLinks.filter((l) => l.siteAId === site.id || l.siteBId === site.id)])
  for (const site of topology.sites) for (const a of site.routeMapAssignments ?? []) {
    const owned = (topology.routeMaps ?? []).filter((map) => map.siteId === site.id)
    ref(a.inboundMapId, owned, 'Inbound map must belong to the same site'); ref(a.outboundMapId, owned, 'Outbound map must belong to the same site')
  }
  for (const vnet of topology.vnets) {
    unique([...vnet.subnets, ...vnet.gateways, ...vnet.appliances, ...(vnet.routeServer ? [vnet.routeServer] : [])])
    for (const subnet of vnet.subnets) {
      ref(subnet.routeTableId, topology.udrTables, 'Subnet route table')
      unique(subnet.privateEndpoints ?? [])
    }
    for (const app of vnet.appliances) {
      ref(app.subnetId, vnet.subnets, 'Appliance subnet')
      unique(app.staticRoutes, new Set())
    }
    ref(vnet.vwanHubAttachment?.hubId, topology.vwanHubs, 'VNet hub attachment')
    if (vnet.routeServer) {
      ref(vnet.routeServer.subnetId, vnet.subnets, 'Route Server subnet')
      const peers = new Set<string>()
      for (const peer of vnet.routeServer.peerApplianceIds) {
        if (peers.has(peer)) fail(peer, 'duplicate ARS peer')
        peers.add(peer); ref(peer, allAppliances, 'ARS peer')
      }
      try { policies(vnet.routeServer, azArsPolicyLinks(vnet, topology)) }
      catch (error) { throw new Error(`${error instanceof Error ? error.message : error}. ARS map requires a local BGP peer or gateway, or eligible gateway-transit peered spoke.`) }
    }
  }
  for (const table of topology.udrTables) unique(table.routes, new Set())
  for (const p of topology.vnetPeerings) { ref(p.vnetAId, topology.vnets, 'Peering A'); ref(p.vnetBId, topology.vnets, 'Peering B') }
  for (const l of topology.erLinks) {
    ref(l.locationId, topology.erLocations, 'ER location')
    ref(l.targetId, l.targetKind === 'site' ? topology.sites : l.targetKind === 'vwan-hub' ? topology.vwanHubs : gateways, 'ER target')
  }
  for (const l of topology.vpnConnections) {
    ref(l.siteId, topology.sites, 'VPN site')
    ref(l.targetId, l.targetKind === 'appliance' ? allAppliances : l.targetKind === 'vwan-hub' ? topology.vwanHubs : gateways, 'VPN target')
  }
  for (const l of topology.siteLinks) { ref(l.siteAId, topology.sites, 'Site link A'); ref(l.siteBId, topology.sites, 'Site link B') }
  for (const l of topology.erGlobalReachLinks ?? []) { ref(l.locationAId, topology.erLocations, 'Global Reach A'); ref(l.locationBId, topology.erLocations, 'Global Reach B') }
  return topology
}
