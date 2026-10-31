import type { ObjectSelection, Topology } from './model'
import { topologyObject } from './model'
import type { FlowPath, Simulation } from './routing'
import { traceFlow } from './routing'
import { applyRouteMapRules, propagateSites, routerMapRules } from './bgp'
import type { SiteRoute, SiteRouting } from './bgp'
import { downstreamVnetForAddress, resolveAttachment, standaloneSites } from './topology-graph'
import { cidr, contains, ipv4 } from './validation'

export type PathNode = ObjectSelection & { kind: 'hub' | 'spoke' | 'site' }
export interface NodePath extends FlowPath { sourceConnectionId?: string; sourceSiteHops?: string[]; sourceSiteLinkIds?: string[]; sourceErLinkIds?: string[]; sourceSpokeId?: string; sourceNvaSpokeId?: string }
export interface GroupPath extends NodePath {
  sourceName: string; destinationPrefix: string; destinationName: string
  sourceNode?: PathNode; targetNode?: PathNode; direction?: 'forward' | 'return'
}
export type PathGroup = 'vnets' | 'sites' | 'everywhere'
export type PathDirection = 'to' | 'from'

export function nodePrefixes(topology: Topology, node: PathNode): string[] {
  if (node.kind === 'spoke') return topology.spokes.find((s) => s.id === node.id)?.prefixes ?? []
  if (node.kind === 'hub') return topology.spokes.filter((s) => s.hubId === node.id).flatMap((s) => s.prefixes)
  const site = topology.sites.find((s) => s.id === node.id)
  return site?.prefixes.length ? site.prefixes : [...new Set(site?.vpnStaticRoutes?.map((r) => r.prefix) ?? [])]
}

export interface SiteAdvertisement extends SiteRoute { connectionId: string; erHubLinkId?: string }

const siteRibCache = new WeakMap<Simulation, Map<string, SiteRouting<SiteAdvertisement>>>()

function sitePlaneCacheKey(topology: Topology): string {
  return JSON.stringify({
    sites: topology.sites.map((s) => [s.id, s.asn, s.prefixes, s.vpnStaticRoutes, s.routeMapAssignments]),
    siteLinks: topology.siteLinks,
    connections: topology.connections.map((c) => [c.id, c.enabled, c.siteId, c.spokeId, c.transport]),
    erLinks: (topology.erLinks ?? []).map((l) => [l.id, l.enabled, l.siteId, l.hubId, l.locationId]),
    routeMaps: (topology.routeMaps ?? []).filter((m) => Boolean(m.siteId)),
  })
}

export function azureRoutesAtSites(topology: Topology, simulation: Simulation): SiteRouting<SiteAdvertisement> {
  const key = sitePlaneCacheKey(topology)
  let byTopology = siteRibCache.get(simulation)
  if (!byTopology) {
    byTopology = new Map()
    siteRibCache.set(simulation, byTopology)
  }
  const cached = byTopology.get(key)
  if (cached) return cached

  const advertisement = (route: SiteRoute, connectionId: string): SiteAdvertisement => ({
    ...route, connectionId,
    ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map((child) => advertisement(child, connectionId)) } : {}),
  })
  const propagated = propagateSites<SiteAdvertisement>(topology, {
    sortByKey: true,
    seed: (site) => [
      ...(simulation.siteCandidates[site.id] ?? []).filter((r) => r.sitePath.length === 1).map((r) => advertisement(r, '')),
      ...[...topology.connections, ...(topology.erLinks ?? [])].filter((c) => c.enabled && c.siteId === site.id)
        .flatMap((c) => {
          const routes = simulation.outbound[c.id] ?? []
          const received = [...applyRouteMapRules(routes.filter((r) => r.kind !== 'vpn-static'), routerMapRules(topology, { kind: 'site', id: site.id }, c.id, 'inbound')), ...routes.filter((r) => r.kind === 'vpn-static')]
          const origin = (r: typeof routes[number], erHubLinkId = r.erHubLinkId): SiteAdvertisement => ({
            key: `${c.id}:${erHubLinkId ?? ''}:${r.key}`, prefix: r.prefix, asPath: r.asPath, sitePath: [site.id], siteLinkIds: [], connectionId: c.id, erHubLinkId,
            ...(r.forwardingRoutes ? { forwardingRoutes: r.forwardingRoutes.map((child) => origin(child, child.erHubLinkId ?? erHubLinkId)) } : {}),
          })
          return received.filter((r) => !r.asPath.includes(site.asn)).map((route) => origin(route))
        }),
    ],
  })
  const result: SiteRouting<SiteAdvertisement> = {
    ...propagated,
    selectionComplete: simulation.siteSelectionComplete !== false && propagated.selectionComplete,
  }
  byTopology.set(key, result)
  return result
}

export function traceGroupedPaths(topology: Topology, simulation: Simulation, anchor: PathNode, direction: PathDirection, group: PathGroup): GroupPath[] {
  const object = topologyObject(topology, anchor)
  if (!simulation.converged || !object) return []
  const nodes = [
    ...(group !== 'sites' ? topology.spokes.map((spoke) => ({ ...spoke, kind: 'spoke' as const })) : []),
    ...(group !== 'vnets' ? standaloneSites(topology).map((site) => ({ ...site, kind: 'site' as const })) : []),
  ].filter((node) => node.kind !== anchor.kind || node.id !== anchor.id)
  const needsSiteRoutes = (node: PathNode) => node.kind === 'site' || (node.kind === 'spoke' && !topology.spokes.find((s) => s.id === node.id)?.hubId)
  const siteRoutes = (direction === 'to' ? needsSiteRoutes(anchor) : nodes.some(needsSiteRoutes))
    ? azureRoutesAtSites(topology, simulation) : undefined
  if (direction === 'from') {
    return nodes.flatMap((source) => [...new Set(nodePrefixes(topology, anchor))].flatMap((prefix) =>
      traceNodePath(topology, simulation, source, prefix.split('/')[0], siteRoutes)
        .map((path) => ({ ...path, sourceName: source.name, destinationPrefix: prefix, destinationName: object.name }))))
  }
  const destinations = new Map<string, string[]>()
  for (const node of nodes) {
    for (const prefix of nodePrefixes(topology, node)) {
      destinations.set(prefix, [...new Set([...(destinations.get(prefix) ?? []), node.name])])
    }
  }
  return [...destinations].flatMap(([prefix, names]) => traceNodePath(topology, simulation, anchor, prefix.split('/')[0], siteRoutes)
    .map((path) => ({ ...path, sourceName: object.name, destinationPrefix: prefix, destinationName: names.join(', ') })))
}

export function traceNodePath(topology: Topology, simulation: Simulation, source: PathNode, destination: string, siteRoutes?: ReturnType<typeof azureRoutesAtSites>): NodePath[] {
  const address = ipv4(destination)
  if (address === undefined || !simulation.converged) return []
  if (source.kind !== 'site') {
    const spoke = source.kind === 'spoke' ? topology.spokes.find((s) => s.id === source.id) : undefined
    if (spoke?.prefixes.some((prefix) => contains(prefix, address))) return [{
      hubs: [], siteId: spoke.id, steps: ['Destination is within the source spoke; no Virtual WAN hop is required.'], status: 'delivered',
      termination: 'owner', terminalKind: 'spoke', traceComplete: true,
    }]
    if (spoke && !spoke.hubId) {
      if (!spoke.nvaSpokeIds?.length) return [{
        hubs: [], steps: ['Standalone VNet is not connected to a Virtual WAN hub or spoke NVA.'], status: 'unreachable',
        termination: 'no-route', traceComplete: true,
      }]
      const nvaConns = topology.connections.filter((c) => c.enabled && c.transport === 'SpokeNVA' && c.spokeId && spoke.nvaSpokeIds?.includes(c.spokeId))
      if (!nvaConns.length) return [{
        hubs: [], steps: ['No enabled spoke BGP NVA is attached to this VNet.'], status: 'unreachable',
        termination: 'no-route', traceComplete: true,
      }]
      const learned = siteRoutes ?? azureRoutesAtSites(topology, simulation)
      if (!learned.converged) return [{ hubs: [], steps: ['On-premises Azure advertisement propagation did not converge.'], status: 'unreachable', termination: 'nonconverged', traceComplete: false }]
      const candidateConns = nvaConns.flatMap((conn) => (learned.tables[conn.siteId] ?? [])
        .filter((r) => contains(r.prefix, address))
        .map((route) => ({ conn, route })))
      if (!candidateConns.length) return [{
        hubs: [], steps: ['No route at the attached spoke BGP NVA for this destination.'], status: 'unreachable',
        termination: 'no-route', traceComplete: learned.selectionComplete,
      }]
      const longest = Math.max(...candidateConns.map((c) => cidr(c.route.prefix)!.length))
      const longestMatches = candidateConns.filter((c) => cidr(c.route.prefix)!.length === longest)
      const shortest = Math.min(...longestMatches.map((c) => c.route.asPath.length))
      const winningConns = [...new Map(longestMatches.filter((c) => c.route.asPath.length === shortest).map((c) => [c.conn.id, c.conn])).values()]
      return winningConns.flatMap((conn) => traceNodePath(topology, simulation, { kind: 'site', id: conn.siteId }, destination, learned).map((path) => ({
        ...path,
        sourceSpokeId: spoke.id,
        sourceNvaSpokeId: conn.spokeId,
        steps: [`Exit downstream VNet ${spoke.name} via spoke NVA on ${topology.spokes.find((s) => s.id === conn.spokeId)?.name ?? conn.spokeId}.`, ...path.steps],
      })))
    }
    const hubId = source.kind === 'hub' ? source.id : spoke?.hubId
    return hubId ? traceFlow(topology, simulation, hubId, destination).map((path) => ({
      ...path, ...(spoke && path.hubs.length ? { sourceSpokeId: spoke.id } : {}),
    })) : []
  }
  const learned = siteRoutes ?? azureRoutesAtSites(topology, simulation)
  if (!learned.converged) return [{ hubs: [], steps: ['On-premises Azure advertisement propagation did not converge.'], status: 'unreachable', termination: 'nonconverged', traceComplete: false }]
  const routes = (learned.tables[source.id] ?? []).filter((r) => contains(r.prefix, address))
  const longest = Math.max(...routes.map((r) => cidr(r.prefix)!.length))
  const matches = routes.filter((r) => cidr(r.prefix)!.length === longest)
  const shortest = Math.min(...matches.map((r) => r.asPath.length))
  const preferred = matches.filter((r) => r.asPath.length === shortest).slice(0, 32)
  if (!preferred.length) return [{ hubs: [], steps: ['No BGP route at the source site. Azure routes must be advertised on an enabled connection.'], status: 'unreachable', termination: 'no-route', traceComplete: learned.selectionComplete }]
  const contributions = (route: SiteAdvertisement): SiteAdvertisement[] => {
    if (!route.forwardingRoutes) return [route]
    const matches = route.forwardingRoutes.filter((child) => contains(child.prefix, address)).flatMap((child) => contributions(child as SiteAdvertisement))
    const longest = Math.max(...matches.map((child) => cidr(child.prefix)!.length))
    return matches.filter((child) => cidr(child.prefix)!.length === longest)
  }
  const paths = preferred.flatMap((selected): NodePath[] => {
    const actual = contributions(selected)
    if (!actual.length) return [{ hubs: [], steps: ['The mapped summary has no known contributing route for this destination.'], status: 'unreachable', termination: 'summary-hole', lookupPrefix: selected.prefix }]
    return actual.flatMap((route): NodePath[] => {
      const steps = [`Source site: longest prefix ${selected.prefix}, shortest AS path ${selected.asPath.join(' ') || 'local'}.`]
      if (!route.connectionId) {
        const terminalSiteId = route.sitePath.at(-1)
        const downstreamHit = downstreamVnetForAddress(topology, terminalSiteId, address)
        const downstreamVnet = downstreamHit?.spoke
        const terminalNvaSpokeId = downstreamHit?.nvaSpokeId
        return [{
          hubs: [], siteHops: route.sitePath, siteLinkIds: route.siteLinkIds,
          siteId: downstreamVnet?.id ?? terminalSiteId,
          ...(downstreamVnet && terminalNvaSpokeId ? { nvaSpokeId: terminalNvaSpokeId } : {}),
          steps: [...steps, ...(downstreamVnet ? [`Downstream VNet: ${downstreamVnet.name}.`] : [])],
          status: 'delivered', termination: 'owner',
          terminalKind: downstreamVnet ? 'spoke' : 'site', lookupPrefix: selected.prefix,
        }]
      }
      const connection = resolveAttachment(topology, route.connectionId)
      const erHub = topology.erLinks?.find((link) => link.id === route.erHubLinkId)
      const hubId = connection?.hubId ?? erHub?.hubId
      if (!connection || !hubId) return [{ hubs: [], steps: [...steps, 'The Azure attachment is unavailable.'], status: 'unreachable', termination: 'attachment-unavailable', lookupPrefix: selected.prefix }]
      return traceFlow(topology, simulation, hubId, destination).map((path) => {
        const loop = path.siteHops?.some((id) => route.sitePath.includes(id))
        return {
          ...path, sourceConnectionId: connection.id, sourceSiteHops: route.sitePath, sourceSiteLinkIds: route.siteLinkIds,
          ...(connection.kind === 'connection' && connection.spokeId ? { sourceNvaSpokeId: connection.spokeId } : {}),
          ...(erHub ? { sourceErLinkIds: [connection.id, erHub.id] } : {}),
          status: loop ? 'loop' : path.status,
          termination: loop ? 'loop' : path.termination,
          steps: [...steps, `Enter Azure via ${connection.name}${erHub ? ` → ${topology.erLocations?.find((location) => location.id === erHub.locationId)?.name} → ${erHub.name}` : ''}.`, ...path.steps, ...(loop ? ['The selected Azure route returns to the source-side site path.'] : [])],
        }
      })
    })
  })
  const complete = learned.selectionComplete && paths.length <= 128 && paths.every((path) => path.traceComplete !== false)
  return paths.slice(0, 128).map((path) => ({ ...path, traceComplete: complete }))
}
