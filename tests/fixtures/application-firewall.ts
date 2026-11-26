import { applicationTcpTopology } from './application-tcp'
import type { ApplicationRequest } from '../../src/application'

export function applicationFirewallTopology() {
  const topology = applicationTcpTopology()
  topology.name = 'Original Firewall explicit proxy with isolated overlapping clients'
  const network = topology.vnets.find((entry) => entry.id === 'proxy')!
  network.subnets[0].name = 'AzureFirewallSubnet'
  network.subnets[0].prefix = '10.92.1.0/26'
  network.appliances = [{ id: 'firewall', name: 'Original Firewall', kind: 'azure-firewall', subnetId: 'proxy-subnet',
    privateIp: '10.92.1.4', enableIpForwarding: true, staticRoutes: [] }]
  const allow = topology.inventory!.networkSecurityGroups![0].rules[0]
  allow.sources = ['10.92.1.0/26']; allow.destinationPorts = ['443']
  topology.application = { version: 1, dnsProfiles: [], services: [{
    id: 'firewall-service', name: 'Original Firewall proxy', kind: 'azure-firewall', owner: { kind: 'vnet', id: 'proxy' },
    references: [{ kind: 'appliance', owner: { kind: 'vnet', id: 'proxy' }, id: 'firewall' }], unsupportedFeatures: [],
    firewallProxy: { applianceId: 'firewall', policyId: 'original-policy', sku: 'Standard', configuration: 'complete',
      parentPolicy: 'none', dnat: 'none', threatIntelligence: 'off', idps: 'off', tlsInspection: 'off', provisioningState: 'succeeded',
      explicitProxy: { enabled: true, httpPort: 3128 },
      collections: [{ id: 'original-collection', groupId: 'original-group', groupPriority: 100, priority: 100, action: 'allow',
        type: 'application', rules: [{ id: 'original-https-rule', sourcePrefixes: ['100.64.1.0/24'], targetFqdns: ['app.example.test'], protocol: 'https', port: 443 }] }],
      dnsBindings: [{ id: 'original-dns-binding', host: 'app.example.test',
        backend: { workloadId: 'backend-vm', nicId: 'backend-nic', ipConfigurationId: 'backend-ip' } }] },
  }] }
  return topology
}
export const applicationFirewallRequest = (): Extract<ApplicationRequest, { kind: 'firewall-proxy' }> => ({
  version: 1, kind: 'firewall-proxy', serviceId: 'firewall-service', mode: 'explicit', proxyPort: 3128, scheme: 'https', host: 'app.example.test',
  sourcePort: 49152, port: 443, client: { kind: 'workload', workloadId: 'client-vm', nicId: 'client-nic', ipConfigurationId: 'client-ip' },
})
