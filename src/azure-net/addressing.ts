import { cidr, contains, ipv4 } from '../validation'

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
