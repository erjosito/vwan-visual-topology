import type { ObjectSelection, Topology } from './model'
import { isEmbeddedSpokeNvaSite, spokeNvaConnectionForSite, spokeNvaConnectionForSpoke } from './topology-graph'

export function deleteTopologyObject(topology: Topology, selection: ObjectSelection): Topology {
  const next = structuredClone(topology)
  const { kind, id } = selection
  const existingNvaConn = kind === 'site' ? spokeNvaConnectionForSite(next, id) : undefined

  if (kind === 'hub') {
    next.hubs = next.hubs.filter((h) => h.id !== id)
    next.spokes = next.spokes.filter((s) => s.hubId !== id)
    next.connections = next.connections.filter((c) => c.hubId !== id)
    next.erLinks = next.erLinks?.filter((link) => link.hubId !== id)
    next.routeMaps = next.routeMaps?.filter((m) => m.hubId !== id)
  } else if (kind === 'site') {
    next.sites = next.sites.filter((s) => s.id !== id)
    next.connections = next.connections.filter((c) => c.siteId !== id)
    next.siteLinks = next.siteLinks.filter((l) => l.a !== id && l.b !== id)
    next.erLinks = next.erLinks?.filter((link) => link.siteId !== id)
    next.routeMaps = next.routeMaps?.filter((map) => map.siteId !== id)
    if (existingNvaConn?.spokeId) {
      next.spokes = next.spokes.map((s) =>
        s.nvaSpokeIds ? { ...s, nvaSpokeIds: s.nvaSpokeIds.filter((nvaId) => nvaId !== existingNvaConn.spokeId) } : s,
      )
    }
  } else if (kind === 'spoke') {
    next.spokes = next.spokes
      .filter((s) => s.id !== id)
      .map((s) => (s.nvaSpokeIds ? { ...s, nvaSpokeIds: s.nvaSpokeIds.filter((nvaId) => nvaId !== id) } : s))
    next.connections = next.connections.filter((connection) => connection.spokeId !== id)
  } else if (kind === 'connection') {
    next.connections = next.connections.filter((c) => c.id !== id)
  } else if (kind === 'erLocation') {
    next.erLocations = next.erLocations?.filter((location) => location.id !== id)
    next.erLinks = next.erLinks?.filter((link) => link.locationId !== id)
  } else if (kind === 'erLink') {
    next.erLinks = next.erLinks?.filter((link) => link.id !== id)
  } else {
    next.siteLinks = next.siteLinks.filter((l) => l.id !== id)
  }

  const activeSpokeIds = new Set(next.spokes.filter((s) => Boolean(s.hubId)).map((s) => s.id))
  const activeNvaSiteIds = new Set(
    next.connections
      .filter((c) => c.transport === 'SpokeNVA' && c.spokeId && activeSpokeIds.has(c.spokeId))
      .map((c) => c.siteId),
  )
  const orphanedNvaSiteIds = new Set(
    next.sites.filter((s) => s.role === 'spoke-nva' && !activeNvaSiteIds.has(s.id)).map((s) => s.id),
  )
  if (orphanedNvaSiteIds.size) {
    next.sites = next.sites.filter((s) => !orphanedNvaSiteIds.has(s.id))
    next.connections = next.connections.filter((c) => !orphanedNvaSiteIds.has(c.siteId))
    next.siteLinks = next.siteLinks.filter((l) => !orphanedNvaSiteIds.has(l.a) && !orphanedNvaSiteIds.has(l.b))
    next.erLinks = next.erLinks?.filter((link) => !link.siteId || !orphanedNvaSiteIds.has(link.siteId))
    next.routeMaps = next.routeMaps?.filter((map) => !map.siteId || !orphanedNvaSiteIds.has(map.siteId))
  }
  next.spokes = next.spokes.map((s) =>
    s.nvaSpokeIds ? { ...s, nvaSpokeIds: s.nvaSpokeIds.filter((nvaId) => activeSpokeIds.has(nvaId)) } : s,
  )
  const remaining = new Set([...next.connections, ...next.siteLinks, ...next.spokes, ...(next.erLinks ?? [])].map((link) => link.id))
  for (const router of [...next.hubs, ...next.sites]) {
    if (router.routeMapAssignments) {
      router.routeMapAssignments = router.routeMapAssignments.filter((a) => remaining.has(a.connectionId))
    }
  }
  for (const site of next.sites) {
    if (site.vpnStaticRoutes) {
      site.vpnStaticRoutes = site.vpnStaticRoutes.filter((r) => remaining.has(r.connectionId))
    }
  }
  return next
}

export function syncNvaDownstreamLinks(
  next: Topology,
  nvaSiteId: string,
  nvaSiteName: string,
  targetSpokeId: string,
  checkedVnetIds: Iterable<string>,
  checkedSiteIds: Iterable<string>,
  createId: () => string = () => crypto.randomUUID(),
): void {
  const checkedVnets = new Set(checkedVnetIds)
  next.spokes = next.spokes.map((s) => {
    if (s.id === targetSpokeId) return s
    const current = new Set(s.nvaSpokeIds ?? [])
    if (checkedVnets.has(s.id)) current.add(targetSpokeId)
    else current.delete(targetSpokeId)
    return { ...s, nvaSpokeIds: current.size ? [...current] : undefined }
  })
  const checkedSites = new Set(checkedSiteIds)
  for (const otherSite of next.sites) {
    if (otherSite.id === nvaSiteId || isEmbeddedSpokeNvaSite(next, otherSite)) continue
    const existingLink = next.siteLinks.find(
      (l) => (l.a === nvaSiteId && l.b === otherSite.id) || (l.b === nvaSiteId && l.a === otherSite.id),
    )
    if (checkedSites.has(otherSite.id) && !existingLink) {
      next.siteLinks.push({
        id: createId(),
        name: `${nvaSiteName} - ${otherSite.name}`,
        a: nvaSiteId,
        b: otherSite.id,
        enabled: true,
        aToB: { prefixes: [], prepend: [], receivePrepend: [] },
        bToA: { prefixes: [], prepend: [], receivePrepend: [] },
      })
    } else if (!checkedSites.has(otherSite.id) && existingLink) {
      next.siteLinks = next.siteLinks.filter((l) => l.id !== existingLink.id)
    }
  }
}

export function syncSiteNvaSpokeLinks(
  next: Topology,
  siteId: string,
  siteName: string,
  checkedNvaSpokeIds: Iterable<string>,
  createId: () => string = () => crypto.randomUUID(),
): void {
  const checkedNvaSpokes = new Set(checkedNvaSpokeIds)
  const nvaSpokes = next.spokes.filter(
    (s) => s.id !== siteId && Boolean(s.hubId) && Boolean(spokeNvaConnectionForSpoke(next, s.id)),
  )
  for (const nvaSpoke of nvaSpokes) {
    const peerSiteId = spokeNvaConnectionForSpoke(next, nvaSpoke.id)?.siteId
    if (!peerSiteId) continue
    const existingLink = next.siteLinks.find(
      (l) => (l.a === siteId && l.b === peerSiteId) || (l.b === siteId && l.a === peerSiteId),
    )
    if (checkedNvaSpokes.has(nvaSpoke.id) && !existingLink) {
      next.siteLinks.push({
        id: createId(),
        name: `${nvaSpoke.name} - ${siteName}`,
        a: peerSiteId,
        b: siteId,
        enabled: true,
        aToB: { prefixes: [], prepend: [], receivePrepend: [] },
        bToA: { prefixes: [], prepend: [], receivePrepend: [] },
      })
    } else if (!checkedNvaSpokes.has(nvaSpoke.id) && existingLink) {
      next.siteLinks = next.siteLinks.filter((l) => l.id !== existingLink.id)
    }
  }
}

export function assignSitePrefixes(topology: Topology, siteId: string, prefixesToAdd: string[]): Topology {
  const next = structuredClone(topology)
  const site = next.sites.find((s) => s.id === siteId)
  if (!site) return next
  site.prefixes = [...new Set([...site.prefixes, ...prefixesToAdd])]
  return next
}
