import type { CourseGuidance } from './course-contract'
import type { PlatformDocument } from '../platform/contract'
import { hubRouteTables } from '../hub-routing'

export const guidanceAnchor = (...scope: string[]) => JSON.stringify(scope)
export type GuidanceReason = 'provider' | 'entity' | 'association' | 'peered'
export type GuidancePlan = { anchors: string[]; reason?: undefined } | { reason: GuidanceReason; anchors?: undefined }

export function resolveGuidance(document: PlatformDocument, cue: CourseGuidance): GuidancePlan {
  if (document.mode === 'vwan') return { reason: 'provider' }
  const topology = document.topology
  if (cue.action === 'packet-probe.open') return topology.vnets.some((vnet) => vnet.id === cue.params.vnetId)
    ? { anchors: [guidanceAnchor('packet-probe', cue.params.vnetId)] } : { reason: 'entity' }
  if (cue.action === 'hub.configure') return topology.vwanHubs.some((hub) => hub.id === cue.params.hubId)
    ? { anchors: [guidanceAnchor('hub-editor', cue.params.hubId)] } : { reason: 'entity' }
  if (cue.action === 'network.configure') return topology.vnets.some((vnet) => vnet.id === cue.params.vnetId)
    ? { anchors: [guidanceAnchor('network-editor', cue.params.vnetId)] } : { reason: 'entity' }
  if (cue.action === 'hub-routes.open') {
    const hub = topology.vwanHubs.find((hub) => hub.id === cue.params.hubId)
    return hub && hubRouteTables(hub).some((table) => table.id === cue.params.tableId)
      ? { anchors: [guidanceAnchor('hub-effective-table', hub.id, cue.params.tableId)] } : { reason: 'entity' }
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
