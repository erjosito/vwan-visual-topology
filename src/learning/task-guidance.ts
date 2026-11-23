import type { CourseCheck, CourseGuidance } from './course-contract'
import type { PlatformDocument } from '../platform/contract'
import type { PacketRequest } from '../packet-flow'

export function packetObservationKey(packet: PacketRequest) {
  const endpoint = (value: PacketRequest['source']) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([endpoint(packet.source), endpoint(packet.target), packet.protocol, packet.sourcePort, packet.destinationPort])
}

export function inspectionScope(check?: CourseCheck) {
  if (check?.kind === 'routes.inspected' || check?.kind === 'control-routes.inspected') return check.params
  if (check?.kind === 'scenario.loaded') return check.params.inspection
  if (check?.kind === 'packet.inspected') return { vnetId: check.params.vnetId, prefix: packetObservationKey(check.params.packet) }
}

/** Navigation preference only; completion still requires the runner's full check. */
export function selectPrimaryGuidance(document: PlatformDocument, check: CourseCheck, cues: CourseGuidance[]) {
  if (document.mode !== 'vwan') {
    const topology = document.topology
    if (check.kind === 'peerings.configured' || check.kind === 'routes.inspected') {
      const pairs = check.kind === 'peerings.configured' ? check.params.peerings
        : cues.flatMap((cue) => cue.action === 'peering.command' ? [cue.params] : [])
      const pending = pairs.find((pair) => !topology.vnetPeerings.some((peering) =>
        peering.enabled && peering.aToB.allowVirtualNetworkAccess && peering.bToA.allowVirtualNetworkAccess
        && ((peering.vnetAId === pair.vnetAId && peering.vnetBId === pair.vnetBId)
          || (peering.vnetBId === pair.vnetAId && peering.vnetAId === pair.vnetBId))))
      const cue = pending && cues.find((cue) => cue.action === 'peering.command'
        && ((cue.params.vnetAId === pending.vnetAId && cue.params.vnetBId === pending.vnetBId)
          || (cue.params.vnetBId === pending.vnetAId && cue.params.vnetAId === pending.vnetBId)))
      if (cue) return cue
      if (check.kind === 'routes.inspected') {
        const inspection = cues.find((cue) => cue.action === 'routes.open'
          && cue.params.vnetId === check.params.vnetId && cue.params.subnetId === check.params.subnetId
          && cue.params.prefix === check.params.prefix)
        if (inspection) return inspection
      }
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
