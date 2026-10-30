import type { Connection, PrependRule, RouteMapRule, RouterSelection, Site, SiteLink, Topology } from './model'
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
  forwardingRoutes?: RouteMapAdvertisement[]
}

export function applyRouteMapRules<T extends RouteMapAdvertisement>(routes: T[], rules: RouteMapRule[]): T[] {
  const process = (route: T, index: number): T[] => {
    if (index >= rules.length) return [route]
    const rule = rules[index]
    const parsed = cidr(route.prefix)!
    const matches = !rule.prefixes.length || rule.prefixes.some((prefix) => rule.match === 'equals'
      ? prefix === route.prefix
      : cidr(prefix)!.length <= parsed.length && contains(prefix, parsed.network))
    if (!matches) return process(route, index + 1)
    if (rule.action === 'drop') return []
    let modified = [route]
    if (rule.action === 'prepend') modified = [{ ...route, asPath: [...rule.prepend, ...route.asPath] }]
    if (rule.action === 'summarize') {
      // Only covering aggregates may replace an advertisement, never more-specific or unrelated prefixes.
      modified = rule.summaryPrefixes.filter((prefix) =>
        cidr(prefix)!.length <= parsed.length && contains(prefix, parsed.network),
      ).map((prefix) => ({ ...route, prefix, asPath: [], forwardingRoutes: route.forwardingRoutes ?? [route] }))
      if (!modified.length) modified = [route]
    }
    return rule.nextStep === 'continue' ? modified.flatMap((next) => process(next, index + 1)) : modified
  }
  const result: T[] = []
  const aggregates = new Map<string, T>()
  for (const route of routes.flatMap((route) => process({
    ...route, asPath: [...route.asPath],
    ...(route.forwardingRoutes ? { forwardingRoutes: [...route.forwardingRoutes] } : {}),
  }, 0))) {
    if (!route.forwardingRoutes) {
      result.push(route)
      continue
    }
    const key = `${route.prefix}:${route.asPath.join(',')}`
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
  forwardingRoutes?: SiteRoute[]
}

export interface SiteRouting {
  tables: Record<string, SiteRoute[]>
  candidates: Record<string, SiteRoute[]>
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

export function propagateSites(topology: Topology): SiteRouting {
  let selectionComplete = true
  const origins: Record<string, SiteRoute[]> = Object.fromEntries(topology.sites.map((site) => [site.id, [
    ...site.prefixes.map((prefix) => ({ key: `${site.id}:${prefix}`, prefix, asPath: [], sitePath: [site.id], siteLinkIds: [] as string[] })),
    ...[...topology.connections, ...(topology.erLinks ?? [])].filter((c) => c.siteId === site.id).flatMap((c) => c.routes.filter((r) => r.kind === 'bgp').map((r) => ({
      key: `${c.id}:${r.id}`, prefix: r.prefix, asPath: r.asPath[0] === 12076 ? r.asPath.slice(1) : r.asPath, sitePath: [site.id], siteLinkIds: [] as string[],
    }))),
  ]]))
  const best = (routes: SiteRoute[]) => [...new Set(routes.map((r) => r.prefix))].flatMap((prefix) => {
    const matching = routes.filter((r) => r.prefix === prefix)
    const shortest = Math.min(...matching.map((r) => r.asPath.length))
    const unique = new Map(matching.filter((r) => r.asPath.length === shortest).map((r) => [r.key + r.sitePath.join(':'), r]))
    if (unique.size > 32) selectionComplete = false
    return [...unique.values()].slice(0, 32)
  })
  let tables = Object.fromEntries(topology.sites.map((s) => [s.id, best(origins[s.id])]))
  let candidates = origins
  const signature = (value: typeof tables) => JSON.stringify(topology.sites.map((s) =>
    value[s.id].map((r) => JSON.stringify(r)).sort(),
  ))
  let converged = topology.siteLinks.length === 0
  for (let round = 0; round < 64 && !converged; round++) {
    const nextCandidates = Object.fromEntries(topology.sites.map((receiver) => {
      const received = topology.siteLinks.filter((l) => l.enabled && (l.a === receiver.id || l.b === receiver.id)).flatMap((link) => {
        const senderId = link.a === receiver.id ? link.b : link.a
        return receiveSiteRoutes(topology, receiver, link, tables[senderId])
      })
      return [receiver.id, [...origins[receiver.id], ...received]]
    }))
    const next = Object.fromEntries(topology.sites.map((site) => [site.id, best(nextCandidates[site.id])]))
    converged = signature(next) === signature(tables)
    tables = next
    candidates = nextCandidates
  }
  return { tables, candidates, converged, selectionComplete }
}
