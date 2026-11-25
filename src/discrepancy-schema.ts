import { z } from 'zod'
import type { AzureObservation } from './azure-observation'
import type { ComparisonProfile } from './azure-comparison'
import type { AzCapturedObservations } from './azure-net/azure-import'
import { cidr } from './ipv4'

// Even a caught JIT probe violates the web and Electron no-eval CSP.
z.config({ jitless: true })

const text = z.string().max(4096)
const id = z.string().min(1).max(2048)
const texts = z.array(text).max(4096)
const timestamp = z.string().max(40).refine(value => /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)))
const dictionary = <T extends z.ZodType>(value: T) => z.record(id, value)
  .refine(entries => Object.keys(entries).length <= 4096)
const hubRouting = z.object({
  status: z.enum(['configured', 'captured', 'unknown']), associatedTableId: id.nullable(),
  propagatedTableIds: texts, labels: texts, limitations: texts.optional(),
})
const hubTable = z.object({
  id, name: text, labels: texts,
  staticRoutes: z.array(z.object({
    name: text, destinationType: text, destinations: texts, nextHopType: text, nextHop: text,
  })).max(4096).optional(),
})
export const observationSchema: z.ZodType<AzureObservation> = z.object({
  version: z.literal(1), wanId: id, capturedAt: timestamp, collectorVersion: text,
  startedAt: timestamp, completedAt: timestamp, inventoryComplete: z.boolean(),
  context: z.object({ cloud: z.literal('AzureCloud'), subscriptionId: id, tenantId: text.nullable(), azureCliVersion: text.nullable() }),
  warnings: texts,
  hubs: z.array(z.object({
    resourceId: id, importedId: id, name: text, preference: z.enum(['ExpressRoute', 'VPN', 'ASPath']),
    privateIntent: z.boolean(), internetIntent: z.boolean(), limitations: texts,
    routeTables: z.array(hubTable).max(100).optional(), routeTablesStatus: z.enum(['captured', 'unknown']).optional(),
    routingScopeComplete: z.boolean().optional(),
    spokes: z.array(z.object({
      resourceId: id, virtualNetworkId: id, importedId: id, name: text, prefixes: texts.nullable(),
      defaultRouting: z.boolean().nullable(), enableInternetSecurity: z.boolean().nullable(), hubRouting: hubRouting.optional(),
    })).max(1000),
  })).max(20),
  tables: z.array(z.object({
    hubResourceId: id, resourceId: id, resourceType: text,
    status: z.enum(['complete', 'empty', 'denied', 'failed', 'truncated', 'unsupported']),
    capturedAt: timestamp, apiVersion: text, warnings: texts,
    routes: z.array(z.object({
      addressPrefixes: z.array(text).max(100), nextHopType: text, nextHops: z.array(text).max(128), routeOrigin: text, asPath: text,
    })).max(10_000),
  })).max(100),
}).refine(value => {
  const rows = value.tables.flatMap(table => table.routes), unique = (ids: string[]) => new Set(ids.map(id => id.toLowerCase())).size === ids.length
  return rows.length <= 20_000
    && rows.reduce((count, row) => count + row.addressPrefixes.length * Math.max(1, row.nextHops.length), 0) <= 100_000
    && Date.parse(value.completedAt) >= Date.parse(value.startedAt)
    && value.hubs.reduce((count, hub) => count + hub.spokes.length, 0) <= 1000
    && unique(value.hubs.map(hub => hub.resourceId)) && unique(value.hubs.flatMap(hub => hub.spokes.map(spoke => spoke.resourceId)))
    && unique(value.tables.map(table => table.resourceId))
    && value.tables.every(table => value.hubs.some(hub => hub.resourceId.toLowerCase() === table.hubResourceId.toLowerCase())
      && table.resourceId.toLowerCase().startsWith(`${table.hubResourceId.toLowerCase()}/hubroutetables/`)
      && /^[^/?#\r\n]+$/.test(table.resourceId.slice(`${table.hubResourceId}/hubRouteTables/`.length))
      && (table.status !== 'empty' || !table.routes.length) && (table.status !== 'complete' || table.routes.length > 0))
})
export const profileSchema: z.ZodType<ComparisonProfile> = z.object({
  hubs: dictionary(id), spokes: dictionary(id),
  nextHops: dictionary(z.union([
    z.object({ kind: z.enum(['hub', 'spoke', 'connection']), id }),
    z.object({ kind: z.literal('gateway'), id, transport: z.enum(['VPN', 'ExpressRoute']) }),
  ])),
  hubResourceId: text, prefixes: z.array(text.refine(prefix => !!cidr(prefix), 'Use canonical IPv4 prefixes for the comparison scope.')).max(1000),
  completeDesign: z.boolean(), compareAsPaths: z.boolean(),
  routeTableId: id.optional(),
}).refine(value => [value.hubs, value.spokes].every(mapping => new Set(Object.values(mapping)).size === Object.values(mapping).length),
  'Each design object can map to only one observed resource.')
const section = z.object({
  state: z.enum(['succeeded', 'empty', 'denied', 'failed', 'timed-out', 'truncated', 'unsupported', 'not-requested']),
  complete: z.boolean(),
})
const bgpRoute = z.object({
  localAddress: text.optional(), localRole: text.optional(), network: text, nextHop: text.optional(),
  sourcePeer: text.optional(), origin: text.optional(), asPath: text.optional(), weight: z.number().finite().optional(),
})
const bgpRoutes = dictionary(z.array(bgpRoute).max(20_000))
export const networkObservationSchema: z.ZodType<AzCapturedObservations> = z.object({
  capturedAt: text, collectorVersion: text, resourceGroup: text, subscriptionId: text.optional(),
  nicEffectiveRoutes: z.array(z.object({
    nicName: text, nicId: text, vnetName: text, subnetName: text, vnetPrefixes: texts.optional(),
    subnetPrefix: text.optional(), privateIp: text.optional(), enableIPForwarding: z.boolean().optional(),
    observation: section.optional(),
    effectiveRoutes: z.array(z.object({
      addressPrefix: texts, source: text, state: text, nextHopType: text, nextHopIpAddress: texts.optional(), name: text.optional(),
    })).max(20_000),
  })).max(4096),
  arsLearnedRoutes: bgpRoutes.optional(), vngLearnedRoutes: bgpRoutes.optional(),
  vngAdvertisedRoutes: dictionary(bgpRoutes).optional(), arsAdvertisedRoutes: bgpRoutes.optional(),
  gatewayLearnedRoutes: bgpRoutes.optional(), gatewayAdvertisedRoutes: bgpRoutes.optional(),
  vngBgpPeerStatus: dictionary(z.array(z.object({
    localAddress: text.optional(), neighbor: text.optional(), asn: z.number().finite().optional(), state: text.optional(),
    routesReceived: z.number().finite().optional(), connectedDuration: text.optional(),
    messagesSent: z.number().finite().optional(), messagesReceived: z.number().finite().optional(),
  })).max(4096)).optional(),
  vngBgpEndpoints: dictionary(z.array(z.object({
    gatewayResourceId: text, ipConfigurationId: text, defaultBgpIpAddresses: texts, customBgpIpAddresses: texts, tunnelIpAddresses: texts,
  })).max(4096)).optional(),
  observationVersion: z.literal(1).optional(), configurationComplete: z.boolean().optional(),
  sections: dictionary(section).optional(),
  unknownAddressing: z.array(z.object({ resourceId: text, resourceName: text, field: text })).max(4096).optional(),
}).refine(value => value.nicEffectiveRoutes.reduce((count, nic) =>
  count + nic.effectiveRoutes.reduce((sum, route) => sum + Math.max(1, route.addressPrefix.length), 0), 0) <= 100_000)

export const manifestSchema = z.object({
  kind: z.literal('aznetsim-discrepancy'), version: z.literal(1), mode: z.enum(['vwan', 'azure-network']),
  createdAt: timestamp, comparisonAt: timestamp.nullable(),
  app: z.object({ version: id, revision: id, engineRevision: id, host: z.enum(['web', 'windows']) }),
  summary: z.string().trim().min(5).max(120), expected: z.string().trim().min(1).max(4000), actual: z.string().trim().min(1).max(4000),
})
export type DiscrepancyManifest = z.infer<typeof manifestSchema>
