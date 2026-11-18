import { createEmptyAzNetTopology } from '../../src/azure-net/model'

export function nvaBgpTopology() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'One NVA, two regional Route Servers'
  topology.vnets = [
    ...['west', 'east'].map((region, index) => ({
      id: region, name: `${region} hub`, region: index ? 'northeurope' : 'westeurope', role: 'hub' as const,
      prefixes: [`10.${10 + index}.0.0/16`],
      subnets: [
        { id: `${region}-nvas`, name: 'NVAs', prefix: `10.${10 + index}.1.0/24` },
        { id: `${region}-ars-subnet`, name: 'RouteServerSubnet', prefix: `10.${10 + index}.255.0/27` },
      ],
      gateways: [],
      appliances: [{
        id: `${region}-source`, name: `${region} advertising NVA`, kind: 'nva-vm' as const,
        subnetId: `${region}-nvas`, privateIp: `10.${10 + index}.1.4`, asn: 65020 + index,
        bgpEnabled: true, enableIpForwarding: true, staticRoutes: [],
        advertisedPrefixes: ['198.18.0.0/24', `198.19.${index}.0/24`],
        advertisedRouteAttributes: [{ prefix: '198.18.0.0/24', communities: [`65020:${index + 1}`] }],
      }],
      routeServer: {
        id: `${region}-ars`, name: `${region} Route Server`, subnetId: `${region}-ars-subnet`,
        enabled: true, branchToBranchTraffic: false, hubRoutingPreference: 'ASPath' as const,
        peerApplianceIds: [`${region}-source`, 'reader'],
      },
    })),
    {
      id: 'shared', name: 'NVA host', region: 'westeurope', role: 'spoke',
      prefixes: ['10.30.0.0/16'], subnets: [{ id: 'reader-subnet', name: 'Reader subnet', prefix: '10.30.1.0/24' }],
      gateways: [], appliances: [{
        id: 'reader', name: 'Dual-region NVA', kind: 'nva-vm', subnetId: 'reader-subnet',
        privateIp: '10.30.1.4', asn: 65010, bgpEnabled: true, enableIpForwarding: true,
        advertisedPrefixes: ['192.0.2.0/24'], staticRoutes: [],
      }],
    },
  ]
  topology.vnetPeerings = ['west', 'east'].map((region) => ({
    id: `${region}-shared`, name: `${region} to NVA host`, vnetAId: region, vnetBId: 'shared', enabled: true,
    aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
  }))
  return topology
}
