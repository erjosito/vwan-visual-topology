import { createEmptyAzNetTopology } from '../azure-net/model'
import type { Requirement } from '../platform/contract'

export function hybridLessonTopology() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'ExpressRoute preference is not a backup test'
  topology.vnets = [
    { id: 'hybrid-hub', name: 'Hybrid hub', region: 'swedencentral', role: 'hub', prefixes: ['10.90.0.0/16'],
      subnets: [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.90.255.0/27' }],
      gateways: [
        { id: 'primary-er', name: 'ExpressRoute gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true },
        { id: 'backup-vpn', name: 'VPN gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true, activeActive: false },
      ], appliances: [] },
    { id: 'hybrid-app', name: 'Application', region: 'swedencentral', role: 'spoke', prefixes: ['10.91.0.0/16'],
      subnets: [{ id: 'work', name: 'Workload', prefix: '10.91.1.0/24' },
        { id: 'ops', name: 'Operations', prefix: '10.91.2.0/24' }], gateways: [], appliances: [] },
    { id: 'hybrid-tenant', name: 'Restricted tenant', region: 'swedencentral', role: 'spoke', prefixes: ['10.92.0.0/16'],
      subnets: [{ id: 'restricted', name: 'Restricted', prefix: '10.92.1.0/24' }], gateways: [], appliances: [] },
  ]
  topology.vnetPeerings = [{
    id: 'hybrid-sharing', name: 'Shared hybrid gateways', vnetAId: 'hybrid-hub', vnetBId: 'hybrid-app', enabled: true,
    aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
    bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
  }]
  topology.sites = [{
    id: 'hybrid-branch', name: 'Branch services', asn: 65090, prefixes: ['172.28.10.0/24', '172.28.20.0/24'],
    routeMapAssignments: [{ connectionId: 'branch-er', outboundMapId: 'branch-er-summary' }],
  }]
  topology.erLocations = [{ id: 'hybrid-location', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Premium' }]
  topology.erLinks = [
    { id: 'azure-er', name: 'Azure ExpressRoute attachment', locationId: 'hybrid-location', targetKind: 'vnet-gateway', targetId: 'primary-er', enabled: true },
    { id: 'branch-er', name: 'Branch ExpressRoute attachment', locationId: 'hybrid-location', targetKind: 'site', targetId: 'hybrid-branch', enabled: true },
  ]
  topology.vpnConnections = [{ id: 'branch-vpn', name: 'Branch VPN backup', siteId: 'hybrid-branch',
    targetKind: 'vnet-gateway', targetId: 'backup-vpn', enabled: false, bgpEnabled: true }]
  topology.routeMaps = [{
    id: 'branch-er-summary', name: 'Branch ER export summary', siteId: 'hybrid-branch',
    rules: [
      { id: 'summarize-service', prefixes: ['172.28.10.0/24'], match: 'equals', action: 'summarize',
        summaryPrefixes: ['172.28.0.0/16'], prepend: [], nextStep: 'terminate' },
      { id: 'retain-other-service', prefixes: [], match: 'contains', action: 'permit',
        summaryPrefixes: [], prepend: [], nextStep: 'terminate' },
    ],
  }]
  return topology
}

export const hybridLessonRequirements: Requirement[] = [
  { id: 'specific-vpn-route', kind: 'route', table: 'work', prefix: '172.28.10.0/24', expectation: 'present' },
  ...['10', '20'].map((octet) => ({
    id: `branch-service-${octet}`, kind: 'flow' as const,
    source: { kind: 'subnet' as const, vnetId: 'hybrid-app', subnetId: 'work' },
    target: { kind: 'site' as const, siteId: 'hybrid-branch' },
    sourceAddress: '10.91.1.10', destinationAddress: `172.28.${octet}.10`, expectation: 'allow' as const,
  })),
  { id: 'hybrid-operations', kind: 'flow',
    source: { kind: 'subnet', vnetId: 'hybrid-app', subnetId: 'work' },
    target: { kind: 'subnet', vnetId: 'hybrid-app', subnetId: 'ops' },
    sourceAddress: '10.91.1.10', destinationAddress: '10.91.2.10', expectation: 'allow' },
  { id: 'hybrid-tenant-isolation', kind: 'flow',
    source: { kind: 'subnet', vnetId: 'hybrid-app', subnetId: 'work' },
    target: { kind: 'subnet', vnetId: 'hybrid-tenant', subnetId: 'restricted' },
    sourceAddress: '10.91.1.10', destinationAddress: '10.92.1.10', expectation: 'deny' },
]
