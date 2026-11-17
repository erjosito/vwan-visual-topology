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

const prefixOutage = structuredClone(routeOverride)
prefixOutage.name = 'Incident: only one workload subnet is down'
prefixOutage.udrTables[0].routes[0].prefix = '10.2.1.0/24'
prefixOutage.udrTables[0].routes[0].name = 'Retired workload quarantine'
prefixOutage.udrTables[0].routes.push({
  id: 'broad-discard', name: 'Broad private discard', prefix: '10.0.0.0/8', nextHopType: 'None', enabled: true,
})
prefixOutage.vnets[1].subnets.push({ id: 'work-batch', name: 'Batch processing', prefix: '10.2.2.0/24' })

const gatewayReturn = createEmptyAzNetTopology()
gatewayReturn.name = 'Incident: the branch cannot reply'
gatewayReturn.vnets = [
  structuredClone(peering.vnets[0]),
  {
    id: 'hub', name: 'Classic hub', role: 'hub', region: 'swedencentral', prefixes: ['10.0.0.0/16'],
    subnets: [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27', routeTableId: 'return-policy' }],
    gateways: [{ id: 'gw', name: 'Shared VPN gateway', kind: 'Vpn', asn: 65515, bgpEnabled: true, enabled: true }],
    appliances: [],
  },
]
gatewayReturn.vnetPeerings.push({
  id: 'gateway-transit', name: 'Shared gateway transit', vnetAId: 'hub', vnetBId: 'a', enabled: true,
  aToB: { ...flags, allowGatewayTransit: true },
  bToA: { ...flags, useRemoteGateways: true },
})
gatewayReturn.sites.push({ id: 'branch', name: 'Branch office', asn: 65001, prefixes: ['172.16.0.0/24'] })
gatewayReturn.vpnConnections.push({
  id: 'branch-vpn', name: 'Branch VPN', siteId: 'branch', targetKind: 'vnet-gateway',
  targetId: 'gw', bgpEnabled: true, enabled: true,
})
gatewayReturn.udrTables.push({
  id: 'return-policy', name: 'Gateway return policy', disableBgpRoutePropagation: false,
  routes: [{ id: 'drop-return', name: 'Retired workload quarantine', prefix: '10.1.0.0/16', nextHopType: 'None', enabled: true }],
})

export const courseScenarios: CourseBundle['scenarios'] = [
  { id: 'two-vnets', document: { mode: 'full', topology: peering } },
  { id: 'peered-with-drop', document: { mode: 'full', topology: routeOverride } },
  { id: 'prefix-outage', document: { mode: 'full', topology: prefixOutage } },
  { id: 'gateway-return', document: { mode: 'full', topology: gatewayReturn } },
]
