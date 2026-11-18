import { createEmptyAzNetTopology, type AzVnetPeering } from '../azure-net/model'
import type { PacketRequest } from '../packet-flow'
import type { Requirement } from '../platform/contract'

export const haLessonPacket: PacketRequest = {
  source: { kind: 'workload', workloadId: 'client', nicId: 'client-nic', ipConfigurationId: 'client-ip' },
  target: { kind: 'workload', workloadId: 'server', nicId: 'server-nic', ipConfigurationId: 'server-ip' },
  protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
}
const backend = (id: string) => ({ workloadId: `${id}-vm`, nicId: `${id}-nic`, ipConfigurationId: `${id}-ip` })
const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false }
const peer = (id: string): AzVnetPeering => ({
  id: `hub-${id}`, name: `Transit to ${id}`, vnetAId: 'hub', vnetBId: id, enabled: true,
  aToB: { ...flags }, bToA: { ...flags },
})

export function haLessonTopology() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'HA transit: an independent return path'
  topology.vnets = [
    { id: 'hub', name: 'Transit hub', region: 'swedencentral', role: 'hub', prefixes: ['10.80.0.0/16'],
      subnets: [
        { id: 'primary-subnet', name: 'Primary transit', prefix: '10.80.1.0/24' },
        { id: 'standby-subnet', name: 'Standby transit', prefix: '10.80.2.0/24' },
        { id: 'frontend-subnet', name: 'Transit frontend', prefix: '10.80.3.0/24' },
      ], gateways: [], appliances: ['primary', 'standby'].map((id, index) => ({
        id, name: id === 'primary' ? 'Preferred NVA' : 'Standby NVA', kind: 'nva-vm',
        subnetId: `${id}-subnet`, privateIp: `10.80.${index + 1}.4`,
        enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [],
      })) },
    { id: 'application', name: 'Application', region: 'swedencentral', role: 'spoke', prefixes: ['10.81.0.0/16'],
      subnets: [{ id: 'work', name: 'Workload', prefix: '10.81.1.0/24', routeTableId: 'application-steering' },
        { id: 'ops', name: 'Operations', prefix: '10.81.2.0/24' }], gateways: [], appliances: [] },
    { id: 'remote', name: 'Remote workload', region: 'swedencentral', role: 'spoke', prefixes: ['10.82.0.0/16'],
      subnets: [{ id: 'remote-work', name: 'Remote workload', prefix: '10.82.1.0/24', routeTableId: 'remote-steering' }],
      gateways: [], appliances: [] },
  ]
  topology.vnetPeerings = [peer('application'), peer('remote')]
  topology.udrTables = [
    { id: 'application-steering', name: 'Application transit', disableBgpRoutePropagation: false,
      routes: [{ id: 'application-path', name: 'Remote transit', prefix: '10.82.0.0/16',
        nextHopType: 'VirtualAppliance', nextHopIp: '10.80.3.10', enabled: true }] },
    { id: 'remote-steering', name: 'Independent remote return', disableBgpRoutePropagation: false,
      routes: [{ id: 'remote-path', name: 'Application return', prefix: '10.81.0.0/16',
        nextHopType: 'VirtualAppliance', nextHopIp: '10.80.2.4', enabled: true }] },
  ]
  topology.inventory = {
    publicIps: [],
    workloads: [
      ...['primary', 'standby'].map((id) => ({ id: `${id}-vm`, name: `${id} VM`, nicIds: [`${id}-nic`], backingDeviceId: id })),
      { id: 'client', name: 'Application client', nicIds: ['client-nic'] },
      { id: 'server', name: 'Remote server', nicIds: ['server-nic'] },
    ],
    nics: [
      ...['primary', 'standby'].map((id, index) => ({ id: `${id}-nic`, name: `${id} NIC`, owner: { kind: 'vnet' as const, id: 'hub' },
        ipConfigurations: [{ id: `${id}-ip`, name: 'Primary', subnetId: `${id}-subnet`, privateIp: `10.80.${index + 1}.4`, primary: true }] })),
      { id: 'client-nic', name: 'Client NIC', owner: { kind: 'vnet', id: 'application' },
        ipConfigurations: [{ id: 'client-ip', name: 'Primary', subnetId: 'work', privateIp: '10.81.1.10' }] },
      { id: 'server-nic', name: 'Server NIC', owner: { kind: 'vnet', id: 'remote' },
        ipConfigurations: [{ id: 'server-ip', name: 'Primary', subnetId: 'remote-work', privateIp: '10.82.1.10' }] },
    ],
    loadBalancers: [{
      id: 'transit-lb', name: 'Transit LB', sku: 'Standard', owner: { kind: 'vnet', id: 'hub' },
      frontends: [{ id: 'transit-vip', name: 'Transit VIP', kind: 'private', subnetId: 'frontend-subnet', privateIp: '10.80.3.10' }],
      pools: [{ id: 'transit-pool', name: 'Original NVAs', members: [backend('primary'), backend('standby')] }],
      probes: [{ id: 'transit-probe', name: 'Declared transit health', protocol: 'tcp', port: 8080,
        health: [{ target: backend('primary'), status: 'healthy' }, { target: backend('standby'), status: 'unhealthy' }] }],
      rules: [{ id: 'transit-rule', name: 'Floating HA ports', frontendId: 'transit-vip', poolId: 'transit-pool', probeId: 'transit-probe',
        protocol: 'all', frontendPort: 0, backendPort: 0, haPorts: true, floatingIp: true,
        haPortsForwarding: 'preserve-tuple', disableOutboundSnat: true }],
      inboundNatRules: [], outboundRules: [],
    }],
  }
  return topology
}

export const haLessonRequirements: Requirement[] = [
  { id: 'original-ha-packet', kind: 'packet', packet: haLessonPacket,
    sourceAddress: '10.81.1.10', destinationAddress: '10.82.1.10', expectation: 'configured',
    requiredBackend: { ...backend('primary'), address: '10.80.1.4' } },
  { id: 'same-nva-both-ways', kind: 'flow',
    source: { kind: 'subnet', vnetId: 'application', subnetId: 'work' },
    target: { kind: 'subnet', vnetId: 'remote', subnetId: 'remote-work' },
    sourceAddress: '10.81.1.10', destinationAddress: '10.82.1.10', expectation: 'allow',
    applianceChain: { forward: ['primary'], reverse: ['primary'] } },
  { id: 'local-operations', kind: 'flow',
    source: { kind: 'subnet', vnetId: 'application', subnetId: 'work' },
    target: { kind: 'subnet', vnetId: 'application', subnetId: 'ops' },
    sourceAddress: '10.81.1.10', destinationAddress: '10.81.2.10', expectation: 'allow' },
]
