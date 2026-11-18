import { createEmptyAzNetTopology, type AzVNet } from '../azure-net/model'
import type { Requirement } from '../platform/contract'

export function multihubLessonTopology() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'A return route is not a two-way service'
  topology.vwanHubs = [
    { id: 'west-hub', name: 'West hub', region: 'swedencentral', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false },
      routeTables: [{ id: 'west-workloads', name: 'West workloads', labels: ['Shared'] }] },
    { id: 'east-hub', name: 'East hub', region: 'westeurope', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false }, routeTables: [
        { id: 'east-services', name: 'East services', labels: ['shared'] },
        { id: 'tenant-only', name: 'Tenant only', labels: ['tenant'] },
      ] },
  ]
  const network = (id: string, name: string, octet: number, subnetId: string, hubId: string, tableId: string, label: string): AzVNet => ({
    id, name, role: 'spoke', region: hubId === 'west-hub' ? 'swedencentral' : 'westeurope',
    prefixes: [`10.${octet}.0.0/16`], subnets: [{ id: subnetId, name: 'Workload', prefix: `10.${octet}.1.0/24` }],
    gateways: [], appliances: [], vwanHubAttachment: { hubId, enabled: true, hubRouting: {
      status: 'configured', associatedTableId: tableId, propagatedTableIds: [tableId], labels: [label],
    } },
  })
  topology.vnets = [
    network('west-client', 'West application', 101, 'client-work', 'west-hub', 'west-workloads', 'shared'),
    network('east-service', 'East shared service', 102, 'service-work', 'east-hub', 'east-services', 'shared'),
    network('east-tenant', 'Restricted tenant', 103, 'tenant-work', 'east-hub', 'tenant-only', 'tenant'),
    network('west-ops', 'West Operations', 104, 'ops-work', 'west-hub', 'west-workloads', 'shared'),
  ]
  return topology
}

const client = { kind: 'subnet' as const, vnetId: 'west-client', subnetId: 'client-work' }
const tenant = { kind: 'subnet' as const, vnetId: 'east-tenant', subnetId: 'tenant-work' }
export const multihubLessonRequirements: Requirement[] = [
  { id: 'inter-hub-service', kind: 'flow', source: client, sourceAddress: '10.101.1.10',
    target: { kind: 'subnet', vnetId: 'east-service', subnetId: 'service-work' }, destinationAddress: '10.102.1.10', expectation: 'allow' },
  { id: 'west-operations', kind: 'flow', source: client, sourceAddress: '10.101.1.10',
    target: { kind: 'subnet', vnetId: 'west-ops', subnetId: 'ops-work' }, destinationAddress: '10.104.1.10', expectation: 'allow' },
  { id: 'west-to-tenant-isolation', kind: 'flow', source: client, sourceAddress: '10.101.1.10',
    target: tenant, destinationAddress: '10.103.1.10', expectation: 'deny' },
  { id: 'tenant-to-west-isolation', kind: 'flow', source: tenant, sourceAddress: '10.103.1.10',
    target: client, destinationAddress: '10.101.1.10', expectation: 'deny' },
  { id: 'west-service-table', kind: 'route', table: 'west-hub', hubTableId: 'west-workloads', prefix: '10.102.0.0/16', expectation: 'present' },
  { id: 'east-reply-table', kind: 'route', table: 'east-hub', hubTableId: 'east-services', prefix: '10.101.0.0/16', expectation: 'present' },
  { id: 'west-tenant-absence', kind: 'route', table: 'west-hub', hubTableId: 'west-workloads', prefix: '10.103.0.0/16', expectation: 'absent' },
  { id: 'tenant-west-absence', kind: 'route', table: 'east-hub', hubTableId: 'tenant-only', prefix: '10.101.0.0/16', expectation: 'absent' },
  { id: 'default-is-not-the-source', kind: 'route', table: 'west-hub', hubTableId: 'defaultRouteTable', prefix: '10.102.0.0/16', expectation: 'absent' },
]
