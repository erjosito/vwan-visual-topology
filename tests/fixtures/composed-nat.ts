import { createEmptyAzNetTopology } from '../../src/azure-net/model'
import type { PacketRequest } from '../../src/packet-flow'

export function composedNat(routerCount = 2) {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Explicit private NVA SNAT chain'
  const owner = { kind: 'vnet' as const, id: 'network' }
  const routers = ['first', 'second', 'third', 'fourth', 'fifth'].slice(0, routerCount)
  const steering = ['client', ...routers.slice(0, -1)]
  const roles = ['client', ...routers, 'server']
  const destination = `10.90.${roles.length}.0/24`
  topology.vnets = [{ id: owner.id, name: 'Private network', region: 'westeurope', role: 'standalone', prefixes: ['10.90.0.0/16'],
    subnets: roles.map((id, index) => ({ id: `${id}-subnet`, name: id, prefix: `10.90.${index + 1}.0/24`, defaultOutboundAccess: false,
      ...(steering.includes(id) ? { routeTableId: `${id}-routes` } : {}) })),
    gateways: [], appliances: routers.map((id, index) => ({ id, name: `${id} NVA`, kind: 'nva-vm',
      subnetId: `${id}-subnet`, privateIp: `10.90.${index + 2}.4`, enableIpForwarding: true, staticRoutes: [] })), x: 250, y: 200 }]
  topology.udrTables = steering.map((id, index) => ({
    id: `${id}-routes`, name: `${id} routes`, disableBgpRoutePropagation: false,
    routes: [{ id: `${id}-server`, name: 'Server through next NVA', prefix: destination,
      nextHopType: 'VirtualAppliance', nextHopIp: `10.90.${index + 2}.4`, enabled: true }],
  }))
  topology.inventory = {
    publicIps: [],
    workloads: roles.map((id) => ({ id: `${id}-vm`, name: id, nicIds: [`${id}-nic`], ...(routers.includes(id) ? { backingDeviceId: id } : {}) })),
    nics: roles.map((id, index) => ({ id: `${id}-nic`, name: `${id} NIC`, owner,
      ipConfigurations: [{ id: `${id}-ip`, name: 'Primary', subnetId: `${id}-subnet`, privateIp: `10.90.${index + 1}.4` }] })),
    routerSnatPolicies: routers.map((id, index) => ({ owner: { kind: 'appliance', id }, kind: 'nva-snat',
      publicIpIds: [], sourcePrefixes: [`10.90.${index + 1}.0/24`], destinationPrefixes: [destination], protocol: 'any' })),
  }
  return topology
}

export const composedNatRequest: PacketRequest = {
  source: { kind: 'workload', workloadId: 'client-vm', nicId: 'client-nic', ipConfigurationId: 'client-ip' },
  target: { kind: 'workload', workloadId: 'server-vm', nicId: 'server-nic', ipConfigurationId: 'server-ip' },
  protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
}
