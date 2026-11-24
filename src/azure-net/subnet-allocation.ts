import { cidr, contains, formatIpv4 } from '../validation'
import type { AzNetTopology, AzSubnet, AzVNet } from './model'
import { subnetAddressError } from './addressing'

export function nvaSubnetError(vnet: AzVNet, subnet: AzSubnet): string | undefined {
  if (/^(GatewaySubnet|RouteServerSubnet|AzureFirewallSubnet|AzureFirewallManagementSubnet|AzureBastionSubnet|VirtualNetworkApplianceSubnet)$/i.test(subnet.name)
    || subnet.delegations?.length) return 'Select a non-service, non-delegated subnet for the NVA.'
  return applianceSubnetError(vnet, subnet)
}

function applianceSubnetError(vnet: AzVNet, subnet: AzSubnet): string | undefined {
  const error = subnetAddressError(vnet.prefixes, subnet.prefix)
  if (error) return error
  const range = cidr(subnet.prefix)!
  if (vnet.subnets.some((other) => other.id !== subnet.id && cidr(other.prefix)
    && (contains(other.prefix, range.network) || contains(subnet.prefix, cidr(other.prefix)!.network)))) {
    return 'The appliance subnet overlaps another subnet.'
  }
}

export function addAzureFirewall(topology: AzNetTopology, vnetId: string): string {
  const vnet = topology.vnets.find((vnet) => vnet.id === vnetId)
  if (!vnet) throw new Error('VNet no longer exists.')
  if (vnet.appliances.some((app) => app.kind === 'azure-firewall')) {
    throw new Error('Only one Azure Firewall is supported per VNet. Remove the existing Firewall first.')
  }
  const existing = vnet.subnets.find((subnet) => subnet.name === 'AzureFirewallSubnet')
  const subnet = existing ?? { id: `${vnet.id}-fw-subnet-${crypto.randomUUID()}`, name: 'AzureFirewallSubnet', prefix: availableSubnetPrefix(vnet) }
  const error = applianceSubnetError(vnet, subnet)
  if (error) throw new Error(error)
  if (cidr(subnet.prefix)!.length > 26 || subnet.delegations?.length) {
    throw new Error('AzureFirewallSubnet must be non-delegated and /26 or larger.')
  }
  const privateIp = nextSubnetAddress(topology, vnet, subnet.prefix)
  const index = vnet.appliances.length + 1
  const id = `${vnet.id}-azfw-${index}`
  if (!existing) vnet.subnets.push(subnet)
  vnet.appliances.push({ id, name: `${vnet.name}-azfw-${index}`, kind: 'azure-firewall',
    subnetId: subnet.id, privateIp, bgpEnabled: false, enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [] })
  return id
}

export function addNva(topology: AzNetTopology, vnetId: string, input: { id: string; name: string; subnetId: string }): void {
  const vnet = topology.vnets.find((vnet) => vnet.id === vnetId)
  if (!vnet) throw new Error('VNet no longer exists.')
  const subnet = vnet.subnets.find((subnet) => subnet.id === input.subnetId)
  if (!subnet) throw new Error('Select an existing subnet for the NVA.')
  const error = nvaSubnetError(vnet, subnet)
  if (error) throw new Error(error)
  const name = input.name.trim()
  if (!name || name.length > 120) throw new Error('Enter an NVA name of 1 to 120 characters.')
  if (!input.id || topology.vnets.some((vnet) => vnet.appliances.some((app) => app.id === input.id))) {
    throw new Error('NVA identity is missing or already exists.')
  }
  const privateIp = nextSubnetAddress(topology, vnet, subnet.prefix)
  vnet.appliances.push({ id: input.id, name, kind: 'nva-vm', subnetId: subnet.id, privateIp,
    bgpEnabled: false, enableIpForwarding: true, inspectsTraffic: true, staticRoutes: [] })
}

export function vnetAddresses(topology: AzNetTopology, vnet: AzVNet): string[] {
  return [
    ...vnet.appliances.map((app) => app.privateIp),
    ...vnet.subnets.flatMap((subnet) => (subnet.privateEndpoints ?? []).map((endpoint) => endpoint.ipAddress)),
    ...(topology.inventory?.nics ?? []).filter((nic) => nic.owner.kind === 'vnet' && nic.owner.id === vnet.id)
      .flatMap((nic) => nic.ipConfigurations.flatMap((config) => config.privateIp ? [config.privateIp] : [])),
    ...(topology.inventory?.loadBalancers ?? []).filter((lb) => lb.owner.kind === 'vnet' && lb.owner.id === vnet.id)
      .flatMap((lb) => lb.frontends.flatMap((frontend) => frontend.kind === 'private' && frontend.privateIp ? [frontend.privateIp] : [])),
  ]
}

export function allocateAddress(prefix: string, used: Set<string>, offset = 4): string {
  const range = cidr(prefix)
  if (!range) throw new Error('Enter a valid IPv4 network CIDR.')
  if (offset >= 4 && offset < 2 ** (32 - range.length) - 1) {
    const preferred = formatIpv4(range.network + offset)
    if (!used.has(preferred)) return preferred
  }
  for (let host = 4; host < 2 ** (32 - range.length) - 1; host++) {
    const address = formatIpv4(range.network + host)
    if (!used.has(address)) return address
  }
  throw new Error('The subnet has no available usable IPv4 addresses.')
}

export function nextSubnetAddress(topology: AzNetTopology, vnet: AzVNet, prefix: string): string {
  return allocateAddress(prefix, new Set(vnetAddresses(topology, vnet)))
}

export function availableSubnetPrefix(vnet: AzVNet, length = 26): string {
  const size = 2 ** (32 - length)
  const occupied = vnet.subnets.flatMap((subnet) => {
    const range = cidr(subnet.prefix)
    return range ? [{ start: range.network, end: range.network + 2 ** (32 - range.length) }] : []
  }).sort((a, b) => a.start - b.start)
  for (const prefix of vnet.prefixes) {
    const range = cidr(prefix)
    if (!range || range.length > length) continue
    const end = range.network + 2 ** (32 - range.length)
    let start = range.network
    for (const other of occupied) {
      if (other.end <= start || other.start >= end) continue
      if (start + size <= other.start) break
      start = Math.ceil(other.end / size) * size
    }
    if (start + size <= end) return `${formatIpv4(start)}/${length}`
  }
  throw new Error('No non-overlapping subnet of the required size fits in the VNet address spaces.')
}
