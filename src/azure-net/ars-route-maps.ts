import { applyRouteMapRules, azureReservedCommunities, type RouteMapAdvertisement } from '../bgp'
import type { RouteMapDirection } from '../model'
import { cidr, parseAsPath, validateTopology } from '../validation'
import type { AzNetTopology, AzRouteServer, AzVNet } from './model'

const reservedArsAsns = new Set([8074, 8075, 12076, 65515, 65517, 65518, 65519, 65520])

export function parseArsPrependAsPath(value: string) {
  const path = parseAsPath(value)
  if (path.some((asn) => asn > 65534 || reservedArsAsns.has(asn))) {
    throw new Error('ARS route maps require 2-byte ASNs (1-65534), excluding Azure-reserved 8074, 8075, 12076, 65515 and 65517-65520.')
  }
  return path
}

export function parseBgpCommunities(value: string) {
  const communities = value.split(/[,\s]+/).filter(Boolean)
  if (communities.some((community) => !/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(community) ||
    community.split(':').some((part) => Number(part) > 65535))) throw new Error('BGP communities must use 2-byte ASN:value notation (0-65535 per component).')
  return [...new Set(communities)]
}

export function azArsSpokes(vnet: AzVNet, topology?: AzNetTopology) {
  return (topology?.vnetPeerings ?? []).flatMap((peering) => {
    const forward = peering.vnetAId === vnet.id ? peering.aToB : peering.vnetBId === vnet.id ? peering.bToA : undefined
    const reverse = peering.vnetAId === vnet.id ? peering.bToA : peering.aToB
    const spoke = topology!.vnets.find((other) => other.id === (peering.vnetAId === vnet.id ? peering.vnetBId : peering.vnetAId))
    if (!forward || !spoke || !forward.allowVirtualNetworkAccess || !reverse.allowVirtualNetworkAccess ||
      !forward.allowGatewayTransit || !reverse.useRemoteGateways || spoke.routeServer?.enabled || spoke.gateways.some((gateway) => gateway.enabled)) return []
    return [{ vnet: spoke, peering, active: peering.enabled }]
  })
}

export function azArsPeers(vnet: AzVNet, topology?: AzNetTopology) {
  const hosts = [vnet, ...azArsSpokes(vnet, topology).filter((spoke) => spoke.active).map((spoke) => spoke.vnet)]
  return (vnet.routeServer?.peerApplianceIds ?? []).slice(0, 8).flatMap((id) => {
    const host = hosts.find((host) => host.appliances.some((app) => app.id === id))
    const peer = host?.appliances.find((app) => app.id === id)
    return host && peer ? [{ host, peer, connectionId: host.id === vnet.id ? `nva:${peer.id}` : `vnet:${host.id}` }] : []
  })
}

export function azArsPolicyLinks(vnet: AzVNet, topology?: AzNetTopology) {
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
    ...azArsSpokes(vnet, topology).map((spoke) => ({
      id: `vnet:${spoke.vnet.id}`, name: `Peered spoke: ${spoke.vnet.name}`,
      bgp: spoke.active, targetId: spoke.vnet.id,
    })),
  ]
}

export function validateAzArsRouteMaps(topology: AzNetTopology) {
  for (const vnet of topology.vnets) {
    for (const app of vnet.appliances) {
      if (app.advertisedRouteAttributes === undefined) continue
      if (!Array.isArray(app.advertisedRouteAttributes) || app.advertisedRouteAttributes.length > 100) throw new Error('NVA route attributes must be an array of at most 100 entries.')
      const prefixes = new Set<string>()
      for (const attributes of app.advertisedRouteAttributes) {
        if (!attributes || !app.advertisedPrefixes?.includes(attributes.prefix) || prefixes.has(attributes.prefix)) throw new Error('NVA route attributes require a unique, configured advertised prefix.')
        prefixes.add(attributes.prefix)
        if (attributes.asPath !== undefined && (!Array.isArray(attributes.asPath) || attributes.asPath.some((asn) => !Number.isInteger(asn) || asn < 1 || asn > 4294967294))) throw new Error('NVA AS-path suffix must contain valid ASNs.')
        if (attributes.communities !== undefined && (!Array.isArray(attributes.communities) || attributes.communities.some((community) => typeof community !== 'string'))) throw new Error('NVA communities must be an array of strings.')
        for (const community of attributes.communities ?? []) {
          if (parseBgpCommunities(community).length !== 1 || parseBgpCommunities(community)[0] !== community) throw new Error('NVA community values must contain one community each.')
        }
        if (Object.keys(attributes).some((key) => !['prefix', 'asPath', 'communities'].includes(key))) throw new Error('Unknown NVA route attribute.')
      }
    }
    const ars = vnet.routeServer
    if (!ars || ars.routeMaps === undefined && ars.routeMapAssignments === undefined) continue
    if (!Array.isArray(ars.routeMaps ?? []) || !Array.isArray(ars.routeMapAssignments ?? [])) {
      throw new Error('ARS route maps and assignments must be arrays.')
    }
    for (const map of ars.routeMaps ?? []) {
      if (map.siteId !== undefined || map.hubId !== undefined) throw new Error('ARS route maps belong to their containing route server, not a site or virtual hub.')
      for (const rule of map.rules ?? []) {
        const supported = new Set(['id', 'prefixes', 'match', 'action', 'summaryPrefixes', 'prepend', 'nextStep', 'matchConditions', 'modifications'])
        if (Object.keys(rule).some((key) => !supported.has(key))) {
          throw new Error('Unknown ARS route-map rule fields are not modeled. Use matchConditions and modifications for advanced policies.')
        }
        parseArsPrependAsPath(rule.prepend.join(' '))
        const validateValues = (property: string, values: string[], modifying: boolean) => {
          if (!Array.isArray(values) || values.length > 100 || values.some((value) => typeof value !== 'string')) throw new Error('ARS condition/action values must be an array of at most 100 strings.')
          if (property === 'prefix') {
            if (values.some((value) => !cidr(value))) throw new Error('ARS prefix conditions require valid IPv4 CIDRs.')
          } else if (property === 'asPath') {
            if (values.some((value) => !/^[1-9]\d*$/.test(value) || Number(value) > 65534)) throw new Error('ARS AS-path conditions/actions require 2-byte ASNs (1-65534).')
            if (modifying) parseArsPrependAsPath(values.join(' '))
          } else if (property === 'community') {
            for (const value of values) if (parseBgpCommunities(value).length !== 1 || parseBgpCommunities(value)[0] !== value) throw new Error('ARS community values must contain one community each.')
          } else throw new Error('Unknown ARS condition/action property.')
        }
        if (!Array.isArray(rule.matchConditions ?? []) || !Array.isArray(rule.modifications ?? []) ||
          (rule.matchConditions?.length ?? 0) > 40 || (rule.modifications?.length ?? 0) > 40) throw new Error('ARS rules support at most 40 conditions and modifications.')
        const rowIds = new Set<string>()
        for (const row of [...(rule.matchConditions ?? []), ...(rule.modifications ?? [])]) {
          if (row?.id !== undefined && rowIds.has(row.id)) throw new Error('Duplicate ARS condition/modification ID.')
          if (row?.id !== undefined) rowIds.add(row.id)
        }
        for (const condition of rule.matchConditions ?? []) {
          if (!condition || !['equals', 'contains'].includes(condition.match)) throw new Error('ARS conditions require equals or contains.')
          validateValues(condition.property, condition.values, false)
          if (!condition.values.length) throw new Error('An ARS match condition requires values; remove the condition to match all routes.')
          if (condition.id !== undefined && (typeof condition.id !== 'string' || !condition.id || condition.id.length > 120)) throw new Error('Invalid ARS condition ID.')
          if (Object.keys(condition).some((key) => !['id', 'property', 'match', 'values'].includes(key))) throw new Error('Unknown ARS match-condition fields.')
        }
        const replacements = new Map<string, string>()
        for (const modification of rule.modifications ?? []) {
          if (!modification || !['asPath', 'community'].includes(modification.property) || !['add', 'replace', 'remove'].includes(modification.action) ||
            modification.property === 'asPath' && modification.action === 'remove') throw new Error('ARS modifications support AS-path add/replace and community add/replace/remove. Replace with no values clears an attribute.')
          validateValues(modification.property, modification.values, true)
          if (modification.action !== 'replace' && !modification.values.length) throw new Error('ARS add/remove actions require values.')
          if (modification.action === 'remove' && modification.values.some((value) => azureReservedCommunities.has(value))) throw new Error('ARS maps cannot remove Azure-reserved communities.')
          if (modification.action === 'replace') {
            const value = JSON.stringify(modification.property === 'community' ? [...new Set(modification.values)].sort() : modification.values)
            if (replacements.has(modification.property) && replacements.get(modification.property) !== value) throw new Error('Conflicting replacements for the same ARS attribute are not order-independent.')
            replacements.set(modification.property, value)
          }
          if (modification.id !== undefined && (typeof modification.id !== 'string' || !modification.id || modification.id.length > 120)) throw new Error('Invalid ARS modification ID.')
          if (Object.keys(modification).some((key) => !['id', 'property', 'action', 'values'].includes(key))) throw new Error('Unknown ARS modification fields.')
        }
        if (rule.action === 'drop' && rule.modifications?.length) throw new Error('Drop rules cannot contain route modifications.')
      }
    }
    validateTopology({
      version: 1, name: topology.name, hubs: [], spokes: [], connections: [], siteLinks: [],
      sites: [{ id: ars.id, name: ars.name, asn: 65001, prefixes: [] }],
      routeMaps: (ars.routeMaps ?? []).map((map) => ({ ...map, siteId: ars.id,
        rules: map.rules.map((rule) => ({ ...rule, matchConditions: undefined, modifications: undefined })),
      })),
    })
    const links = azArsPolicyLinks(vnet, topology)
    const seen = new Set<string>()
    for (const assignment of ars.routeMapAssignments ?? []) {
      if (!assignment || seen.has(assignment.connectionId)) throw new Error('Duplicate or invalid ARS route-map assignment.')
      seen.add(assignment.connectionId)
      if (!links.some((link) => link.id === assignment.connectionId)) throw new Error('ARS route-map assignment must reference a local BGP peer or gateway connection, or an eligible gateway-transit peered spoke.')
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
    const links = azArsPolicyLinks(vnet, topology)
    ars.routeMapAssignments = ars.routeMapAssignments.flatMap((assignment) => {
      if (!links.some((link) => link.id === assignment.connectionId)) return []
      const inboundMapId = ars.routeMaps?.find((map) => map.id === assignment.inboundMapId)?.id
      const outboundMapId = ars.routeMaps?.find((map) => map.id === assignment.outboundMapId)?.id
      return inboundMapId || outboundMapId ? [{ connectionId: assignment.connectionId, inboundMapId, outboundMapId }] : []
    })
  }
}
