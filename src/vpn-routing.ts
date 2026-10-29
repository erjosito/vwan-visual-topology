import type { Connection, Topology } from './model'
import { propagateSites } from './bgp'
import { validateTopology } from './validation'

export type VpnRoutingMode = 'static' | 'bgp'
export interface VpnRouteDraft { prefix: string; asPath: number[] }

export function vpnRoutingMode(topology: Topology, connection: Connection): VpnRoutingMode | 'mixed' {
  const statics = topology.sites.find((site) => site.id === connection.siteId)?.vpnStaticRoutes?.some((route) => route.connectionId === connection.id)
  const bgp = connection.learnSiteRoutes || connection.routes.some((route) => route.kind === 'bgp')
  return statics ? bgp ? 'mixed' : 'static' : 'bgp'
}

export function suggestVpnRoutes(topology: Topology, connection: Connection): VpnRouteDraft[] {
  const site = topology.sites.find((site) => site.id === connection.siteId)!
  const suggestions = new Map<string, VpnRouteDraft>()
  for (const route of connection.routes) suggestions.set(route.prefix, { prefix: route.prefix, asPath: [...route.asPath] })
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

export function convertVpnRouting(topology: Topology, connectionId: string, mode: VpnRoutingMode, routes: VpnRouteDraft[], learnSiteRoutes = false): Topology {
  const next = structuredClone(topology)
  const connection = next.connections.find((connection) => connection.id === connectionId)
  if (!connection || connection.transport !== 'VPN') throw new Error('Select an existing S2S VPN connection.')
  const site = next.sites.find((site) => site.id === connection.siteId)!
  if (!routes.length && (mode === 'static' || !learnSiteRoutes)) throw new Error('Enter at least one destination prefix, or enable site-originated and learned BGP routes.')
  if (new Set(routes.map((route) => route.prefix)).size !== routes.length) throw new Error('Enter each destination prefix only once.')
  const statics = site.vpnStaticRoutes?.filter((route) => route.connectionId === connectionId) ?? []
  const id = (prefix: string) => {
    const bgp = connection.routes.find((route) => route.prefix === prefix)?.id
    const existing = statics.find((route) => route.prefix === prefix)?.id
    return (mode === 'static' ? existing ?? bgp : bgp ?? existing) ?? crypto.randomUUID()
  }
  const converted = routes.map((route) => ({ id: id(route.prefix), prefix: route.prefix, asPath: [...route.asPath] }))
  site.vpnStaticRoutes = (site.vpnStaticRoutes ?? []).filter((route) => route.connectionId !== connectionId)
  if (mode === 'static') {
    site.vpnStaticRoutes.push(...converted.map((route) => ({ id: route.id, prefix: route.prefix, connectionId })))
    connection.routes = []
    connection.learnSiteRoutes = false
  } else {
    connection.routes = converted.map((route) => ({ ...route, kind: 'bgp' }))
    connection.learnSiteRoutes = learnSiteRoutes
  }
  return validateTopology(next)
}
