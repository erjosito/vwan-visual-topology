import { cidr, contains, formatIpv4, ipv4 } from './validation'
import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'

export interface InventorySubnet { id: string; name: string; prefix: string }
export interface InventoryOwner { kind: 'spoke' | 'vnet'; id: string }
export interface Workload { id: string; name: string; nicIds: string[]; backingDeviceId?: string }
export interface NicIpConfiguration { id: string; name: string; subnetId: string; privateIp?: string; publicIpId?: string; primary?: boolean }
export interface NetworkNic { id: string; name: string; owner: InventoryOwner; ipConfigurations: NicIpConfiguration[] }
export interface PublicIp { id: string; name: string; address?: string; sku?: 'Standard' | 'Basic' | 'StandardV2'; allocation?: 'Static' | 'Dynamic' }
export interface PublicIpPrefix { id: string; name: string; sku: 'Standard'; prefixLength: number; prefix?: string }
export interface NatGateway {
  id: string
  name: string
  sku: 'Standard'
  owner: InventoryOwner
  subnetIds: string[]
  publicIpIds: string[]
  publicIpPrefixIds?: string[]
}
export interface RouterSnatOwner { kind: 'appliance' | 'hub'; id: string }
export interface WorkloadIpReference { workloadId: string; nicId: string; ipConfigurationId: string }
export type LoadBalancerFrontend = { id: string; name: string } & (
  { kind: 'public'; publicIpId: string } | { kind: 'private'; subnetId: string; privateIp?: string })
export interface LoadBalancerPool { id: string; name: string; members: WorkloadIpReference[]; membersStatus?: 'unknown' }
export interface LoadBalancerProbe {
  id: string
  name: string
  protocol: 'tcp' | 'http' | 'https'
  port: number
  requestPath?: string
  health: { target: WorkloadIpReference; status: 'healthy' | 'unhealthy' | 'unknown' }[]
}
export interface LoadBalancerRule {
  id: string
  name: string
  frontendId: string
  poolId: string
  probeId: string
  protocol: 'tcp' | 'udp' | 'all'
  frontendPort: number
  backendPort: number
  affinity?: 'none' | 'client-ip' | 'client-ip-protocol'
  disableOutboundSnat?: boolean
  floatingIp?: boolean
  haPorts?: boolean
  haPortsForwarding?: 'preserve-tuple'
}
export interface LoadBalancerInboundNatRule {
  id: string
  name: string
  frontendId: string
  poolId: string
  target: WorkloadIpReference
  protocol: 'tcp' | 'udp'
  frontendPort: number
  backendPort: number
}
export interface LoadBalancerOutboundRule {
  id: string
  name: string
  frontendIds: string[]
  poolId: string
  protocol: 'tcp' | 'udp' | 'any'
}
export interface NetworkLoadBalancer {
  id: string
  name: string
  sku: 'Standard'
  owner: InventoryOwner
  frontends: LoadBalancerFrontend[]
  pools: LoadBalancerPool[]
  probes: LoadBalancerProbe[]
  rules: LoadBalancerRule[]
  inboundNatRules: LoadBalancerInboundNatRule[]
  outboundRules: LoadBalancerOutboundRule[]
  rulesStatus?: 'unknown'
}
export function workloadEndpointKey(ref: WorkloadIpReference & { kind: 'workload' }): string {
  return JSON.stringify(['workload', ref.workloadId, ref.nicId, ref.ipConfigurationId])
}
export interface DnatRule {
  id: string
  name: string
  priority: number
  protocol: 'tcp' | 'udp'
  sourcePrefixes: string[]
  publicIpId: string
  frontendPort: number
  target: WorkloadIpReference
  translatedPort: number
}
export type RouterDnatPolicy = {
  owner: RouterSnatOwner
  publicIpIds: string[]
  rules: DnatRule[]
  rulesStatus?: 'unknown'
} & ({ kind: 'firewall-dnat' } | { kind: 'nva-dnat'; sourceTranslation: 'preserve' | 'interface' })
export interface NetworkSecurityRule {
  id: string
  name: string
  priority: number
  direction: 'inbound' | 'outbound'
  action: 'allow' | 'deny'
  protocol: 'tcp' | 'udp' | 'any' | 'icmp' | 'esp' | 'ah' | 'unknown'
  sources: string[]
  destinations: string[]
  sourcePorts: string[]
  destinationPorts: string[]
}
export interface NetworkSecurityGroup {
  id: string
  name: string
  rules: NetworkSecurityRule[]
  rulesStatus?: 'unknown'
  region?: string
}
export interface NsgAssociation {
  owner: InventoryOwner
  target: { kind: 'subnet' | 'nic'; id: string }
  nsgId?: string
  status?: 'unknown'
}
export type RouterSnatPolicy = {
  owner: RouterSnatOwner
  publicIpIds: string[]
} & ({
  kind: 'firewall-network-rules'
  privateRanges?: string[]
  zoneRedundant?: boolean
} | {
  kind: 'nva-snat'
  sourcePrefixes: string[]
  destinationPrefixes: string[]
  protocol: 'tcp' | 'udp' | 'any'
})
export interface NetworkInventory {
  workloads: Workload[]
  nics: NetworkNic[]
  publicIps: PublicIp[]
  publicIpPrefixes?: PublicIpPrefix[]
  natGateways?: NatGateway[]
  routerSnatPolicies?: RouterSnatPolicy[]
  routerDnatPolicies?: RouterDnatPolicy[]
  loadBalancers?: NetworkLoadBalancer[]
  networkSecurityGroups?: NetworkSecurityGroup[]
  nsgAssociations?: NsgAssociation[]
  capture?: { version: 1; configurationComplete: boolean; resourceIds: Record<string, string> }
}
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
  if (inventory.capture !== undefined) {
    const capture = object(inventory.capture), resources = object(capture.resourceIds)
    if (Object.keys(capture).some((key) => !['version', 'configurationComplete', 'resourceIds'].includes(key))
      || capture.version !== 1 || typeof capture.configurationComplete !== 'boolean' || Object.keys(resources).length > 4096) {
      fail('unsupported connectivity capture provenance')
    }
    for (const [id, resourceId] of Object.entries(resources)) {
      text(id, 'captured entity ID', true)
      if (typeof resourceId !== 'string' || resourceId.length > 2048
        || !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/?#\r\n]+\/providers\/Microsoft\.(Network|Compute)\/[^?#\r\n]+$/i.test(resourceId)) {
        fail('invalid original captured resource ID')
      }
    }
  }
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
    if (row.sku !== undefined && !['Standard', 'Basic', 'StandardV2'].includes(String(row.sku))) fail('unsupported public IP SKU')
    if (row.allocation !== undefined && !['Static', 'Dynamic'].includes(String(row.allocation))) fail('unsupported public IP allocation')
    if (row.address !== undefined) {
      const address = text(row.address, 'public IP address')
      if (!publicIpv4(address) || publicAddresses.has(address)) fail(`invalid or duplicate public address ${address}`)
      publicAddresses.add(address)
    }
    return row
  })
  const addresses = new Set<string>(), publicAssociations = new Set<string>()
  const publicPrefixes = list(inventory.publicIpPrefixes ?? [], 'public IP prefixes').map((entry) => {
    const row = named(entry, 'public IP prefix')
    if (row.sku !== 'Standard' || !Number.isInteger(row.prefixLength) || Number(row.prefixLength) < 28 || Number(row.prefixLength) > 31) {
      fail('public IP prefixes support Standard IPv4 /28-/31 only')
    }
    if (row.prefix !== undefined) {
      const prefix = cidr(text(row.prefix, 'public IP prefix'))
      if (!prefix || prefix.length !== row.prefixLength || ipv4(String(row.prefix).split('/')[0]) !== prefix.network
        || !publicIpv4(formatIpv4(prefix.network)) || !publicIpv4(formatIpv4(prefix.network + 2 ** (32 - prefix.length) - 1))) {
        fail('invalid or non-public IPv4 prefix')
      }
    }
    return row
  })
  for (let index = 0; index < publicPrefixes.length; index++) {
    const prefix = publicPrefixes[index]
    if (prefix.prefix && publicPrefixes.slice(0, index).some((other) => other.prefix
      && (contains(String(other.prefix), cidr(String(prefix.prefix))!.network) || contains(String(prefix.prefix), cidr(String(other.prefix))!.network)))) {
      fail('overlapping public IP prefixes')
    }
  }
  const subnetAssociations = new Set<string>(), prefixAssociations = new Set<string>()
  for (const entry of list(inventory.natGateways ?? [], 'NAT gateways')) {
    const gateway = named(entry, 'NAT gateway'), owner = object(gateway.owner)
    if (gateway.sku !== 'Standard') fail('only Standard IPv4 NAT Gateway is supported')
    const container = owners.find((entry) => entry.kind === owner.kind && entry.id === owner.id)
    if (!container) fail('NAT Gateway requires one original VNet/spoke owner; managed virtual hubs are not supported')
    const subnets = new Set<string>()
    for (const value of list(gateway.subnetIds, 'NAT Gateway subnet references')) {
      const id = text(value, 'NAT Gateway subnet reference', true), subnet = container!.subnets.find((subnet) => subnet.id === id)
      const key = JSON.stringify([owner.kind, owner.id, id])
      if (!subnet || subnets.has(id) || subnetAssociations.has(key)) fail('missing, duplicate or multiply associated NAT Gateway subnet')
      if (subnet!.name.toLowerCase() === 'gatewaysubnet') fail('NAT Gateway cannot associate with GatewaySubnet')
      subnets.add(id); subnetAssociations.add(key)
    }
    let publicCount = 0
    for (const value of list(gateway.publicIpIds, 'NAT Gateway public IP references')) {
      const id = text(value, 'NAT Gateway public IP reference', true), ip = publicIps.find((entry) => entry.id === id)
      if (!ip || ip.sku !== 'Standard' || ip.allocation !== 'Static' || publicAssociations.has(id)) {
        fail('NAT Gateway needs uniquely associated Standard static public IPs')
      }
      publicAssociations.add(id); publicCount++
    }
    for (const value of list(gateway.publicIpPrefixIds ?? [], 'NAT Gateway public IP prefix references')) {
      const id = text(value, 'public IP prefix reference', true), prefix = publicPrefixes.find((entry) => entry.id === id)
      if (!prefix || prefixAssociations.has(id)) fail('missing or multiply associated NAT Gateway public IP prefix')
      if (prefix!.prefix && publicIps.some((ip) => ip.address && contains(String(prefix!.prefix), ipv4(String(ip.address))!))) {
        fail('a NAT Gateway prefix cannot also contain an allocated public IP')
      }
      prefixAssociations.add(id); publicCount += 2 ** (32 - Number(prefix!.prefixLength))
    }
    if (publicCount < 1 || publicCount > 16) fail('Standard NAT Gateway requires 1-16 public IPv4 addresses, including prefixes')
  }
  const nics = list(inventory.nics, 'NICs').map((entry) => {
    const nic = named(entry, 'NIC'), owner = object(nic.owner)
    const container = owners.find((entry) => entry.kind === owner.kind && entry.id === owner.id)
    if (!container) fail(`NIC ${nic.id} references a missing owner`)
    const configs = new Set<string>()
    let primaries = 0
    for (const value of list(nic.ipConfigurations, 'IP configurations')) {
      const config = object(value), id = text(config.id, 'IP configuration ID', true)
      text(config.name, 'IP configuration name')
      if (config.primary !== undefined && typeof config.primary !== 'boolean') fail('invalid NIC primary IPv4 configuration')
      if (config.primary === true && ++primaries > 1) fail('a NIC cannot have multiple primary IPv4 configurations')
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
        const ip = publicIps.find((entry) => entry.id === id)
        if (!ip || publicAssociations.has(id)) fail(`missing or multiply associated public IP ${id}`)
        if (subnetAssociations.has(JSON.stringify([owner.kind, owner.id, config.subnetId])) && ip!.sku !== undefined && ip!.sku !== 'Standard') {
          fail('NAT Gateway subnets cannot contain NICs with non-Standard public IPs')
        }
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
  const groups=list(inventory.networkSecurityGroups??[],'network security groups').map((entry) => {
    const group=named(entry,'NSG')
    if(Object.keys(group).some((key) => !['id','name','rules','rulesStatus','region'].includes(key))
      ||group.rulesStatus!==undefined&&group.rulesStatus!=='unknown') fail('unsupported NSG field or completeness status')
    if(group.region!==undefined) text(group.region,'NSG region')
    const priorities=new Set<string>(),ruleIds=new Set<string>(),names=new Set<string>()
    for(const entry of list(group.rules,'NSG rules')) {
      const rule=object(entry),id=text(rule.id,'NSG rule ID',true),name=text(rule.name,'NSG rule name')
      if(!/^\w[\w.-]{0,78}[\w_]$|^\w$/.test(name)||names.has(name.toLowerCase())||ruleIds.has(id)) fail('invalid or duplicate NSG rule name/ID')
      names.add(name.toLowerCase()); ruleIds.add(id)
      if(Object.keys(rule).some((key) => !['id','name','priority','direction','action','protocol',
        'sources','destinations','sourcePorts','destinationPorts'].includes(key))
        ||!['inbound','outbound'].includes(String(rule.direction))||!['allow','deny'].includes(String(rule.action))
        ||!['tcp','udp','any','icmp','esp','ah','unknown'].includes(String(rule.protocol))
        ||!Number.isInteger(rule.priority)||Number(rule.priority)<100||Number(rule.priority)>4096) fail('invalid NSG rule')
      const priority=`${rule.direction}:${rule.priority}`
      if(priorities.has(priority)) fail('duplicate NSG direction/priority')
      priorities.add(priority)
      for(const field of ['sources','destinations']) {
        const values=list(rule[field],`NSG ${field}`)
        if(!values.length) fail('NSG address selectors cannot be empty')
        let tags=0
        for(const entry of values) {
          const selector=text(entry,'NSG address selector')
          if(selector==='*'||selector.toLowerCase()==='any'||ipv4(selector)!==undefined||cidr(selector)) continue
          if(!/^asg:.+/.test(selector)&&!/^[A-Za-z][A-Za-z0-9._-]*$/.test(selector)) fail('malformed NSG address selector')
          tags++
        }
        if(tags&&values.length!==1) fail('NSG service tags/ASGs cannot be combined with other address selectors')
      }
      for(const field of ['sourcePorts','destinationPorts']) {
        const values=list(rule[field],`NSG ${field}`)
        if(!values.length) fail('NSG port selectors cannot be empty')
        for(const entry of values) {
          const selector=text(entry,'NSG port selector')
          if(selector==='*') continue
          if(!/^\d{1,5}(-\d{1,5})?$/.test(selector)) fail('malformed NSG port selector')
          const [start,end=start]=selector.split('-').map(Number)
          if(start>end||end>65535) fail('invalid NSG port range')
        }
      }
    }
    return group
  })
  const bindings=new Set<string>()
  for(const entry of list(inventory.nsgAssociations??[],'NSG associations')) {
    const binding=object(entry),owner=object(binding.owner),target=object(binding.target)
    if(Object.keys(binding).some((key) => !['owner','target','nsgId','status'].includes(key))
      ||Object.keys(owner).some((key) => !['kind','id'].includes(key))
      ||Object.keys(target).some((key) => !['kind','id'].includes(key))
      ||binding.status!==undefined&&binding.status!=='unknown') fail('unsupported NSG association field')
    const container=owners.find((entry) => entry.kind===owner.kind&&entry.id===owner.id)
    const id=text(target.id,'NSG association target',true)
    if(!container||(target.kind==='subnet'? !container.subnets.some((subnet) => subnet.id===id)
      :target.kind!=='nic'||!nics.some((nic) => nic.id===id&&sameInventoryOwner(nic.owner as unknown as InventoryOwner,owner as unknown as InventoryOwner)))) {
      fail('NSG association requires an original subnet/NIC owner')
    }
    const key=JSON.stringify([owner.kind,owner.id,target.kind,id])
    if(target.kind==='subnet'&&['GatewaySubnet','AzureFirewallSubnet'].includes(container!.subnets.find((subnet) => subnet.id===id)!.name)
      &&binding.status!=='unknown') fail('customer NSGs are not supported on GatewaySubnet or AzureFirewallSubnet')
    if(bindings.has(key)) fail('duplicate NSG association')
    bindings.add(key)
    if(binding.nsgId===undefined&&binding.status!=='unknown') fail('NSG association needs an NSG or explicit captured uncertainty')
    if(binding.nsgId!==undefined) {
      const group=groups.find((group) => group.id===text(binding.nsgId,'NSG reference',true))
      if(!group&&binding.status!=='unknown') fail('NSG association references a missing group')
      if(group?.region&&topology.version===2) {
        const region=topology.vnets.find((vnet) => vnet.id===owner.id)?.region
        if(region&&String(group.region).replace(/\s/g,'').toLowerCase()!==region.replace(/\s/g,'').toLowerCase()) fail('NSG and original VNet must be in the same region')
      }
    }
  }
    const snatOwners = new Set<string>()
    for (const entry of list(inventory.routerSnatPolicies ?? [], 'router SNAT policies')) {
      const policy = object(entry), owner = object(policy.owner), id = text(owner.id, 'SNAT owner', true)
      const fields = ['owner', 'kind', 'publicIpIds', ...(policy.kind === 'firewall-network-rules'
        ? ['privateRanges', 'zoneRedundant'] : ['sourcePrefixes', 'destinationPrefixes', 'protocol'])]
      if (Object.keys(policy).some((field) => !fields.includes(field)) || Object.keys(owner).some((field) => !['kind', 'id'].includes(field))) {
        fail('unsupported router SNAT selector or field')
      }
      const key = JSON.stringify([owner.kind, id])
      const appliance = topology.version === 2 ? topology.vnets.flatMap((vnet) => vnet.appliances).find((device) => device.id === id) : undefined
      const hub = topology.version === 1 ? topology.hubs.find((hub) => hub.id === id) : topology.vwanHubs.find((hub) => hub.id === id)
      if (snatOwners.has(key) || (owner.kind === 'hub' ? !hub : owner.kind !== 'appliance' || !appliance)) fail('missing or duplicate original SNAT owner')
      snatOwners.add(key)
      if (policy.kind === 'firewall-network-rules') {
        if (owner.kind === 'appliance' && appliance?.kind !== 'azure-firewall') fail('Firewall SNAT requires an original Firewall')
        if (policy.zoneRedundant !== undefined && typeof policy.zoneRedundant !== 'boolean') fail('invalid Firewall zone redundancy')
        if (policy.zoneRedundant === true && appliance && topology.version === 2) {
          const vnet = topology.vnets.find((vnet) => vnet.appliances.some((device) => device.id === id))!
          if (natGatewayForSubnet(topology, { kind: 'vnet', id: vnet.id }, appliance.subnetId)) fail('Standard NAT Gateway does not support zone-redundant Firewall integration')
        }
        if (policy.privateRanges !== undefined) {
          const ranges = list(policy.privateRanges, 'Firewall private ranges')
          if (!ranges.length) fail('custom Firewall ranges cannot be empty; use 255.255.255.255/32 for always-SNAT')
          for (const range of ranges) {
            const value = text(range, 'Firewall private range')
            if (value !== 'IANAPrivateRanges' && !cidr(value) && ipv4(value) === undefined) fail('invalid Firewall private range')
          }
        }
      } else if (policy.kind === 'nva-snat') {
        if (owner.kind !== 'appliance' || appliance?.kind !== 'nva-vm') fail('NVA SNAT requires an original NVA')
        if (!['tcp', 'udp', 'any'].includes(String(policy.protocol))) fail('unsupported NVA SNAT protocol')
        for (const field of ['sourcePrefixes', 'destinationPrefixes']) {
          if (!list(policy[field], field).length) fail('NVA SNAT matching requires explicit prefixes')
          for (const prefix of list(policy[field], field)) if (!cidr(text(prefix, field))) fail('invalid NVA SNAT prefix')
        }
      } else fail('unsupported router SNAT policy')
      const references = list(policy.publicIpIds, 'router public IP references')
      if (references.length > 16) fail('router public pools support at most 16 addresses')
      const poolIds = new Set<string>()
      for (const value of references) {
        const id = text(value, 'router public IP reference', true), ip = publicIps.find((entry) => entry.id === id)
        const backingNic = topology.inventory.nics.some((nic) => topology.inventory!.workloads.some((workload) =>
          workload.backingDeviceId === owner.id && workload.nicIds.includes(nic.id)) && nic.ipConfigurations.some((config) =>
          config.publicIpId === id && config.privateIp === appliance?.privateIp))
        if (!ip || poolIds.has(id) || publicAssociations.has(id) && !backingNic || ip.sku !== 'Standard' || ip.allocation !== 'Static') {
          fail('router SNAT needs uniquely associated Standard static public IPs')
        }
        poolIds.add(id)
        publicAssociations.add(id)
      }
    }
  const dnatOwners = new Set<string>(), dnatPublicOwners = new Map<string, string>()
  for (const entry of list(inventory.routerDnatPolicies ?? [], 'router DNAT policies')) {
    const policy = object(entry), owner = object(policy.owner), id = text(owner.id, 'DNAT owner', true)
    const key = JSON.stringify([owner.kind, id])
    const device = topology.version === 2 ? topology.vnets.flatMap((vnet) => vnet.appliances).find((device) => device.id === id) : undefined
    const hub = topology.version === 1 ? topology.hubs.find((hub) => hub.id === id) : topology.vwanHubs.find((hub) => hub.id === id)
    if (dnatOwners.has(key) || (owner.kind === 'hub' ? !hub : owner.kind !== 'appliance' || !device)) fail('missing or duplicate original DNAT owner')
    dnatOwners.add(key)
    if (Object.keys(policy).some((field) => !['owner', 'kind', 'publicIpIds', 'rules', 'rulesStatus',
      ...(policy.kind === 'nva-dnat' ? ['sourceTranslation'] : [])].includes(field))
      || Object.keys(owner).some((field) => !['kind', 'id'].includes(field))
      || policy.rulesStatus !== undefined && policy.rulesStatus !== 'unknown') fail('unsupported DNAT policy field')
    if (policy.kind === 'firewall-dnat' ? owner.kind === 'appliance' && device?.kind !== 'azure-firewall'
      : policy.kind !== 'nva-dnat' || owner.kind !== 'appliance' || device?.kind !== 'nva-vm'
        || !['preserve', 'interface'].includes(String(policy.sourceTranslation))) fail('unsupported original DNAT service or source translation')
    const pool = new Set<string>()
    for (const value of list(policy.publicIpIds, 'DNAT public IP references')) {
      const ipId = text(value, 'DNAT public IP reference', true), ip = publicIps.find((ip) => ip.id === ipId)
      const snat = topology.inventory.routerSnatPolicies?.find((policy) => policy.publicIpIds.includes(ipId))
      const backing = topology.inventory.nics.some((nic) => topology.inventory!.workloads.some((workload) =>
        workload.backingDeviceId === id && workload.nicIds.includes(nic.id)) && nic.ipConfigurations.some((config) =>
        config.publicIpId === ipId && config.privateIp === device?.privateIp))
      if (!ip || ip.sku !== 'Standard' || ip.allocation !== 'Static' || pool.has(ipId) || dnatPublicOwners.has(ipId)
        || publicAssociations.has(ipId) && !(snat && snat.owner.kind === owner.kind && snat.owner.id === id || backing)) {
        fail('DNAT needs uniquely owned Standard static public IPs; only the same original router may share its SNAT pool or backing NIC')
      }
      pool.add(ipId); dnatPublicOwners.set(ipId, key)
    }
    if (!pool.size || pool.size > 16) fail('DNAT requires 1-16 original public IPs')
    const priorities = new Set<number>(), ruleIds = new Set<string>()
    for (const value of list(policy.rules, 'DNAT rules')) {
      const rule = object(value), ruleId = text(rule.id, 'DNAT rule ID', true)
      text(rule.name, 'DNAT rule name')
      if (Object.keys(rule).some((field) => !['id', 'name', 'priority', 'protocol', 'sourcePrefixes', 'publicIpId',
        'frontendPort', 'target', 'translatedPort'].includes(field))
        || ruleIds.has(ruleId) || !Number.isInteger(rule.priority) || Number(rule.priority) < 100 || Number(rule.priority) > 65000
        || priorities.has(Number(rule.priority)) || !['tcp', 'udp'].includes(String(rule.protocol))
        || !pool.has(String(rule.publicIpId))
        || [rule.frontendPort, rule.translatedPort].some((port) => !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)) {
        fail('invalid or duplicate DNAT rule identity, priority, protocol, frontend or ports')
      }
      priorities.add(Number(rule.priority)); ruleIds.add(ruleId)
      const sources = list(rule.sourcePrefixes, 'DNAT source prefixes')
      if (!sources.length || sources.some((prefix) => !cidr(text(prefix, 'DNAT source prefix')))) fail('DNAT requires explicit IPv4 source prefixes')
      const target = object(rule.target)
      if (Object.keys(target).some((field) => !['workloadId', 'nicId', 'ipConfigurationId'].includes(field))) fail('unsupported DNAT target field')
      for (const field of ['workloadId', 'nicId', 'ipConfigurationId']) text(target[field], `DNAT target ${field}`, true)
      const endpoint = namedEndpoints(topology).find(({ workload, nic, config }) => workload.id === target.workloadId
        && nic.id === target.nicId && config.id === target.ipConfigurationId)
      if (!endpoint || endpoint.workload.backingDeviceId) fail('DNAT target must reference an original non-router workload NIC/IP configuration')
    }
  }
  const endpoints = namedEndpoints(topology)
  const endpointReference = (value: unknown) => {
    const target = object(value)
    if (Object.keys(target).some((field) => !['workloadId', 'nicId', 'ipConfigurationId'].includes(field))) fail('unsupported LB backend reference')
    for (const field of ['workloadId', 'nicId', 'ipConfigurationId']) text(target[field], `LB backend ${field}`, true)
    const endpoint = endpoints.find(({ workload, nic, config }) => workload.id === target.workloadId
      && nic.id === target.nicId && config.id === target.ipConfigurationId)
    if (!endpoint) fail('LB backend requires an original workload/NIC/IP configuration')
    return endpoint!
  }
  const supportedFields = (row: Record<string, unknown>, fields: string[], label: string) => {
    if (Object.keys(row).some((field) => !fields.includes(field))) fail(`unsupported ${label} field`)
  }
  const port = (value: unknown) => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535
  const publicFrontendOwners = new Set([...publicAssociations, ...dnatPublicOwners.keys()])
  for (const value of list(inventory.loadBalancers ?? [], 'load balancers')) {
    const lb = named(value, 'load balancer'), owner = object(lb.owner)
    supportedFields(lb, ['id', 'name', 'sku', 'owner', 'frontends', 'pools', 'probes', 'rules', 'inboundNatRules', 'outboundRules', 'rulesStatus'], 'LB')
    supportedFields(owner, ['kind', 'id'], 'LB owner')
    const container = owners.find((entry) => sameInventoryOwner(entry, owner as unknown as InventoryOwner))
    if (!container || lb.sku !== 'Standard' || lb.rulesStatus !== undefined && lb.rulesStatus !== 'unknown') {
      fail('LB requires an original network owner, regional Standard SKU and known/unknown rule completeness')
    }
    const frontends = list(lb.frontends, 'LB frontends').map((entry) => {
      const frontend = named(entry, 'LB frontend')
      supportedFields(frontend, ['id', 'name', 'kind', ...(frontend.kind === 'public' ? ['publicIpId'] : ['subnetId', 'privateIp'])], 'LB frontend')
      if (frontend.kind === 'public') {
        const id = text(frontend.publicIpId, 'LB public IP reference', true), ip = publicIps.find((ip) => ip.id === id)
        if (!ip || ip.sku !== 'Standard' || ip.allocation !== 'Static' || publicFrontendOwners.has(id)) {
          fail('LB frontend requires a uniquely owned Standard static public IP')
        }
        publicFrontendOwners.add(id)
      } else if (frontend.kind === 'private') {
        const subnet = container!.subnets.find((subnet) => subnet.id === frontend.subnetId)
        if (!subnet || ['GatewaySubnet', 'AzureFirewallSubnet'].includes(subnet.name)) fail('internal LB requires an original supported subnet')
        if (frontend.privateIp !== undefined) {
          const address = text(frontend.privateIp, 'LB private frontend address'), ip = ipv4(address), range = cidr(subnet!.prefix)!
          const key = JSON.stringify([owner.kind, owner.id, address])
          const collision = topology.version === 2
            ? topology.vnets.find((vnet) => vnet.id === owner.id)?.appliances.some((device) => device.privateIp === address)
              || topology.vnets.find((vnet) => vnet.id === owner.id)?.subnets.some((subnet) => subnet.privateEndpoints?.some((endpoint) => endpoint.ipAddress === address))
            : topology.connections.some((connection) => connection.transport === 'SpokeNVA' && connection.spokeId === owner.id && connection.peerIp === address)
          if (ip === undefined || !contains(subnet!.prefix, ip) || ip < range.network + 4
            || ip >= range.network + 2 ** (32 - range.length) - 1 || addresses.has(key) || collision
            || container!.subnets.filter((subnet) => contains(subnet.prefix, ip)).length !== 1) fail('invalid, reserved or colliding internal LB address')
          addresses.add(key)
        }
      } else fail('unsupported LB frontend kind')
      return frontend
    })
    if (new Set(frontends.map((frontend) => frontend.kind)).size > 1) fail('a regional LB cannot mix public and internal frontends')
    const pools = list(lb.pools, 'LB pools').map((entry) => {
      const pool = named(entry, 'LB pool')
      supportedFields(pool, ['id', 'name', 'members', 'membersStatus'], 'LB pool')
      if (pool.membersStatus !== undefined && pool.membersStatus !== 'unknown') fail('unsupported LB membership completeness')
      const members = new Set<string>()
      for (const member of list(pool.members, 'LB members')) {
        const endpoint = endpointReference(member), key = workloadEndpointKey({ kind: 'workload', ...member as WorkloadIpReference })
        if (!sameInventoryOwner(endpoint.nic.owner, owner as unknown as InventoryOwner) || members.has(key)) {
          fail('LB backends must be unique original NIC associations in the same VNet')
        }
        if (['gatewaysubnet', 'azurefirewallsubnet'].includes(container!.subnets.find((subnet) => subnet.id === endpoint.config.subnetId)!.name.toLowerCase())) {
          fail('LB VM backends cannot occupy managed gateway/Firewall subnets')
        }
        if (endpoint.config.publicIpId && publicIps.find((ip) => ip.id === endpoint.config.publicIpId)?.sku !== 'Standard') {
          fail('Standard LB backends cannot have unknown or non-Standard instance public IP SKUs')
        }
        if (topology.version === 2 && endpoint.workload.backingDeviceId && topology.vnets
          .flatMap((vnet) => vnet.appliances).find((device) => device.id === endpoint.workload.backingDeviceId)?.kind !== 'nva-vm') {
          fail('a managed Azure Firewall is not a VM LB backend')
        }
        members.add(key)
      }
      return pool
    })
    const memberInPool = (pool: Record<string, unknown>, target: unknown) => {
      const endpoint = endpointReference(target)
      return (pool.members as WorkloadIpReference[]).some((member) => member.workloadId === endpoint.workload.id
        && member.nicId === endpoint.nic.id && member.ipConfigurationId === endpoint.config.id)
    }
    const probes = list(lb.probes, 'LB probes').map((entry) => {
      const probe = named(entry, 'LB probe')
      supportedFields(probe, ['id', 'name', 'protocol', 'port', 'requestPath', 'health'], 'LB probe')
      if (!['tcp', 'http', 'https'].includes(String(probe.protocol)) || !port(probe.port)) fail('invalid LB health probe')
      if (probe.requestPath !== undefined && (probe.protocol === 'tcp' || !text(probe.requestPath, 'LB probe path').startsWith('/'))) fail('invalid LB probe request path')
      const health = new Set<string>()
      for (const entry of list(probe.health, 'LB declared health')) {
        const state = object(entry)
        supportedFields(state, ['target', 'status'], 'LB health')
        const endpoint = endpointReference(state.target), key = workloadEndpointKey({ kind: 'workload', ...state.target as WorkloadIpReference })
        if (!sameInventoryOwner(endpoint.nic.owner, owner as unknown as InventoryOwner) || !pools.some((pool) => memberInPool(pool, state.target))
          || health.has(key) || !['healthy', 'unhealthy', 'unknown'].includes(String(state.status))) fail('invalid or duplicate original LB probe health')
        health.add(key)
      }
      return probe
    })
    const matches = new Set<string>()
    const match = (rule: Record<string, unknown>) => {
      const frontend = frontends.find((frontend) => frontend.id === rule.frontendId), pool = pools.find((pool) => pool.id === rule.poolId)
      if (!frontend || !pool) fail('LB rule requires original frontend and pool references')
      const key = JSON.stringify([rule.frontendId, rule.protocol, rule.frontendPort])
      if (matches.has(key) || rule.protocol === 'all' && [...matches].some((key) => JSON.parse(key)[0] === rule.frontendId)
        || [...matches].some((key) => JSON.parse(key)[0] === rule.frontendId && JSON.parse(key)[1] === 'all')) {
        fail('overlapping LB frontend rule or inbound NAT match')
      }
      matches.add(key)
      return { frontend: frontend!, pool: pool! }
    }
    const rules = list(lb.rules, 'LB rules').map((entry) => {
      const rule = named(entry, 'LB rule')
      supportedFields(rule, ['id', 'name', 'frontendId', 'poolId', 'probeId', 'protocol', 'frontendPort', 'backendPort',
        'affinity', 'disableOutboundSnat', 'floatingIp', 'haPorts', 'haPortsForwarding'], 'LB rule')
      if (rule.haPortsForwarding !== undefined && (rule.haPortsForwarding !== 'preserve-tuple' || !rule.haPorts || !rule.floatingIp)) fail('HA forwarding requires floating HA ports and an explicit preserve-tuple declaration')
      for (const field of ['disableOutboundSnat', 'floatingIp', 'haPorts']) if (rule[field] !== undefined && typeof rule[field] !== 'boolean') fail('invalid LB rule flag')
      if (rule.affinity !== undefined && !['none', 'client-ip', 'client-ip-protocol'].includes(String(rule.affinity))) fail('unsupported LB affinity')
      const { frontend } = match(rule)
      if (!probes.some((probe) => probe.id === rule.probeId)) fail('LB rule requires an original health probe')
      if (rule.haPorts === true) {
        if (frontend.kind !== 'private' || rule.protocol !== 'all' || rule.frontendPort !== 0 || rule.backendPort !== 0) fail('HA ports require internal Standard, protocol All and ports 0')
      } else if (!['tcp', 'udp'].includes(String(rule.protocol)) || !port(rule.frontendPort) || !port(rule.backendPort)) fail('invalid ordinary LB rule protocol/ports')
      return rule
    })
    for (const entry of list(lb.inboundNatRules, 'LB inbound NAT rules')) {
      const rule = named(entry, 'LB inbound NAT rule')
      supportedFields(rule, ['id', 'name', 'frontendId', 'poolId', 'target', 'protocol', 'frontendPort', 'backendPort'], 'LB inbound NAT rule')
      const { pool } = match(rule)
      if (!['tcp', 'udp'].includes(String(rule.protocol)) || !port(rule.frontendPort) || !port(rule.backendPort)
        || !memberInPool(pool, rule.target)) fail('LB inbound NAT requires a specific original pool member and supported protocol/ports')
    }
    const outboundMatches = new Set<string>()
    for (const entry of list(lb.outboundRules, 'LB outbound rules')) {
      const rule = named(entry, 'LB outbound rule')
      supportedFields(rule, ['id', 'name', 'frontendIds', 'poolId', 'protocol'], 'LB outbound rule')
      const pool = pools.find((pool) => pool.id === rule.poolId)
      if (!pool || !['tcp', 'udp', 'any'].includes(String(rule.protocol))) fail('invalid LB outbound pool/protocol')
      if ((pool!.members as WorkloadIpReference[]).some((member) => endpointReference(member).config.primary === false)) fail('IPv4 LB outbound rules cannot reference secondary IP configurations')
      const references = list(rule.frontendIds, 'LB outbound frontend references'), seen = new Set<string>()
      if (!references.length || references.length > 16) fail('LB outbound rule requires 1-16 public frontends')
      for (const value of references) {
        const id = text(value, 'LB outbound frontend reference', true), frontend = frontends.find((frontend) => frontend.id === id)
        if (!frontend || frontend.kind !== 'public' || seen.has(id)) fail('LB outbound requires unique original public frontend references')
        if (rules.some((rule) => rule.frontendId === id && rule.disableOutboundSnat !== true)) fail('disable load-balancing-rule outbound SNAT before adding an explicit outbound rule')
        const protocols = rule.protocol === 'any' ? ['tcp', 'udp'] : [String(rule.protocol)]
        for (const protocol of protocols) {
          const key = JSON.stringify([rule.poolId, id, protocol])
          if (outboundMatches.has(key)) fail('overlapping LB outbound rule')
          outboundMatches.add(key)
        }
        seen.add(id)
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

export function loadBalancerOutboundCandidates(topology: InventoryTopology, target: WorkloadIpReference, protocol?: 'tcp' | 'udp') {
  const endpoint = namedEndpoints(topology).find(({ workload, nic, config }) => workload.id === target.workloadId
    && nic.id === target.nicId && config.id === target.ipConfigurationId)
  if (!endpoint) return []
  const primaryKnown = endpoint.config.primary === true || endpoint.config.primary === undefined && endpoint.nic.ipConfigurations.length === 1
  return (topology.inventory?.loadBalancers ?? []).flatMap((lb) => lb.pools.flatMap((pool) => {
    if (!pool.members.some((member) => member.workloadId === target.workloadId && member.nicId === target.nicId
      && member.ipConfigurationId === target.ipConfigurationId)) return []
    const explicit = lb.outboundRules.filter((rule) => rule.poolId === pool.id && (!protocol || rule.protocol === 'any' || rule.protocol === protocol))
      .map((rule) => ({ lb, pool, ruleId: rule.id, primaryKnown, unsupported: false,
        frontends: lb.frontends.filter((frontend) => frontend.kind === 'public' && rule.frontendIds.includes(frontend.id)) }))
    const implicit = lb.rules.filter((rule) => rule.poolId === pool.id && rule.disableOutboundSnat !== true
      && (!protocol || rule.protocol === protocol || rule.protocol === 'all')
      && lb.frontends.some((frontend) => frontend.id === rule.frontendId && frontend.kind === 'public'))
      .map((rule) => ({ lb, pool, ruleId: rule.id, primaryKnown, unsupported: rule.haPorts === true || rule.floatingIp === true,
        frontends: lb.frontends.filter((frontend) => frontend.id === rule.frontendId) }))
    return [...explicit, ...implicit]
  }))
}

export function inventoryCounts(topology: InventoryTopology, owner: InventoryOwner, subnetId?: string) {
  const nics = (topology.inventory?.nics ?? []).filter((nic) => sameInventoryOwner(nic.owner, owner)
    && (subnetId === undefined || nic.ipConfigurations.some((config) => config.subnetId === subnetId)))
  return {
    loadBalancers: (topology.inventory?.loadBalancers ?? []).filter((lb) => sameInventoryOwner(lb.owner, owner)
      && (subnetId === undefined || lb.frontends.some((frontend) => frontend.kind === 'private' && frontend.subnetId === subnetId)
        || lb.pools.some((pool) => pool.members.some((member) => nics.some((nic) => nic.id === member.nicId
          && nic.ipConfigurations.some((config) => config.id === member.ipConfigurationId && config.subnetId === subnetId)))))).length,
    nsgs: new Set((topology.inventory?.nsgAssociations ?? []).filter((binding) => sameInventoryOwner(binding.owner, owner)
      && (subnetId === undefined || binding.target.kind === 'subnet' && binding.target.id === subnetId
        || binding.target.kind === 'nic' && nics.some((nic) => nic.id === binding.target.id)))
      .map((binding) => binding.nsgId ?? `unknown:${binding.target.kind}:${binding.target.id}`)).size,
    natGateways: (topology.inventory?.natGateways ?? []).filter((gateway) => sameInventoryOwner(gateway.owner, owner)
      && (subnetId === undefined || gateway.subnetIds.includes(subnetId))).length,
    nics: nics.length,
    workloads: (topology.inventory?.workloads ?? []).filter((workload) => workload.nicIds.some((id) => nics.some((nic) => nic.id === id))).length,
    publicIps: new Set(nics.flatMap((nic) => nic.ipConfigurations.filter((config) => subnetId === undefined || config.subnetId === subnetId)
      .flatMap((config) => config.publicIpId ? [config.publicIpId] : []))).size,
  }
}

export function natGatewayForSubnet(topology: InventoryTopology, owner: InventoryOwner, subnetId: string) {
  return topology.inventory?.natGateways?.find((gateway) => sameInventoryOwner(gateway.owner, owner) && gateway.subnetIds.includes(subnetId))
}

export function nsgAssociation(topology: InventoryTopology, owner: InventoryOwner, target: NsgAssociation['target']) {
  return topology.inventory?.nsgAssociations?.find((binding) => sameInventoryOwner(binding.owner, owner)
    && binding.target.kind === target.kind && binding.target.id === target.id)
}

export function pruneDeletedInventory(next: InventoryTopology, previous: InventoryTopology) {
  if (!next.inventory || !previous.inventory) return
  const before = inventoryOwners(previous), after = inventoryOwners(next)
  const routerExists = (topology: InventoryTopology, owner: RouterSnatOwner) => owner.kind === 'hub'
    ? (topology.version === 1 ? topology.hubs : topology.vwanHubs).some((hub) => hub.id === owner.id)
    : topology.version === 2 && topology.vnets.some((vnet) => vnet.appliances.some((device) => device.id === owner.id))
  if (next.inventory.routerSnatPolicies) next.inventory.routerSnatPolicies = next.inventory.routerSnatPolicies.filter((policy) =>
    !routerExists(previous, policy.owner) || routerExists(next, policy.owner))
  if (next.inventory.routerDnatPolicies) next.inventory.routerDnatPolicies = next.inventory.routerDnatPolicies.filter((policy) =>
    !routerExists(previous, policy.owner) || routerExists(next, policy.owner))
  if (next.inventory.natGateways) next.inventory.natGateways = next.inventory.natGateways.filter((gateway) => {
    const oldOwner = before.find((owner) => sameInventoryOwner(owner, gateway.owner))
    const newOwner = after.find((owner) => sameInventoryOwner(owner, gateway.owner))
    if (oldOwner && !newOwner) return false
    gateway.subnetIds = gateway.subnetIds.filter((id) => !oldOwner?.subnets.some((subnet) => subnet.id === id)
      || newOwner?.subnets.some((subnet) => subnet.id === id))
    return true
  })
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
  if (next.inventory.nsgAssociations) next.inventory.nsgAssociations = next.inventory.nsgAssociations.filter((binding) => {
    const oldOwner = before.find((owner) => sameInventoryOwner(owner, binding.owner))
    const newOwner = after.find((owner) => sameInventoryOwner(owner, binding.owner))
    if (oldOwner && !newOwner) return false
    return binding.target.kind === 'nic' ? !removed.has(binding.target.id)
      : !oldOwner?.subnets.some((subnet) => subnet.id === binding.target.id) || !!newOwner?.subnets.some((subnet) => subnet.id === binding.target.id)
  })
  const backingIds = (topology: InventoryTopology) => new Set(topology.version === 1
    ? topology.connections.filter((connection) => connection.transport === 'SpokeNVA').map((connection) => connection.siteId)
    : topology.vnets.flatMap((vnet) => vnet.appliances.map((appliance) => appliance.id)))
  const oldDevices = backingIds(previous), newDevices = backingIds(next)
  for (const workload of next.inventory.workloads) {
    if (workload.backingDeviceId && oldDevices.has(workload.backingDeviceId) && !newDevices.has(workload.backingDeviceId)) delete workload.backingDeviceId
  }
  for (const policy of next.inventory.routerDnatPolicies ?? []) {
    policy.rules = policy.rules.filter((rule) => namedEndpoints(next).some(({ workload, nic, config }) =>
      workload.id === rule.target.workloadId && nic.id === rule.target.nicId && config.id === rule.target.ipConfigurationId))
  }
  if (next.inventory.loadBalancers) next.inventory.loadBalancers = next.inventory.loadBalancers.filter((lb) => {
    const oldOwner = before.find((owner) => sameInventoryOwner(owner, lb.owner)), newOwner = after.find((owner) => sameInventoryOwner(owner, lb.owner))
    if (oldOwner && !newOwner) return false
    lb.frontends = lb.frontends.filter((frontend) => frontend.kind !== 'private'
      || !oldOwner?.subnets.some((subnet) => subnet.id === frontend.subnetId) || newOwner?.subnets.some((subnet) => subnet.id === frontend.subnetId))
    const exists = (target: WorkloadIpReference) => namedEndpoints(next).some(({ workload, nic, config }) =>
      workload.id === target.workloadId && nic.id === target.nicId && config.id === target.ipConfigurationId)
    for (const pool of lb.pools) pool.members = pool.members.filter(exists)
    for (const probe of lb.probes) probe.health = probe.health.filter((state) => exists(state.target)
      && lb.pools.some((pool) => pool.members.some((member) => workloadEndpointKey({ kind: 'workload', ...member }) === workloadEndpointKey({ kind: 'workload', ...state.target }))))
    lb.inboundNatRules = lb.inboundNatRules.filter((rule) => exists(rule.target) && lb.frontends.some((frontend) => frontend.id === rule.frontendId))
    lb.rules = lb.rules.filter((rule) => lb.frontends.some((frontend) => frontend.id === rule.frontendId))
    lb.outboundRules = lb.outboundRules.filter((rule) => {
      rule.frontendIds = rule.frontendIds.filter((id) => lb.frontends.some((frontend) => frontend.id === id))
      return rule.frontendIds.length > 0
    })
    return true
  })
}
