import { createEmptyAzNetTopology, type AzNetTopology, type AzVNet, type AzVnetPeering } from '../azure-net/model'
import { haLessonTopology } from './ha-scenario'

const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
const network = (id: string, octet: number): AzVNet => ({
  id, name: { a: 'Application', b: 'Partner', c: 'Restricted', hub: 'Inspection hub', transport: 'Transport', leaf: 'Indirect workload' }[id] ?? id,
  role: id === 'hub' ? 'hub' : 'spoke', region: 'swedencentral', prefixes: [`10.${octet}.0.0/16`],
  subnets: [{ id: `${id}-work`, name: 'Workload', prefix: `10.${octet}.1.0/24` }], gateways: [], appliances: [],
})
const peer = (a: string, b: string): AzVnetPeering => ({
  id: `peer-${a}-${b}`, name: `${a} - ${b}`, vnetAId: a, vnetBId: b, enabled: true, aToB: { ...flags }, bToA: { ...flags },
})
const route = (id: string, prefix: string, nextHopIp: string, enabled = true) => ({
  id, name: id, prefix, nextHopType: 'VirtualAppliance' as const, nextHopIp, enabled,
})
function base() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [network('a', 21), network('b', 22), network('c', 23)]
  topology.vnets[0].subnets.push({ id: 'a-ops', name: 'Operations', prefix: '10.21.2.0/24' })
  return topology
}
function table(topology: AzNetTopology, vnetId: string, subnetId: string, id: string, routes: ReturnType<typeof route>[]) {
  topology.vnets.find((vnet) => vnet.id === vnetId)!.subnets.find((subnet) => subnet.id === subnetId)!.routeTableId = id
  topology.udrTables.push({ id, name: id, disableBgpRoutePropagation: false, routes })
}
function router(vnet: AzVNet, id: string, subnetId: string, ip: string) {
  vnet.appliances.push({ id, name: id === 'fw' ? 'Inspection firewall' : id === 'sdwan' ? 'SD-WAN router' : 'Tier router',
    kind: 'nva-vm', subnetId, privateIp: ip, enableIpForwarding: true, inspectsTraffic: id === 'fw', staticRoutes: [] })
}
const privateLink = base()
privateLink.name = 'A private partner connection'

const bypass = base()
bypass.name = 'Connectivity without the required inspection'
const hub = network('hub', 20)
router(hub, 'fw', 'hub-work', '10.20.1.4')
bypass.vnets.push(hub)
bypass.vnetPeerings = [peer('a', 'hub'), peer('b', 'hub'), peer('a', 'b')]
table(bypass, 'a', 'a-work', 'application-policy', [route('private-summary', '10.0.0.0/8', '10.20.1.4')])
table(bypass, 'b', 'b-work', 'partner-policy', [route('private-summary-return', '10.0.0.0/8', '10.20.1.4')])

const colocated = structuredClone(bypass)
colocated.name = 'SD-WAN and firewall in one hub VNet'
colocated.vnetPeerings = [peer('a', 'hub'), peer('b', 'hub')]
colocated.udrTables[0].routes = [route('partner-path', '10.22.0.0/16', '10.20.1.4')]
colocated.udrTables[1].routes = [route('application-path', '10.21.0.0/16', '10.20.2.4')]
colocated.vnets[3].subnets.push({ id: 'transport-work', name: 'Transport', prefix: '10.20.2.0/24' })
router(colocated.vnets[3], 'sdwan', 'transport-work', '10.20.2.4')
table(colocated, 'hub', 'hub-work', 'inspection-onward', [route('partner-onward', '10.22.0.0/16', '10.20.2.4', false)])
table(colocated, 'hub', 'transport-work', 'transport-return', [route('application-onward', '10.21.0.0/16', '10.20.1.4')])

const dedicated = structuredClone(colocated)
dedicated.name = 'SD-WAN and firewall in separate VNets'
dedicated.vnets[3].subnets = dedicated.vnets[3].subnets.filter((subnet) => subnet.id !== 'transport-work')
dedicated.vnets[3].appliances = dedicated.vnets[3].appliances.filter((appliance) => appliance.id !== 'sdwan')
const transport = network('transport', 24)
router(transport, 'sdwan', 'transport-work', '10.24.1.4')
transport.appliances[0].enableIpForwarding = false
transport.subnets[0].routeTableId = 'transport-return'
dedicated.vnets.push(transport)
dedicated.vnetPeerings = [peer('a', 'hub'), peer('hub', 'transport'), peer('transport', 'b')]
dedicated.udrTables[1].routes[0].nextHopIp = '10.24.1.4'
dedicated.udrTables[2].routes[0].nextHopIp = '10.24.1.4'
dedicated.udrTables[2].routes[0].enabled = true

const branch = base()
branch.name = 'A branch prefix missing from the workload'
const gatewayHub = network('hub', 20)
gatewayHub.subnets = [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.20.255.0/27' }]
gatewayHub.gateways = [{ id: 'gw', name: 'Branch gateway', kind: 'Vpn', asn: 65515, bgpEnabled: true, enabled: true }]
branch.vnets.push(gatewayHub)
branch.vnetPeerings = [peer('hub', 'a')]
branch.vnetPeerings[0].aToB.allowGatewayTransit = true
branch.vnetPeerings[0].bToA.useRemoteGateways = true
branch.sites = [{ id: 'branch', name: 'Branch office', asn: 65021, prefixes: ['172.22.0.0/24'] }]
branch.vpnConnections = [{ id: 'vpn', name: 'Branch connection', siteId: 'branch', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true }]
table(branch, 'a', 'a-work', 'workload-learning', [])
branch.udrTables[0].disableBgpRoutePropagation = true

const isolation = base()
isolation.name = 'Shared service reach with a restricted tenant'
isolation.vwanHubs = [{ id: 'wan', name: 'Regional WAN', region: 'swedencentral', preference: 'ExpressRoute',
  routingIntent: { private: false, internet: false } }]
for (const vnet of isolation.vnets) vnet.vwanHubAttachment = {
  hubId: 'wan', enabled: true, hubRouting: { status: 'configured',
    associatedTableId: vnet.id === 'c' ? 'noneRouteTable' : 'defaultRouteTable',
    propagatedTableIds: vnet.id === 'a' ? ['defaultRouteTable'] : ['noneRouteTable'], labels: [] },
}

const tiered = structuredClone(dedicated)
tiered.name = 'An indirect tier with two independent routing faults'
tiered.vnets.find((vnet) => vnet.id === 'transport')!.appliances[0].enableIpForwarding = true
const application = tiered.vnets[0]
application.subnets.push({ id: 'tier-work', name: 'Tier transit', prefix: '10.21.3.0/24' })
router(application, 'tier', 'tier-work', '10.21.3.4')
tiered.vnets.push(network('leaf', 25))
tiered.vnetPeerings.push(peer('leaf', 'a'))
table(tiered, 'leaf', 'leaf-work', 'indirect-egress', [route('partner-service', '10.22.0.0/16', '10.21.3.4', false)])
table(tiered, 'a', 'tier-work', 'tier-onward', [route('partner-transit', '10.22.0.0/16', '10.20.1.4')])
tiered.udrTables.find((entry) => entry.id === 'inspection-onward')!.routes.push(route('indirect-return', '10.25.0.0/16', '10.24.1.4'))
tiered.udrTables.find((entry) => entry.id === 'partner-policy')!.routes.push(route('indirect-partner-return', '10.25.0.0/16', '10.24.1.4'))
tiered.udrTables.find((entry) => entry.id === 'transport-return')!.routes.push(route('indirect-transport-return', '10.25.0.0/16', '10.20.1.4'))

export const scenarioTopologies: Record<string, AzNetTopology> = {
  'private-link': privateLink, 'inspection-bypass': bypass, 'colocated-chain': colocated, 'dedicated-chain': dedicated,
  'branch-advertisement': branch, 'wan-isolation': isolation, 'tiered-incident': tiered,
  'ha-return-path': haLessonTopology(),
}
