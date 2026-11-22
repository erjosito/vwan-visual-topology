import type { Topology } from './model'
import { routingDisplayResult } from './routing-display'

export function vwanRoutingInput(topology: Topology) {
  const routing = structuredClone(topology)
  if (JSON.stringify(routing).includes('\\u0000aznet-name:')) {
    return { revision: JSON.stringify(routing), nameRevision: '[]' }
  }
  const names: string[] = []
  const name = (entity: { name: string }) => {
    entity.name = `\0aznet-name:${names.push(entity.name) - 1}\0`
  }
  const node = (entity: { name: string; label?: string }) => {
    name(entity); delete entity.label
  }
  name(routing)
  delete routing.layout
  delete routing.warningAcknowledgements
  routing.hubs.forEach(hub => {
    node(hub)
    if (hub.firewall) name(hub.firewall)
    hub.routeTables?.forEach(name)
  })
  routing.spokes.forEach(node)
  routing.sites.forEach(node)
  routing.connections.forEach(name)
  routing.siteLinks.forEach(name)
  routing.erLinks?.forEach(name)
  routing.interWanVpns?.forEach(name)
  routing.wans?.forEach(name)
  routing.routeMaps?.forEach(name)
  // ER location names can resolve SKU/region eligibility; static-route names retain route identity.
  return { revision: JSON.stringify(routing), nameRevision: JSON.stringify(names) }
}

export function vwanDisplayResult<T>(value: T, names: string[]): T {
  return names.length ? routingDisplayResult(value, names) : value
}
