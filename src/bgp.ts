import type { Connection, PrependRule, RouteMapRule, RouterSelection, Site, SiteLink, Topology } from './model'
import { downstreamSpokesForNvaSite } from './topology-graph'
import { cidr, contains } from './validation'

export function applyRouteMap(prefix: string, asPath: number[], rules: PrependRule[]): number[] {
  const parsed = cidr(prefix)!
  const rule = rules.find((r) => !r.prefixes.length || r.prefixes.some((match) =>
    r.match === 'equals' ? prefix === match : cidr(match)!.length <= parsed.length && contains(match, parsed.network),
  ))
  return rule ? [...rule.prepend, ...asPath] : [...asPath]
}

export function connectionMapRules(topology: Topology, connection: Connection, direction: 'inbound' | 'outbound'): RouteMapRule[] {
  return routerMapRules(topology, { kind: 'hub', id: connection.hubId }, connection.id, direction)
}

export function routerMapRules(topology: Topology, router: RouterSelection, connectionId: string, direction: 'inbound' | 'outbound'): RouteMapRule[] {
  const node = (router.kind === 'hub' ? topology.hubs : topology.sites).find((node) => node.id === router.id)
  const assignment = node?.routeMapAssignments?.find((a) => a.connectionId === connectionId)
  const connection = topology.connections.find((c) => c.id === connectionId)
  if (router.kind === 'hub' && connection?.transport === 'SDWAN') return []
  const assigned = assignment?.[`${direction}MapId`]
  if (assigned !== undefined) return topology.routeMaps?.find((map) => map.id === assigned && (router.kind === 'hub' ? map.hubId : map.siteId) === router.id)?.rules ?? []
  if (router.kind !== 'hub' || !connection) return []
  const reference = connection[`${direction}MapId`]
  if (reference !== undefined) {
    return topology.routeMaps?.find((map) => map.id === reference && map.hubId === connection.hubId)?.rules ?? []
  }
  return connection[direction].map((rule) => ({
    ...rule, action: 'prepend', summaryPrefixes: [], nextStep: 'terminate',
  }))
}

export interface RouteMapAdvertisement {
  prefix: string
  asPath: number[]
  communities?: string[]
  forwardingRoutes?: RouteMapAdvertisement[]
}

export const azureReservedCommunities = new Set([
  '65517:12001', '65517:12002', '65517:12003', '65517:12005', '65517:12006',
  '65518:65518', '65517:65517', '65517:12076', '65518:12076', '65515:10000', '65515:20000',
])

export function applyRouteMapRules<T extends RouteMapAdvertisement>(routes: T[], rules: RouteMapRule[]): T[] {
  const process = (route: T, index: number): T[] => {
    if (index >= rules.length) return [route]
    const rule = rules[index]
    const parsed = cidr(route.prefix)!
    const matchesPrefix = !rule.prefixes.length || rule.prefixes.some((prefix) => rule.match === 'equals'
      ? prefix === route.prefix
      : cidr(prefix)!.length <= parsed.length && contains(prefix, parsed.network))
    const matches = matchesPrefix && (rule.matchConditions ?? []).every((condition) => {
      if (condition.property === 'prefix') return condition.values.some((prefix) => condition.match === 'equals'
        ? prefix === route.prefix : cidr(prefix)!.length <= parsed.length && contains(prefix, parsed.network))
      if (condition.property === 'asPath') return condition.match === 'equals'
        ? condition.values.length === route.asPath.length && condition.values.every((asn, index) => Number(asn) === route.asPath[index])
        : condition.values.some((asn) => route.asPath.includes(Number(asn)))
      return condition.match === 'equals'
        ? condition.values.every((community) => route.communities?.includes(community))
        : condition.values.some((community) => route.communities?.includes(community))
    })
    if (!matches) return process(route, index + 1)
    if (rule.action === 'drop') return []
    let modified = [route]
    for (const action of ['replace', 'add', 'remove'] as const) {
      if (action === 'add' && rule.action === 'prepend') modified = modified.map((route) => ({ ...route, asPath: [...rule.prepend, ...route.asPath] }))
      const modifications = (rule.modifications ?? []).filter((modification) => modification.action === action)
        .sort((a, b) => JSON.stringify([a.property, a.action, a.values]).localeCompare(JSON.stringify([b.property, b.action, b.values])))
      for (const modification of modifications) {
        modified = modified.map((route) => {
          if (modification.property === 'asPath') {
            const values = modification.values.map(Number)
            return { ...route, asPath: action === 'replace' ? values : [...values, ...route.asPath] }
          }
          const reserved = (route.communities ?? []).filter((community) => azureReservedCommunities.has(community))
          const communities = action === 'replace' ? modification.values
            : action === 'add' ? [...(route.communities ?? []), ...modification.values]
              : (route.communities ?? []).filter((community) => !modification.values.includes(community))
          return { ...route, communities: [...new Set([...reserved, ...communities])] }
        })
      }
    }
    if (rule.action === 'summarize') {
      const attributeModified = modified
      // Only covering aggregates may replace an advertisement, never more-specific or unrelated prefixes.
      modified = rule.summaryPrefixes.filter((prefix) =>
        cidr(prefix)!.length <= parsed.length && contains(prefix, parsed.network),
      ).map((prefix) => ({ ...route, prefix, asPath: [],
        ...(route.communities !== undefined || rule.modifications?.some((modification) => modification.property === 'community') ? { communities: [] } : {}),
        forwardingRoutes: route.forwardingRoutes ?? [route] }))
      if (!modified.length) modified = attributeModified
    }
    return rule.nextStep === 'continue' ? modified.flatMap((next) => process(next, index + 1)) : modified
  }
  const result: T[] = []
  const aggregates = new Map<string, T>()
  for (const route of routes.flatMap((route) => process({
    ...route, asPath: [...route.asPath],
    ...(route.communities ? { communities: [...route.communities] } : {}),
    ...(route.forwardingRoutes ? { forwardingRoutes: [...route.forwardingRoutes] } : {}),
  }, 0))) {
    if (!route.forwardingRoutes) {
      result.push(route)
      continue
    }
    const key = `${route.prefix}:${route.asPath.join(',')}:${[...(route.communities ?? [])].sort().join(',')}`
    const existing = aggregates.get(key)
    if (existing) existing.forwardingRoutes = [...new Set([...existing.forwardingRoutes!, ...route.forwardingRoutes])]
    else {
      aggregates.set(key, route)
      result.push(route)
    }
  }
  return result
}

export interface SiteRoute {
  key: string
  prefix: string
  asPath: number[]
  sitePath: string[]
  siteLinkIds?: string[]
  erLinkIds?: string[]
  forwardingRoutes?: SiteRoute[]
}

export function areErLocationsGlobalReachLinked(topology: Topology, locAId: string, locBId: string): boolean {
  if (locAId === locBId) {
    return Boolean(topology.erLocations?.find((l) => l.id === locAId)?.globalReachEnabled)
  }
  const locA = topology.erLocations?.find((l) => l.id === locAId)
  const locB = topology.erLocations?.find((l) => l.id === locBId)
  return Boolean(
    locA && locB && (
      locA.globalReachLocationIds?.includes(locBId) ||
      locB.globalReachLocationIds?.includes(locAId)
    ),
  )
}

export interface SiteRouting<T extends SiteRoute = SiteRoute> {
  tables: Record<string, T[]>
  candidates: Record<string, T[]>
  converged: boolean
  selectionComplete: boolean
}

export function siteExports<T extends RouteMapAdvertisement>(topology: Topology, siteId: string, connectionId: string, routes: T[]): T[] {
  const rules = routerMapRules(topology, { kind: 'site', id: siteId }, connectionId, 'outbound')
  if (!rules.length) return routes
  const asn = topology.sites.find((site) => site.id === siteId)!.asn
  return applyRouteMapRules(routes, rules)
    .map((route) => ({ ...route, asPath: route.asPath.length && (!route.forwardingRoutes || route.asPath.includes(asn)) ? route.asPath : [asn, ...route.asPath] }))
}

export function advertiseSiteRoutes<T extends SiteRoute>(topology: Topology, receiver: Site, link: SiteLink, routes: T[], _repeatOriginAsn = false, stage: 'before' | 'after' = 'after'): T[] {
  const senderId = link.a === receiver.id ? link.b : link.a
  const sender = topology.sites.find((site) => site.id === senderId)!
  const policy = link.a === senderId ? link.aToB : link.bToA
  const transit = (route: T): T => ({
    ...route, key: `${link.id}:${route.key}`,
    // Both site planes contain already-normalized local origins; Azure-learned paths still need the sender ASN.
    asPath: [...policy.prepend, ...(route.asPath[0] === sender.asn ? route.asPath : [sender.asn, ...route.asPath])],
    sitePath: [receiver.id, ...route.sitePath], siteLinkIds: [link.id, ...(route.siteLinkIds ?? [])],
    ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map((child) => transit(child as T)) } : {}),
  })
  const eligible = routes.filter((route) => !route.sitePath.includes(receiver.id)
    && !route.asPath.includes(receiver.asn) && (!policy.prefixes.length || policy.prefixes.includes(route.prefix))).map(transit)
  return stage === 'before' ? eligible : siteExports(topology, senderId, link.id, eligible)
}

export function receiveSiteRoutes<T extends SiteRoute>(topology: Topology, receiver: Site, link: SiteLink, routes: T[], repeatOriginAsn = false, stage: 'before' | 'after' = 'after'): T[] {
  const policy = link.a === receiver.id ? link.bToA : link.aToB
  const exported = advertiseSiteRoutes(topology, receiver, link, routes, repeatOriginAsn)
  const received = exported.map((route) => ({ ...route, asPath: [...(policy.receivePrepend ?? []), ...route.asPath] }))
  if (stage === 'before') return received
  return applyRouteMapRules(received, routerMapRules(topology, { kind: 'site', id: receiver.id }, link.id, 'inbound'))
    .filter((route) => !route.asPath.includes(receiver.asn))
}

export function propagateSites<T extends SiteRoute = SiteRoute>(
  topology: Topology,
  options?: {
    seed?: (site: Site) => T[]
    rank?: (route: T) => number
    sortByKey?: boolean
  },
): SiteRouting<T> {
  let selectionComplete = true
  const defaultSeed = (site: Site): T[] => {
    const downstreamVnetRoutes = downstreamSpokesForNvaSite(topology, site.id).flatMap((spoke) =>
      spoke.prefixes.map((prefix) => ({
        key: `${spoke.id}:${prefix}`,
        prefix,
        asPath: [] as number[],
        sitePath: [site.id],
        siteLinkIds: [] as string[],
      })),
    )
    return [
      ...site.prefixes.map((prefix) => ({ key: `${site.id}:${prefix}`, prefix, asPath: [] as number[], sitePath: [site.id], siteLinkIds: [] as string[] })),
      ...downstreamVnetRoutes,
    ] as T[]
  }
  const seed = options?.seed ?? defaultSeed
  const rank = options?.rank
  const origins: Record<string, T[]> = Object.fromEntries(topology.sites.map((site) => [site.id, seed(site)]))
  const best = (routes: T[]) => [...new Set(routes.map((r) => r.prefix))].flatMap((prefix) => {
    const matching = routes.filter((r) => r.prefix === prefix)
    const preferred = rank
      ? (() => {
          const minRank = Math.min(...matching.map(rank))
          return matching.filter((r) => rank(r) === minRank)
        })()
      : matching
    const shortest = Math.min(...preferred.map((r) => r.asPath.length))
    const shortestMatches = preferred.filter((r) => r.asPath.length === shortest)
    if (options?.sortByKey) {
      if (shortestMatches.length > 32) selectionComplete = false
      return [...shortestMatches].sort((a, b) => a.key.localeCompare(b.key)).slice(0, 32)
    }
    const unique = new Map(shortestMatches.map((r) => [r.key + r.sitePath.join(':'), r]))
    if (unique.size > 32) selectionComplete = false
    return [...unique.values()].slice(0, 32)
  })
  let tables = Object.fromEntries(topology.sites.map((s) => [s.id, best(origins[s.id])]))
  let candidates = origins
  const signature = (value: typeof tables) => JSON.stringify(topology.sites.map((s) =>
    value[s.id].map((r) => JSON.stringify(r)).sort(),
  ))
  const erSiteLinks = (topology.erLinks ?? []).filter((l) => l.enabled && Boolean(l.siteId))
  const hasGlobalReach = erSiteLinks.some((a, index) =>
    erSiteLinks.slice(index + 1).some((b) => a.siteId !== b.siteId && areErLocationsGlobalReachLinked(topology, a.locationId, b.locationId)),
  )
  let converged = topology.siteLinks.length === 0 && !hasGlobalReach
  for (let round = 0; round < 64 && !converged; round++) {
    const nextCandidates = Object.fromEntries(topology.sites.map((receiver) => {
      const receivedFromSiteLinks = topology.siteLinks.filter((l) => l.enabled && (l.a === receiver.id || l.b === receiver.id)).flatMap((link) => {
        const senderId = link.a === receiver.id ? link.b : link.a
        return receiveSiteRoutes(topology, receiver, link, tables[senderId])
      })
      const receivedFromGlobalReach = !hasGlobalReach ? [] : erSiteLinks
        .filter((l) => l.siteId === receiver.id)
        .flatMap((receiverErLink) =>
          erSiteLinks
            .filter((l) => l.siteId !== receiver.id && areErLocationsGlobalReachLinked(topology, receiverErLink.locationId, l.locationId))
            .flatMap((senderErLink) => {
              const senderId = senderErLink.siteId!
              const sender = topology.sites.find((s) => s.id === senderId)!
              const transit = (route: T): T => ({
                ...route,
                key: `gr:${receiverErLink.id}:${senderErLink.id}:${route.key}`,
                asPath: route.asPath[0] === sender.asn ? route.asPath : [sender.asn, ...route.asPath],
                sitePath: [receiver.id, ...route.sitePath],
                erLinkIds: [receiverErLink.id, senderErLink.id, ...(route.erLinkIds ?? [])],
                ...(route.forwardingRoutes ? { forwardingRoutes: route.forwardingRoutes.map((child) => transit(child as T)) } : {}),
              })
              const eligible = tables[senderId]
                .filter((route) => !route.sitePath.includes(receiver.id) && !route.asPath.includes(receiver.asn) && !route.asPath.includes(12076))
                .map(transit)
              const exported = siteExports(topology, senderId, senderErLink.id, eligible).map((route) => ({
                ...route,
                asPath: [12076, ...route.asPath],
              }))
              return applyRouteMapRules(exported, routerMapRules(topology, { kind: 'site', id: receiver.id }, receiverErLink.id, 'inbound'))
                .filter((route) => !route.asPath.includes(receiver.asn))
            }),
        )
      return [receiver.id, [...origins[receiver.id], ...receivedFromSiteLinks, ...receivedFromGlobalReach]]
    }))
    const next = Object.fromEntries(topology.sites.map((site) => [site.id, best(nextCandidates[site.id])]))
    converged = signature(next) === signature(tables)
    tables = next
    candidates = nextCandidates
  }
  return { tables, candidates, converged, selectionComplete }
}
