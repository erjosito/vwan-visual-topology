import { cloneAzNetTopology, type AzNetTopology } from './model'

const infrastructureSubnets = new Set(['GatewaySubnet', 'AzureFirewallSubnet', 'RouteServerSubnet', 'VirtualNetworkApplianceSubnet'])
const tokenPattern = /(.)aznet-name:(\d+)(.)/gs

/**
 * Routing runs against stable display tokens. Rebinding the resulting plain data to current
 * names avoids both rerouting on rename and stale prose in cached routes/diagnostics/traces.
 * Infrastructure subnet names and inferred ER locations are routing inputs, not decoration.
 */
export function azRoutingInput(topology: AzNetTopology) {
  const routing = cloneAzNetTopology(topology)
  const names: string[] = []
  const name = (entity: { name: string }) => {
    const index = names.push(entity.name) - 1
    entity.name = `\0aznet-name:${index}\0`
  }
  const node = (entity: { name: string; label?: string; x?: number; y?: number }) => {
    name(entity)
    delete entity.label; delete entity.x; delete entity.y
  }
  name(routing)
  delete routing.subtitle
  delete routing.layout
  for (const vnet of routing.vnets) {
    node(vnet)
    for (const subnet of vnet.subnets) {
      if (!infrastructureSubnets.has(subnet.name)) name(subnet)
      for (const endpoint of subnet.privateEndpoints ?? []) name(endpoint)
    }
    vnet.gateways.forEach(name)
    vnet.appliances.forEach(name)
    if (vnet.routeServer) {
      name(vnet.routeServer)
      vnet.routeServer.routeMaps?.forEach(name)
    }
  }
  routing.vwanHubs.forEach(node)
  for (const location of routing.erLocations) {
    location.peeringLocation ??= location.name
    node(location)
  }
  routing.sites.forEach(node)
  for (const table of routing.udrTables) { name(table); table.routes.forEach(name) }
  routing.routeMaps?.forEach(name)
  routing.vnetPeerings.forEach(name)
  routing.erLinks.forEach(name)
  routing.erGlobalReachLinks?.forEach(name)
  routing.vpnConnections.forEach(name)
  routing.siteLinks.forEach(name)
  return { routing, revision: JSON.stringify(routing), names, nameRevision: JSON.stringify(names) }
}

export function azDisplayResult<T>(value: T, names: string[]): T {
  const visit = (entry: unknown): unknown => {
    if (typeof entry === 'string') return entry.replace(tokenPattern, (token, before: string, index: string, after: string) =>
      before === '\0' && after === '\0' ? names[Number(index)] ?? '' : token)
    if (Array.isArray(entry)) return entry.map(visit)
    if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, visit(child)]))
    return entry
  }
  return visit(value) as T
}
