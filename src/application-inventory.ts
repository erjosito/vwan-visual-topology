import { inventoryOwners, namedEndpoints, ownsInventoryAddress, sameInventoryOwner } from './inventory'
import type { InventoryOwner, InventoryTopology } from './inventory'
import type { ApplicationReference, FirewallProxyConfiguration } from './application'
import { cidr, formatIpv4 } from './ipv4'

export const applicationLimits = {
  maxServices: 32, maxDnsProfiles: 32, maxReferences: 64, maxFeatures: 32,
  maxListeners: 64, maxRules: 64, maxMembers: 64, maxDnsEndpoints: 64,
} as const
export const fail = (reason: string): never => { throw new Error(`Application: ${reason}`) }
export function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return fail('plain object required')
  const record = value as Record<string, unknown>
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(record))) {
    if (!fields.includes(key) || !('value' in descriptor)) fail(`unknown or unsafe field ${key}`)
  }
  return record
}
export function text(value: unknown, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || ['__proto__', 'constructor', 'prototype'].includes(value)) return fail('bounded nonempty text required')
  return value
}
export function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length) return fail(`dense array of at most ${max} entries required`)
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor)) fail('plain array values required')
  }
  return value
}
export function normalizeApplicationHost(value: unknown): string {
  const host = text(value, 253).toLowerCase().replace(/\.$/, '')
  if (!host || host.split('.').some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    || /^\d+(?:\.\d+){3}$/.test(host)) return fail('explicit DNS hostname required; URLs, IP literals and wildcards are not request hosts')
  return host
}
function owner(value: unknown): InventoryOwner {
  const entry = object(value, ['kind', 'id'])
  if (!['vnet', 'spoke'].includes(entry.kind as string)) fail('original VNet/spoke owner required')
  text(entry.id)
  return entry as unknown as InventoryOwner
}
export function reference(value: unknown): ApplicationReference {
  const entry = object(value, ['kind', 'id', 'owner', 'workloadId', 'nicId', 'ipConfigurationId', 'loadBalancerId'])
  switch (entry.kind) {
    case 'service': case 'dns-profile': case 'public-ip':
      object(entry, ['kind', 'id']); text(entry.id); break
    case 'appliance': case 'subnet':
      object(entry, ['kind', 'id', 'owner']); text(entry.id); owner(entry.owner); break
    case 'workload':
      object(entry, ['kind', 'workloadId', 'nicId', 'ipConfigurationId'])
      text(entry.workloadId); text(entry.nicId); text(entry.ipConfigurationId); break
    case 'load-balancer-frontend': case 'load-balancer-pool':
      object(entry, ['kind', 'id', 'loadBalancerId']); text(entry.id); text(entry.loadBalancerId); break
    default: fail('unsupported original reference')
  }
  return entry as unknown as ApplicationReference
}
export function applicationReferenceKey(ref: ApplicationReference): string {
  switch (ref.kind) {
    case 'workload': return JSON.stringify([ref.kind, ref.workloadId, ref.nicId, ref.ipConfigurationId])
    case 'appliance': case 'subnet': return JSON.stringify([ref.kind, ref.owner.kind, ref.owner.id, ref.id])
    case 'load-balancer-frontend': case 'load-balancer-pool': return JSON.stringify([ref.kind, ref.loadBalancerId, ref.id])
    default: return JSON.stringify([ref.kind, ref.id])
  }
}
export function applicationReferenceExists(topology: InventoryTopology, ref: ApplicationReference): boolean {
  const inventory = topology.inventory
  switch (ref.kind) {
    case 'service': return !!topology.application?.services.some((entry) => entry.id === ref.id)
    case 'dns-profile': return !!topology.application?.dnsProfiles.some((entry) => entry.id === ref.id)
    case 'subnet': return inventoryOwners(topology).some((entry) => sameInventoryOwner(entry, ref.owner) && entry.subnets.some((subnet) => subnet.id === ref.id))
    case 'appliance': return topology.version === 2 && ref.owner.kind === 'vnet'
      && topology.vnets.some((vnet) => vnet.id === ref.owner.id && vnet.appliances.some((device) => device.id === ref.id))
    case 'workload': return namedEndpoints(topology).some(({ workload, nic, config }) => workload.id === ref.workloadId && nic.id === ref.nicId && config.id === ref.ipConfigurationId)
    case 'public-ip': return !!inventory?.publicIps.some((entry) => entry.id === ref.id)
    case 'load-balancer-frontend': return !!inventory?.loadBalancers?.some((entry) => entry.id === ref.loadBalancerId && entry.frontends.some((frontend) => frontend.id === ref.id))
    case 'load-balancer-pool': return !!inventory?.loadBalancers?.some((entry) => entry.id === ref.loadBalancerId && entry.pools.some((pool) => pool.id === ref.id))
  }
}
export function validateApplicationInventory(topology: InventoryTopology): void {
  if (topology.application === undefined) return
  const application = object(topology.application, ['version', 'services', 'dnsProfiles'])
  if (application.version !== 1) fail('unsupported inventory version')
  const services = list(application.services, applicationLimits.maxServices)
  const profiles = list(application.dnsProfiles, applicationLimits.maxDnsProfiles)
  const ids = new Set<string>()
  const proxyAllocations = new Set<string>()
  const firewallAppliances = new Set<string>()
  for (const [entries, kinds] of [[services, ['application-gateway', 'front-door', 'azure-firewall']], [profiles, ['traffic-manager']]] as const) {
    for (const value of entries) {
      const entry = object(value, entries === services ? ['id', 'name', 'kind', 'owner', 'references', 'unsupportedFeatures', 'tcpProxy', 'firewallProxy'] : ['id', 'name', 'kind', 'references', 'unsupportedFeatures'])
      const id = text(entry.id)
      if (ids.has(id)) fail(`duplicate original ID ${id}`)
      ids.add(id); text(entry.name)
      if (!(kinds as readonly unknown[]).includes(entry.kind)) fail('unsupported service identity kind')
      if (entry.owner !== undefined) {
        const scope = owner(entry.owner)
        if (!inventoryOwners(topology).some((entry) => sameInventoryOwner(entry, scope))) fail('missing original service owner')
      }
      const refs = list(entry.references, applicationLimits.maxReferences).map(reference)
      if (new Set(refs.map(applicationReferenceKey)).size !== refs.length) fail('duplicate original references')
      for (const feature of list(entry.unsupportedFeatures, applicationLimits.maxFeatures)) text(feature, 256)
      if (entry.firewallProxy !== undefined) validateFirewallProxyInventory(topology, entry, firewallAppliances)
      if (entry.tcpProxy !== undefined) {
        const proxy = object(entry.tcpProxy, ['sku', 'subnetId', 'frontendAddress', 'instanceAddress', 'listenerId', 'ruleId', 'rulePriority', 'poolId',
          'frontendPort', 'backendPort', 'backend', 'declaredHealth', 'provisioningState', 'proxyProtocol'])
        if (topology.version !== 2 || entry.kind !== 'application-gateway' || entry.owner === undefined) fail('TCP proxy requires an original native-v2 Application Gateway owner')
        const scope = owner(entry.owner), network = topology.version === 2 ? topology.vnets.find((vnet) => vnet.id === scope.id) : undefined
        const subnet = network?.subnets.find((subnet) => subnet.id === proxy.subnetId)
        if (scope.kind !== 'vnet' || !subnet || ['GatewaySubnet', 'RouteServerSubnet', 'AzureFirewallSubnet'].includes(subnet.name)) return fail('original dedicated Application Gateway subnet required')
        if (network?.appliances.some((device) => device.subnetId === subnet.id)
          || topology.inventory?.nics.some((nic) => sameInventoryOwner(nic.owner, scope) && nic.ipConfigurations.some((config) => config.subnetId === subnet.id))
          || subnet.privateEndpoints?.length
          || topology.inventory?.loadBalancers?.some((lb) => sameInventoryOwner(lb.owner, scope) && lb.frontends.some((frontend) => frontend.kind === 'private' && frontend.subnetId === subnet.id))
          || topology.inventory?.privateLinkServices?.some((service) => sameInventoryOwner(service.owner, scope) && service.natIpConfigurations.some((config) => config.subnetId === subnet.id))) {
          fail('Application Gateway subnet must not contain other modeled services or NICs')
        }
        if (typeof proxy.sku !== 'string' || !['Standard_v2', 'WAF_v2'].includes(proxy.sku)
          || typeof proxy.provisioningState !== 'string' || !['succeeded', 'unknown'].includes(proxy.provisioningState)
          || typeof proxy.declaredHealth !== 'string' || !['healthy', 'unhealthy', 'unknown'].includes(proxy.declaredHealth)
          || typeof proxy.proxyProtocol !== 'boolean') fail('explicit TCP proxy SKU, provisioning, health and Proxy Protocol states required')
        const configurationIds = ['listenerId', 'ruleId', 'poolId'].map((field) => text(proxy[field]))
        if (new Set(configurationIds).size !== configurationIds.length) fail('distinct original listener, rule and pool IDs required')
        if (typeof proxy.rulePriority !== 'number' || !Number.isInteger(proxy.rulePriority) || proxy.rulePriority < 1 || proxy.rulePriority > 20000) fail('original TCP rule priority 1-20000 required')
        for (const field of ['frontendPort', 'backendPort']) {
          const port = proxy[field]
          if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) fail('TCP proxy ports 1-65535 required')
        }
        for (const field of ['frontendAddress', 'instanceAddress']) {
          if (proxy[field] === undefined) continue
          const address = text(proxy[field]), key = JSON.stringify([scope.id, address])
          if (!ownsInventoryAddress(topology, scope, subnet.id, address) || proxyAllocations.has(key)) fail('TCP proxy address must be unique within its original gateway subnet')
          proxyAllocations.add(key)
        }
        const backend = object(proxy.backend, ['workloadId', 'nicId', 'ipConfigurationId'])
        const target = reference({ kind: 'workload', ...backend })
        if (!applicationReferenceExists(topology, target)) fail('original TCP backend workload/NIC/IP binding required')
      }
    }
  }
  for (const entry of [...topology.application.services, ...topology.application.dnsProfiles]) {
    for (const ref of entry.references) {
      if (!applicationReferenceExists(topology, ref)) fail('missing or mismatched original reference')
    }
  }
}

const oneOf = (value: unknown, values: readonly string[]) => {
  if (typeof value !== 'string' || !values.includes(value)) fail(`expected ${values.join(' or ')}`)
}
const integer = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(`integer ${min}-${max} required`)
}
function prefixes(value: unknown) {
  const entries = list(value, 64)
  if (!entries.length || entries.some((entry) => {
    const range = typeof entry === 'string' && cidr(entry)
    return !range || `${formatIpv4(range.network)}/${range.length}` !== entry
  })) fail('nonempty canonical IPv4 prefix list required')
}
export function validateFirewallProxyInventory(topology: InventoryTopology, service: Record<string, unknown>, seen: Set<string>):
  asserts service is Record<string, unknown> & { firewallProxy: FirewallProxyConfiguration } {
  const scope = object(service.owner, ['kind', 'id'])
  if (topology.version !== 2 || service.kind !== 'azure-firewall' || scope.kind !== 'vnet') return fail('Firewall proxy requires an original native-v2 Firewall VNet owner')
  const owner = { kind: 'vnet' as const, id: text(scope.id) }
  const config = object(service.firewallProxy, ['applianceId', 'policyId', 'sku', 'configuration', 'parentPolicy', 'dnat',
    'threatIntelligence', 'idps', 'tlsInspection', 'provisioningState', 'explicitProxy', 'collections', 'dnsBindings'])
  const network = topology.vnets.find((entry) => entry.id === owner.id)
  const device = network?.appliances.find((entry) => entry.id === config.applianceId && entry.kind === 'azure-firewall')
  const subnet = network?.subnets.find((entry) => entry.id === device?.subnetId && entry.name === 'AzureFirewallSubnet')
  if (!device || !subnet || !ownsInventoryAddress(topology, owner, subnet.id, device.privateIp)) return fail('original Firewall appliance and owned AzureFirewallSubnet allocation required')
  if (seen.has(device.id)) fail('one original proxy policy per Firewall appliance required')
  seen.add(device.id); text(config.policyId)
  if (network!.appliances.some((entry) => entry.id !== device.id && entry.subnetId === subnet.id)
    || topology.inventory?.nics.some((nic) => sameInventoryOwner(nic.owner, owner) && nic.ipConfigurations.some((ip) => ip.subnetId === subnet.id))
    || subnet.privateEndpoints?.length
    || topology.inventory?.loadBalancers?.some((lb) => sameInventoryOwner(lb.owner, owner) && lb.frontends.some((frontend) => frontend.kind === 'private' && frontend.subnetId === subnet.id))
    || topology.application?.services.some((entry) => entry.id !== service.id && entry.owner && sameInventoryOwner(entry.owner, owner) && entry.tcpProxy?.subnetId === subnet.id)
    || topology.inventory?.privateLinkServices?.some((entry) => sameInventoryOwner(entry.owner, owner) && entry.natIpConfigurations.some((ip) => ip.subnetId === subnet.id))) fail('dedicated original AzureFirewallSubnet required')
  oneOf(config.sku, ['Standard', 'Premium'])
  oneOf(config.configuration, ['complete', 'unknown'])
  for (const field of ['parentPolicy', 'dnat']) oneOf(config[field], ['none', 'unknown'])
  for (const field of ['threatIntelligence', 'idps', 'tlsInspection']) oneOf(config[field], ['off', 'unknown'])
  oneOf(config.provisioningState, ['succeeded', 'unknown'])
  const explicit = object(config.explicitProxy, ['enabled', 'httpPort'])
  if (typeof explicit.enabled !== 'boolean') fail('explicit proxy enabled boolean required')
  integer(explicit.httpPort, 1, 65535)
  const ids = new Set<string>(), groupPriorities = new Map<string, number>(), groups = new Map<number, string>(), priorities = new Set<string>()
  for (const value of list(config.collections, 64)) {
    const collection = object(value, ['id', 'groupId', 'groupPriority', 'priority', 'action', 'type', 'rules'])
    const id = text(collection.id), group = text(collection.groupId)
    if (ids.has(id)) fail('duplicate original Firewall collection ID')
    ids.add(id)
    integer(collection.groupPriority, 100, 65000); integer(collection.priority, 100, 65000)
    const priority = collection.groupPriority as number
    if (groupPriorities.has(group) && groupPriorities.get(group) !== priority
      || groups.has(priority) && groups.get(priority) !== group) fail('consistent unique original Firewall group priorities required')
    groupPriorities.set(group, priority); groups.set(priority, group)
    const key = JSON.stringify([group, collection.priority])
    if (priorities.has(key)) fail('unique collection priority within each original Firewall group required')
    priorities.add(key)
    oneOf(collection.action, ['allow', 'deny']); oneOf(collection.type, ['network', 'application'])
    const rules = new Set<string>()
    for (const value of list(collection.rules, 64)) {
      const rule = object(value, collection.type === 'network'
        ? ['id', 'sourcePrefixes', 'destinationPrefixes', 'destinationPorts', 'protocol']
        : ['id', 'sourcePrefixes', 'targetFqdns', 'protocol', 'port'])
      const id = text(rule.id)
      if (rules.has(id)) fail('duplicate original Firewall rule ID within collection')
      rules.add(id); prefixes(rule.sourcePrefixes)
      if (collection.type === 'network') {
        prefixes(rule.destinationPrefixes); oneOf(rule.protocol, ['tcp', 'udp', 'any'])
        const ports = list(rule.destinationPorts, 64)
        if (!ports.length) fail('nonempty Firewall destination port list required')
        for (const port of ports) if (port !== '*') integer(port, 1, 65535)
      } else {
        oneOf(rule.protocol, ['http', 'https']); integer(rule.port, 1, 65535)
        const hosts = list(rule.targetFqdns, 64)
        if (!hosts.length) fail('nonempty Firewall FQDN list required')
        for (const host of hosts) if (host !== '*') {
          if (normalizeApplicationHost(host) !== host) fail('canonical lowercase Firewall FQDN required')
        }
      }
    }
  }
  const hosts = new Set<string>(), bindings = new Set<string>()
  for (const value of list(config.dnsBindings, 64)) {
    const binding = object(value, ['id', 'host', 'backend'])
    const id = text(binding.id), host = normalizeApplicationHost(binding.host)
    if (host !== binding.host || hosts.has(host) || bindings.has(id)) fail('unique canonical original Firewall DNS binding required')
    hosts.add(host); bindings.add(id)
    const backend = object(binding.backend, ['workloadId', 'nicId', 'ipConfigurationId'])
    const workloadId = text(backend.workloadId), nicId = text(backend.nicId), ipConfigurationId = text(backend.ipConfigurationId)
    if (!applicationReferenceExists(topology, { kind: 'workload', workloadId, nicId, ipConfigurationId })) fail('original Firewall DNS backend binding required')
  }
}
