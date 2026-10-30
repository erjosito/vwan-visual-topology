import type { ObjectSelection, Topology } from './model'
import { topologyObject } from './model'

export interface LinkIsolation {
  linkId: string
  linkName: string
  object?: ObjectSelection
  endpoints: [ObjectSelection, ObjectSelection]
  groups: [ObjectSelection[], ObjectSelection[]]
}

export function isolationLinkName(topology: Topology, isolation: LinkIsolation): string {
  return isolation.object ? topologyObject(topology, isolation.object)?.name ?? isolation.linkName
    : isolation.endpoints.map((node) => topologyObject(topology, node)?.name ?? node.id).join(' ↔ ')
}

export function singleLinkIsolation(topology: Topology): LinkIsolation[] {
  const nodes = new Map<string, ObjectSelection>([
    ...topology.hubs.map(({ id }) => [id, { kind: 'hub', id }] as const),
    ...topology.spokes.map(({ id }) => [id, { kind: 'spoke', id }] as const),
    ...topology.sites.map(({ id }) => [id, { kind: 'site', id }] as const),
    ...(topology.erLocations ?? []).map(({ id }) => [id, { kind: 'erLocation', id }] as const),
  ])
  const edges = [
    ...topology.connections.filter((link) => link.enabled).map((link) => ({ a: link.hubId, b: link.siteId, linkId: link.id, linkName: link.name, object: { kind: 'connection' as const, id: link.id } })),
    ...topology.siteLinks.filter((link) => link.enabled).map((link) => ({ a: link.a, b: link.b, linkId: link.id, linkName: link.name, object: { kind: 'siteLink' as const, id: link.id } })),
    ...(topology.erLinks ?? []).filter((link) => link.enabled).map((link) => ({ a: link.hubId ?? link.siteId!, b: link.locationId, linkId: link.id, linkName: link.name, object: { kind: 'erLink' as const, id: link.id } })),
    ...topology.spokes.map((spoke) => ({ a: spoke.id, b: spoke.hubId, linkId: spoke.id, linkName: spoke.name, object: { kind: 'spoke' as const, id: spoke.id } })),
    ...topology.hubs.flatMap((hub, i) => topology.hubs.slice(i + 1).map((other) => ({ a: hub.id, b: other.id, linkId: `interhub:${[hub.id, other.id].sort().join(':')}`, linkName: `${hub.name} ↔ ${other.name}`, object: undefined }))),
  ].filter((edge) => nodes.has(edge.a) && nodes.has(edge.b))
  const adjacent = new Map([...nodes.keys()].map((id) => [id, [] as number[]]))
  edges.forEach((edge, index) => { adjacent.get(edge.a)!.push(index); adjacent.get(edge.b)!.push(index) })
  const visited = new Map<string, number>(), low = new Map<string, number>(), bridges: number[] = []
  const visit = (node: string, parentEdge = -1) => {
    visited.set(node, visited.size); low.set(node, visited.get(node)!)
    for (const index of adjacent.get(node)!) {
      if (index === parentEdge) continue
      const edge = edges[index], next = edge.a === node ? edge.b : edge.a
      if (!visited.has(next)) {
        visit(next, index)
        low.set(node, Math.min(low.get(node)!, low.get(next)!))
        if (low.get(next)! > visited.get(node)!) bridges.push(index)
      } else low.set(node, Math.min(low.get(node)!, visited.get(next)!))
    }
  }
  for (const id of nodes.keys()) if (!visited.has(id)) visit(id)
  const component = (start: string, excluded: number) => {
    const found = new Set([start]), pending = [start]
    while (pending.length) {
      const node = pending.pop()!
      for (const index of adjacent.get(node)!) {
        if (index === excluded) continue
        const edge = edges[index], next = edge.a === node ? edge.b : edge.a
        if (!found.has(next)) { found.add(next); pending.push(next) }
      }
    }
    return [...found].sort().map((id) => nodes.get(id)!)
  }
  return bridges.map((index): LinkIsolation => {
    const { linkId, linkName, object, a, b } = edges[index]
    return { linkId, linkName, object, endpoints: [nodes.get(a)!, nodes.get(b)!], groups: [component(a, index), component(b, index)] }
  })
}
