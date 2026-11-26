import { createEmptyAzNetTopology } from '../../src/azure-net/model'
import type { WorkloadEndpoint } from '../../src/packet-flow'

export const overlapEndpoint = (network: string, role = 'client'): WorkloadEndpoint => ({
  kind: 'workload', workloadId: `${network}-${role}`, nicId: `${network}-${role}-nic`, ipConfigurationId: `${network}-${role}-ip`,
})

export function overlappingVnets() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Isolated overlapping networks'
  topology.vnets = ['a', 'b'].map((id, index) => ({
    id, name: `Network ${id.toUpperCase()}`, role: 'standalone', region: 'westeurope', prefixes: ['100.64.0.0/16'],
    subnets: [{ id: `${id}-app`, name: 'Application', prefix: '100.64.1.0/24', defaultOutboundAccess: false },
      { id: `${id}-data`, name: 'Data', prefix: '100.64.2.0/24', defaultOutboundAccess: false }],
    gateways: [], appliances: [], x: 200 + index * 450, y: 200,
  }))
  topology.inventory = {
    publicIps: [],
    workloads: ['a', 'b'].flatMap((network) => ['client', 'server'].map((role) => ({
      id: `${network}-${role}`, name: `${role} ${network.toUpperCase()}`, nicIds: [`${network}-${role}-nic`],
    }))),
    nics: ['a', 'b'].flatMap((network) => ['client', 'server'].map((role) => ({
      id: `${network}-${role}-nic`, name: `${role} NIC`, owner: { kind: 'vnet', id: network },
      ipConfigurations: [{ id: `${network}-${role}-ip`, name: 'Primary', subnetId: `${network}-${role === 'client' ? 'app' : 'data'}`,
        privateIp: `100.64.${role === 'client' ? 1 : 2}.4` }],
    }))),
  }
  return topology
}
