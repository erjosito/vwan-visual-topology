import type { AzNetTopology, AzUdrTable } from './model'
import { udrRegionKey } from './udr-regions'

export function createUdrTable(topology: AzNetTopology, name: string, region: string, source?: AzUdrTable): AzUdrTable {
  name = name.trim()
  region = region.trim()
  if (!name || name.length > 120) throw new Error('The route-table name must contain 1-120 characters.')
  if (topology.udrTables.some((table) => table.name.toLowerCase() === name.toLowerCase())) throw new Error('A route table with this name already exists.')
  if (!udrRegionKey(region)) throw new Error('Choose a valid nonempty route-table region.')
  return {
    id: `rt-${crypto.randomUUID()}`, name, region,
    disableBgpRoutePropagation: source?.disableBgpRoutePropagation ?? false,
    disablePeeringRoutePropagation: source?.disablePeeringRoutePropagation ?? false,
    routes: (source?.routes ?? []).map((route) => ({ ...structuredClone(route), id: `udr-${crypto.randomUUID()}` })),
  }
}

export function udrAssociations(topology: AzNetTopology, tableId: string) {
  return topology.vnets.flatMap((vnet) => vnet.subnets.filter((subnet) => subnet.routeTableId === tableId)
    .map((subnet) => ({ vnetId: vnet.id, subnetId: subnet.id, name: `${vnet.name}/${subnet.name}` })))
}

export function deleteUdrTable(topology: AzNetTopology, tableId: string): void {
  if (udrAssociations(topology, tableId).length) throw new Error('Dissociate every subnet before deleting this route table.')
  topology.udrTables = topology.udrTables.filter((table) => table.id !== tableId)
}
