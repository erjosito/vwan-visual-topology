import { cidr, contains, ipv4 } from '../validation'
import type { AzSimulationResult } from './engine'
import type { AzSite } from './model'

export interface CpeRouteLookup {
  address: string
  sourceAddress?: string
  contextId: string
  sourceRequired?: boolean
  routes: { prefix: string; connectionId?: string; tunnelId?: string; erLinkId?: string; kind: string; provenance: string }[]
}

export function lookupCpeRoutes(
  site: AzSite, simulation: AzSimulationResult, address: string, sourceAddress?: string,
): CpeRouteLookup {
  const routing = site.vpnRouting!
  const ip = ipv4(address) ?? -1
  const matching = routing.peerRoutes.filter((route) => route.enabled && contains(route.prefix, ip))
  const statics = matching.filter((route) => !route.sourceAddress || route.sourceAddress === sourceAddress).map((route) => ({
    prefix: route.prefix, kind: route.nextHop.kind, provenance: `configured-peer-route:${route.id}`,
    ...(route.nextHop.kind === 'tunnel' ? { connectionId: route.nextHop.connectionId, tunnelId: route.nextHop.tunnelId }
      : route.nextHop.kind === 'er-link' ? { erLinkId: route.nextHop.linkId } : {}),
  }))
  const learned = (simulation.siteRibs[site.id] ?? []).filter((route) => route.preferred && contains(route.prefix, ip)).map((route) => ({
    prefix: route.prefix, kind: route.originProtocol, provenance: `derived:${route.id}`,
    connectionId: route.connectionId, tunnelId: route.vpnTunnelId,
    ...(route.originProtocol === 'ExpressRoute' ? { erLinkId: route.connectionId } : {}),
  }))
  const all = [...statics, ...learned]
  const length = Math.max(...all.map((route) => cidr(route.prefix)?.length ?? -1))
  const exact = all.filter((route) => cidr(route.prefix)?.length === length)
  // Configured statics win equal-prefix dynamic candidates, not more-specific routes.
  const selectedStatics = exact.filter((route) => route.provenance.startsWith('configured-peer-route:'))
  return {
    address, sourceAddress, contextId: routing.contextId,
    ...(sourceAddress === undefined && matching.some((route) => route.sourceAddress) ? { sourceRequired: true } : {}),
    routes: selectedStatics.length ? selectedStatics : exact,
  }
}
