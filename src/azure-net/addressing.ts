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

function vnetAddresses(topology: AzNetTopology, vnet: AzVNet): string[] {
  return [
    ...vnet.appliances.map((app) => app.privateIp),
    ...vnet.subnets.flatMap((subnet) => (subnet.privateEndpoints ?? []).map((endpoint) => endpoint.ipAddress)),
    ...(topology.inventory?.nics ?? []).filter((nic) => nic.owner.kind === 'vnet' && nic.owner.id === vnet.id)
      .flatMap((nic) => nic.ipConfigurations.flatMap((config) => config.privateIp ? [config.privateIp] : [])),
    ...(topology.inventory?.loadBalancers ?? []).filter((lb) => lb.owner.kind === 'vnet' && lb.owner.id === vnet.id)
      .flatMap((lb) => lb.frontends.flatMap((frontend) => frontend.kind === 'private' && frontend.privateIp ? [frontend.privateIp] : [])),
  ]
}

function allocateAddress(prefix: string, used: Set<string>, offset = 4): string {
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

function subnetResources(topology: AzNetTopology, vnet: AzVNet, subnetId: string) {
  const apps = vnet.appliances.filter((app) => app.subnetId === subnetId)
  const resources = [
    ...apps.map((app) => ({ key: `app:${app.id}`, address: app.privateIp, apply: (ip: string) => { app.privateIp = ip }, nextHop: true })),
    ...(vnet.subnets.find((subnet) => subnet.id === subnetId)?.privateEndpoints ?? [])
      .map((endpoint) => ({ key: `pe:${endpoint.id}`, address: endpoint.ipAddress, apply: (ip: string) => { endpoint.ipAddress = ip }, nextHop: false })),
  ]
  for (const nic of topology.inventory?.nics ?? []) {
    if (nic.owner.kind !== 'vnet' || nic.owner.id !== vnet.id) continue
    for (const config of nic.ipConfigurations) {
      if (config.subnetId !== subnetId || !config.privateIp) continue
      const backing = apps.find((app) => app.privateIp === config.privateIp && topology.inventory?.workloads
        .some((workload) => workload.backingDeviceId === app.id && workload.nicIds.includes(nic.id)))
      resources.push({ key: backing ? `app:${backing.id}` : `nic:${nic.id}:${config.id}`,
        address: config.privateIp, apply: (ip) => { config.privateIp = ip }, nextHop: false })
    }
  }
  for (const lb of topology.inventory?.loadBalancers ?? []) {
    if (lb.owner.kind !== 'vnet' || lb.owner.id !== vnet.id) continue
    for (const frontend of lb.frontends) {
      if (frontend.kind !== 'private' || frontend.subnetId !== subnetId || !frontend.privateIp) continue
      resources.push({ key: `lb:${lb.id}:${frontend.id}`, address: frontend.privateIp,
        apply: (ip) => { frontend.privateIp = ip }, nextHop: true })
    }
  }
  return resources
}

export function subnetNeedsReaddressing(topology: AzNetTopology, vnet: AzVNet, subnetId: string): boolean {
  const subnet = vnet.subnets.find((entry) => entry.id === subnetId)
  return !!subnet && !!cidr(subnet.prefix) && subnetResources(topology, vnet, subnetId)
    .some((resource) => !usableSubnetAddress(subnet.prefix, resource.address))
}

export function resizeAzSubnet(topology: AzNetTopology, vnetId: string, subnetId: string, prefix: string) {
  const vnet = topology.vnets.find((entry) => entry.id === vnetId)
  const subnet = vnet?.subnets.find((entry) => entry.id === subnetId)
  if (!vnet || !subnet) return
  const range = cidr(prefix)
  if (!range) { subnet.prefix = prefix; return }
  const oldRange = cidr(subnet.prefix)
  const size = 2 ** (32 - range.length)
  const moving = subnetResources(topology, vnet, subnetId).filter((entry) => !usableSubnetAddress(prefix, entry.address))
  const used = new Set(vnetAddresses(topology, vnet))
  const replacements = new Map<string, string>()
  const allocated = new Map<string, string>()
  const nextHopAddresses = [
    ...topology.vnets.flatMap((network) => network.appliances.map((app) => app.privateIp)),
    ...(topology.inventory?.loadBalancers ?? []).flatMap((lb) => lb.frontends
      .flatMap((frontend) => frontend.kind === 'private' && frontend.privateIp ? [frontend.privateIp] : [])),
  ]
  const changes = moving.map((entry) => {
    const ip = ipv4(entry.address)
    const offset = ip === undefined ? 4 : oldRange && contains(subnet.prefix, ip) ? ip - oldRange.network : ip % size
    const address = allocated.get(entry.key) ?? allocateAddress(prefix, used, offset)
    allocated.set(entry.key, address)
    used.add(address)
    if (entry.nextHop) {
      if (nextHopAddresses.filter((address) => address === entry.address).length !== 1) {
        throw new Error('Resolve duplicate resource IP addresses before automatically updating next-hop references.')
      }
      replacements.set(entry.address, address)
    }
    return { apply: entry.apply, address }
  })
  subnet.prefix = prefix
  for (const change of changes) change.apply(change.address)
  for (const table of topology.udrTables) for (const route of table.routes) {
    if (route.nextHopType === 'VirtualAppliance' && route.nextHopIp) {
      route.nextHopIp = replacements.get(route.nextHopIp) ?? route.nextHopIp
    }
  }
  for (const network of topology.vnets) {
    for (const app of network.appliances) for (const route of app.staticRoutes) {
      if (route.nextHopKind === 'appliance' && route.nextHopIp) route.nextHopIp = replacements.get(route.nextHopIp) ?? route.nextHopIp
    }
    for (const route of network.vwanHubAttachment?.staticRoutes ?? []) {
      route.nextHopIpAddress = replacements.get(route.nextHopIpAddress) ?? route.nextHopIpAddress
    }
  }
}
