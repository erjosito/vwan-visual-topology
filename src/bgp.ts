import type { Connection, PrependRule, RouteMapRule, Topology } from './model'
import { cidr, contains } from './validation'

export function applyRouteMap(prefix: string, asPath: number[], rules: PrependRule[]): number[] {
  const parsed = cidr(prefix)!
  const rule = rules.find((r) => !r.prefixes.length || r.prefixes.some((match) =>
    r.match === 'equals' ? prefix === match : cidr(match)!.length <= parsed.length && contains(match, parsed.network),
  ))
  return rule ? [...rule.prepend, ...asPath] : [...asPath]
}

export function connectionMapRules(topology: Topology, connection: Connection, direction: 'inbound' | 'outbound'): RouteMapRule[] {
  if (connection.transport === 'SDWAN') return []
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
}

export interface SiteRouting {
  tables: Record<string, SiteRoute[]>
  candidates: Record<string, SiteRoute[]>
  converged: boolean
}

export function propagateSites(topology: Topology): SiteRouting {
  const origins = Object.fromEntries(topology.sites.map((site) => [site.id, [
    ...site.prefixes.map((prefix) => ({ key: `${site.id}:${prefix}`, prefix, asPath: [], sitePath: [site.id], siteLinkIds: [] as string[] })),
    ...topology.connections.filter((c) => c.siteId === site.id).flatMap((c) => c.routes.filter((r) => r.kind === 'bgp').map((r) => ({
      key: `${c.id}:${r.id}`, prefix: r.prefix, asPath: r.asPath[0] === 12076 ? r.asPath.slice(1) : r.asPath, sitePath: [site.id], siteLinkIds: [] as string[],
    }))),
  ]]))
  const best = (routes: SiteRoute[]) => [...new Set(routes.map((r) => r.prefix))].flatMap((prefix) => {
    const matching = routes.filter((r) => r.prefix === prefix)
    const shortest = Math.min(...matching.map((r) => r.asPath.length))
    const unique = new Map(matching.filter((r) => r.asPath.length === shortest).map((r) => [r.key + r.sitePath.join(':'), r]))
    return [...unique.values()].slice(0, 32)
  })
  let tables = Object.fromEntries(topology.sites.map((s) => [s.id, best(origins[s.id])]))
  let candidates = origins
  const signature = (value: typeof tables) => JSON.stringify(topology.sites.map((s) =>
    value[s.id].map((r) => `${r.key}:${r.sitePath.join(':')}:${r.asPath.join(',')}`).sort(),
  ))
  let converged = topology.siteLinks.length === 0
  for (let round = 0; round < 64 && !converged; round++) {
    const nextCandidates = Object.fromEntries(topology.sites.map((receiver) => {
      const received = topology.siteLinks.filter((l) => l.enabled && (l.a === receiver.id || l.b === receiver.id)).flatMap((link) => {
        const senderId = link.a === receiver.id ? link.b : link.a
        const sender = topology.sites.find((s) => s.id === senderId)!
        const policy = link.a === senderId ? link.aToB : link.bToA
        return tables[senderId].filter((r) => !r.sitePath.includes(receiver.id)
          && !r.asPath.includes(receiver.asn)
          && (!policy.prefixes.length || policy.prefixes.includes(r.prefix))).map((r) => ({
          ...r,
          key: `${link.id}:${r.key}`,
          asPath: [...(policy.receivePrepend ?? []), ...policy.prepend, ...(r.asPath[0] === sender.asn ? r.asPath : [sender.asn, ...r.asPath])],
          sitePath: [receiver.id, ...r.sitePath],
          siteLinkIds: [link.id, ...(r.siteLinkIds ?? [])],
        })).filter((r) => !r.asPath.includes(receiver.asn))
      })
      return [receiver.id, [...origins[receiver.id], ...received]]
    }))
    const next = Object.fromEntries(topology.sites.map((site) => [site.id, best(nextCandidates[site.id])]))
    converged = signature(next) === signature(tables)
    tables = next
    candidates = nextCandidates
  }
  return { tables, candidates, converged }
}
