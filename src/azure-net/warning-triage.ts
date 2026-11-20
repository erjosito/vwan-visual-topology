import type { AzDiagnosticFinding } from './diagnostics'
import type { AzNetTopology } from './model'
import { traceAzNetPair, type AzSimulationResult } from './engine'
import { evidenceSet, warningFingerprint } from '../warning-acknowledgements'

export function azWarningToken(topology: AzNetTopology, simulation: AzSimulationResult, finding: AzDiagnosticFinding): string {
  const entries = finding.occurrences ?? [finding]
  const vnetIds = new Set(entries.flatMap((entry) => {
    const ids = entry.vnetId ? [entry.vnetId] : []
    const peering = topology.vnetPeerings.find((peer) => peer.id === entry.peeringId)
    if (peering) ids.push(peering.vnetAId, peering.vnetBId)
    for (const ref of [entry.sampleFlow?.source, entry.sampleFlow?.destination]) {
      if (ref?.kind === 'subnet') ids.push(ref.vnetId)
    }
    return ids
  }))
  const paths = entries.flatMap((entry) => entry.sampleFlow ? [traceAzNetPair(topology, simulation,
    entry.sampleFlow.source, entry.sampleFlow.sourceIp, entry.sampleFlow.destination, entry.sampleFlow.destinationIp)] : [])
  for (const pair of paths) for (const trace of [pair.forward, pair.reverse]) {
    for (const id of trace.traversedVnetIds) vnetIds.add(id)
  }
  const vnets = topology.vnets.filter((vnet) => vnetIds.has(vnet.id))
  const tableIds = new Set(vnets.flatMap((vnet) => vnet.subnets.flatMap((subnet) => subnet.routeTableId ? [subnet.routeTableId] : [])))
  const refs = new Set(entries.flatMap((entry) => [entry.erLinkId, entry.erLocationId,
    entry.sampleFlow?.source.kind === 'site' ? entry.sampleFlow.source.siteId : undefined,
    entry.sampleFlow?.destination.kind === 'site' ? entry.sampleFlow.destination.siteId : undefined,
  ]).filter(Boolean))
  return warningFingerprint('aznet', {
    id: finding.id, category: finding.category, severity: finding.severity,
    entries: evidenceSet(entries.map((entry) => ({
      id: entry.id, category: entry.category, severity: entry.severity, vnetId: entry.vnetId, subnetId: entry.subnetId,
      peeringId: entry.peeringId, applianceId: entry.applianceId, erLocationId: entry.erLocationId,
      erLinkId: entry.erLinkId, sampleFlow: entry.sampleFlow, sourceKey: entry.sourceKey, destinationKey: entry.destinationKey,
    }))),
    vnets: evidenceSet(vnets), tables: evidenceSet(topology.udrTables.filter((table) => tableIds.has(table.id))),
    peerings: evidenceSet(topology.vnetPeerings.filter((peer) => vnetIds.has(peer.vnetAId) || vnetIds.has(peer.vnetBId))),
    locations: evidenceSet(topology.erLocations.filter((location) => refs.has(location.id))),
    links: evidenceSet(topology.erLinks.filter((link) => refs.has(link.id))),
    sites: evidenceSet(topology.sites.filter((site) => refs.has(site.id))),
    routes: evidenceSet(Object.values(simulation.subnetTables).filter((table) => vnetIds.has(table.vnetId))),
    paths: evidenceSet(paths.map((pair) => ({ forward: pair.forward, reverse: pair.reverse, symmetricInspection: pair.symmetricInspection }))),
    complete: simulation.controlPlaneComplete,
  })
}
