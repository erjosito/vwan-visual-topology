import { applyRouteMapRules, type RouteMapAdvertisement } from '../bgp'
import type { RouteMapDirection } from '../model'
import { parseAsPath, validateTopology } from '../validation'
import type { AzNetTopology, AzRouteServer, AzVNet } from './model'

const reservedArsAsns = new Set([8074, 8075, 12076, 65515, 65517, 65518, 65519, 65520])

export function parseArsPrependAsPath(value: string) {
  const path = parseAsPath(value)
  if (path.some((asn) => asn > 65534 || reservedArsAsns.has(asn))) {
    throw new Error('ARS route maps require 2-byte ASNs (1-65534), excluding Azure-reserved 8074, 8075, 12076, 65515 and 65517-65520.')
  }
  return path
}

export function azArsPolicyLinks(vnet: AzVNet) {
  const ars = vnet.routeServer
  if (!ars) return []
  return [
    ...ars.peerApplianceIds.slice(0, 8).flatMap((id) => {
      const peer = vnet.appliances.find((app) => app.id === id)
      return peer ? [{ id: `nva:${id}`, name: `BGP peer: ${peer.name}`, bgp: Boolean(peer.bgpEnabled), targetId: id }] : []
    }),
    ...vnet.gateways.map((gateway) => ({
      id: `gateway:${gateway.id}`, name: `${gateway.kind} gateway: ${gateway.name}`,
      bgp: gateway.bgpEnabled, targetId: gateway.id,
    })),
  ]
}

export function validateAzArsRouteMaps(topology: AzNetTopology) {
  for (const vnet of topology.vnets) {
    const ars = vnet.routeServer
    if (!ars || ars.routeMaps === undefined && ars.routeMapAssignments === undefined) continue
    if (!Array.isArray(ars.routeMaps ?? []) || !Array.isArray(ars.routeMapAssignments ?? [])) {
      throw new Error('ARS route maps and assignments must be arrays.')
    }
    for (const map of ars.routeMaps ?? []) {
      if (map.siteId !== undefined || map.hubId !== undefined) throw new Error('ARS route maps belong to their containing route server, not a site or virtual hub.')
      for (const rule of map.rules ?? []) {
        const supported = new Set(['id', 'prefixes', 'match', 'action', 'summaryPrefixes', 'prepend', 'nextStep'])
        if (Object.keys(rule).some((key) => !supported.has(key))) {
          throw new Error('ARS simulation supports prefix matches, permit/drop, summarization and AS-path prepend only; advanced AS-path/community rules are not modeled.')
        }
        parseArsPrependAsPath(rule.prepend.join(' '))
      }
    }
    validateTopology({
      version: 1, name: topology.name, hubs: [], spokes: [], connections: [], siteLinks: [],
      sites: [{ id: ars.id, name: ars.name, asn: 65001, prefixes: [] }],
      routeMaps: (ars.routeMaps ?? []).map((map) => ({ ...map, siteId: ars.id })),
    })
    const links = azArsPolicyLinks(vnet)
    const seen = new Set<string>()
    for (const assignment of ars.routeMapAssignments ?? []) {
      if (!assignment || seen.has(assignment.connectionId)) throw new Error('Duplicate or invalid ARS route-map assignment.')
      seen.add(assignment.connectionId)
      if (!links.some((link) => link.id === assignment.connectionId)) throw new Error('ARS route-map assignment must reference a local BGP peer or gateway connection.')
      for (const id of [assignment.inboundMapId, assignment.outboundMapId]) {
        if (id !== undefined && !ars.routeMaps?.some((map) => map.id === id)) throw new Error('ARS assignment references a missing map on this route server.')
      }
    }
  }
}

export function applyAzArsRouteMap<T extends RouteMapAdvertisement & { protectedVnet?: boolean; routeMapTrace?: string[] }>(
  ars: AzRouteServer, connectionId: string, direction: RouteMapDirection, routes: T[],
): T[] {
  const binding = ars.routeMapAssignments?.find((binding) => binding.connectionId === connectionId)
  const map = ars.routeMaps?.find((map) => map.id === binding?.[`${direction}MapId`])
  if (!map) return routes
  const protectedRoutes = direction === 'outbound' ? routes.filter((route) => route.protectedVnet) : []
  const processed = applyRouteMapRules(routes.filter((route) => !protectedRoutes.includes(route)), map.rules).map((route) => ({
    ...route,
    routeMapTrace: [...new Set([...(route.routeMapTrace ?? []), `ARS route map "${map.name}" (${direction} at ${ars.name}, ${connectionId})`])],
  }))
  return [...protectedRoutes, ...processed]
}

export function pruneAzArsRouteMaps(topology: AzNetTopology) {
  for (const vnet of topology.vnets) {
    const ars = vnet.routeServer
    if (!ars?.routeMapAssignments) continue
    const links = azArsPolicyLinks(vnet)
    ars.routeMapAssignments = ars.routeMapAssignments.flatMap((assignment) => {
      if (!links.some((link) => link.id === assignment.connectionId)) return []
      const inboundMapId = ars.routeMaps?.find((map) => map.id === assignment.inboundMapId)?.id
      const outboundMapId = ars.routeMaps?.find((map) => map.id === assignment.outboundMapId)?.id
      return inboundMapId || outboundMapId ? [{ connectionId: assignment.connectionId, inboundMapId, outboundMapId }] : []
    })
  }
}
