import type { ObjectSelection, Topology } from './model'
import type { FlowPath, Simulation } from './routing'
import { traceFlow } from './routing'
import { cidr, contains, ipv4 } from './validation'

export type PathNode = ObjectSelection & { kind: 'hub' | 'spoke' | 'site' }
export interface NodePath extends FlowPath { sourceConnectionId?: string; sourceSiteHops?: string[]; sourceSiteLinkIds?: string[] }

export function nodePrefixes(topology: Topology, node: PathNode): string[] {
  if (node.kind === 'spoke') return topology.spokes.find((s) => s.id === node.id)?.prefixes ?? []
  if (node.kind === 'hub') return topology.spokes.filter((s) => s.hubId === node.id).flatMap((s) => s.prefixes)
  const site = topology.sites.find((s) => s.id === node.id)
  return site?.prefixes.length ? site.prefixes : [...new Set(topology.connections.filter((c) => c.siteId === node.id).flatMap((c) => c.routes.map((r) => r.prefix)))]
}

interface SiteAdvertisement {
  key: string; prefix: string; asPath: number[]; sitePath: string[]; siteLinkIds: string[]; connectionId: string
}

function azureRoutesAtSites(topology: Topology, simulation: Simulation) {
  const best = (routes: SiteAdvertisement[]) => [...new Set(routes.map((r) => r.prefix))].flatMap((prefix) => {
    const matches = routes.filter((r) => r.prefix === prefix)
    const shortest = Math.min(...matches.map((r) => r.asPath.length))
    return matches.filter((r) => r.asPath.length === shortest).sort((a, b) => a.key.localeCompare(b.key)).slice(0, 32)
  })
  const origins = Object.fromEntries(topology.sites.map((site) => [site.id, [
    ...(simulation.siteCandidates[site.id] ?? []).filter((r) => r.sitePath.length === 1).map((r) => ({ ...r, siteLinkIds: [], connectionId: '' })),
    ...topology.connections.filter((c) => c.enabled && c.siteId === site.id)
      .flatMap((c) => (simulation.outbound[c.id] ?? []).filter((r) => !r.asPath.includes(site.asn)).map((r) => ({
        key: `${c.id}:${r.key}`, prefix: r.prefix, asPath: r.asPath, sitePath: [site.id], siteLinkIds: [], connectionId: c.id,
      }))),
  ]]))
  let tables = Object.fromEntries(topology.sites.map((s) => [s.id, best(origins[s.id])]))
  let converged = topology.siteLinks.length === 0
  for (let round = 0; round < 64 && !converged; round++) {
    const next = Object.fromEntries(topology.sites.map((receiver) => {
      const received = topology.siteLinks.filter((l) => l.enabled && (l.a === receiver.id || l.b === receiver.id)).flatMap((link) => {
        const senderId = link.a === receiver.id ? link.b : link.a
        const sender = topology.sites.find((s) => s.id === senderId)!
        const policy = link.a === senderId ? link.aToB : link.bToA
        return tables[senderId].filter((r) => !r.sitePath.includes(receiver.id) && (!policy.prefixes.length || policy.prefixes.includes(r.prefix)))
          .map((r) => ({
            ...r, key: `${link.id}:${r.key}`, sitePath: [receiver.id, ...r.sitePath], siteLinkIds: [link.id, ...r.siteLinkIds],
            asPath: [...(policy.receivePrepend ?? []), ...policy.prepend, sender.asn, ...r.asPath],
          })).filter((r) => !r.asPath.includes(receiver.asn))
      })
      return [receiver.id, best([...origins[receiver.id], ...received])]
    }))
    converged = JSON.stringify(next) === JSON.stringify(tables)
    tables = next
  }
  return { tables, converged }
}

export function traceNodePath(topology: Topology, simulation: Simulation, source: PathNode, destination: string): NodePath[] {
  const address = ipv4(destination)
  if (address === undefined || !simulation.converged) return []
  if (source.kind !== 'site') {
    const spoke = source.kind === 'spoke' ? topology.spokes.find((s) => s.id === source.id) : undefined
    if (spoke?.prefixes.some((prefix) => contains(prefix, address))) return [{
      hubs: [], siteId: spoke.id, steps: ['Destination is within the source spoke; no Virtual WAN hop is required.'], status: 'delivered',
    }]
    const hubId = source.kind === 'hub' ? source.id : spoke?.hubId
    return hubId ? traceFlow(topology, simulation, hubId, destination) : []
  }
  const learned = azureRoutesAtSites(topology, simulation)
  if (!learned.converged) return [{ hubs: [], steps: ['On-premises Azure advertisement propagation did not converge.'], status: 'unreachable' }]
  const routes = (learned.tables[source.id] ?? []).filter((r) => contains(r.prefix, address))
  const longest = Math.max(...routes.map((r) => cidr(r.prefix)!.length))
  const matches = routes.filter((r) => cidr(r.prefix)!.length === longest)
  const shortest = Math.min(...matches.map((r) => r.asPath.length))
  const preferred = matches.filter((r) => r.asPath.length === shortest).slice(0, 32)
  if (!preferred.length) return [{ hubs: [], steps: ['No BGP route at the source site. Azure routes must be advertised on a supported connection; SD-WAN outbound learning is not modeled.'], status: 'unreachable' }]
  return preferred.flatMap((route): NodePath[] => {
    const steps = [`Source site: longest prefix ${route.prefix}, shortest AS path ${route.asPath.join(' ') || 'local'}.`]
    if (!route.connectionId) return [{ hubs: [], siteHops: route.sitePath, siteLinkIds: route.siteLinkIds, siteId: route.sitePath.at(-1), steps, status: 'delivered' }]
    const connection = topology.connections.find((c) => c.id === route.connectionId)!
    return traceFlow(topology, simulation, connection.hubId, destination).map((path) => {
      const loop = path.siteHops?.some((id) => route.sitePath.includes(id))
      return {
        ...path, sourceConnectionId: connection.id, sourceSiteHops: route.sitePath, sourceSiteLinkIds: route.siteLinkIds,
        status: loop ? 'loop' : path.status,
        steps: [...steps, `Enter Azure via ${connection.name}.`, ...path.steps, ...(loop ? ['The selected Azure route returns to the source-side site path.'] : [])],
      }
    })
  }).slice(0, 128)
}
