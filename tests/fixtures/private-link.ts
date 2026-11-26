import { overlappingVnets, overlapEndpoint } from './overlapping-vnets'
import type { PacketRequest } from '../../src/packet-flow'

export function privateLinkTopology() {
  const topology = overlappingVnets()
  topology.name = 'Overlapping consumers of a private provider service'
  for (const vnet of topology.vnets) vnet.subnets[1].privateEndpoints = [{
    id: `${vnet.id}-pe`, name: `${vnet.name} endpoint`, ipAddress: '100.64.2.10', serviceName: 'Private provider',
  }]
  const owner = { kind: 'vnet' as const, id: 'provider' }
  const backend = { workloadId: 'provider-vm', nicId: 'provider-nic', ipConfigurationId: 'provider-ip' }
  topology.vnets.push({ id: owner.id, name: 'Provider', role: 'shared-services', region: 'westeurope', prefixes: ['10.91.0.0/16'],
    subnets: [{ id: 'provider-nat', name: 'Service NAT', prefix: '10.91.1.0/24', privateLinkServiceNetworkPolicies: 'Disabled' },
      { id: 'provider-front', name: 'Frontend', prefix: '10.91.2.0/24' },
      { id: 'provider-backend', name: 'Backend', prefix: '10.91.3.0/24' }], gateways: [], appliances: [], x: 1050, y: 200 })
  topology.inventory!.workloads.push({ id: backend.workloadId, name: 'Provider server', nicIds: [backend.nicId] })
  topology.inventory!.nics.push({ id: backend.nicId, name: 'Provider NIC', owner,
    ipConfigurations: [{ id: backend.ipConfigurationId, name: 'Primary', subnetId: 'provider-backend', privateIp: '10.91.3.4' }] })
  topology.inventory!.loadBalancers = [{ id: 'provider-lb', name: 'Provider LB', sku: 'Standard', owner,
    frontends: [{ id: 'provider-frontend', name: 'Private frontend', kind: 'private', subnetId: 'provider-front', privateIp: '10.91.2.10' }],
    pools: [{ id: 'provider-pool', name: 'Backend pool', members: [backend] }],
    probes: [{ id: 'provider-probe', name: 'Probe', protocol: 'tcp', port: 8080, health: [{ target: backend, status: 'healthy' }] }],
    rules: ['tcp', 'udp'].map((protocol) => ({ id: `provider-${protocol}`, name: `Service ${protocol}`, frontendId: 'provider-frontend',
      poolId: 'provider-pool', probeId: 'provider-probe', protocol: protocol === 'tcp' ? 'tcp' : 'udp', frontendPort: 443, backendPort: 8443 })),
    inboundNatRules: [], outboundRules: [] }]
  topology.inventory!.networkSecurityGroups = [{ id: 'provider-nsg', name: 'Provider NSG', rules: [{
    id: 'allow-probe', name: 'AllowProbe', priority: 100, direction: 'inbound', action: 'allow', protocol: 'tcp',
    sources: ['AzureLoadBalancer'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['8080'],
  }, {
    id: 'allow-provider-nat', name: 'AllowProviderNat', priority: 200, direction: 'inbound', action: 'allow', protocol: 'any',
    sources: ['10.91.1.4'], destinations: ['*'], sourcePorts: ['*'], destinationPorts: ['8443'],
  }] }]
  topology.inventory!.nsgAssociations = [{ owner, target: { kind: 'nic', id: backend.nicId }, nsgId: 'provider-nsg' }]
  topology.inventory!.privateLinkServices = [{ id: 'pls', name: 'Private provider', owner, loadBalancerId: 'provider-lb', frontendId: 'provider-frontend',
    natIpConfigurations: [{ id: 'pls-nat-ip', subnetId: 'provider-nat', privateIp: '10.91.1.4' }], provisioningState: 'succeeded', proxyProtocol: false }]
  topology.inventory!.privateEndpointConnections = ['a', 'b'].map((id) => ({
    id: `${id}-connection`, privateEndpointId: `${id}-pe`, serviceId: 'pls', state: 'approved',
  }))
  return topology
}

export const privateLinkRequest = (network: string): PacketRequest => ({
  source: overlapEndpoint(network), target: { kind: 'private-endpoint', privateEndpointId: `${network}-pe` },
  protocol: 'tcp', sourcePort: 49152, destinationPort: 443,
})
