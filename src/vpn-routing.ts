import type { Connection, Topology } from './model'
import { propagateSites } from './bgp'
import { cidr, validateTopology } from './validation'

export type VpnRoutingMode = 'static' | 'bgp'
export interface VpnRouteDraft { prefix: string; asPath: number[] }

export function vpnRoutingMode(topology: Topology, connection: Connection): VpnRoutingMode | 'mixed' {
  const statics = topology.sites.find((site) => site.id === connection.siteId)?.vpnStaticRoutes?.some((route) => route.connectionId === connection.id)
  const bgp = connection.learnSiteRoutes
  return statics ? bgp ? 'mixed' : 'static' : 'bgp'
}

export function suggestVpnRoutes(topology: Topology, connection: Connection): VpnRouteDraft[] {
  const site = topology.sites.find((site) => site.id === connection.siteId)!
  const suggestions = new Map<string, VpnRouteDraft>()
  const prefixes = [
    ...(site.vpnStaticRoutes?.filter((route) => route.connectionId === connection.id).map((route) => route.prefix) ?? []),
    ...site.prefixes,
    ...(connection.learnSiteRoutes ? propagateSites(topology).tables[site.id].map((route) => route.prefix) : []),
  ]
  for (const prefix of prefixes) {
    if (!suggestions.has(prefix)) suggestions.set(prefix, { prefix, asPath: [site.asn] })
  }
  return [...suggestions.values()]
}

export function convertVpnRouting(topology: Topology, connectionId: string, mode: VpnRoutingMode, routes: VpnRouteDraft[], learnSiteRoutes = true): Topology {
  const next = structuredClone(topology)
  const connection = next.connections.find((connection) => connection.id === connectionId)
  if (!connection || connection.transport !== 'VPN') throw new Error('Select an existing S2S VPN connection.')
  const site = next.sites.find((site) => site.id === connection.siteId)!
  if (!routes.length && (mode === 'static' || (!learnSiteRoutes && !site.prefixes.length))) throw new Error('Enter at least one destination prefix, or enable site-originated and learned BGP routes.')
  if (new Set(routes.map((route) => route.prefix)).size !== routes.length) throw new Error('Enter each destination prefix only once.')
  for (const route of routes) {
    if (!cidr(route.prefix)) throw new Error(`Invalid static IPv4 network CIDR: ${route.prefix}`)
  }
  const statics = site.vpnStaticRoutes?.filter((route) => route.connectionId === connectionId) ?? []
  const id = (prefix: string) => statics.find((route) => route.prefix === prefix)?.id ?? crypto.randomUUID()
  const converted = routes.map((route) => ({ id: id(route.prefix), prefix: route.prefix }))
  site.vpnStaticRoutes = (site.vpnStaticRoutes ?? []).filter((route) => route.connectionId !== connectionId)
  if (mode === 'static') {
    site.vpnStaticRoutes.push(...converted.map((route) => ({ id: route.id, prefix: route.prefix, connectionId })))
    connection.learnSiteRoutes = false
  } else {
    const learnedPrefixes = new Set(propagateSites(next).tables[site.id].map((route) => route.prefix))
    const newSitePrefixes = converted.map((route) => route.prefix).filter((prefix) => !site.prefixes.includes(prefix) && !learnedPrefixes.has(prefix))
    if (newSitePrefixes.length) site.prefixes = [...site.prefixes, ...newSitePrefixes]
    connection.learnSiteRoutes = learnSiteRoutes || converted.length > 0 || site.prefixes.length > 0
  }
  return validateTopology(next)
}
