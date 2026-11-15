import { DEFAULT_HUB_TABLE, hubRouteTables, hubTableCoverage, propagatesLocally } from '../hub-routing'
import type { HubRoutingConfiguration, Topology } from '../model'
import type { AzNetTopology, AzVwanHub } from './model'

export const legacyAzHubRouting: HubRoutingConfiguration = {
  status: 'configured', associatedTableId: DEFAULT_HUB_TABLE,
  propagatedTableIds: [DEFAULT_HUB_TABLE], labels: ['default'],
}

export function azHubRouting(config?: HubRoutingConfiguration): HubRoutingConfiguration {
  return config ?? legacyAzHubRouting
}

export function azInterHubId(a: string, b: string): string {
  return JSON.stringify(['vwan-transit', ...[a, b].sort()])
}

export function azInterHubLinks(topology: AzNetTopology) {
  return topology.vwanHubs.flatMap((hub, index) => topology.vwanHubs.slice(index + 1).map((other) => ({
    id: azInterHubId(hub.id, other.id), from: `vwan-hub:${hub.id}`, to: `vwan-hub:${other.id}`,
  })))
}

export function azHubAssociation(config?: HubRoutingConfiguration): string {
  return azHubRouting(config).associatedTableId ?? DEFAULT_HUB_TABLE
}

export function azHubAttachments(topology: AzNetTopology, hubId: string) {
  return [
    ...topology.vnets.filter((vnet) => vnet.vwanHubAttachment?.enabled && vnet.vwanHubAttachment.hubId === hubId)
      .map((vnet) => ({ id: `vhub-attach:${vnet.id}:${hubId}`, name: vnet.name, hubRouting: vnet.vwanHubAttachment!.hubRouting })),
    ...topology.erLinks.filter((link) => link.enabled && link.targetKind === 'vwan-hub' && link.targetId === hubId),
    ...topology.vpnConnections.filter((link) => link.enabled && link.targetKind === 'vwan-hub' && link.targetId === hubId),
  ]
}

export function azHubVnetExports(topology: AzNetTopology, hub: AzVwanHub, config?: HubRoutingConfiguration) {
  const table = hubRouteTables(hub).find((table) => table.id === azHubAssociation(config))
  if (!table || azHubRouting(config).status === 'unknown') return []
  return topology.vnets.filter((vnet) => vnet.vwanHubAttachment?.enabled
    && vnet.vwanHubAttachment.hubId === hub.id
    && propagatesLocally(azHubRouting(vnet.vwanHubAttachment.hubRouting), table))
}

export function azHubTableCoverage(topology: AzNetTopology) {
  const projection: Topology = {
    version: 1, name: topology.name,
    hubs: topology.vwanHubs.map((hub) => ({
      ...hub, routingIntent: { ...hub.routingIntent, privatePrefixes: hub.routingIntent.privatePrefixes ?? [] },
    })),
    spokes: topology.vwanHubs.flatMap((hub) => azHubAttachments(topology, hub.id).map((attachment) => ({
      ...attachment, hubId: hub.id, prefixes: [],
    }))),
    sites: [], connections: [], siteLinks: [],
  }
  const coverage = hubTableCoverage(projection)
  if (topology.vnets.some((vnet) => vnet.vwanHubAttachment?.enabled && 'hubRouting' in vnet)) {
    for (const tables of Object.values(coverage)) for (const entry of Object.values(tables)) {
      entry.complete = false
      entry.limitations = ['Retained mixed hub policy configuration is not modeled; reachability is not established.']
    }
  }
  return coverage
}
