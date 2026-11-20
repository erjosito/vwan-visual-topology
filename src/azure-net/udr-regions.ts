import type { AzNetTopology, AzUdrTable, AzVNet } from './model'

export function udrRegionKey(region?: string): string | undefined {
  const key = region?.trim().toLowerCase().replace(/[\s-]/g, '')
  return key && /^[a-z][a-z0-9]{1,39}$/.test(key) ? key : undefined
}

export function resolveUdrRegion(topology: AzNetTopology, table: AzUdrTable): string | undefined {
  if (table.region !== undefined) return udrRegionKey(table.region)
  const owners = topology.vnets.filter((vnet) => vnet.subnets.some((subnet) => subnet.routeTableId === table.id))
  const regions = new Set(owners.map((vnet) => udrRegionKey(vnet.region)))
  return regions.size === 1 && !regions.has(undefined) ? [...regions][0] : undefined
}

export function udrAssociationError(topology: AzNetTopology, vnet: AzVNet, table?: AzUdrTable): string | undefined {
  if (!table) return 'The associated route table is missing. Choose an existing table or dissociate the subnet.'
  const region = resolveUdrRegion(topology, table)
  const vnetRegion = udrRegionKey(vnet.region)
  if (!region || !vnetRegion) return `Route table "${table.name}" or VNet "${vnet.name}" has an unknown region. Set an explicit region before associating them.`
  if (region !== vnetRegion) return `Route table "${table.name}" (${region}) cannot be associated with VNet "${vnet.name}" (${vnetRegion}). Dissociate the subnet or use a table in the same region.`
}

export function udrAssociationFindings(topology: AzNetTopology) {
  return topology.vnets.flatMap((vnet) => vnet.subnets.flatMap((subnet) => {
    if (!subnet.routeTableId) return []
    const error = udrAssociationError(topology, vnet, topology.udrTables.find((table) => table.id === subnet.routeTableId))
    return error ? [{ vnetId: vnet.id, subnetId: subnet.id, summary: `${vnet.name}/${subnet.name}: ${error}` }] : []
  }))
}

export function validateUdrRegionEdit(before: AzNetTopology, after: AzNetTopology): void {
  // Pin an inferred legacy region before changing its associations or a VNet region.
  for (const table of after.udrTables) {
    const previous = before.udrTables.find((candidate) => candidate.id === table.id)
    if (table.region !== undefined && previous?.region !== table.region && !udrRegionKey(table.region)) {
      throw new Error(`Route table "${table.name}" requires a valid nonempty region.`)
    }
    if (!previous || previous.region !== undefined || table.region !== undefined) continue
    const associations = (topology: AzNetTopology) => topology.vnets.flatMap((vnet) =>
      vnet.subnets.filter((subnet) => subnet.routeTableId === table.id).map((subnet) => `${vnet.id}:${subnet.id}:${udrRegionKey(vnet.region)}`)).sort().join('|')
    if (associations(before) !== associations(after)) {
      const region = resolveUdrRegion(before, previous)
      if (region) table.region = region
    }
  }
  for (const vnet of after.vnets) {
    const oldVnet = before.vnets.find((candidate) => candidate.id === vnet.id)
    for (const subnet of vnet.subnets) {
      if (!subnet.routeTableId) continue
      const oldSubnet = oldVnet?.subnets.find((candidate) => candidate.id === subnet.id)
      const table = after.udrTables.find((candidate) => candidate.id === subnet.routeTableId)
      const oldTable = before.udrTables.find((candidate) => candidate.id === subnet.routeTableId)
      if (oldSubnet?.routeTableId === subnet.routeTableId && oldVnet?.region === vnet.region && oldTable?.region === table?.region) continue
      if (oldSubnet?.routeTableId !== subnet.routeTableId && table?.region === undefined &&
        (!oldTable || !resolveUdrRegion(before, oldTable))) throw new Error(`Route table "${table?.name ?? subnet.routeTableId}" has an unknown region. Set an explicit region before associating it.`)
      const error = udrAssociationError(after, vnet, table)
      if (error) throw new Error(error)
    }
  }
}
