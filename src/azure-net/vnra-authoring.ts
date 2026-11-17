import { cidr, contains, ipv4 } from '../validation'
import type { AzNetTopology } from './model'

export const vnraSubnetName = 'VirtualNetworkApplianceSubnet'

export interface ManagedVnraInput {
  id: string
  name: string
  privateIp: string
  subnetId?: string
  newSubnetPrefix?: string
}

export function saveManagedVnra(topology: AzNetTopology, vnetId: string, input: ManagedVnraInput) {
  const vnet = topology.vnets.find((entry) => entry.id === vnetId)
  if (!vnet) throw new Error('The original VNet is no longer available.')
  const existing = vnet.appliances.find((app) => app.id === input.id)
  if (existing && existing.kind !== 'vnra') throw new Error('The original appliance is not a Managed VNRA.')
  const name = input.name.trim()
  if (!name || name.length > 120) throw new Error('Enter a VNRA name of 1-120 characters.')
  const subnet = input.subnetId ? vnet.subnets.find((entry) => entry.id === input.subnetId) : {
    id: `${input.id}-subnet`, name: vnraSubnetName, prefix: input.newSubnetPrefix?.trim() ?? '',
  }
  if (!subnet || subnet.name !== vnraSubnetName) throw new Error('Select an original VirtualNetworkApplianceSubnet in this VNet.')
  if (!input.subnetId && vnet.subnets.some((entry) => entry.name === vnraSubnetName)) {
    throw new Error('This VNet already has a VirtualNetworkApplianceSubnet. Select it instead.')
  }
  const range = cidr(subnet.prefix)
  if (!range || range.length > 29 || !vnet.prefixes.some((prefix) =>
    contains(prefix, range.network) && contains(prefix, range.network + 2 ** (32 - range.length) - 1))) {
    throw new Error('Use an IPv4 subnet of /29 or larger inside an original VNet address space.')
  }
  if (vnet.subnets.some((entry) => entry.id !== subnet.id && cidr(entry.prefix)
    && (contains(entry.prefix, range.network) || contains(subnet.prefix, cidr(entry.prefix)!.network)))) {
    throw new Error('The VNRA subnet overlaps another original subnet.')
  }
  if (vnet.appliances.some((app) => app.subnetId === subnet.id && app.kind !== 'vnra')
    || vnet.routeServer?.subnetId === subnet.id || subnet.privateEndpoints?.length
    || topology.inventory?.nics.some((nic) => nic.owner.kind === 'vnet' && nic.owner.id === vnetId
      && nic.ipConfigurations.some((config) => config.subnetId === subnet.id))) {
    throw new Error('The VNRA subnet must be dedicated; move unrelated devices explicitly.')
  }
  const address = ipv4(input.privateIp.trim())
  if (address === undefined || !contains(subnet.prefix, address) || address < range.network + 4
    || address >= range.network + 2 ** (32 - range.length) - 1) {
    throw new Error('Enter an available IPv4 address in the selected subnet, excluding the first four and last addresses.')
  }
  if (vnet.appliances.some((app) => app.id !== input.id && ipv4(app.privateIp) === address)
    || topology.inventory?.nics.some((nic) => nic.owner.kind === 'vnet' && nic.owner.id === vnetId
      && nic.ipConfigurations.some((config) => config.privateIp && ipv4(config.privateIp) === address))) {
    throw new Error('This private IPv4 address is already assigned in the original VNet.')
  }
  if (!input.subnetId) vnet.subnets.push(subnet)
  if (existing) {
    existing.name = name
    existing.subnetId = subnet.id
    existing.privateIp = input.privateIp.trim()
  } else {
    vnet.appliances.push({
      id: input.id, name, kind: 'vnra', subnetId: subnet.id, privateIp: input.privateIp.trim(),
      enableIpForwarding: true, inspectsTraffic: false, staticRoutes: [],
    })
  }
}
