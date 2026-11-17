import { haRoutingTopology } from './ha-routing'
import type { PacketRequest } from '../../src/packet-flow'
import type { NetworkLoadBalancer } from '../../src/inventory'

export const haBackend = (id: 'primary' | 'standby') => ({ workloadId: `${id}-vm`, nicId: `${id}-nic`, ipConfigurationId: `${id}-ip` })
export const haPacket: PacketRequest = { source: { kind: 'workload', workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' },
  target: { kind: 'workload', workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' },
  protocol: 'tcp', sourcePort: 49152, destinationPort: 443 }

export function haPortsTopology() {
  const topology = haRoutingTopology(), hub = topology.vnets[0]
  topology.name = 'Original internal HA ports transit'
  hub.subnets.push({ id: 'frontend-subnet', name: 'Transit frontend', prefix: '10.80.3.0/24' })
  topology.vnets.push({ id: 'remote', name: 'Remote workload', region: 'swedencentral', role: 'spoke',
    prefixes: ['10.82.0.0/16'], subnets: [{ id: 'remote-work', name: 'Remote workload', prefix: '10.82.1.0/24', routeTableId: 'remote-steering' }],
    gateways: [], appliances: [] })
  topology.vnetPeerings.push({ ...structuredClone(topology.vnetPeerings[0]), id: 'hub-remote', name: 'Transit to remote', vnetBId: 'remote' })
  topology.vnets[1].subnets[0].routeTableId = 'application-steering'
  topology.udrTables = [
    { id: 'application-steering', name: 'Application transit', disableBgpRoutePropagation: false,
      routes: ['172.31.80.0/24', '10.82.0.0/16'].map((prefix, index) => ({ id: `application-path-${index}`, name: 'Via transit VIP',
        prefix, nextHopType: 'VirtualAppliance' as const, nextHopIp: '10.80.3.10', enabled: true })) },
    { id: 'remote-steering', name: 'Independent remote return', disableBgpRoutePropagation: false,
      routes: [{ id: 'remote-path', name: 'Via transit VIP', prefix: '10.81.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.80.3.10', enabled: true }] },
  ]
  const lb: NetworkLoadBalancer = { id: 'transit-lb', name: 'Transit LB', sku: 'Standard', owner: { kind: 'vnet', id: 'hub' },
    frontends: [{ id: 'transit-vip', name: 'Transit VIP', kind: 'private', subnetId: 'frontend-subnet', privateIp: '10.80.3.10' }],
    pools: [{ id: 'transit-pool', name: 'Original NVAs', members: [haBackend('primary'), haBackend('standby')] }],
    probes: [{ id: 'transit-probe', name: 'Declared transit health', protocol: 'tcp', port: 8080,
      health: [{ target: haBackend('primary'), status: 'healthy' }, { target: haBackend('standby'), status: 'unhealthy' }] }],
    rules: [{ id: 'transit-rule', name: 'Floating HA ports', frontendId: 'transit-vip', poolId: 'transit-pool', probeId: 'transit-probe',
      protocol: 'all', frontendPort: 0, backendPort: 0, haPorts: true, floatingIp: true, haPortsForwarding: 'preserve-tuple', disableOutboundSnat: true }],
    inboundNatRules: [], outboundRules: [] }
  topology.inventory = { publicIps: [], loadBalancers: [lb],
    workloads: [...(['primary', 'standby'] as const).map((id) => ({ id: `${id}-vm`, name: `${id} VM`, nicIds: [`${id}-nic`], backingDeviceId: id })),
      { id: 'client', name: 'Application client', nicIds: ['client-nic'] }, { id: 'server', name: 'Remote server', nicIds: ['server-nic'] }],
    nics: [...(['primary', 'standby'] as const).map((id, index) => ({ id: `${id}-nic`, name: `${id} NIC`, owner: { kind: 'vnet' as const, id: 'hub' },
      ipConfigurations: [{ id: `${id}-ip`, name: 'Primary', subnetId: `${id}-subnet`, privateIp: `10.80.${index + 1}.4`, primary: true }] })),
      { id: 'client-nic', name: 'Client NIC', owner: { kind: 'vnet', id: 'application' },
        ipConfigurations: [{ id: 'client-ip', name: 'Primary', subnetId: 'work', privateIp: '10.81.1.10' }] },
      { id: 'server-nic', name: 'Server NIC', owner: { kind: 'vnet', id: 'remote' },
        ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'remote-work', privateIp: '10.82.1.10' }] }],
  }
  return topology
}
