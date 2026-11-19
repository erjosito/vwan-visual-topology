import type { CourseCheck, CourseGuidance } from './course-contract'
import type { PlatformDocument } from '../platform/contract'
import { hubRouteTables } from '../hub-routing'

export const guidanceAnchor = (...scope: string[]) => JSON.stringify(scope)
export type GuidanceReason = 'provider' | 'entity' | 'association' | 'peered' | 'capture'
export type GuidancePlan = { anchors: string[]; reason?: undefined } | { reason: GuidanceReason; anchors?: undefined }

/** Navigation preference only; completion still requires the runner's full check. */
export function selectPrimaryGuidance(document: PlatformDocument, check: CourseCheck, cues: CourseGuidance[]) {
  if (document.mode !== 'vwan') {
    const topology = document.topology
    if (check.kind === 'peerings.configured') {
      const pending = check.params.peerings.find((pair) => !topology.vnetPeerings.some((peering) =>
        peering.enabled && peering.aToB.allowVirtualNetworkAccess && peering.bToA.allowVirtualNetworkAccess
        && ((peering.vnetAId === pair.vnetAId && peering.vnetBId === pair.vnetBId)
          || (peering.vnetBId === pair.vnetAId && peering.vnetAId === pair.vnetBId))))
      const cue = pending && cues.find((cue) => cue.action === 'peering.command'
        && ((cue.params.vnetAId === pending.vnetAId && cue.params.vnetBId === pending.vnetBId)
          || (cue.params.vnetBId === pending.vnetAId && cue.params.vnetAId === pending.vnetBId)))
      if (cue) return cue
    }
    if (check.kind === 'udrs.configured') {
      const pending = check.params.routes.find((scope) => {
        const subnet = topology.vnets.find((vnet) => vnet.id === scope.vnetId)?.subnets.find((entry) => entry.id === scope.subnetId)
        return !topology.udrTables.find((table) => table.id === subnet?.routeTableId)?.routes.some((route) =>
          route.enabled && route.prefix === scope.prefix && route.nextHopType === 'VirtualAppliance' && route.nextHopIp === scope.nextHopIp)
      })
      const cue = pending && cues.find((cue) => cue.action === 'route-table.configure'
        && cue.params.vnetId === pending.vnetId && cue.params.subnetId === pending.subnetId)
      if (cue) return cue
    }
  }
  return cues[0]
}

export function resolveGuidance(document: PlatformDocument, cue: CourseGuidance): GuidancePlan {
  if (document.mode === 'vwan') return { reason: 'provider' }
  const topology = document.topology
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
