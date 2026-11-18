import { createEmptyAzNetTopology } from '../../src/azure-net/model'
import type { Topology } from '../../src/model'
import type { NetworkInventory } from '../../src/inventory'

export function graphicalDetailTopology(mode: string, extraNics = 0) {
  const owner = { kind: mode === 'vwan' ? 'spoke' as const : 'vnet' as const, id: 'detail-network' }
  const subnets = [{ id: 'first', name: 'Application subnet', prefix: '10.10.1.0/24' },
    { id: 'second', name: 'Data subnet', prefix: '10.10.2.0/24' }]
  const inventory: NetworkInventory = {
    workloads: [{ id: 'original-vm', name: 'Original workload', nicIds: ['original-nic'] }],
    nics: [{ id: 'original-nic', name: 'Original NIC', owner, ipConfigurations: [
      { id: 'primary', name: 'Primary', subnetId: 'first', privateIp: '10.10.1.4' },
      { id: 'secondary', name: 'Secondary', subnetId: 'second', privateIp: '10.10.2.4' },
    ] }],
    publicIps: [{ id: 'nat-pip', name: 'NAT public IP', address: '20.50.60.80', sku: 'Standard', allocation: 'Static' }],
    natGateways: [{ id: 'original-nat', name: 'Original shared NAT', owner, sku: 'Standard', subnetIds: ['first', 'second'], publicIpIds: ['nat-pip'] }],
    loadBalancers: [{ id: 'original-lb', name: 'Original shared LB', owner, sku: 'Standard',
      frontends: [{ id: 'frontend', name: 'Frontend', kind: 'private', subnetId: 'second', privateIp: '10.10.2.10' }],
      pools: [{ id: 'pool', name: 'Pool', members: [{ workloadId: 'original-vm', nicId: 'original-nic', ipConfigurationId: 'primary' }] }],
      probes: [], rules: [], inboundNatRules: [], outboundRules: [] }],
  }
  for (let index = 0; index < extraNics; index++) {
    inventory.workloads.push({ id: `vm-${index}`, name: `Inventory workload ${index}`, nicIds: [`nic-${index}`] })
    inventory.nics.push({ id: `nic-${index}`, name: `Inventory NIC ${index}`, owner,
      ipConfigurations: [{ id: 'primary', name: 'Primary', subnetId: 'first', privateIp: `10.10.1.${index + 20}` },
        ...(index >= extraNics - 14 ? [{ id: 'secondary', name: 'Secondary', subnetId: 'second', privateIp: `10.10.2.${index + 20}` }] : [])] })
  }
  if (mode === 'vwan') return {
    version: 1, name: 'Attachment diagram', hubs: [], sites: [], connections: [], siteLinks: [], routeMaps: [],
    spokes: [{ id: owner.id, name: 'Original network', prefixes: ['10.10.0.0/16'], subnets }], inventory,
  } satisfies Topology
  const topology = createEmptyAzNetTopology()
  topology.name = 'Attachment diagram'
  topology.vnets = [{ id: owner.id, name: 'Original network', role: 'standalone', region: 'westeurope', prefixes: ['10.10.0.0/16'],
    subnets, x: 220, y: 180, appliances: [
      { id: 'original-nva', name: 'Original NVA', kind: 'nva-vm', subnetId: 'first', privateIp: '10.10.1.8', enableIpForwarding: true, staticRoutes: [] },
    ], gateways: [{ id: 'original-gateway', name: 'Original gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true }] }]
  topology.inventory = inventory
  topology.application = { version: 1, services: [{ id: 'service', name: 'Declared service', kind: 'application-gateway', owner,
    references: [{ kind: 'subnet', owner, id: 'first' }], unsupportedFeatures: [] }], dnsProfiles: [] }
  return topology
}
