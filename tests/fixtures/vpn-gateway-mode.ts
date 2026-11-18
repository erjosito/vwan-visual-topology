import { createEmptyAzNetTopology } from '../../src/azure-net/model'

export function vpnGatewayModeTopology() {
  const topology = createEmptyAzNetTopology()
  topology.vnets = [{
    id: 'hub', name: 'VPN mode hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
    subnets: [
      { id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27' },
      { id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.0.254.0/27' },
      { id: 'app', name: 'Application', prefix: '10.0.1.0/24' },
    ],
    gateways: [{ id: 'vpn', name: 'Standalone VPN', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true }],
    routeServer: { id: 'ars', name: 'ARS', enabled: true, subnetId: 'ars-subnet',
      branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: [] },
    appliances: [],
  }]
  topology.sites = [{ id: 'site', name: 'On-premises', asn: 65001, prefixes: ['192.0.2.0/24'] }]
  topology.vpnConnections = [{ id: 's2s', name: 'S2S', siteId: 'site', targetKind: 'vnet-gateway',
    targetId: 'vpn', enabled: true, bgpEnabled: true }]
  return topology
}
