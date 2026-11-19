import { cidr, contains, ipv4 } from '../validation'
import { allocateAddress, usableSubnetAddress, vnetAddresses } from './addressing'
import type { AzNetTopology, AzVNet } from './model'

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
