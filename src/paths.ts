import type { ObjectSelection, Topology } from './model'
import { topologyObject } from './model'
import type { FlowPath, Simulation } from './routing'
import { traceFlow } from './routing'
import { applyRouteMapRules, receiveSiteRoutes, routerMapRules } from './bgp'
import type { SiteRoute } from './bgp'
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

export function azureRoutesAtSites(topology: Topology, simulation: Simulation) {
  let selectionComplete = simulation.siteSelectionComplete !== false
  const advertisement = (route: SiteRoute, connectionId: string): SiteAdvertisement => ({
    ...route, connectionId,
    ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map((child) => advertisement(child, connectionId)) } : {}),
  })
  const best = (routes: SiteAdvertisement[]) => [...new Set(routes.map((r) => r.prefix))].flatMap((prefix) => {
    const matches = routes.filter((r) => r.prefix === prefix)
    const shortest = Math.min(...matches.map((r) => r.asPath.length))
    if (matches.filter((r) => r.asPath.length === shortest).length > 32) selectionComplete = false
    return matches.filter((r) => r.asPath.length === shortest).sort((a, b) => a.key.localeCompare(b.key)).slice(0, 32)
  })
  const origins = Object.fromEntries(topology.sites.map((site) => [site.id, [
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
  ]]))
  let tables = Object.fromEntries(topology.sites.map((s) => [s.id, best(origins[s.id])]))
  let candidates = origins
  let converged = topology.siteLinks.length === 0
  for (let round = 0; round < 64 && !converged; round++) {
    const next = Object.fromEntries(topology.sites.map((receiver) => {
      const received = topology.siteLinks.filter((l) => l.enabled && (l.a === receiver.id || l.b === receiver.id)).flatMap((link) => {
        const senderId = link.a === receiver.id ? link.b : link.a
        return receiveSiteRoutes(topology, receiver, link, tables[senderId])
      })
      return [receiver.id, [...origins[receiver.id], ...received]]
    }))
    const selected = Object.fromEntries(topology.sites.map((site) => [site.id, best(next[site.id])]))
    converged = JSON.stringify(selected) === JSON.stringify(tables)
    tables = selected
    candidates = next
  }
  return { tables, candidates, converged, selectionComplete }
}

export function traceGroupedPaths(topology: Topology, simulation: Simulation, anchor: PathNode, direction: PathDirection, group: PathGroup): GroupPath[] {
  const object = topologyObject(topology, anchor)
  if (!simulation.converged || !object) return []
  const nvaSiteIds = new Set(topology.connections.filter((c) => c.transport === 'SpokeNVA' && c.spokeId).map((c) => c.siteId))
  const nodes = [
    ...(group !== 'sites' ? topology.spokes.map((spoke) => ({ ...spoke, kind: 'spoke' as const })) : []),
    ...(group !== 'vnets' ? topology.sites.filter((site) => !nvaSiteIds.has(site.id)).map((site) => ({ ...site, kind: 'site' as const })) : []),
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
        const terminalNvaSpokeId = topology.connections.find((c) => c.transport === 'SpokeNVA' && c.siteId === terminalSiteId && c.spokeId)?.spokeId
        const downstreamVnet = terminalNvaSpokeId
          ? topology.spokes.find((s) => s.nvaSpokeIds?.includes(terminalNvaSpokeId) && s.prefixes.some((p) => contains(p, address)))
          : undefined
        return [{
          hubs: [], siteHops: route.sitePath, siteLinkIds: route.siteLinkIds,
          siteId: downstreamVnet?.id ?? terminalSiteId,
          ...(downstreamVnet && terminalNvaSpokeId ? { nvaSpokeId: terminalNvaSpokeId } : {}),
          steps: [...steps, ...(downstreamVnet ? [`Downstream VNet: ${downstreamVnet.name}.`] : [])],
          status: 'delivered', termination: 'owner',
          terminalKind: downstreamVnet ? 'spoke' : 'site', lookupPrefix: selected.prefix,
        }]
      }
      const connection = topology.connections.find((c) => c.id === route.connectionId) ?? topology.erLinks?.find((link) => link.id === route.connectionId)
      const erHub = topology.erLinks?.find((link) => link.id === route.erHubLinkId)
      const hubId = connection?.hubId ?? erHub?.hubId
      if (!connection || !hubId) return [{ hubs: [], steps: [...steps, 'The Azure attachment is unavailable.'], status: 'unreachable', termination: 'attachment-unavailable', lookupPrefix: selected.prefix }]
      return traceFlow(topology, simulation, hubId, destination).map((path) => {
        const loop = path.siteHops?.some((id) => route.sitePath.includes(id))
        return {
          ...path, sourceConnectionId: connection.id, sourceSiteHops: route.sitePath, sourceSiteLinkIds: route.siteLinkIds,
          ...('spokeId' in connection && connection.spokeId ? { sourceNvaSpokeId: connection.spokeId } : {}),
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
