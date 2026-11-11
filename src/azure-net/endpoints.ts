import { cidr } from '../validation'
import { firstUsableIp, type AzEndpointRef } from './engine'
import type { AzNetTopology, AzSubnet, AzVNet } from './model'

export interface AzEndpointOption {
  key: string
  label: string
  ref: AzEndpointRef
  defaultIp: string
  prefix: string
  group: 'workload' | 'infrastructure' | 'site' | 'hub' | 'internet'
}

export function azEndpointKey(ref: AzEndpointRef): string {
  switch (ref.kind) {
    case 'subnet': return `subnet:${ref.vnetId}:${ref.subnetId}`
    case 'site': return `site:${ref.siteId}`
    case 'vwanHub': return `hub:${ref.hubId}`
    case 'internet': return `internet:${ref.ip ?? '20.50.60.70'}`
  }
}

export function isWorkloadSubnet(vnet: AzVNet, subnet: AzSubnet): boolean {
  return !['GatewaySubnet', 'AzureFirewallSubnet', 'RouteServerSubnet', 'VirtualNetworkApplianceSubnet'].includes(subnet.name) &&
    !vnet.appliances.some((a) => a.subnetId === subnet.id)
}

export function getAzNetEndpoints(topology: AzNetTopology): AzEndpointOption[] {
  const endpoints: AzEndpointOption[] = []
  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      if (!cidr(subnet.prefix)) continue
      const ref: AzEndpointRef = { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id }
      endpoints.push({
        key: azEndpointKey(ref),
        label: `VNet Subnet · ${vnet.name} / ${subnet.name} (${subnet.prefix})`,
        ref,
        defaultIp: firstUsableIp(subnet.prefix),
        prefix: subnet.prefix,
        group: isWorkloadSubnet(vnet, subnet) ? 'workload' : 'infrastructure',
      })
    }
  }
  for (const site of topology.sites) {
    for (const prefix of new Set(site.prefixes)) {
      if (!cidr(prefix)) continue
      endpoints.push({
        key: `site:${site.id}:${prefix}`,
        label: `On-Prem Site · ${site.name} (${prefix})`,
        ref: { kind: 'site', siteId: site.id },
        defaultIp: firstUsableIp(prefix),
        prefix,
        group: 'site',
      })
    }
  }
  for (const hub of topology.vwanHubs) {
    if (!hub.prefix || !cidr(hub.prefix)) continue
    endpoints.push({
      key: `hub:${hub.id}`,
      label: `Virtual Hub · ${hub.name} (${hub.prefix})`,
      ref: { kind: 'vwanHub', hubId: hub.id },
      defaultIp: firstUsableIp(hub.prefix),
      prefix: hub.prefix,
      group: 'hub',
    })
  }
  endpoints.push({
    key: 'internet:20.50.60.70',
    label: '🌐 Public Internet (20.50.60.70)',
    ref: { kind: 'internet', ip: '20.50.60.70' },
    defaultIp: '20.50.60.70',
    prefix: '20.50.60.70/32',
    group: 'internet',
  })
  return endpoints
}
