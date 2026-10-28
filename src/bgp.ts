import type { PrependRule, Topology } from './model'
import { cidr, contains } from './validation'

export function applyRouteMap(prefix: string, asPath: number[], rules: PrependRule[]): number[] {
  const parsed = cidr(prefix)!
  const rule = rules.find((r) => !r.prefixes.length || r.prefixes.some((match) =>
    r.match === 'equals' ? prefix === match : cidr(match)!.length <= parsed.length && contains(match, parsed.network),
  ))
  return rule ? [...rule.prepend, ...asPath] : [...asPath]
}

export interface SiteRoute {
  key: string
  prefix: string
  asPath: number[]
  sitePath: string[]
}

export interface SiteRouting {
  tables: Record<string, SiteRoute[]>
  candidates: Record<string, SiteRoute[]>
  converged: boolean
}

export function propagateSites(topology: Topology): SiteRouting {
  const origins = Object.fromEntries(topology.sites.map((site) => [site.id, [
    ...site.prefixes.map((prefix) => ({ key: `${site.id}:${prefix}`, prefix, asPath: [], sitePath: [site.id] })),
    ...topology.connections.filter((c) => c.siteId === site.id).flatMap((c) => c.routes.filter((r) => r.kind === 'bgp').map((r) => ({
      key: `${c.id}:${r.id}`, prefix: r.prefix, asPath: r.asPath[0] === 12076 ? r.asPath.slice(1) : r.asPath, sitePath: [site.id],
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
