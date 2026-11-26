import { createEmptyAzNetTopology } from '../../src/azure-net/model'
import type { ApplicationRequest } from '../../src/application'

export function applicationTcpTopology() {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Private TCP proxy with independent backend routing'
  topology.vnets = [
    { id: 'client', name: 'Client', prefixes: ['100.64.0.0/16'], subnet: '100.64.1.0/24' },
    { id: 'isolated', name: 'Isolated reused client', prefixes: ['100.64.0.0/16'], subnet: '100.64.1.0/24' },
    { id: 'proxy', name: 'Proxy network', prefixes: ['10.92.0.0/16'], subnet: '10.92.1.0/24' },
    { id: 'backend', name: 'Backend', prefixes: ['10.93.0.0/16'], subnet: '10.93.1.0/24' },
  ].map((entry, index) => ({ id: entry.id, name: entry.name, prefixes: entry.prefixes, role: 'standalone', region: 'westeurope',
    subnets: [{ id: `${entry.id}-subnet`, name: entry.id === 'proxy' ? 'ApplicationGatewaySubnet' : 'Application', prefix: entry.subnet, defaultOutboundAccess: false }],
    gateways: [], appliances: [], x: 200 + index * 380, y: 200 }))
  const flags = { allowVirtualNetworkAccess: true, allowForwardedTraffic: false, allowGatewayTransit: false, useRemoteGateways: false }
  topology.vnetPeerings = ['client', 'backend'].map((id) => ({ id: `proxy-${id}`, name: `Proxy to ${id}`, vnetAId: 'proxy', vnetBId: id,
    aToB: { ...flags }, bToA: { ...flags }, enabled: true }))
  topology.inventory = { publicIps: [],
    workloads: ['client', 'isolated', 'backend'].map((id) => ({ id: `${id}-vm`, name: `${id} VM`, nicIds: [`${id}-nic`] })),
    nics: ['client', 'isolated', 'backend'].map((id) => ({ id: `${id}-nic`, name: `${id} NIC`, owner: { kind: 'vnet', id },
      ipConfigurations: [{ id: `${id}-ip`, name: 'Primary', subnetId: `${id}-subnet`, privateIp: id === 'backend' ? '10.93.1.4' : '100.64.1.4' }] })),
    networkSecurityGroups: [{ id: 'backend-nsg', name: 'Backend data filter', rules: [{
      id: 'allow-proxy-instance', name: 'AllowInstance', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
      sources: ['10.92.1.4'], destinations: ['10.93.1.4'], sourcePorts: ['*'], destinationPorts: ['15433'],
    }, { id: 'deny-other-data', name: 'DenyOther', priority: 200, direction: 'inbound', action: 'deny', protocol: 'any',
      sources: ['*'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['*'] }] }],
    nsgAssociations: [{ owner: { kind: 'vnet', id: 'backend' }, target: { kind: 'nic', id: 'backend-nic' }, nsgId: 'backend-nsg' }] }
  topology.application = { version: 1, dnsProfiles: [], services: [{ id: 'appgw', name: 'Original TCP gateway', kind: 'application-gateway',
    owner: { kind: 'vnet', id: 'proxy' }, references: [{ kind: 'subnet', owner: { kind: 'vnet', id: 'proxy' }, id: 'proxy-subnet' }],
    unsupportedFeatures: [], tcpProxy: { sku: 'Standard_v2', subnetId: 'proxy-subnet',
      frontendAddress: '10.92.1.10', instanceAddress: '10.92.1.4', listenerId: 'tcp-listener', ruleId: 'tcp-rule', rulePriority: 100,
      poolId: 'tcp-pool', frontendPort: 1433, backendPort: 15433, declaredHealth: 'healthy', provisioningState: 'succeeded', proxyProtocol: false,
      backend: { workloadId: 'backend-vm', nicId: 'backend-nic', ipConfigurationId: 'backend-ip' } } }] }
  return topology
}

export const applicationTcpRequest = (network = 'client'): Extract<ApplicationRequest, { kind: 'tcp' }> => ({
  version: 1, kind: 'tcp', serviceId: 'appgw', client: { kind: 'workload', workloadId: `${network}-vm`, nicId: `${network}-nic`, ipConfigurationId: `${network}-ip` },
  sourcePort: 49152, port: 1433,
})
