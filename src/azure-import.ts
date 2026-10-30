import type { AzureImportInfo, Hub, Topology } from './model'
import { cidr, validateTopology } from './validation'

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, limit = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new Error(`Invalid ${label}.`)
  return value
}
function list(value: unknown, label: string, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${label} must be an array with at most ${limit} entries.`)
  return value
}
function messages(value: unknown): string[] {
  return list(value, 'Capture warnings', 100).map((value) => text(value, 'capture warning', 400))
}
function resourceId(value: unknown, type: string): string {
  const result = text(value, 'Azure resource ID', 2048)
  const match = /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/?#\r\n]+\/providers\/Microsoft\.Network\/([^/?#\r\n]+)\/[^/?#\r\n]+$/i.exec(result)
  if (!match || match[1].toLowerCase() !== type.toLowerCase()) throw new Error(`Expected a ${type} Azure resource ID.`)
  return result
}
function stableId(kind: string, armId: string): string {
  let hash = 14695981039346656037n
  for (const char of armId.toLowerCase()) hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 1099511628211n)
  return `az-${kind}-${hash.toString(16)}`
}
export { stableId as azureObjectId }

export function importAzureCapture(input: unknown): Topology {
  const root = object(input, 'Azure capture')
  if (root.kind !== 'azure-vwan-capture' || root.version !== 1) throw new Error('Unsupported Azure capture format/version. Use the supplied collector.')
  if (typeof root.complete !== 'boolean') throw new Error('Capture completeness is missing.')
  const wan = object(root.wan, 'Virtual WAN')
  const wanId = resourceId(wan.id, 'virtualWans')
  if (wan.type !== 'Standard') throw new Error('Only Standard Virtual WAN captures are supported.')
  const globalLimitations: string[] = []
  if (!root.complete) globalLimitations.push('Capture is incomplete; configuration reads failed or were unavailable.')
  if (wan.allowBranchToBranchTraffic !== true || wan.allowVnetToVnetTraffic !== true) globalLimitations.push('WAN transit flags differ from, or cannot confirm, the simulator full-mesh defaults.')
  const warnings = new Set([
    'Structural Azure import, not a production routing replica. ER/on-premises connectivity, gateway advertisements, route maps, custom propagation and firewall enforcement are not reconstructed.',
    ...messages(root.warnings), ...globalLimitations,
  ])
  const topology: Topology = { version: 1, name: text(wan.name, 'WAN name'), hubs: [], spokes: [], sites: [], connections: [], siteLinks: [] }
  const sources: AzureImportInfo['hubs'] = []
  const seen = new Set<string>([wanId.toLowerCase()])
  const seenVnets = new Set<string>()
  for (const value of list(root.hubs, 'Captured hubs', 20)) {
    const source = object(value, 'Captured hub')
    const armId = resourceId(source.id, 'virtualHubs')
    if (armId.split('/')[2].toLowerCase() !== wanId.split('/')[2].toLowerCase()) throw new Error('Captured hubs must be in the selected WAN subscription.')
    if (text(source.virtualWanId, 'Parent WAN ID', 2048).toLowerCase() !== wanId.toLowerCase()) throw new Error('Capture contains a hub belonging to a different WAN.')
    if (seen.has(armId.toLowerCase())) throw new Error('Duplicate Azure hub resource ID.')
    seen.add(armId.toLowerCase())
    const name = text(source.name, 'Hub name')
    const preferences: Record<string, Hub['preference']> = { ExpressRoute: 'ExpressRoute', VpnGateway: 'VPN', ASPath: 'ASPath' }
    const preferenceName = text(source.hubRoutingPreference, 'hub routing preference')
    const preference = Object.hasOwn(preferences, preferenceName) ? preferences[preferenceName] : undefined
    if (!preference) throw new Error(`Unknown Azure routing preference for ${name}.`)
    const addressPrefix = text(source.addressPrefix, 'hub infrastructure prefix')
    if (!cidr(addressPrefix)) throw new Error(`Invalid hub infrastructure IPv4 CIDR for ${name}.`)
    const limitations = [...globalLimitations, ...messages(source.unsupportedFeatures)]
    const hub: Hub = { id: stableId('hub', armId), name, region: text(source.location, 'Hub location'), preference, routingIntent: { private: false, internet: false, privatePrefixes: [] } }
    for (const value of list(source.routingPolicies, 'Routing policies', 2)) {
      const policy = object(value, 'Routing policy')
      const nextHop = text(policy.nextHop, 'Routing next hop', 2048)
      const firewall = /^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^/?#\r\n]+\/providers\/Microsoft\.Network\/azureFirewalls\/[^/?#\r\n]+$/i.test(nextHop)
      for (const destination of list(policy.destinations, 'Routing destinations', 10)) {
        if (destination !== 'PrivateTraffic' && destination !== 'Internet') {
          limitations.push('Unsupported routing-intent destination; only structure is imported.')
        } else if (!firewall) {
          limitations.push('Routing intent targets a non-Azure-Firewall provider; its policy is not simulated.')
        } else if (destination === 'PrivateTraffic') hub.routingIntent.private = true
        else hub.routingIntent.internet = true
      }
    }
    for (const gateway of list(source.gatewayTypes, 'Gateway types', 3)) {
      if (!['VPN', 'ExpressRoute', 'P2S'].includes(gateway as string)) throw new Error('Unknown captured gateway type.')
      warnings.add(`${name}: ${gateway} gateway connectivity is not reconstructed.`)
    }
    topology.hubs.push(hub)
    for (const value of list(source.connections, 'VNet connections', 60)) {
      const connection = object(value, 'VNet connection')
      const vnetId = resourceId(connection.virtualNetworkId, 'virtualNetworks')
      if (seenVnets.has(vnetId.toLowerCase())) throw new Error('A VNet appears in multiple captured connections; ambiguous attachments are not supported.')
      seenVnets.add(vnetId.toLowerCase())
      if (connection.defaultRouting !== true) limitations.push('A VNet connection has custom or unknown association/propagation settings.')
      if (connection.addressPrefixes === null) {
        limitations.push('A referenced VNet could not be read; its spoke is omitted.')
        continue
      }
      const prefixes: string[] = []
      for (const prefix of list(connection.addressPrefixes, 'VNet prefixes', 30)) {
        if (typeof prefix === 'string' && prefix.includes(':')) limitations.push('IPv6 VNet prefixes are omitted; IPv6 is not simulated.')
        else {
          if (typeof prefix !== 'string' || !cidr(prefix)) throw new Error('Invalid captured VNet IPv4 network CIDR.')
          prefixes.push(prefix)
        }
      }
      if (!prefixes.length) {
        limitations.push('A VNet has no usable IPv4 prefixes; its spoke is omitted.')
        continue
      }
      topology.spokes.push({ id: stableId('spoke', vnetId), name: text(connection.name, 'Spoke name'), hubId: hub.id, prefixes: [...new Set(prefixes)] })
    }
    const uniqueLimitations = [...new Set(limitations)]
    for (const warning of uniqueLimitations) warnings.add(`${name}: ${warning}`)
    sources.push({ hubId: hub.id, resourceId: armId, addressPrefix, limitations: uniqueLimitations })
  }
  topology.azureImport = {
    capturedAt: text(root.capturedAt, 'capture timestamp', 40), collectorVersion: text(root.collectorVersion, 'collector version', 40),
    wanId, warnings: [...warnings], hubs: sources,
  }
  return validateTopology(topology)
}
