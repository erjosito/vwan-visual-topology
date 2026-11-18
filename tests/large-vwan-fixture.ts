import { contextObservationFixture } from './azure-observation-fixture'

/** Synthetic, not a customer capture. Distinct ARM identities share one explicit WAN. */
export function largeVwanCapture(count = 200, hubCount = 1, prefixCount = 4) {
  const source = contextObservationFixture()
  source.capturedAt = '2026-11-18T12:00:00Z'
  source.observations.startedAt = source.capturedAt
  source.observations.completedAt = source.capturedAt
  source.observations.tables.forEach((table) => { table.capturedAt = source.capturedAt })
  const template = source.hubs[0]
  const hubs = Array.from({ length: hubCount }, (_, h) => {
    const id = template.id.replace('/west', `/synthetic-${h}`)
    const connections = Array.from({ length: count }, (_, i) => i).filter((i) => i % hubCount === h).map((i) => ({
      ...template.connections[0],
      id: `${id}/hubVirtualNetworkConnections/vnet-${i}`,
      name: `Synthetic VNet ${i}`,
      virtualNetworkId: template.connections[0].virtualNetworkId.replace(/\/a$/, `/synthetic-${i}`),
      addressPrefixes: Array.from({ length: prefixCount }, (_, p) => `10.${i + 1}.${p}.0/24`),
      routingConfiguration: { status: 'captured', associatedTableId: `${id}/hubRouteTables/defaultRouteTable`,
        propagatedTableIds: [`${id}/hubRouteTables/defaultRouteTable`], labels: ['default'], unsupportedControls: [] as string[] },
    }))
    return { ...template, id, name: `Synthetic hub ${h}`, addressPrefix: `172.16.${h}.0/24`, connections,
      routeTables: template.routeTables.slice(0, 2).map((table) => ({ ...table, id: table.id.replace(template.id, id) })) }
  })
  return {
    ...source, wan: { ...source.wan, name: 'Synthetic large WAN' }, hubs,
    observations: { ...source.observations, tables: hubs.map((hub) => ({
      ...source.observations.tables[0], hubResourceId: hub.id, resourceId: `${hub.id}/hubRouteTables/defaultRouteTable`,
      status: 'complete',
      routes: hub.connections.map((connection) => ({
        addressPrefixes: connection.addressPrefixes, nextHopType: 'Virtual Network Connection',
        nextHops: [connection.id], routeOrigin: connection.id, asPath: '',
      })),
    })) },
  }
}
