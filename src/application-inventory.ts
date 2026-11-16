import { inventoryOwners, namedEndpoints, sameInventoryOwner } from './inventory'
import type { InventoryOwner, InventoryTopology } from './inventory'
import type { ApplicationReference } from './application'

export const applicationLimits = {
  maxServices: 32, maxDnsProfiles: 32, maxReferences: 64, maxFeatures: 32,
  maxListeners: 64, maxRules: 64, maxMembers: 64, maxDnsEndpoints: 64,
} as const
export const applicationCapabilities = {
  inventoryVersion: 1,
  requestVersion: 1,
  minimumContractVersion: 2,
  operations: ['application'],
  providers: [] as string[],
  scope: 'Identity and evidence contracts only. All application/DNS service providers are unavailable.',
  limits: applicationLimits,
  privacy: 'Offline declared configuration only; no DNS queries, probes, credentials, telemetry or origin fetches.',
}

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
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max || Object.keys(value).length !== value.length) return fail(`dense array of at most ${max} entries required`)
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor)) fail('plain array values required')
  }
  return value
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
    case 'subnet':
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
    case 'subnet': return JSON.stringify([ref.kind, ref.owner.kind, ref.owner.id, ref.id])
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
  for (const [entries, kinds] of [[services, ['application-gateway', 'front-door']], [profiles, ['traffic-manager']]] as const) {
    for (const value of entries) {
      const entry = object(value, entries === services ? ['id', 'name', 'kind', 'owner', 'references', 'unsupportedFeatures'] : ['id', 'name', 'kind', 'references', 'unsupportedFeatures'])
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
    }
  }
  for (const entry of [...topology.application.services, ...topology.application.dnsProfiles]) {
    for (const ref of entry.references) {
      if (!applicationReferenceExists(topology, ref)) fail('missing or mismatched original reference')
    }
  }
}
