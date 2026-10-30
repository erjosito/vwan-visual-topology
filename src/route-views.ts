import type { ObjectSelection, RouterSelection, Topology } from './model'
import type { Candidate, Simulation } from './routing'
import type { SiteRoute } from './bgp'
import { advertiseSiteRoutes, applyRouteMapRules, receiveSiteRoutes, routerMapRules } from './bgp'
import { azureRoutesAtSites } from './paths'

export type RouteMode = 'bgp' | 'learned' | 'advertised'
export type RouteStage = 'before' | 'after'
export interface NeighborRoutes {
  id: string
  name: string
  before: (Candidate | SiteRoute)[]
  after: (Candidate | SiteRoute)[]
}

export function neighborRoutes(topology: Topology, simulation: Simulation, router: ObjectSelection,
  mode: Exclude<RouteMode, 'bgp'>, sites?: ReturnType<typeof azureRoutesAtSites>): NeighborRoutes[] {
  const direction = mode === 'learned' ? 'inbound' : 'outbound'
  const snapshot = (owner: RouterSelection, connectionId: string, direction: 'inbound' | 'outbound') =>
    simulation.routePolicies.find((policy) => policy.router.kind === owner.kind && policy.router.id === owner.id
      && policy.connectionId === connectionId && policy.direction === direction)
  const incoming = (connectionId: string): Pick<NeighborRoutes, 'before' | 'after'> => {
    const before = simulation.outbound[connectionId] ?? []
    const site = topology.sites.find((site) => site.id === router.id)!
    const after = [
      ...applyRouteMapRules(before.filter((route) => route.kind !== 'vpn-static'),
        routerMapRules(topology, { kind: 'site', id: site.id }, connectionId, 'inbound')),
      ...before.filter((route) => route.kind === 'vpn-static'),
    ].filter((route) => !route.asPath.includes(site.asn))
    return { before, after }
  }
  if (router.kind === 'erLocation') return (topology.erLinks ?? []).filter((link) => link.locationId === router.id).map((link) => {
    const owner: RouterSelection = link.hubId ? { kind: 'hub', id: link.hubId } : { kind: 'site', id: link.siteId! }
    const name = (owner.kind === 'hub' ? topology.hubs : topology.sites).find((node) => node.id === owner.id)?.name
    const routes = !link.enabled ? [] : mode === 'learned'
      ? snapshot(owner, link.id, 'outbound')?.after ?? []
      : link.hubId ? snapshot(owner, link.id, 'inbound')?.before ?? [] : simulation.outbound[link.id] ?? []
    return { id: link.id, name: `${name} · ${link.name}${link.enabled ? '' : ' (down)'}`, before: routes, after: routes }
  })
  if (router.kind !== 'hub' && router.kind !== 'site') return []
  const owner: RouterSelection = { kind: router.kind, id: router.id }
  const peers: NeighborRoutes[] = [
    ...topology.connections.filter((connection) => router.kind === 'hub' ? connection.hubId === router.id : connection.siteId === router.id)
      .map((connection) => {
        const neighbor = router.kind === 'hub' ? topology.sites.find((site) => site.id === connection.siteId)
          : topology.hubs.find((hub) => hub.id === connection.hubId)
        const routes = !connection.enabled ? { before: [], after: [] } : router.kind === 'site' && mode === 'learned'
          ? incoming(connection.id) : snapshot(owner, connection.id, direction) ?? { before: [], after: [] }
        return { id: connection.id, name: `${neighbor?.name} · ${connection.name}${connection.enabled ? '' : ' (down)'}`,
          before: routes.before.filter((route) => !(router.kind === 'hub' && mode === 'learned' && 'kind' in route && route.kind === 'vpn-static')),
          after: routes.after.filter((route) => !(router.kind === 'hub' && mode === 'learned' && 'kind' in route && route.kind === 'vpn-static')) }
      }),
    ...(topology.erLinks ?? []).filter((link) => router.kind === 'hub' ? link.hubId === router.id : link.siteId === router.id)
      .map((link) => {
        const location = topology.erLocations?.find((location) => location.id === link.locationId)
        const routes = !link.enabled ? { before: [], after: [] } : router.kind === 'site' && mode === 'learned'
          ? incoming(link.id) : snapshot(owner, link.id, direction) ?? { before: [], after: [] }
        return { id: link.id, name: `${location?.name} · ${link.name}${link.enabled ? '' : ' (down)'}`, before: routes.before, after: routes.after }
      }),
  ]
  if (router.kind === 'hub') {
    for (const neighbor of topology.hubs.filter((hub) => hub.id !== router.id)) {
      const routes = mode === 'learned'
        ? (simulation.bgpTables[router.id] ?? []).flatMap((decision) => decision.candidates)
          .filter((route) => route.remote && route.originHubId === neighbor.id)
        : (simulation.bgpTables[router.id] ?? []).flatMap((decision) => decision.selected)
          .filter((route) => !route.remote && route.prefix !== '0.0.0.0/0' && route.kind !== 'policy')
      peers.push({ id: `interhub:${neighbor.id}`, name: `${neighbor.name} · inter-hub`, before: routes, after: routes })
    }
  } else {
    const site = topology.sites.find((site) => site.id === router.id)!
    const routing = sites ?? azureRoutesAtSites(topology, simulation)
    for (const link of topology.siteLinks.filter((link) => link.a === site.id || link.b === site.id)) {
      const neighbor = topology.sites.find((node) => node.id === (link.a === site.id ? link.b : link.a))!
      const routes = (stage: RouteStage) => !link.enabled ? [] : mode === 'learned'
        ? receiveSiteRoutes(topology, site, link, routing.tables[neighbor.id] ?? [], true, stage)
        : advertiseSiteRoutes(topology, neighbor, link, routing.tables[site.id] ?? [], true, stage)
      peers.push({ id: link.id, name: `${neighbor.name} · ${link.name}${link.enabled ? '' : ' (down)'}`,
        before: routes('before'), after: routes('after') })
    }
  }
  return peers
}
