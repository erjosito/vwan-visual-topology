import type { CourseGuidance } from './course-contract'
import type { PlatformDocument } from '../platform/contract'
import { hubRouteTables } from '../hub-routing'

export const guidanceAnchor = (...scope: string[]) => JSON.stringify(scope)
export type GuidanceReason = 'provider' | 'entity' | 'association' | 'peered' | 'capture'
export type GuidancePlan = { anchors: string[]; reason?: undefined } | { reason: GuidanceReason; anchors?: undefined }

export function resolveGuidance(document: PlatformDocument, cue: CourseGuidance): GuidancePlan {
  if (document.mode === 'vwan') return { reason: 'provider' }
  const topology = document.topology
  if (cue.action === 'peering.configure') return topology.vnetPeerings.some((peering) => peering.id === cue.params.peeringId)
    ? { anchors: [guidanceAnchor('peering-editor', cue.params.peeringId)] } : { reason: 'entity' }
  if (cue.action === 'load-balancer.configure') return topology.inventory?.loadBalancers?.some((lb) =>
    lb.id === cue.params.loadBalancerId && lb.owner.kind === 'vnet' && lb.owner.id === cue.params.vnetId)
    ? { anchors: [guidanceAnchor('load-balancer-health', cue.params.vnetId, cue.params.loadBalancerId)] } : { reason: 'entity' }
  if (cue.action === 'gateway-routes.open') {
    const { vnetId, gatewayId, prefix } = cue.params
    return topology.vnets.some((vnet) => vnet.id === vnetId && vnet.gateways.some((gateway) => gateway.id === gatewayId))
      ? { anchors: [guidanceAnchor('gateway-effective-prefix', vnetId, gatewayId, prefix), guidanceAnchor('gateway-effective-table', vnetId, gatewayId)] }
      : { reason: 'entity' }
  }
  if (cue.action === 'er-routes.open') return topology.erLocations.some((location) => location.id === cue.params.locationId)
    ? { anchors: [guidanceAnchor('er-effective-prefix', cue.params.locationId, cue.params.prefix), guidanceAnchor('er-effective-table', cue.params.locationId)] }
    : { reason: 'entity' }
  if (cue.action === 'connection.configure') {
    const connections = cue.params.kind === 'er-link' ? topology.erLinks : topology.vpnConnections
    return connections.some((connection) => connection.id === cue.params.connectionId)
      ? { anchors: [guidanceAnchor('connection-editor', cue.params.kind, cue.params.connectionId)] } : { reason: 'entity' }
  }
  if (cue.action === 'site-routes.open') return topology.sites.some((site) => site.id === cue.params.siteId)
    ? { anchors: [guidanceAnchor('site-effective-table', cue.params.siteId)] } : { reason: 'entity' }
  if (cue.action === 'packet-probe.open') return topology.vnets.some((vnet) => vnet.id === cue.params.vnetId)
    ? { anchors: [guidanceAnchor('packet-probe', cue.params.vnetId)] } : { reason: 'entity' }
  if (cue.action === 'hub.configure') return topology.vwanHubs.some((hub) => hub.id === cue.params.hubId)
    ? { anchors: [guidanceAnchor('hub-editor', cue.params.hubId)] } : { reason: 'entity' }
  if (cue.action === 'network.configure') return topology.vnets.some((vnet) => vnet.id === cue.params.vnetId)
    ? { anchors: [guidanceAnchor('network-editor', cue.params.vnetId)] } : { reason: 'entity' }
  if (cue.action === 'hub-routes.open') {
    const hub = topology.vwanHubs.find((hub) => hub.id === cue.params.hubId)
    if (hub?.routeTablesStatus === 'unknown') return { reason: 'capture' }
    return hub && hubRouteTables(hub).some((table) => table.id === cue.params.tableId)
      ? { anchors: [
        ...(cue.params.prefix ? [guidanceAnchor('hub-effective-prefix', hub.id, cue.params.tableId, cue.params.prefix)] : []),
        guidanceAnchor('hub-effective-table', hub.id, cue.params.tableId),
      ] } : { reason: 'entity' }
  }
  if (cue.action === 'peering.command') {
    const { vnetAId, vnetBId } = cue.params
    if (vnetAId === vnetBId || ![vnetAId, vnetBId].every((id) => topology.vnets.some((v) => v.id === id))) return { reason: 'entity' }
    if (topology.vnetPeerings.some((p) => p.vnetAId === vnetAId && p.vnetBId === vnetBId || p.vnetAId === vnetBId && p.vnetBId === vnetAId)) return { reason: 'peered' }
    return { anchors: [guidanceAnchor('peer-target', vnetAId, vnetBId), guidanceAnchor('peer-menu', vnetAId)] }
  }
  const { vnetId, subnetId } = cue.params
  const subnet = topology.vnets.find((v) => v.id === vnetId)?.subnets.find((s) => s.id === subnetId)
  if (!subnet) return { reason: 'entity' }
  if (cue.action === 'routes.open') return { anchors: [
    guidanceAnchor('effective-prefix', vnetId, subnetId, cue.params.prefix),
    guidanceAnchor('effective-table', vnetId, subnetId),
  ] }
  const { routeTableId, routeId } = cue.params
  if (subnet.routeTableId !== routeTableId) return { reason: 'association' }
  const table = topology.udrTables.find((t) => t.id === routeTableId)
  if (!table || routeId && !table.routes.some((r) => r.id === routeId)) return { reason: 'entity' }
  if (!routeId) return { anchors: [guidanceAnchor('udr-table', vnetId, subnetId, routeTableId)] }
  return { anchors: [guidanceAnchor('udr-route', vnetId, subnetId, routeTableId, routeId)] }
}
