import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzeRouting } from './diagnostics'
import { example } from './model'
import { validateTopology } from './validation'
import { simulate } from './routing'
import { azureRoutesAtSites } from './paths'
import {
  downstreamSpokesForNvaSite,
  downstreamSpokesForNvaSpoke,
  downstreamVnetForAddress,
  embeddedSpokeNvaSiteIds,
  enabledErLocationBridge,
  hostingSpokeForSite,
  hubInboundPolicyConnectionId,
  isEmbeddedSpokeNvaSite,
  resolveAttachment,
  spokeNvaConnectionForSite,
  spokeNvaConnectionForSpoke,
  spokeNvaPeerForSpoke,
  standaloneSites,
} from './topology-graph'
import { assignSitePrefixes, createExpressRouteAttachment, deleteTopologyObject, syncNvaDownstreamLinks, syncSiteNvaSpokeLinks } from './topology-mutations'
import { ipv4 } from './validation'

describe('topology-graph connectivity and SpokeNVA helpers', () => {
  it('resolves SpokeNVA connections, hosting spokes, and standalone vs embedded sites', () => {
    const topology = structuredClone(example)
    topology.sites.push({ id: 'nva-eu', name: 'EU Spoke NVA', asn: 65050, prefixes: [], role: 'spoke-nva' })
    topology.connections.push({
      id: 'nva-peer-eu',
      name: 'EU NVA Peering',
      hubId: 'eu',
      siteId: 'nva-eu',
      spokeId: 'eu-apps',
      peerIp: '10.1.0.4',
      transport: 'SpokeNVA',
      enabled: true,
      learnSiteRoutes: true,
      inbound: [],
      outbound: [],
    })
    topology.spokes.push({
      id: 'downstream-vnet',
      name: 'Downstream workload VNet',
      prefixes: ['10.150.0.0/16', '10.150.10.0/24'],
      nvaSpokeIds: ['eu-apps'],
    })

    expect(spokeNvaConnectionForSite(topology, 'nva-eu')?.id).toBe('nva-peer-eu')
    expect(spokeNvaConnectionForSpoke(topology, 'eu-apps')?.id).toBe('nva-peer-eu')
    expect(spokeNvaPeerForSpoke(topology, 'eu-apps')?.site.id).toBe('nva-eu')
    expect(isEmbeddedSpokeNvaSite(topology, 'nva-eu')).toBe(true)
    expect(isEmbeddedSpokeNvaSite(topology, 'dc')).toBe(false)
    expect(embeddedSpokeNvaSiteIds(topology)).toEqual(new Set(['nva-eu']))
    expect(standaloneSites(topology).some((site) => site.id === 'nva-eu')).toBe(false)
    expect(hostingSpokeForSite(topology, 'nva-eu')?.id).toBe('eu-apps')
    expect(downstreamSpokesForNvaSpoke(topology, 'eu-apps').map((s) => s.id)).toEqual(['downstream-vnet'])
    expect(downstreamSpokesForNvaSite(topology, 'nva-eu').map((s) => s.id)).toEqual(['downstream-vnet'])
    expect(downstreamVnetForAddress(topology, 'nva-eu', ipv4('10.150.10.5')!)).toMatchObject({
      nvaSpokeId: 'eu-apps',
      prefix: '10.150.10.0/24',
    })
    expect(hubInboundPolicyConnectionId(topology.connections.at(-1)!)).toBe('eu-apps')
    expect(hubInboundPolicyConnectionId(topology.connections[0])).toBe(topology.connections[0].id)
  })

  it('resolves attachments across connections, ER links, and spokes and bridges ER location links', () => {
    const topology = structuredClone(example)
    topology.erLocations = [{ id: 'loc-eu', name: 'EU MSEE' }]
    topology.erLinks = [
      { id: 'er-hub-eu', name: 'EU Hub ER', locationId: 'loc-eu', hubId: 'eu', enabled: true, learnSiteRoutes: false },
      { id: 'er-site-dc', name: 'DC ER', locationId: 'loc-eu', siteId: 'dc', enabled: true, learnSiteRoutes: true },
    ]
    expect(resolveAttachment(topology, 'er-eu')?.kind).toBe('connection')
    expect(resolveAttachment(topology, 'er-hub-eu')?.kind).toBe('erLink')
    expect(resolveAttachment(topology, 'eu-apps')?.kind).toBe('spoke')
    expect(resolveAttachment(topology, 'missing')).toBeUndefined()

    const bridge = enabledErLocationBridge(topology, topology.erLinks[0], topology.erLinks[1])
    expect(bridge?.hub.id).toBe('eu')
    expect(bridge?.site.id).toBe('dc')
    expect(bridge?.location.id).toBe('loc-eu')
  })

  it('memoizes azureRoutesAtSites per simulation and invalidates when site plane changes', () => {
    const topology = structuredClone(example)
    const simulation = simulate(topology)
    const first = azureRoutesAtSites(topology, simulation)
    const second = azureRoutesAtSites(topology, simulation)
    expect(second).toBe(first)

    const mutated = structuredClone(topology)
    mutated.sites[0].prefixes.push('10.222.0.0/16')
    const afterChange = azureRoutesAtSites(mutated, simulation)
    expect(afterChange).not.toBe(first)
  })

  it('cascades deletes and synchronizes SpokeNVA downstream VNet and site links', () => {
    const topology = structuredClone(example)
    topology.sites.push({ id: 'nva-eu', name: 'EU Spoke NVA', asn: 65050, prefixes: [], role: 'spoke-nva' })
    topology.connections.push({
      id: 'nva-peer-eu',
      name: 'EU NVA Peering',
      hubId: 'eu',
      siteId: 'nva-eu',
      spokeId: 'eu-apps',
      peerIp: '10.1.0.4',
      transport: 'SpokeNVA',
      enabled: true,
      learnSiteRoutes: true,
      inbound: [],
      outbound: [],
    })
    topology.spokes.push({
      id: 'downstream-vnet',
      name: 'Downstream VNet',
      prefixes: ['10.150.0.0/16'],
    })

    syncNvaDownstreamLinks(topology, 'nva-eu', 'EU Spoke NVA', 'eu-apps', ['downstream-vnet'], ['dc'], () => 'link-nva-dc')
    expect(topology.spokes.find((s) => s.id === 'downstream-vnet')?.nvaSpokeIds).toEqual(['eu-apps'])
    expect(topology.siteLinks.some((l) => l.id === 'link-nva-dc' && l.a === 'nva-eu' && l.b === 'dc')).toBe(true)

    syncSiteNvaSpokeLinks(topology, 'dc', 'Paris Datacenter', [], () => 'unused')
    expect(topology.siteLinks.some((l) => l.id === 'link-nva-dc')).toBe(false)

    syncSiteNvaSpokeLinks(topology, 'dc', 'Paris Datacenter', ['eu-apps'], () => 'link-dc-nva')
    expect(topology.siteLinks.some((l) => l.id === 'link-dc-nva')).toBe(true)

    const withAssigned = assignSitePrefixes(topology, 'dc', ['10.200.0.0/16', '10.10.0.0/16'])
    expect(withAssigned.sites.find((s) => s.id === 'dc')?.prefixes).toContain('10.200.0.0/16')

    const afterSpokeDelete = deleteTopologyObject(topology, { kind: 'spoke', id: 'eu-apps' })
    expect(afterSpokeDelete.spokes.some((s) => s.id === 'eu-apps')).toBe(false)
    expect(afterSpokeDelete.sites.some((s) => s.id === 'nva-eu')).toBe(false)
    expect(afterSpokeDelete.connections.some((c) => c.id === 'nva-peer-eu')).toBe(false)
    expect(afterSpokeDelete.siteLinks.some((l) => l.id === 'link-dc-nva')).toBe(false)
    expect(afterSpokeDelete.spokes.find((s) => s.id === 'downstream-vnet')?.nvaSpokeIds).toEqual([])
  })

  it('automatically creates an ExpressRoute peering location and hub/site ER links when adding or converting an ER connection', () => {
    const topology = structuredClone(example)
    let counter = 0
    const ids = () => `er-auto-${++counter}`

    const created = createExpressRouteAttachment(
      topology,
      {
        hubId: 'us',
        siteId: 'ny',
        name: 'Ashburn ExpressRoute',
        enabled: true,
        learnSiteRoutes: true,
        propagateDefaultRoute: true,
      },
      ids,
    )
    expect(created).toEqual({
      locationId: 'er-auto-1',
      hubLinkId: 'er-auto-2',
      siteLinkId: 'er-auto-3',
    })
    expect(topology.erLocations?.find((loc) => loc.id === 'er-auto-1')?.name).toBe('Ashburn ExpressRoute')
    expect(topology.erLinks?.find((link) => link.id === 'er-auto-2')).toMatchObject({
      locationId: 'er-auto-1',
      hubId: 'us',
      enabled: true,
      learnSiteRoutes: false,
      propagateDefaultRoute: true,
    })
    expect(topology.erLinks?.find((link) => link.id === 'er-auto-3')).toMatchObject({
      locationId: 'er-auto-1',
      siteId: 'ny',
      enabled: true,
      learnSiteRoutes: true,
    })
    expect(() => validateTopology(topology)).not.toThrow()
  })

  it('validates the 3-hub all-features sample topology and detects its asymmetric routing path', () => {
    for (const file of [
      'samples/hub-routing-preferences.json',
      'samples/secured-hub-routing-intent.json',
      'samples/spoke-bgp-nva-transit.json',
      'samples/three-hub-all-features-asymmetric.json',
    ]) {
      const sample = validateTopology(JSON.parse(readFileSync(file, 'utf8')))
      expect(simulate(sample).converged).toBe(true)
    }
    const raw = JSON.parse(readFileSync('samples/three-hub-all-features-asymmetric.json', 'utf8'))
    const topology = validateTopology(raw)
    expect(topology.hubs).toHaveLength(3)
    const simulation = simulate(topology)
    expect(simulation.converged).toBe(true)

    const report = analyzeRouting(topology, { version: 1, intents: [], failureAnalysis: false }, { automatic: true })
    expect(report.findings.some((f) => f.rule === 'asymmetric')).toBe(true)
    expect(report.findings.some((f) => f.rule === 'unowned-advertisement')).toBe(false)
    expect(report.findings.some((f) => f.rule === 'ownership')).toBe(false)
  })
})
