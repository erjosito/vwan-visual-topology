import { cidr, contains, formatIpv4, ipv4 } from '../validation'
import type { AzNetTopology, AzVNet } from './model'

export function subnetAddressError(prefixes: string[], prefix: string): string | undefined {
  const subnet = cidr(prefix)
  if (!subnet) return 'Enter a valid IPv4 network CIDR.'
  if (!prefixes.some((prefix) => {
    const vnet = cidr(prefix)
    return vnet && subnet.length >= vnet.length && contains(prefix, subnet.network)
  })) return 'Subnet prefix is outside the VNet address spaces.'
}

export function vnetAddressError(vnet: { prefixes: string[]; subnets: { prefix: string }[] }): string | undefined {
  if (!vnet.prefixes.length || vnet.prefixes.some((prefix) => !cidr(prefix))) return 'Enter valid IPv4 network CIDRs.'
  if (vnet.subnets.some((subnet) => cidr(subnet.prefix) && subnetAddressError(vnet.prefixes, subnet.prefix))) {
    return 'A subnet prefix is outside the VNet address spaces.'
  }
}

export function usableSubnetAddress(prefix: string, address: string): boolean {
  const range = cidr(prefix)
  const ip = ipv4(address)
  return !!range && ip !== undefined && ip >= range.network + 4
    && ip < range.network + 2 ** (32 - range.length) - 1
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
