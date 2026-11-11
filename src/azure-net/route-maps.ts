import { applyRouteMapRules, type RouteMapAdvertisement } from '../bgp'
import type { RouteMapDirection } from '../model'
import { validateTopology } from '../validation'
import type { AzNetTopology } from './model'

export function azSitePolicyLinks(topology: AzNetTopology, siteId: string) {
  return [
    ...topology.vpnConnections.filter((link) => link.siteId === siteId).map((link) => ({
      id: link.id, name: link.name, bgp: link.bgpEnabled &&
        (link.targetKind !== 'vnet-gateway' || Boolean(topology.vnets.some((vnet) =>
          vnet.gateways.some((gateway) => gateway.id === link.targetId && gateway.bgpEnabled)))),
    })),
    ...topology.erLinks.filter((link) => link.targetKind === 'site' && link.targetId === siteId)
      .map((link) => ({ id: link.id, name: link.name, bgp: true })),
    ...topology.siteLinks.filter((link) => link.siteAId === siteId || link.siteBId === siteId)
      .map((link) => ({ id: link.id, name: link.name, bgp: true })),
  ]
}

export function validateAzSiteRouteMaps(topology: AzNetTopology) {
  // Validate policy definitions with the same owner, rule and ASN constraints as VWAN.
  validateTopology({
    version: 1, name: topology.name, hubs: [], spokes: [], connections: [], siteLinks: [],
    sites: topology.sites.map((site) => ({ id: site.id, name: site.name, asn: site.asn, prefixes: [] })),
    routeMaps: topology.routeMaps ?? [],
  })
  for (const site of topology.sites) {
    const seen = new Set<string>()
    if (site.routeMapAssignments !== undefined && !Array.isArray(site.routeMapAssignments)) {
      throw new Error('Site route-map assignments must be an array.')
    }
    for (const assignment of site.routeMapAssignments ?? []) {
      if (!assignment || seen.has(assignment.connectionId)) throw new Error('Duplicate or invalid site route-map assignment.')
      seen.add(assignment.connectionId)
      if (!azSitePolicyLinks(topology, site.id).some((link) => link.id === assignment.connectionId)) {
        throw new Error('Route-map assignment references a connection not attached to this site.')
      }
      for (const id of [assignment.inboundMapId, assignment.outboundMapId]) {
        if (id !== undefined && !topology.routeMaps?.some((map) => map.id === id && map.siteId === site.id)) {
          throw new Error('Route map must exist and belong to the same site as its assignment.')
        }
      }
    }
  }
}

export function applyAzSiteRouteMap<T extends RouteMapAdvertisement & { routeMapTrace?: string[] }>(
  topology: AzNetTopology, siteId: string, connectionId: string, direction: RouteMapDirection, routes: T[],
): T[] {
  const site = topology.sites.find((site) => site.id === siteId)
  const assignment = site?.routeMapAssignments?.find((assignment) => assignment.connectionId === connectionId)
  const map = topology.routeMaps?.find((map) => map.id === assignment?.[`${direction}MapId`] && map.siteId === siteId)
  if (!site || !map || !azSitePolicyLinks(topology, siteId).some((link) => link.id === connectionId && link.bgp)) return routes
  const result = applyRouteMapRules(routes, map.rules).map((route) => ({
    ...route,
    routeMapTrace: [...new Set([...(route.routeMapTrace ?? []), `Site route map "${map.name}" (${direction} at ${site.name}, ${connectionId})`])],
  }))
  if (direction === 'inbound') return result.filter((route) => !route.asPath.includes(site.asn))
  return result.map((route) => ({
    ...route,
    asPath: route.asPath.length && (!route.forwardingRoutes || route.asPath.includes(site.asn))
      ? route.asPath : [site.asn, ...route.asPath],
  }))
}

export function pruneAzSiteRouteMaps(topology: AzNetTopology) {
  if (topology.routeMaps) topology.routeMaps = topology.routeMaps.filter((map) => topology.sites.some((site) => site.id === map.siteId))
  for (const site of topology.sites) {
    if (!site.routeMapAssignments) continue
    const links = azSitePolicyLinks(topology, site.id)
    site.routeMapAssignments = site.routeMapAssignments.flatMap((assignment) => {
      if (!links.some((link) => link.id === assignment.connectionId)) return []
      const inboundMapId = topology.routeMaps?.find((map) => map.id === assignment.inboundMapId && map.siteId === site.id)?.id
      const outboundMapId = topology.routeMaps?.find((map) => map.id === assignment.outboundMapId && map.siteId === site.id)?.id
      return inboundMapId || outboundMapId ? [{ connectionId: assignment.connectionId, inboundMapId, outboundMapId }] : []
    })
  }
}
