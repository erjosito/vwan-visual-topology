import { parseAzNetTopology } from './admission'
import { simulateAzNet, type AzSimulationResult } from './engine'
import type { AzNetTopology } from './model'
import type { VpnTunnelAssessment } from './vpn-sessions'

export interface VpnTransitionRequest {
  previousTopology: AzNetTopology
  event: { id: string; description: string }
}

export interface VpnTransitionComparison {
  kind: 'authored-snapshot-comparison'
  event: VpnTransitionRequest['event']
  inPlaceReproduction: 'not-assessed'
  reason: string
  sourceSnapshots: { before: AzNetTopology; after: AzNetTopology }
  tunnels: {
    key: string
    identity: 'retained' | 'added' | 'removed'
    declaredIpsecChanged: boolean
    before?: VpnTunnelAssessment
    after?: VpnTunnelAssessment
  }[]
  routeDeltas: { table: string; before: unknown; after: unknown }[]
}

export function compareVpnSnapshots(
  request: VpnTransitionRequest, current: AzNetTopology, currentSimulation?: AzSimulationResult,
): VpnTransitionComparison {
  const before = parseAzNetTopology(request.previousTopology)
  const after = parseAzNetTopology(current)
  const oldSimulation = simulateAzNet(before), newSimulation = currentSimulation ?? simulateAzNet(after)
  const oldTunnels = oldSimulation.vpnTunnels ?? {}, newTunnels = newSimulation.vpnTunnels ?? {}
  const tables = (simulation: AzSimulationResult) => Object.fromEntries([
    ...Object.entries(simulation.gatewayRibs).map(([id, routes]) => [`gateway:${id}`, routes] as const),
    ...Object.entries(simulation.siteRibs).map(([id, routes]) => [`site:${id}`, routes] as const),
    ...Object.entries(simulation.subnetTables).map(([id, table]) => [`subnet:${id}`, table.routes] as const),
  ])
  const oldTables = tables(oldSimulation), newTables = tables(newSimulation)
  return {
    kind: 'authored-snapshot-comparison', event: { ...request.event }, inPlaceReproduction: 'not-assessed',
    reason: 'Ordered source snapshots and their derived control/forwarding deltas only. Retained IDs and unchanged declared IPsec state do not prove SA continuity or reproduce a live in-place migration.',
    sourceSnapshots: { before, after },
    tunnels: [...new Set([...Object.keys(oldTunnels), ...Object.keys(newTunnels)])].sort().map((key) => ({
      key, identity: oldTunnels[key] && newTunnels[key] ? 'retained' : oldTunnels[key] ? 'removed' : 'added',
      declaredIpsecChanged: !!oldTunnels[key] && !!newTunnels[key] && oldTunnels[key].ipsecAssumption !== newTunnels[key].ipsecAssumption,
      ...(oldTunnels[key] ? { before: oldTunnels[key] } : {}), ...(newTunnels[key] ? { after: newTunnels[key] } : {}),
    })),
    routeDeltas: [...new Set([...Object.keys(oldTables), ...Object.keys(newTables)])].sort()
      .filter((table) => JSON.stringify(oldTables[table]) !== JSON.stringify(newTables[table]))
      .map((table) => ({ table, before: oldTables[table] ?? null, after: newTables[table] ?? null })),
  }
}
