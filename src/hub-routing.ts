import type { Hub, HubRouteTable, HubRoutingConfiguration, Topology } from './model'

export const DEFAULT_HUB_TABLE = 'defaultRouteTable'
export const NONE_HUB_TABLE = 'noneRouteTable'
export const hubRoutingCoverageMessage = 'Hub route-table configuration is unknown or unsupported; reachability is not established. See #22.'

const legacyRouting: HubRoutingConfiguration = {
  status: 'configured', associatedTableId: DEFAULT_HUB_TABLE, propagatedTableIds: [DEFAULT_HUB_TABLE], labels: ['default'],
}

export function hubRouteTables(hub: Hub): HubRouteTable[] {
  const tables: HubRouteTable[] = [
    { id: DEFAULT_HUB_TABLE, name: 'Default', labels: ['default'] },
    { id: NONE_HUB_TABLE, name: 'None', labels: ['none'] },
  ]
  for (const table of hub.routeTables ?? []) {
    const index = tables.findIndex((entry) => entry.id === table.id)
    if (index < 0) tables.push(table)
    else tables[index] = table
  }
  return tables
}

export function attachmentHubRouting(topology: Topology, attachmentId: string): HubRoutingConfiguration {
  const connection = topology.connections.find((entry) => entry.id === attachmentId)
  const hostId = connection?.transport === 'SpokeNVA' ? connection.spokeId : attachmentId
  return topology.spokes.find((entry) => entry.id === hostId)?.hubRouting
    ?? connection?.hubRouting ?? topology.erLinks?.find((entry) => entry.id === attachmentId)?.hubRouting ?? legacyRouting
}

export function propagationLabels(config: HubRoutingConfiguration): string[] {
  if (config.labels.includes('none') || config.propagatedTableIds.includes(NONE_HUB_TABLE)) return []
  if (config.labels.length) return config.labels
  return ['default']
}

export function propagatesLocally(config: HubRoutingConfiguration, table: HubRouteTable): boolean {
  return config.status !== 'unknown' && table.id !== NONE_HUB_TABLE && !config.propagatedTableIds.includes(NONE_HUB_TABLE) && !config.labels.includes('none')
    && (config.propagatedTableIds.includes(table.id) || propagationLabels(config).some((label) => table.labels.includes(label)))
}

export function propagatesRemotely(config: HubRoutingConfiguration, origin: HubRouteTable, destination: HubRouteTable, originTables: HubRouteTable[]): boolean {
  const labels = propagationLabels(config).filter((label) => destination.labels.includes(label))
  const matchingOrigins = originTables.filter((table) => table.id !== NONE_HUB_TABLE && labels.some((label) => table.labels.includes(label)))
  return config.status !== 'unknown' && origin.id !== NONE_HUB_TABLE && destination.id !== NONE_HUB_TABLE
    && !config.propagatedTableIds.includes(NONE_HUB_TABLE) && labels.length > 0
    && (!matchingOrigins.length || matchingOrigins.some((table) => table.id === origin.id))
}

export function hubTableCoverage(topology: Topology): Record<string, Record<string, { complete: boolean; limitations: string[] }>> {
  const attachments = [...topology.spokes, ...topology.connections, ...(topology.erLinks ?? [])]
    .filter((entry) => !('enabled' in entry) || entry.enabled)
  const unknownPropagation = topology.hubs.some((hub) => hub.routeTablesStatus === 'unknown')
    || topology.azureImport?.hubs.some((hub) => hub.routingScopeComplete === false || hub.limitations.length > 0)
    || attachments.some((entry) => entry.hubRouting?.status === 'unknown' || entry.hubRouting?.limitations?.length)
  const remoteOnlySources = attachments.filter((entry) => {
    const hub = topology.hubs.find((hub) => hub.id === entry.hubId)
    if (!hub) return false
    const config = attachmentHubRouting(topology, entry.id)
    return config.status !== 'unknown' && !config.propagatedTableIds.includes(NONE_HUB_TABLE)
      && !hubRouteTables(hub).some((table) => propagatesLocally(config, table))
  })
  const unsupportedSources = topology.hubs.flatMap((hub) => hubRouteTables(hub)
    .filter((table) => table.staticRoutes?.length || ((hub.routingIntent.private || hub.routingIntent.internet)
      && hubRouteTables(hub).some((entry) => ![DEFAULT_HUB_TABLE, NONE_HUB_TABLE].includes(entry.id))))
    .map((table) => ({ hubId: hub.id, table })))
  return Object.fromEntries(topology.hubs.map((hub) => [hub.id, Object.fromEntries(hubRouteTables(hub).map((table) => {
    const unsupported = unsupportedSources.some((source) => source.hubId === hub.id && source.table.id === table.id
      || source.table.labels.some((label) => table.labels.includes(label))
      || attachments.some((entry) => {
        if (entry.hubId !== source.hubId || entry.hubId === hub.id) return false
        const config = attachmentHubRouting(topology, entry.id)
        const originTables = hubRouteTables(topology.hubs.find((origin) => origin.id === source.hubId)!)
        return propagatesLocally(config, source.table) && propagatesRemotely(config, source.table, table, originTables)
      }))
      || remoteOnlySources.some((source) => source.hubId !== hub.id
        && propagationLabels(attachmentHubRouting(topology, source.id)).some((label) => table.labels.includes(label)))
      || attachments.some((source) => {
        if (source.hubId === hub.id) return false
        const origin = topology.hubs.find((entry) => entry.id === source.hubId)
        if (!origin) return false
        const config = attachmentHubRouting(topology, source.id)
        const labels = propagationLabels(config).filter((label) => table.labels.includes(label))
        const origins = hubRouteTables(origin)
        return labels.length > 0 && !origins.some((entry) => entry.id !== NONE_HUB_TABLE && labels.some((label) => entry.labels.includes(label)))
          && origins.some((entry) => entry.id !== DEFAULT_HUB_TABLE && propagatesLocally(config, entry))
      })
      || (table.id !== DEFAULT_HUB_TABLE && table.id !== NONE_HUB_TABLE
        && topology.hubs.some((origin) => origin.routingIntent.private || origin.routingIntent.internet))
    const complete = !unknownPropagation && !unsupported
    return [table.id, { complete, limitations: complete ? [] : [hubRoutingCoverageMessage] }]
  }))]))
}
