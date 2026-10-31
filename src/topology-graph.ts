import { cidr, contains } from './validation'
import type { Connection, ErLink, ErLocation, Hub, Site, Spoke, Topology, Transport } from './model'

export type ResolvedAttachment =
  | {
      kind: 'connection'
      id: string
      name: string
      transport: Transport
      enabled: boolean
      hubId: string
      siteId: string
      spokeId?: string
      propagateDefaultRoute?: boolean
      connection: Connection
    }
  | {
      kind: 'erLink'
      id: string
      name: string
      transport: 'ExpressRoute'
      enabled: boolean
      locationId: string
      hubId?: string
      siteId?: string
      propagateDefaultRoute?: boolean
      erLink: ErLink
    }
  | {
      kind: 'spoke'
      id: string
      name: string
      enabled: true
      hubId?: string
      propagateDefaultRoute?: boolean
      spoke: Spoke
    }

export function spokeNvaConnectionForSite(topology: Topology, siteId: string): Connection | undefined {
  return topology.connections.find((c) => c.transport === 'SpokeNVA' && c.siteId === siteId)
}

export function spokeNvaConnectionForSpoke(topology: Topology, spokeId: string): Connection | undefined {
  return topology.connections.find((c) => c.transport === 'SpokeNVA' && c.spokeId === spokeId)
}

export function spokeNvaPeerForSpoke(topology: Topology, spokeId: string): { connection: Connection; site: Site } | undefined {
  const connection = spokeNvaConnectionForSpoke(topology, spokeId)
  if (!connection) return undefined
  const site = topology.sites.find((s) => s.id === connection.siteId)
  return site ? { connection, site } : undefined
}

export function isEmbeddedSpokeNvaSite(topology: Topology, siteOrId: Site | string): boolean {
  const site = typeof siteOrId === 'string' ? topology.sites.find((s) => s.id === siteOrId) : siteOrId
  const siteId = typeof siteOrId === 'string' ? siteOrId : siteOrId.id
  return site?.role === 'spoke-nva' || !!spokeNvaConnectionForSite(topology, siteId)
}

export function embeddedSpokeNvaSiteIds(topology: Topology): Set<string> {
  return new Set(
    topology.sites
      .filter((site) => isEmbeddedSpokeNvaSite(topology, site))
      .map((site) => site.id),
  )
}

export function standaloneSites(topology: Topology): Site[] {
  const nvaSiteIds = embeddedSpokeNvaSiteIds(topology)
  return topology.sites.filter((site) => !nvaSiteIds.has(site.id))
}

export function hostingSpokeForSite(topology: Topology, siteId: string): Spoke | undefined {
  const connection = spokeNvaConnectionForSite(topology, siteId)
  return connection?.spokeId ? topology.spokes.find((spoke) => spoke.id === connection.spokeId) : undefined
}

export function downstreamSpokesForNvaSpoke(topology: Topology, nvaSpokeId: string | undefined): Spoke[] {
  if (!nvaSpokeId) return []
  return topology.spokes.filter((spoke) => Boolean(spoke.nvaSpokeIds?.includes(nvaSpokeId)))
}

export function downstreamSpokesForNvaSite(topology: Topology, siteId: string): Spoke[] {
  const connection = spokeNvaConnectionForSite(topology, siteId)
  return downstreamSpokesForNvaSpoke(topology, connection?.spokeId)
}

export function downstreamVnetForAddress(
  topology: Topology,
  terminalSiteId: string | undefined,
  address: number,
): { spoke: Spoke; nvaSpokeId: string; prefix: string } | undefined {
  if (!terminalSiteId) return undefined
  const nvaSpokeId = spokeNvaConnectionForSite(topology, terminalSiteId)?.spokeId
  if (!nvaSpokeId) return undefined
  const spokes = downstreamSpokesForNvaSpoke(topology, nvaSpokeId)
  let best: { spoke: Spoke; prefix: string; length: number } | undefined
  for (const spoke of spokes) {
    for (const prefix of spoke.prefixes) {
      const length = cidr(prefix)?.length ?? -1
      if (contains(prefix, address) && (!best || length > best.length)) {
        best = { spoke, prefix, length }
      }
    }
  }
  return best ? { spoke: best.spoke, nvaSpokeId, prefix: best.prefix } : undefined
}

export function hubInboundPolicyConnectionId(connection: Connection): string {
  return connection.transport === 'SpokeNVA' && connection.spokeId ? connection.spokeId : connection.id
}

export function resolveAttachment(topology: Topology, id: string): ResolvedAttachment | undefined {
  const connection = topology.connections.find((item) => item.id === id)
  if (connection) {
    return {
      kind: 'connection',
      id: connection.id,
      name: connection.name,
      transport: connection.transport,
      enabled: connection.enabled,
      hubId: connection.hubId,
      siteId: connection.siteId,
      spokeId: connection.spokeId,
      propagateDefaultRoute: connection.propagateDefaultRoute,
      connection,
    }
  }
  const erLink = topology.erLinks?.find((item) => item.id === id)
  if (erLink) {
    return {
      kind: 'erLink',
      id: erLink.id,
      name: erLink.name,
      transport: 'ExpressRoute',
      enabled: erLink.enabled,
      locationId: erLink.locationId,
      hubId: erLink.hubId,
      siteId: erLink.siteId,
      propagateDefaultRoute: erLink.propagateDefaultRoute,
      erLink,
    }
  }
  const spoke = topology.spokes.find((item) => item.id === id)
  if (spoke) {
    return {
      kind: 'spoke',
      id: spoke.id,
      name: spoke.name,
      enabled: true,
      hubId: spoke.hubId,
      propagateDefaultRoute: spoke.propagateDefaultRoute,
      spoke,
    }
  }
  return undefined
}

export function enabledErLocationBridge(
  topology: Topology,
  hubLink: ErLink,
  siteLink: ErLink,
): { hub: Hub; site: Site; location: ErLocation } | undefined {
  if (!hubLink.enabled || !siteLink.enabled || !hubLink.hubId || !siteLink.siteId || hubLink.locationId !== siteLink.locationId) {
    return undefined
  }
  const location = topology.erLocations?.find((item) => item.id === hubLink.locationId)
  const hub = topology.hubs.find((item) => item.id === hubLink.hubId)
  const site = topology.sites.find((item) => item.id === siteLink.siteId)
  if (!location || !hub || !site) return undefined
  return { hub, site, location }
}
