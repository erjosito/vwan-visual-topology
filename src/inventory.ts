import { cidr, contains, ipv4 } from './validation'
import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'

export interface InventorySubnet { id: string; name: string; prefix: string }
export interface InventoryOwner { kind: 'spoke' | 'vnet'; id: string }
export interface Workload { id: string; name: string; nicIds: string[]; backingDeviceId?: string }
export interface NicIpConfiguration { id: string; name: string; subnetId: string; privateIp?: string; publicIpId?: string }
export interface NetworkNic { id: string; name: string; owner: InventoryOwner; ipConfigurations: NicIpConfiguration[] }
export interface PublicIp { id: string; name: string; address?: string }
export interface NetworkInventory { workloads: Workload[]; nics: NetworkNic[]; publicIps: PublicIp[] }
export type InventoryTopology = Topology | AzNetTopology

export function inventoryOwners(topology: InventoryTopology) {
  return topology.version === 1
    ? topology.spokes.map((spoke) => ({ kind: 'spoke' as const, id: spoke.id, name: spoke.name, prefixes: spoke.prefixes, subnets: spoke.subnets ?? [] }))
    : topology.vnets.map((vnet) => ({ kind: 'vnet' as const, id: vnet.id, name: vnet.name, prefixes: vnet.prefixes, subnets: vnet.subnets }))
}

export function sameInventoryOwner(a: InventoryOwner, b: InventoryOwner) {
  return a.kind === b.kind && a.id === b.id
}

export function publicIpv4(address: string): boolean {
  const ip = ipv4(address)
  return ip !== undefined && !['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
    '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/3'].some((prefix) => contains(prefix, ip))
}

export function validateInventory(topology: InventoryTopology): void {
  if (topology.inventory === undefined && (topology.version === 2 || !topology.spokes.some((spoke) => spoke.subnets !== undefined))) return
  const fail = (message: string): never => { throw new Error(`Inventory: ${message}`) }
  const text = (value: unknown, label: string, isId = false): string => {
    if (typeof value !== 'string' || !value || value.length > (isId ? 120 : 4096) || value.includes('\0')
      || (isId && ['__proto__', 'constructor', 'prototype'].includes(value))) fail(`invalid ${label}`)
    return value as string
  }
  const list = (value: unknown, label: string): unknown[] => {
    if (!Array.isArray(value) || value.length > 512) fail(`${label} must be an array of at most 512 entries`)
    return value as unknown[]
  }
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object')
    return value as Record<string, unknown>
  }
  const owners = inventoryOwners(topology)
  for (const owner of owners) {
    const seen = new Set<string>()
    for (const entry of list(owner.subnets, 'subnets')) {
      const subnet = object(entry), id = text(subnet.id, 'subnet ID', true)
      text(subnet.name, 'subnet name')
      const prefix = cidr(text(subnet.prefix, 'subnet prefix'))
      if (seen.has(id)) fail(`duplicate subnet ${id}`)
      seen.add(id)
      if (!prefix || !owner.prefixes.some((parent) => {
        const network = cidr(parent)
        return network && network.length <= prefix.length && contains(parent, prefix.network)
      })) fail(`subnet ${id} is outside its owner address space`)
    }
  }
  if (topology.inventory === undefined) return
  const inventory = object(topology.inventory)
  const ids = new Set<string>(topology.version === 1
    ? [...topology.hubs, ...topology.spokes, ...topology.sites, ...topology.connections].map((entry) => entry.id)
    : [...topology.vnets, ...topology.sites, ...topology.vwanHubs, ...topology.vnets.flatMap((vnet) => [...vnet.gateways, ...vnet.appliances, ...vnet.subnets])].map((entry) => entry.id))
  const named = (entry: unknown, label: string) => {
    const row = object(entry), id = text(row.id, `${label} ID`, true)
    text(row.name, `${label} name`)
    if (ids.has(id)) fail(`duplicate entity ID ${id}`)
    ids.add(id)
    return row
  }
  const publicAddresses = new Set<string>()
  const publicIps = list(inventory.publicIps, 'public IPs').map((entry) => {
    const row = named(entry, 'public IP')
    if (row.address !== undefined) {
      const address = text(row.address, 'public IP address')
      if (!publicIpv4(address) || publicAddresses.has(address)) fail(`invalid or duplicate public address ${address}`)
      publicAddresses.add(address)
    }
    return row
  })
  const addresses = new Set<string>(), publicAssociations = new Set<string>()
  const nics = list(inventory.nics, 'NICs').map((entry) => {
    const nic = named(entry, 'NIC'), owner = object(nic.owner)
    const container = owners.find((entry) => entry.kind === owner.kind && entry.id === owner.id)
    if (!container) fail(`NIC ${nic.id} references a missing owner`)
    const configs = new Set<string>()
    for (const value of list(nic.ipConfigurations, 'IP configurations')) {
      const config = object(value), id = text(config.id, 'IP configuration ID', true)
      text(config.name, 'IP configuration name')
      if (configs.has(id)) fail(`duplicate IP configuration ${id}`)
      configs.add(id)
      const subnet = container!.subnets.find((subnet) => subnet.id === config.subnetId)
      if (!subnet) fail(`NIC ${nic.id} references a missing subnet`)
      if (config.privateIp !== undefined) {
        const address = text(config.privateIp, 'private IP address'), ip = ipv4(address), network = cidr(subnet!.prefix)!
        const key = JSON.stringify([owner.kind, owner.id, address])
        if (ip === undefined || !contains(subnet!.prefix, ip) || ip < network.network + 4
          || ip >= network.network + 2 ** (32 - network.length) - 1 || addresses.has(key)
          || container!.subnets.filter((subnet) => contains(subnet.prefix, ip)).length !== 1) {
          fail(`invalid, reserved or duplicate private address ${address}`)
        }
        addresses.add(key)
      }
      if (config.publicIpId !== undefined) {
        const id = text(config.publicIpId, 'public IP reference', true)
        if (!publicIps.some((entry) => entry.id === id) || publicAssociations.has(id)) fail(`missing or multiply associated public IP ${id}`)
        publicAssociations.add(id)
      }
    }
    return nic
  })
  const attached = new Set<string>(), devices = new Set<string>()
  for (const entry of list(inventory.workloads, 'workloads')) {
    const workload = named(entry, 'workload')
    let owner: InventoryOwner | undefined
    for (const value of list(workload.nicIds, 'workload NIC references')) {
      const id = text(value, 'NIC reference', true), nic = nics.find((nic) => nic.id === id)
      if (!nic || attached.has(id)) fail(`missing or multiply attached NIC ${id}`)
      attached.add(id)
      const next = nic!.owner as unknown as InventoryOwner
      if (owner && !sameInventoryOwner(owner, next)) fail('a workload cannot span different network owners')
      owner = next
    }
    if (workload.backingDeviceId !== undefined) {
      const id = text(workload.backingDeviceId, 'backing device', true)
      const deviceOwner = topology.version === 1
        ? topology.connections.find((connection) => connection.transport === 'SpokeNVA' && connection.siteId === id)?.spokeId
        : topology.vnets.find((vnet) => vnet.appliances.some((appliance) => appliance.id === id))?.id
      if (!deviceOwner || devices.has(id) || (owner && owner.id !== deviceOwner)) fail(`invalid or duplicated backing device ${id}`)
      devices.add(id)
    }
  }
  if (topology.version === 2) {
    for (const nic of topology.inventory.nics) for (const config of nic.ipConfigurations) {
      const owner = topology.vnets.find((vnet) => vnet.id === nic.owner.id)!
      const device = owner.appliances.find((device) => device.privateIp === config.privateIp)
      const workload = topology.inventory.workloads.find((workload) => workload.nicIds.includes(nic.id))
      if (device && workload?.backingDeviceId !== device.id) fail(`NIC ${nic.id} duplicates an existing router address without its backing identity`)
      if (config.privateIp && owner.subnets.some((subnet) => subnet.privateEndpoints?.some((endpoint) => endpoint.ipAddress === config.privateIp))) {
        fail(`NIC ${nic.id} duplicates an existing private endpoint address`)
      }
    }
  }
}

export interface NamedEndpoint {
  workload: Workload
  nic: NetworkNic
  config: NicIpConfiguration
}
export function namedEndpoints(topology: InventoryTopology): NamedEndpoint[] {
  return (topology.inventory?.workloads ?? []).flatMap((workload) => workload.nicIds.flatMap((id) => {
    const nic = topology.inventory?.nics.find((nic) => nic.id === id)
    return nic ? nic.ipConfigurations.map((config) => ({ workload, nic, config })) : []
  }))
}

export function inventoryCounts(topology: InventoryTopology, owner: InventoryOwner, subnetId?: string) {
  const nics = (topology.inventory?.nics ?? []).filter((nic) => sameInventoryOwner(nic.owner, owner)
    && (subnetId === undefined || nic.ipConfigurations.some((config) => config.subnetId === subnetId)))
  return {
    nics: nics.length,
    workloads: (topology.inventory?.workloads ?? []).filter((workload) => workload.nicIds.some((id) => nics.some((nic) => nic.id === id))).length,
    publicIps: new Set(nics.flatMap((nic) => nic.ipConfigurations.filter((config) => subnetId === undefined || config.subnetId === subnetId)
      .flatMap((config) => config.publicIpId ? [config.publicIpId] : []))).size,
  }
}

export function pruneDeletedInventory(next: InventoryTopology, previous: InventoryTopology) {
  if (!next.inventory || !previous.inventory) return
  const before = inventoryOwners(previous), after = inventoryOwners(next)
  const oldNics = new Set(previous.inventory.nics.map((nic) => nic.id))
  next.inventory.nics = next.inventory.nics.filter((nic) => {
    const oldOwner = before.find((owner) => sameInventoryOwner(owner, nic.owner))
    const newOwner = after.find((owner) => sameInventoryOwner(owner, nic.owner))
    if (oldOwner && !newOwner) return false
    nic.ipConfigurations = nic.ipConfigurations.filter((config) =>
      !oldOwner?.subnets.some((subnet) => subnet.id === config.subnetId) || newOwner?.subnets.some((subnet) => subnet.id === config.subnetId))
    return true
  })
  const removed = new Set([...oldNics].filter((id) => !next.inventory!.nics.some((nic) => nic.id === id)))
  next.inventory.workloads = next.inventory.workloads.filter((workload) => {
    const hadNics = workload.nicIds.length > 0
    workload.nicIds = workload.nicIds.filter((id) => !removed.has(id))
    return !hadNics || workload.nicIds.length > 0
  })
  const backingIds = (topology: InventoryTopology) => new Set(topology.version === 1
    ? topology.connections.filter((connection) => connection.transport === 'SpokeNVA').map((connection) => connection.siteId)
    : topology.vnets.flatMap((vnet) => vnet.appliances.map((appliance) => appliance.id)))
  const oldDevices = backingIds(previous), newDevices = backingIds(next)
  for (const workload of next.inventory.workloads) {
    if (workload.backingDeviceId && oldDevices.has(workload.backingDeviceId) && !newDevices.has(workload.backingDeviceId)) delete workload.backingDeviceId
  }
}
