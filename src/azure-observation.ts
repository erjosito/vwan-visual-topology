import { azureObjectId, importAzureCapture } from './azure-import'
import type { AzureObservedTable, Preference, Topology } from './model'
import { ipv4 } from './validation'

export type ObservationStatus = 'complete' | 'empty' | 'denied' | 'failed' | 'truncated' | 'unsupported'
export interface ObservedRoute {
  addressPrefixes: string[]
  nextHopType: string
  nextHops: string[]
  routeOrigin: string
  asPath: string
}
export interface ObservedTable {
  hubResourceId: string
  resourceId: string
  resourceType: string
  status: ObservationStatus
  capturedAt: string
  apiVersion: string
  routes: ObservedRoute[]
  warnings: string[]
}
export interface ObservedSpoke {
  resourceId: string
  virtualNetworkId: string
  importedId: string
  name: string
  prefixes: string[] | null
  defaultRouting: boolean | null
  enableInternetSecurity: boolean | null
}
export interface ObservedHub {
  resourceId: string
  importedId: string
  name: string
  preference: Preference
  privateIntent: boolean
  internetIntent: boolean
  limitations: string[]
  spokes: ObservedSpoke[]
}
export interface AzureObservation {
  version: 1
  wanId: string
  capturedAt: string
  collectorVersion: string
  startedAt: string
  completedAt: string
  inventoryComplete: boolean
  context: { cloud: string; subscriptionId: string; tenantId: string | null; azureCliVersion: string | null }
  warnings: string[]
  hubs: ObservedHub[]
  tables: ObservedTable[]
}
const invalid = (): never => { throw new Error('Invalid Azure observation capture. Use the supplied collector with -IncludeEffectiveRoutes.') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, limit = 2048, empty = false): string {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) return invalid()
  return value
}
function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) return invalid()
  return value
}
function strings(value: unknown, limit: number, length = 2048): string[] {
  return list(value, limit).map((value) => text(value, length))
}
function timestamp(value: unknown): string {
  const result = text(value, 40)
  if (!/^\d{4}-\d\d-\d\dT/.test(result) || !Number.isFinite(Date.parse(result))) return invalid()
  return result
}
const nullableBoolean = (value: unknown) => typeof value === 'boolean' ? value : null
export const armKey = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase()

export function normalizeObservedPrefix(value: string): string | undefined {
  const [address, mask, extra] = value.trim().split('/')
  const number = ipv4(address)
  if (number === undefined || mask === undefined || extra !== undefined || !/^(0|[1-9]\d?)$/.test(mask) || +mask > 32) return
  const network = Math.floor(number / 2 ** (32 - +mask)) * 2 ** (32 - +mask)
  return `${[24, 16, 8, 0].map((shift) => Math.floor(network / 2 ** shift) % 256).join('.')}/${+mask}`
}

export function normalizeObservedAsPath(value: string): string | undefined {
  const path = value.trim().replace(/[-,\s]+/g, ' ')
  if (!path) return ''
  if (!/^\d+(?: \d+)*$/.test(path)) return
  const numbers = path.split(' ').map(Number)
  if (numbers.some((asn) => !Number.isSafeInteger(asn) || asn < 1 || asn > 4294967294)) return
  return numbers.join(' ')
}

export function parseAzureObservation(input: unknown): AzureObservation {
  const root = record(input)
  if (root.kind !== 'azure-vwan-capture' || root.version !== 2) return invalid()
  if (new TextEncoder().encode(JSON.stringify(input)).length > 8_000_000) return invalid()
  const structure: Topology = importAzureCapture({ ...root, version: 1 })
  const context = record(root.context)
  const cloud = text(context.cloud, 40), subscriptionId = text(context.subscriptionId, 36)
  const tenantId = context.tenantId === null ? null : text(context.tenantId, 36)
  const azureCliVersion = context.azureCliVersion === null ? null : text(context.azureCliVersion, 120)
  if (cloud !== 'AzureCloud' || subscriptionId.toLowerCase() !== structure.azureImport!.wanId.split('/')[2].toLowerCase()
    || (tenantId !== null && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(tenantId))) return invalid()
  const observation = record(root.observations)
  if (observation.version !== 1) return invalid()
  const startedAt = timestamp(observation.startedAt), completedAt = timestamp(observation.completedAt)
  if (Date.parse(completedAt) < Date.parse(startedAt)) return invalid()
  const hubs: ObservedHub[] = list(root.hubs, 20).map((value, index) => {
    const source = record(value), hub = structure.hubs[index], info = structure.azureImport!.hubs[index]
    return {
      resourceId: info.resourceId, importedId: hub.id, name: hub.name, preference: hub.preference,
      privateIntent: hub.routingIntent.private, internetIntent: hub.routingIntent.internet, limitations: info.limitations,
      spokes: list(source.connections, 60).map((value) => {
        const connection = record(value), virtualNetworkId = text(connection.virtualNetworkId)
        const resourceId = text(connection.id)
        const prefix = `${armKey(info.resourceId)}/hubvirtualnetworkconnections/`
        if (!armKey(resourceId).startsWith(prefix) || !/^[^/?#\r\n]+$/.test(armKey(resourceId).slice(prefix.length))) return invalid()
        return {
          resourceId, virtualNetworkId, importedId: azureObjectId('spoke', virtualNetworkId),
          name: text(connection.name, 120), prefixes: connection.addressPrefixes === null ? null : strings(connection.addressPrefixes, 30, 256),
          defaultRouting: nullableBoolean(connection.defaultRouting), enableInternetSecurity: nullableBoolean(connection.enableInternetSecurity),
        }
      }),
    }
  })
  const spokeIds = hubs.flatMap((hub) => hub.spokes.map((spoke) => armKey(spoke.resourceId)))
  if (new Set(spokeIds).size !== spokeIds.length) return invalid()
  let totalRows = 0, expandedTuples = 0
  const selectors = new Set<string>()
  const tables = list(observation.tables, 20).map((value): ObservedTable => {
    const table = record(value), hubResourceId = text(table.hubResourceId), resourceId = text(table.resourceId)
    if (!hubs.some((hub) => armKey(hub.resourceId) === armKey(hubResourceId))) return invalid()
    const prefix = `${armKey(hubResourceId)}/hubroutetables/`
    if (!armKey(resourceId).startsWith(prefix) || !/^[^/?#\r\n]+$/.test(armKey(resourceId).slice(prefix.length))) return invalid()
    if (selectors.has(armKey(resourceId))) return invalid()
    selectors.add(armKey(resourceId))
    const status = text(table.status) as ObservationStatus
    if (!['complete', 'empty', 'denied', 'failed', 'truncated', 'unsupported'].includes(status)) return invalid()
    const routes = list(table.routes, 10_000).map((value): ObservedRoute => {
      const row = record(value)
      return {
        addressPrefixes: strings(row.addressPrefixes, 100, 256), nextHopType: text(row.nextHopType, 120, true),
        nextHops: strings(row.nextHops, 128), routeOrigin: text(row.routeOrigin ?? '', 2048, true),
        asPath: text(row.asPath ?? '', 2048, true),
      }
    })
    totalRows += routes.length
    expandedTuples += routes.reduce((count, row) => count + row.addressPrefixes.length * Math.max(1, row.nextHops.length), 0)
    if (totalRows > 20_000 || expandedTuples > 100_000 || (status === 'empty' && routes.length) || (status === 'complete' && !routes.length)) return invalid()
    return { hubResourceId, resourceId, resourceType: text(table.resourceType, 120), status,
      capturedAt: timestamp(table.capturedAt), apiVersion: text(table.apiVersion, 120), routes, warnings: strings(table.warnings, 100, 400) }
  })
  return { version: 1, wanId: structure.azureImport!.wanId, capturedAt: timestamp(root.capturedAt),
    collectorVersion: text(root.collectorVersion, 40), startedAt, completedAt, inventoryComplete: root.complete === true,
    context: { cloud, subscriptionId, tenantId, azureCliVersion },
    warnings: strings(root.warnings, 100, 400), hubs, tables }
}

export interface ObservedSnapshotLookupSession {
  observation: AzureObservation
  profile?: {
    hubs?: Record<string, string>
    spokes?: Record<string, string>
    nextHops?: Record<string, { kind: 'spoke' | 'hub' | 'gateway' | 'connection'; id: string; transport?: 'VPN' | 'ExpressRoute' }>
  }
}

export interface ResolvedObservedHubSnapshot {
  table?: AzureObservedTable
  capturedAt: string
  collectorVersion: string
  notices: string[]
  isStale: boolean
}

export interface DescribedObservedResource {
  label: string
  kind: 'local-hub' | 'remote-hub' | 'spoke' | 'gateway' | 'connection' | 'firewall' | 'route-table' | 'bgp-connection' | 'unknown'
  known: boolean
  rawId: string
}

export function hasObservedSnapshots(topology: Topology, session?: ObservedSnapshotLookupSession): boolean {
  return (topology.azureImport?.tables?.length ?? 0) > 0 || (session?.observation.tables.length ?? 0) > 0
}

export function resolveObservedHubSnapshot(topology: Topology, hubId: string, session?: ObservedSnapshotLookupSession): ResolvedObservedHubSnapshot | undefined {
  if (!hasObservedSnapshots(topology, session)) return undefined
  let table: AzureObservedTable | undefined
  let hubLimitations: string[] = []
  if (session) {
    const obsHub = session.observation.hubs.find((hub) =>
      session.profile?.hubs?.[armKey(hub.resourceId)] === hubId
      || (hub.importedId === hubId && topology.azureImport?.hubs.some((item) => item.hubId === hubId && armKey(item.resourceId) === armKey(hub.resourceId))))
    if (obsHub) {
      hubLimitations = obsHub.limitations
      const obsTable = session.observation.tables.find((item) => armKey(item.hubResourceId) === armKey(obsHub.resourceId))
      if (obsTable) table = { hubId, ...obsTable }
    }
  }
  if (!table) {
    table = topology.azureImport?.tables?.find((item) => item.hubId === hubId)
    if (!hubLimitations.length) hubLimitations = topology.azureImport?.hubs.find((item) => item.hubId === hubId)?.limitations ?? []
  }
  const capturedAt = table?.capturedAt ?? session?.observation.capturedAt ?? topology.azureImport?.capturedAt ?? ''
  const collectorVersion = session?.observation.collectorVersion ?? topology.azureImport?.collectorVersion ?? '1'
  const isStale = Boolean(table && (!Number.isFinite(Date.parse(table.capturedAt)) || Math.abs(Date.now() - Date.parse(table.capturedAt)) > 86_400_000))
  const notices: string[] = ['Observed effective routes are a read-only Azure snapshot, not reversible BGP configuration.']
  if (!table) {
    notices.push('No Azure effective-route snapshot was captured or mapped for this hub.')
  } else {
    const statusNotice: Partial<Record<ObservationStatus, string>> = {
      empty: 'Azure returned an empty effective-route table for this hub.',
      denied: 'Effective-route retrieval was denied by Azure RBAC (virtualHubs/effectiveRoutes/action).',
      failed: 'Effective-route retrieval failed or timed out during capture.',
      truncated: 'Effective-route capture was truncated at the collector safety limit; routes are incomplete.',
      unsupported: 'This route table or hub configuration could not be queried for effective routes.',
    }
    if (statusNotice[table.status]) notices.push(statusNotice[table.status]!)
    if (isStale) notices.push('This snapshot is older than 24 hours or is future-dated.')
    for (const warning of [...hubLimitations, ...table.warnings]) {
      if (!notices.includes(warning)) notices.push(warning)
    }
  }
  return { table, capturedAt, collectorVersion, notices, isStale }
}

export function describeObservedNextHopType(nextHopType: string): { label: string; known: boolean } {
  const trimmed = nextHopType.trim()
  const knownTypes: Record<string, string> = {
    VirtualNetworkConnection: 'VirtualNetworkConnection (Spoke VNet)',
    'Remote Hub': 'Remote Hub',
    VPN_S2S_Gateway: 'VPN_S2S_Gateway (S2S VPN)',
    ExpressRouteGateway: 'ExpressRouteGateway (ExpressRoute)',
    AzureFirewall: 'AzureFirewall (Secured hub firewall)',
    HubBgpConnection: 'HubBgpConnection (Spoke NVA BGP)',
    Static: 'Static',
    None: 'None (Blackhole / drop)',
  }
  if (Object.hasOwn(knownTypes, trimmed)) return { label: knownTypes[trimmed], known: true }
  return { label: trimmed ? `Unknown type (${trimmed})` : 'Unknown type (empty)', known: false }
}

export function describeObservedResource(id: string, currentHubId: string, topology: Topology, session?: ObservedSnapshotLookupSession): DescribedObservedResource {
  const trimmed = id.trim()
  if (!trimmed) return { label: 'None reported', kind: 'unknown', known: false, rawId: '' }
  const key = armKey(trimmed)
  const explicit = session?.profile?.nextHops?.[key]
  if (explicit) {
    if (explicit.kind === 'spoke') {
      const spoke = topology.spokes.find((item) => item.id === explicit.id)
      if (spoke) return { label: `${spoke.name} (VNet connection)`, kind: 'spoke', known: true, rawId: trimmed }
    } else if (explicit.kind === 'hub') {
      const hub = topology.hubs.find((item) => item.id === explicit.id)
      if (hub) return { label: `${hub.name} (${hub.id === currentHubId ? 'local hub' : 'remote hub'})`, kind: hub.id === currentHubId ? 'local-hub' : 'remote-hub', known: true, rawId: trimmed }
    } else if (explicit.kind === 'gateway') {
      const hub = topology.hubs.find((item) => item.id === explicit.id)
      if (hub) return { label: `${hub.name} · ${explicit.transport === 'VPN' ? 'S2S VPN gateway' : 'ExpressRoute gateway'}`, kind: 'gateway', known: true, rawId: trimmed }
    } else if (explicit.kind === 'connection') {
      const conn = topology.connections.find((item) => item.id === explicit.id)
      if (conn) return { label: `${conn.name} (${conn.transport})`, kind: 'connection', known: true, rawId: trimmed }
    }
  }
  const resolveHubName = (hubResourceId: string): { id?: string; name?: string } => {
    const hubKey = armKey(hubResourceId)
    const mappedId = session?.profile?.hubs?.[hubKey] ?? topology.azureImport?.hubs.find((item) => armKey(item.resourceId) === hubKey)?.hubId
    const hub = mappedId ? topology.hubs.find((item) => item.id === mappedId) : undefined
    if (hub) return { id: hub.id, name: hub.name }
    const observed = session?.observation.hubs.find((item) => armKey(item.resourceId) === hubKey)
    if (observed) return { id: observed.importedId, name: observed.name }
    return {}
  }
  const directHub = resolveHubName(trimmed)
  if (directHub.name) {
    const isLocal = directHub.id === currentHubId
    return { label: `${directHub.name} (${isLocal ? 'local hub' : 'remote hub'})`, kind: isLocal ? 'local-hub' : 'remote-hub', known: true, rawId: trimmed }
  }
  const mappedSpokeId = session?.profile?.spokes?.[key]
    ?? topology.azureImport?.spokes?.find((item) => armKey(item.resourceId) === key || armKey(item.virtualNetworkId) === key)?.spokeId
  if (mappedSpokeId) {
    const spoke = topology.spokes.find((item) => item.id === mappedSpokeId)
    if (spoke) return { label: `${spoke.name} (VNet connection)`, kind: 'spoke', known: true, rawId: trimmed }
  }
  const observedSpoke = session?.observation.hubs.flatMap((hub) => hub.spokes).find((item) => armKey(item.resourceId) === key || armKey(item.virtualNetworkId) === key)
  if (observedSpoke) {
    const spoke = topology.spokes.find((item) => item.id === observedSpoke.importedId)
    return { label: `${spoke?.name ?? observedSpoke.name} (VNet connection)`, kind: 'spoke', known: true, rawId: trimmed }
  }
  const childMatch = /^(\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Network\/virtualHubs\/([^/]+))\/(hubRouteTables|hubBgpConnections|hubVirtualNetworkConnections)\/([^/]+)$/i.exec(trimmed)
  if (childMatch) {
    const parent = resolveHubName(childMatch[1])
    const hubLabel = parent.name ?? childMatch[2]
    const childKind = childMatch[3].toLowerCase()
    const childName = childMatch[4]
    if (childKind === 'hubroutetables') return { label: `${hubLabel} · ${childName} (route table)`, kind: 'route-table', known: true, rawId: trimmed }
    if (childKind === 'hubbgpconnections') return { label: `${hubLabel} · ${childName} (BGP connection)`, kind: 'bgp-connection', known: true, rawId: trimmed }
    return { label: `Unknown VNet connection (${hubLabel} · ${childName})`, kind: 'spoke', known: false, rawId: trimmed }
  }
  const gwMatch = /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Network\/(vpnGateways|expressRouteGateways|azureFirewalls|p2sVpnGateways)\/([^/]+)$/i.exec(trimmed)
  if (gwMatch) {
    const resourceKind = gwMatch[1].toLowerCase()
    const resourceName = gwMatch[2]
    if (resourceKind === 'vpngateways') return { label: `S2S VPN gateway (${resourceName})`, kind: 'gateway', known: true, rawId: trimmed }
    if (resourceKind === 'expressroutegateways') return { label: `ExpressRoute gateway (${resourceName})`, kind: 'gateway', known: true, rawId: trimmed }
    if (resourceKind === 'azurefirewalls') return { label: `Azure Firewall (${resourceName})`, kind: 'firewall', known: true, rawId: trimmed }
    return { label: `P2S VPN gateway (${resourceName})`, kind: 'gateway', known: true, rawId: trimmed }
  }
  if (/^defaultroutetable$/i.test(trimmed)) return { label: 'defaultRouteTable (route table)', kind: 'route-table', known: true, rawId: trimmed }
  return { label: `Unknown resource (${trimmed})`, kind: 'unknown', known: false, rawId: trimmed }
}
