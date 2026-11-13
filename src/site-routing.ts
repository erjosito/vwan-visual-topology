import type { Topology } from './model'
import type { Simulation } from './routing'
import { applyRouteMapRules, propagateSites, routerMapRules } from './bgp'
import type { SiteRoute, SiteRouting } from './bgp'

export interface SiteAdvertisement extends SiteRoute { connectionId: string; erHubLinkId?: string }

const siteRibCache = new WeakMap<Simulation, Map<string, SiteRouting<SiteAdvertisement>>>()

function sitePlaneCacheKey(topology: Topology): string {
  return JSON.stringify({
    sites: topology.sites.map((s) => [s.id, s.asn, s.prefixes, s.vpnStaticRoutes, s.routeMapAssignments]),
    siteLinks: topology.siteLinks,
    connections: topology.connections.map((c) => [c.id, c.enabled, c.siteId, c.spokeId, c.transport]),
    erLocations: (topology.erLocations ?? []).map((l) => [l.id, l.peeringLocation, l.sku, l.globalReachEnabled, l.globalReachLocationIds]),
    erLinks: (topology.erLinks ?? []).map((l) => [l.id, l.enabled, l.siteId, l.hubId, l.locationId, l.learnSiteRoutes]),
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
          const isErLink = 'locationId' in c
          const routes = simulation.outbound[c.id] ?? []
          const received = [...applyRouteMapRules(routes.filter((r) => r.kind !== 'vpn-static'), routerMapRules(topology, { kind: 'site', id: site.id }, c.id, 'inbound')), ...routes.filter((r) => r.kind === 'vpn-static')]
          const origin = (r: typeof received[number], erHubLinkId = isErLink ? r.erHubLinkId : undefined): SiteAdvertisement => ({
            key: `${c.id}:${erHubLinkId ?? ''}:${r.key}`, prefix: r.prefix, asPath: r.asPath, sitePath: [site.id], siteLinkIds: [], connectionId: c.id, erHubLinkId,
            ...(r.localPreference === undefined ? {} : { localPreference: r.localPreference }),
            ...(r.forwardingRoutes ? { forwardingRoutes: r.forwardingRoutes.map((child) => origin(child, isErLink ? (child.erHubLinkId ?? erHubLinkId) : undefined)) } : {}),
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
