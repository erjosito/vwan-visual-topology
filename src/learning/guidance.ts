import type { CourseGuidance } from './course-contract'
import type { PlatformDocument } from '../platform/contract'

export const guidanceAnchor = (...scope: string[]) => JSON.stringify(scope)
export type GuidanceReason = 'provider' | 'entity' | 'association' | 'peered'
export type GuidancePlan = { anchors: string[]; reason?: undefined } | { reason: GuidanceReason; anchors?: undefined }

export function resolveGuidance(document: PlatformDocument, cue: CourseGuidance): GuidancePlan {
  if (document.mode === 'vwan') return { reason: 'provider' }
  const topology = document.topology
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
  if (!topology.udrTables.find((t) => t.id === routeTableId)?.routes.some((r) => r.id === routeId)) return { reason: 'entity' }
  return { anchors: [guidanceAnchor('udr-route', vnetId, subnetId, routeTableId, routeId)] }
}
