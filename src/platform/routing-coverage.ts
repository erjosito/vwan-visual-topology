import type { AzNetTopology } from '../azure-net/model'
import type { AzSimulationResult } from '../azure-net/engine'
import { unscopedRoutingLimitations, type RoutingEvidenceEnvelope, type RoutingLimitation } from '../routing-evidence'
import type { RouteRequirement } from './contract'
import { engineVersion } from './contract'

// Include even disabled relationships: narrowing must not guess which unknown export can matter.
function component(topology: AzNetTopology, owner: { kind: 'vnet' | 'hub'; id: string }): Set<string> | undefined {
  if (!(owner.kind === 'vnet' ? topology.vnets : topology.vwanHubs).some(resource => resource.id === owner.id)) return
  const key = (kind: string, id: string) => JSON.stringify([kind, id])
  const edges = new Map<string, Set<string>>()
  const connect = (a: string, b: string) => {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!edges.has(from)) edges.set(from, new Set())
      edges.get(from)!.add(to)
    }
  }
  const target = (kind: string, id: string) => {
    if (kind === 'vwan-hub' || kind === 'site') return key(kind === 'vwan-hub' ? 'hub' : kind, id)
    const vnet = topology.vnets.find(vnet => (kind === 'appliance' ? vnet.appliances : vnet.gateways).some(resource => resource.id === id))
    return vnet ? key('vnet', vnet.id) : key(kind, id)
  }
  for (const peering of topology.vnetPeerings) connect(key('vnet', peering.vnetAId), key('vnet', peering.vnetBId))
  for (const vnet of topology.vnets) {
    if (vnet.vwanHubAttachment) connect(key('vnet', vnet.id), key('hub', vnet.vwanHubAttachment.hubId))
    for (const id of vnet.routeServer?.peerApplianceIds ?? []) connect(key('vnet', vnet.id), target('appliance', id))
    if (vnet.appliances.some(appliance => appliance.vwanBgpEnabled)) {
      for (const hub of topology.vwanHubs) connect(key('vnet', vnet.id), key('hub', hub.id))
    }
  }
  for (const link of topology.erLinks) connect(key('er', link.locationId), target(link.targetKind, link.targetId))
  for (const link of topology.vpnConnections) connect(key('site', link.siteId), target(link.targetKind, link.targetId))
  for (const link of topology.siteLinks) connect(key('site', link.siteAId), key('site', link.siteBId))
  for (const kind of ['hub', 'er']) {
    const resources = kind === 'hub' ? topology.vwanHubs : topology.erLocations
    for (const resource of resources.slice(1)) connect(key(kind, resources[0].id), key(kind, resource.id))
  }
  const visited = new Set([key(owner.kind, owner.id)])
  for (const node of visited) for (const neighbor of edges.get(node) ?? []) visited.add(neighbor)
  return visited
}

export function routeCoverage(topology: AzNetTopology, simulation: AzSimulationResult, requirement: RouteRequirement,
  revision: string, requestRevision = revision): { coverage: RoutingEvidenceEnvelope; limitations: RoutingLimitation[] } {
  const hub = requirement.hubTableId !== undefined ? topology.vwanHubs.find(hub => hub.id === requirement.table) : undefined
  const vnet = requirement.hubTableId === undefined ? topology.vnets.find(vnet => vnet.subnets.some(subnet => subnet.id === requirement.table)) : undefined
  const scope: RoutingEvidenceEnvelope['scope'] = requirement.hubTableId !== undefined
    ? { kind: 'hub-table', hubId: requirement.table, tableId: requirement.hubTableId }
    : { kind: 'subnet-table', subnetId: requirement.table }
  const records = unscopedRoutingLimitations(simulation.warnings, simulation.routingLimitations)
  const requestedKey = JSON.stringify(hub ? ['hub', hub.id] : ['vnet', vnet?.id])
  const limitations = records.filter(record => {
    if (record.completeness === 'complete' || !record.operations.includes('route')) return false
    if (record.scope.kind === 'document') return true
    if (record.scope.kind === 'hub-table' && hub) {
      return record.scope.hubId === hub.id && record.scope.tableId === requirement.hubTableId
    }
    const owner = record.scope.kind === 'component' ? { kind: 'vnet' as const, id: record.scope.vnetId }
      : { kind: 'hub' as const, id: record.scope.hubId }
    const affected = component(topology, owner)
    return !affected || affected.has(requestedKey)
  })
  const tableComplete = hub ? !!simulation.vwanHubTables[hub.id]?.[requirement.hubTableId!]
    && simulation.vwanHubTableCoverage[hub.id]?.[requirement.hubTableId!]?.complete === true
    : !!vnet && !!simulation.subnetTables[requirement.table]
  const missingCompleteness = simulation.controlPlaneComplete !== true && !records.some(record =>
    record.completeness === 'not-assessed' && record.operations.includes('route'))
  return { limitations, coverage: {
    provider: 'azure-net', engineVersion, revision, requestRevision, scope,
    complete: tableComplete && !missingCompleteness && !limitations.length,
    limitationIds: limitations.map(record => record.id),
  } }
}
