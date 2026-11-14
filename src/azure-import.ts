import type { AzureImportInfo, Hub, HubRouteTable, HubRoutingConfiguration, Topology } from './model'
import { armKey, parseAzureObservation } from './azure-observation'
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
  if (root.kind !== 'azure-vwan-capture' || (root.version !== 1 && root.version !== 2)) throw new Error('Unsupported Azure capture format/version. Use the supplied collector.')
  if (root.version === 2) {
    const observation = parseAzureObservation(input)
    const topology = importAzureCapture({ ...root, version: 1 })
    const spokes = observation.hubs.flatMap((hub) => hub.spokes)
      .filter((spoke) => topology.spokes.some((item) => item.id === spoke.importedId))
      .map((spoke) => ({ spokeId: spoke.importedId, resourceId: spoke.resourceId, virtualNetworkId: spoke.virtualNetworkId }))
    const tables = observation.tables.flatMap((table) => {
      const hub = observation.hubs.find((item) => armKey(item.resourceId) === armKey(table.hubResourceId))
      return hub ? [{ hubId: hub.importedId, ...table }] : []
    })
    topology.azureImport = {
      ...topology.azureImport!,
      spokes,
      tables,
      warnings: [
        ...topology.azureImport!.warnings,
        'Attached observed hub effective-route snapshots are read-only Azure observations (see Hub BGP table -> Azure snapshot) and do not modify simulated routes.',
      ],
    }
    return validateTopology(topology)
  }
  if (typeof root.complete !== 'boolean') throw new Error('Capture completeness is missing.')
  if (root.routingContextVersion !== undefined && root.routingContextVersion !== 1) throw new Error('Unsupported hub routing-context capture version.')
  const capturesContexts = root.routingContextVersion === 1
  const wan = object(root.wan, 'Virtual WAN')
  const wanId = resourceId(wan.id, 'virtualWans')
  if (wan.type !== 'Standard') throw new Error('Only Standard Virtual WAN captures are supported.')
  const globalLimitations: string[] = []
  if (!root.complete) globalLimitations.push('Capture is incomplete; configuration reads failed or were unavailable.')
  if (wan.allowBranchToBranchTraffic !== undefined && typeof wan.allowBranchToBranchTraffic !== 'boolean') throw new Error('WAN branch-to-branch traffic must be a boolean.')
  if (wan.allowBranchToBranchTraffic === undefined || wan.allowVnetToVnetTraffic !== true) globalLimitations.push('WAN transit flags differ from, or cannot confirm, the simulator full-mesh defaults.')
  const warnings = new Set([
    capturesContexts
      ? 'Structural Azure import, not a production routing replica. Captured VNet table contexts are imported; ER/on-premises advertisements, route maps and firewall enforcement are not reconstructed.'
      : 'Structural Azure import, not a production routing replica. ER/on-premises connectivity, gateway advertisements, route maps, custom propagation and firewall enforcement are not reconstructed.',
    'Spoke NVA BGP peers, interface IPs and downstream routing are not reconstructed. Configure them manually after structural import.',
    ...messages(root.warnings), ...globalLimitations,
  ])
  const topology: Topology = { version: 1, name: text(wan.name, 'WAN name'), hubs: [], spokes: [], sites: [], connections: [], siteLinks: [] }
  if (typeof wan.allowBranchToBranchTraffic === 'boolean') topology.allowBranchToBranchTraffic = wan.allowBranchToBranchTraffic
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
    const localTableReference = (value: unknown) => {
      const result = text(value, 'Hub route-table reference', 2048), prefix = `${armKey(armId)}/hubroutetables/`
      if (!armKey(result).startsWith(prefix)) return
      const suffix = result.slice(prefix.length)
      if (!/^[^/?#\r\n]{1,120}$/.test(suffix)) return
      return suffix.toLowerCase() === 'defaultroutetable' ? 'defaultRouteTable'
        : suffix.toLowerCase() === 'noneroutetable' ? 'noneRouteTable' : suffix
    }
    if (capturesContexts) {
      if (!['captured', 'unknown'].includes(source.routeTablesStatus as string)) throw new Error('Invalid hub route-table capture provenance.')
      hub.routeTablesStatus = source.routeTablesStatus as Hub['routeTablesStatus']
      hub.routeTables = list(source.routeTables, 'Captured hub route tables', 64).map((value): HubRouteTable => {
        const table = object(value, 'Captured hub route table'), id = localTableReference(table.id)
        if (!id || id.toLowerCase() !== text(table.name, 'Hub route-table name').toLowerCase()) throw new Error('Captured route table is outside its hub or has an inconsistent identity.')
        return {
          id, name: text(table.name, 'Hub route-table name'),
          labels: list(table.labels, 'Hub route-table labels', 64).map((entry) => text(entry, 'Hub route-table label')),
          staticRoutes: list(table.staticRoutes, 'Captured hub static routes', 1000).map((value) => {
            const route = object(value, 'Captured hub static route')
            if (typeof route.nextHop !== 'string' || route.nextHop.length > 2048) throw new Error('Invalid captured static next hop.')
            return {
              name: text(route.name, 'Hub static-route name'), destinationType: text(route.destinationType, 'Hub static-route destination type'),
              destinations: list(route.destinations, 'Hub static-route destinations', 100).map((entry) => text(entry, 'Hub static-route destination')),
              nextHopType: text(route.nextHopType, 'Hub static-route next-hop type'), nextHop: route.nextHop,
            }
          }),
        }
      })
      if (!hub.routeTables.some((table) => table.id === 'defaultRouteTable')) hub.routeTablesStatus = 'unknown'
      if (hub.routeTablesStatus === 'unknown') limitations.push('Hub route-table inventory is incomplete; table-context reachability is unknown.')
    } else if (limitations.length) {
      hub.routeTablesStatus = 'unknown'
    }
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
      let hubRouting: HubRoutingConfiguration | undefined
      if (capturesContexts) {
        const captured = object(connection.routingConfiguration, 'Captured VNet routing configuration')
        if (!['captured', 'unknown'].includes(captured.status as string)) throw new Error('Invalid VNet routing capture provenance.')
        const associated = captured.associatedTableId === null ? null : text(captured.associatedTableId, 'Associated hub route table', 2048)
        const propagated = list(captured.propagatedTableIds, 'Propagated hub route tables', 64).map((entry) => text(entry, 'Propagated hub route table', 2048))
        const resolve = (reference: string) => {
          const local = localTableReference(reference)
          return hub.routeTables?.find((table) => table.id.toLowerCase() === local?.toLowerCase())?.id
        }
        const unsupported = list(captured.unsupportedControls, 'Unsupported VNet routing controls', 40).map((entry) => text(entry, 'Unsupported VNet routing control'))
        const known = captured.status === 'captured' && unsupported.length === 0
          && associated !== null && !!resolve(associated) && propagated.every((entry) => !!resolve(entry))
        hubRouting = {
          status: known ? 'captured' : 'unknown',
          associatedTableId: known ? resolve(associated!)! : associated,
          propagatedTableIds: known ? propagated.map((entry) => resolve(entry)!) : propagated,
          labels: list(captured.labels, 'Propagation labels', 64).map((entry) => text(entry, 'Propagation label')),
          limitations: unsupported,
        }
        if (!known) limitations.push('A VNet association or propagation context is unknown or outside the captured local inventory.')
      } else if (connection.defaultRouting !== true) {
        limitations.push('A VNet connection has custom or unknown association/propagation settings.')
        hubRouting = { status: 'unknown', associatedTableId: null, propagatedTableIds: [], labels: [] }
      }
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
      if (connection.enableInternetSecurity !== undefined && connection.enableInternetSecurity !== null && typeof connection.enableInternetSecurity !== 'boolean') {
        throw new Error('Invalid captured VNet internet security flag.')
      }
      if (capturesContexts && typeof connection.enableInternetSecurity !== 'boolean') {
        limitations.push('A VNet internet-security flag is unknown; default-route reachability is not established.')
        if (hubRouting) hubRouting.status = 'unknown'
      }
      topology.spokes.push({
        id: stableId('spoke', vnetId), name: text(connection.name, 'Spoke name'), hubId: hub.id, prefixes: [...new Set(prefixes)],
        ...(connection.enableInternetSecurity === true ? { propagateDefaultRoute: true } : {}),
        ...(hubRouting ? { hubRouting } : {}),
      })
    }
    const uniqueLimitations = [...new Set(limitations)]
    for (const warning of uniqueLimitations) warnings.add(`${name}: ${warning}`)
    sources.push({ hubId: hub.id, resourceId: armId, addressPrefix, limitations: uniqueLimitations,
      ...(capturesContexts ? { routingScopeComplete: root.complete === true && source.branchRoutingStatus === 'captured'
        && list(source.gatewayTypes, 'Gateway types', 3).length === 0
        && hub.routeTablesStatus === 'captured' && uniqueLimitations.length === 0 } : {}) })
  }
  topology.azureImport = {
    capturedAt: text(root.capturedAt, 'capture timestamp', 40), collectorVersion: text(root.collectorVersion, 'collector version', 40),
    wanId, warnings: [...warnings], hubs: sources,
  }
  return validateTopology(topology)
}
