import { createEmptyAzNetTopology, type AzNetTopology } from '../../src/azure-net/model'
import type { Requirement } from '../../src/platform/contract'

export function haRoutingTopology(): AzNetTopology {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Dual NVA branch maintenance'
  topology.vnets = [
    {
      id: 'hub', name: 'Transit hub', region: 'swedencentral', role: 'hub', prefixes: ['10.80.0.0/16'],
      subnets: [
        { id: 'primary-subnet', name: 'Primary transit', prefix: '10.80.1.0/24' },
        { id: 'standby-subnet', name: 'Standby transit', prefix: '10.80.2.0/24' },
        { id: 'ars-subnet', name: 'RouteServerSubnet', prefix: '10.80.255.0/27' },
      ],
      gateways: [],
      appliances: [
        {
          id: 'primary', name: 'Preferred NVA', kind: 'nva-vm', subnetId: 'primary-subnet', privateIp: '10.80.1.4',
          asn: 65080, bgpEnabled: true, enableIpForwarding: true, inspectsTraffic: true,
          advertisedPrefixes: ['172.31.80.0/24'], staticRoutes: [],
        },
        {
          id: 'standby', name: 'Standby NVA', kind: 'nva-vm', subnetId: 'standby-subnet', privateIp: '10.80.2.4',
          asn: 65081, bgpEnabled: true, enableIpForwarding: true, inspectsTraffic: true,
          advertisedPrefixes: ['172.31.80.0/24'],
          advertisedRouteAttributes: [{ prefix: '172.31.80.0/24', asPath: [65081, 65081] }], staticRoutes: [],
        },
      ],
      routeServer: {
        id: 'ars', name: 'Transit Route Server', subnetId: 'ars-subnet', enabled: true,
        branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: ['primary', 'standby'],
      },
    },
    {
      id: 'application', name: 'Application', role: 'spoke', region: 'swedencentral', prefixes: ['10.81.0.0/16'],
      subnets: [
        { id: 'work', name: 'Workload', prefix: '10.81.1.0/24' },
        { id: 'ops', name: 'Operations', prefix: '10.81.2.0/24' },
      ],
      gateways: [], appliances: [],
    },
  ]
  topology.vnetPeerings = [{
    id: 'hub-application', name: 'Transit to application', vnetAId: 'hub', vnetBId: 'application', enabled: true,
    aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
    bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
  }]
  topology.sites = [{ id: 'branch', name: 'Maintenance branch', asn: 65090, prefixes: ['172.31.80.0/24'] }]
  topology.vpnConnections = [
    { id: 'primary-overlay', name: 'Preferred branch overlay', siteId: 'branch', targetKind: 'appliance',
      targetId: 'primary', bgpEnabled: true, enabled: true },
    { id: 'standby-overlay', name: 'Standby branch overlay', siteId: 'branch', targetKind: 'appliance',
      targetId: 'standby', bgpEnabled: true, outboundPrepend: [65081, 65081], enabled: true },
  ]
  return topology
}

export function withdrawHaPrimary(topology: AzNetTopology) {
  topology.vpnConnections.find((connection) => connection.id === 'primary-overlay')!.enabled = false
  topology.vnets[0].appliances.find((appliance) => appliance.id === 'primary')!.advertisedPrefixes = []
}

export function haRoutingRequirements(applianceId: 'primary' | 'standby'): Requirement[] {
  return [
    {
      id: 'branch-conversation', kind: 'flow',
      source: { kind: 'subnet', vnetId: 'application', subnetId: 'work' }, target: { kind: 'site', siteId: 'branch' },
      sourceAddress: '10.81.1.10', destinationAddress: '172.31.80.10',
      expectation: 'allow', applianceChain: { forward: [applianceId], reverse: [applianceId] },
    },
    {
      id: 'branch-prefix', kind: 'route', table: 'work', prefix: '172.31.80.0/24', expectation: 'present',
    },
    {
      id: 'local-operations', kind: 'flow',
      source: { kind: 'subnet', vnetId: 'application', subnetId: 'work' },
      target: { kind: 'subnet', vnetId: 'application', subnetId: 'ops' },
      sourceAddress: '10.81.1.10', destinationAddress: '10.81.2.10', expectation: 'allow',
    },
  ]
}
