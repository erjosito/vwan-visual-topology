import { createEmptyAzNetTopology } from '../../src/azure-net/model'
import type { ApplicationInventory, ApplicationRequest } from '../../src/application'
import type { InventoryTopology } from '../../src/inventory'
import type { PlatformMode, PlatformRequest } from '../../src/platform/contract'

export function applicationFixture(mode: PlatformMode = 'full'): InventoryTopology {
  const owner = { kind: mode === 'vwan' ? 'spoke' as const : 'vnet' as const, id: 'original-network' }
  const subnets = [{ id: 'original-subnet', name: 'Application subnet', prefix: '10.1.1.0/24' }]
  const application: ApplicationInventory = {
    version: 1,
    services: [{ id: 'original-gateway', name: 'Declared gateway {0}', kind: 'application-gateway', owner,
      references: [{ kind: 'subnet', owner, id: 'original-subnet' },
        { kind: 'workload', workloadId: 'original-vm', nicId: 'original-nic', ipConfigurationId: 'original-ip' }],
      unsupportedFeatures: ['health-unknown', 'WAF'] }],
    dnsProfiles: [{ id: 'original-dns', name: 'Declared DNS', kind: 'traffic-manager',
      references: [{ kind: 'service', id: 'original-gateway' }], unsupportedFeatures: ['unresolved-name'] }],
  }
  const inventory = {
    workloads: [{ id: 'original-vm', name: 'Original workload', nicIds: ['original-nic'] }],
    nics: [{ id: 'original-nic', name: 'Original NIC', owner, ipConfigurations: [{ id: 'original-ip', name: 'Primary', subnetId: 'original-subnet', privateIp: '10.1.1.4' }] }],
    publicIps: [],
  }
  if (mode === 'vwan') return {
    version: 1, name: 'Application contracts', hubs: [], sites: [], connections: [], siteLinks: [],
    spokes: [{ id: owner.id, name: 'Original network', prefixes: ['10.1.0.0/16'], subnets }], inventory, application,
  }
  const topology = createEmptyAzNetTopology()
  topology.name = 'Application contracts'
  topology.vnets = [{ id: owner.id, name: 'Original network', prefixes: ['10.1.0.0/16'], subnets,
    region: 'westeurope', role: 'standalone', gateways: [], appliances: [], x: 200, y: 200 }]
  topology.inventory = inventory
  topology.application = application
  return topology
}
export function httpRequest(): Extract<ApplicationRequest, { kind: 'http' }> {
  return { version: 1, kind: 'http', serviceId: 'original-gateway',
    client: { kind: 'workload', workloadId: 'original-vm', nicId: 'original-nic', ipConfigurationId: 'original-ip' },
    scheme: 'https', host: 'APP.Example.test.', port: 443, path: '/catalog/%aa' }
}
export function dnsRequest(): Extract<ApplicationRequest, { kind: 'dns' }> {
  return { version: 1, kind: 'dns', profileId: 'original-dns', resolver: { kind: 'external', address: '198.51.100.10' },
    name: 'APP.Example.test.', evaluatedAt: '2026-11-16T00:00:00.000Z', cache: 'fresh' }
}
export function applicationPlatformRequest(mode: PlatformMode = 'full', kind: 'http' | 'dns' = 'http'): PlatformRequest {
  return { contractVersion: 2, operation: 'application', document: { mode, topology: applicationFixture(mode) } as PlatformRequest['document'],
    application: kind === 'http' ? httpRequest() : dnsRequest() }
}
