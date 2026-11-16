import { createEmptyAzNetTopology } from '../azure-net/model'
import type { CourseBundle } from './course-contract'

const peering = createEmptyAzNetTopology()
peering.name = 'Guided peering example'
peering.vnets = ['a', 'b'].map((id, index) => ({
  id, name: `Workload ${id.toUpperCase()}`, role: 'spoke', region: 'swedencentral',
  prefixes: [`10.${index + 1}.0.0/16`],
  subnets: [{ id: `work-${id}`, name: 'Workload', prefix: `10.${index + 1}.1.0/24` }],
  gateways: [], appliances: [],
}))

const routeOverride = structuredClone(peering)
routeOverride.name = 'Peering with a conflicting UDR'
const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
routeOverride.vnetPeerings.push({
  id: 'existing-peering', name: 'A to B', vnetAId: 'a', vnetBId: 'b', enabled: true,
  aToB: flags, bToA: { ...flags },
})
routeOverride.vnets[0].subnets[0].routeTableId = 'blocking'
routeOverride.udrTables.push({
  id: 'blocking', name: 'Conflicting UDR', disableBgpRoutePropagation: false,
  routes: [{ id: 'drop-b', name: 'Drop B', prefix: '10.2.0.0/16', nextHopType: 'None', enabled: true }],
})

export const courseScenarios: CourseBundle['scenarios'] = [
  { id: 'two-vnets', document: { mode: 'full', topology: peering } },
  { id: 'peered-with-drop', document: { mode: 'full', topology: routeOverride } },
]
