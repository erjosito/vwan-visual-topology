import { nvaBgpTopology } from './nva-bgp'
import type { Topology } from '../../src/model'

export function bgpNeighborVwanTopology(): Topology {
  return {
    version: 1, name: 'Synthetic managed VWAN neighbor boundary',
    hubs: [{ id: 'managed-hub', name: 'Managed hub', region: 'westeurope', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
    sites: [{ id: 'branch', name: 'Synthetic branch', asn: 65050, prefixes: ['203.0.113.0/24'] }],
    spokes: [], siteLinks: [],
    connections: [{ id: 'managed-vpn', name: 'Managed VPN', hubId: 'managed-hub', siteId: 'branch', transport: 'VPN',
      enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] }],
  }
}

export function bgpNeighborTopology() {
  const topology = nvaBgpTopology()
  topology.name = 'Synthetic two-hub BGP neighbor reference'
  const west = topology.vnets[0]
  west.subnets.push({ id: 'west-gateway-subnet', name: 'GatewaySubnet', prefix: '10.10.254.0/27' })
  west.gateways.push({ id: 'vpn-aa', name: 'Active-active VPN', kind: 'Vpn', asn: 65515, activeActive: true, bgpEnabled: true, enabled: true })
  west.routeServer!.branchToBranchTraffic = true
  topology.vnets[1].gateways.push({ id: 'er-gateway', name: 'ExpressRoute gateway', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true })
  topology.vnets[1].subnets.push({ id: 'east-gateway-subnet', name: 'GatewaySubnet', prefix: '10.11.254.0/27' })
  topology.vnets.push({
    id: 'standalone', name: 'Standalone active-standby VNet', region: 'westeurope', role: 'standalone',
    prefixes: ['10.40.0.0/16'], subnets: [{ id: 'standalone-gateway', name: 'GatewaySubnet', prefix: '10.40.254.0/27' }],
    gateways: [{ id: 'vpn-as', name: 'Active-standby VPN', kind: 'Vpn', asn: 65515, activeActive: false, bgpEnabled: true, enabled: true }],
    appliances: [],
  })
  topology.sites = [{ id: 'branch', name: 'Synthetic on-prem router', asn: 65050, prefixes: ['203.0.113.0/24'] }]
  topology.vpnConnections = [
    { id: 'branch-aa', name: 'Branch active-active', siteId: 'branch', targetKind: 'vnet-gateway', targetId: 'vpn-aa', enabled: true, bgpEnabled: true },
    { id: 'branch-as', name: 'Branch active-standby', siteId: 'branch', targetKind: 'vnet-gateway', targetId: 'vpn-as', enabled: true, bgpEnabled: true },
  ]
  topology.erLocations = [{ id: 'edge-location', name: 'Frankfurt', peeringLocation: 'Frankfurt' }]
  topology.erLinks = [
    { id: 'er-site', name: 'Branch ER', locationId: 'edge-location', targetKind: 'site', targetId: 'branch', enabled: true },
    { id: 'er-azure', name: 'Azure ER', locationId: 'edge-location', targetKind: 'vnet-gateway', targetId: 'er-gateway', enabled: true },
  ]
  return topology
}
