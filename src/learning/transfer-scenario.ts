import { createEmptyAzNetTopology } from '../azure-net/model'
import type { FlowRequirement } from '../platform/contract'

export function transferLessonTopology() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'New team handover'
  topology.vnets = [
    { id: 'orders', name: 'Orders', role: 'spoke', region: 'swedencentral', prefixes: ['10.141.0.0/16'],
      subnets: [{ id: 'orders-app', name: 'Application', prefix: '10.141.3.0/24', routeTableId: 'orders-policy' },
        { id: 'orders-ops', name: 'Operations', prefix: '10.141.4.0/24' }], gateways: [], appliances: [] },
    { id: 'supplier', name: 'Supplier', role: 'spoke', region: 'swedencentral', prefixes: ['10.142.0.0/16'],
      subnets: [{ id: 'supplier-api', name: 'Service', prefix: '10.142.7.0/24', routeTableId: 'service-policy' }], gateways: [], appliances: [] },
    { id: 'tenant', name: 'Restricted tenant', role: 'spoke', region: 'swedencentral', prefixes: ['10.143.0.0/16'],
      subnets: [{ id: 'tenant-work', name: 'Workload', prefix: '10.143.1.0/24' }], gateways: [], appliances: [] },
  ]
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
  topology.vnetPeerings = [{ id: 'orders-supplier', name: 'Orders - Supplier', vnetAId: 'orders', vnetBId: 'supplier',
    enabled: true, aToB: { ...flags }, bToA: { ...flags } }]
  topology.udrTables = [
    { id: 'orders-policy', name: 'Orders policy', disableBgpRoutePropagation: false, routes: [] },
    { id: 'service-policy', name: 'Service policy', disableBgpRoutePropagation: false, routes: [
      { id: 'change-window', name: 'Change window', prefix: '10.141.3.0/24', nextHopType: 'None', enabled: true },
    ] },
  ]
  return topology
}

const orders = { kind: 'subnet' as const, vnetId: 'orders', subnetId: 'orders-app' }
const supplier = { kind: 'subnet' as const, vnetId: 'supplier', subnetId: 'supplier-api' }
const operations = { kind: 'subnet' as const, vnetId: 'orders', subnetId: 'orders-ops' }
const tenant = { kind: 'subnet' as const, vnetId: 'tenant', subnetId: 'tenant-work' }
export const transferLessonRequirements: FlowRequirement[] = [
  { id: 'handover-service', kind: 'flow', source: orders, target: supplier,
    sourceAddress: '10.141.3.10', destinationAddress: '10.142.7.20', expectation: 'allow' },
  { id: 'handover-local-operations', kind: 'flow', source: orders, target: operations,
    sourceAddress: '10.141.3.10', destinationAddress: '10.141.4.10', expectation: 'allow' },
  { id: 'handover-supplier-operations', kind: 'flow', source: supplier, target: operations,
    sourceAddress: '10.142.7.20', destinationAddress: '10.141.4.10', expectation: 'allow' },
  { id: 'handover-tenant-out', kind: 'flow', source: orders, target: tenant,
    sourceAddress: '10.141.3.10', destinationAddress: '10.143.1.10', expectation: 'deny' },
  { id: 'handover-tenant-in', kind: 'flow', source: tenant, target: orders,
    sourceAddress: '10.143.1.10', destinationAddress: '10.141.3.10', expectation: 'deny' },
]
