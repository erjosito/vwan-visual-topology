import { azureObjectId, importAzureCapture } from './azure-import'
import type { Preference, Topology } from './model'
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
