import type { AzNetTopology } from './model'

export function indirectFirewallTopology() {
  const topology: AzNetTopology = {
    version: 2, kind: 'azure-network-topology', name: '',
    vnets: [], vnetPeerings: [], udrTables: [], vwanHubs: [],
    erLocations: [], erLinks: [], erGlobalReachLinks: [], sites: [], vpnConnections: [], siteLinks: [],
  }
  topology.name = 'Virtual WAN indirect spoke through Azure Firewall'
  topology.vwanHubs = [{
    id: 'wan', name: 'Virtual hub', region: 'westeurope', preference: 'ExpressRoute',
    routingIntent: { private: false, internet: false },
  }]
  topology.vnets = [{
    id: 'security', name: 'Security spoke', region: 'westeurope', role: 'transit-vnet', prefixes: ['10.0.0.0/16'],
    subnets: [{ id: 'fw-subnet', name: 'AzureFirewallSubnet', prefix: '10.0.0.0/26' }],
    gateways: [],
    appliances: [{
      id: 'fw', name: 'Spoke Azure Firewall', kind: 'azure-firewall', subnetId: 'fw-subnet',
      privateIp: '10.0.0.4', enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [],
    }],
    vwanHubAttachment: {
      hubId: 'wan', enabled: true, propagateStaticRoutes: true,
      staticRoutes: [{ name: 'Indirect spoke', addressPrefixes: ['10.2.0.0/16'], nextHopIpAddress: '10.0.0.4' }],
    },
  }, {
    id: 'direct', name: 'Direct spoke', region: 'westeurope', role: 'spoke-vnet', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 'direct-work', name: 'Workload', prefix: '10.1.1.0/24' }], gateways: [], appliances: [],
    vwanHubAttachment: { hubId: 'wan', enabled: true },
  }, {
    id: 'indirect', name: 'Indirect spoke', region: 'westeurope', role: 'spoke-vnet', prefixes: ['10.2.0.0/16'],
    subnets: [{ id: 'indirect-work', name: 'Workload', prefix: '10.2.1.0/24', routeTableId: 'return-routes' }],
    gateways: [], appliances: [],
  }]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  topology.vnetPeerings = [{
    id: 'indirect-peering', name: 'Security to indirect spoke', enabled: true, vnetAId: 'security', vnetBId: 'indirect',
    aToB: { ...flags }, bToA: { ...flags },
  }]
  topology.udrTables = [{
    id: 'return-routes', name: 'Indirect return through Firewall', disableBgpRoutePropagation: false,
    routes: [{ id: 'return', name: 'Return through Firewall', prefix: '10.0.0.0/8',
      nextHopType: 'VirtualAppliance', nextHopIp: '10.0.0.4', enabled: true }],
  }]
  return topology
}
