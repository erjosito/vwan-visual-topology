import { describe, expect, it } from 'vitest'
import { example } from './model'
import { nodePrefixes, traceGroupedPaths, traceNodePath } from './paths'
import { simulate } from './routing'

describe('contextual node paths', () => {
  it('combines all other destination prefixes while excluding the source and retaining unreachable results', () => {
    const t = structuredClone(example)
    t.sites[0].prefixes = ['10.20.0.0/16']
    t.sites[1].prefixes = ['203.0.113.0/24']
    t.connections.push({ ...structuredClone(t.connections[0]), id: 'parallel-er', name: 'Parallel ER',
      routes: t.connections[0].routes.map((route) => ({ ...route, id: `parallel-${route.id}` })) })
    const paths = traceGroupedPaths(t, simulate(t), { kind: 'spoke', id: 'eu-apps' }, 'to', 'everywhere')
    expect(new Set(paths.map((path) => path.destinationPrefix))).toEqual(new Set(['10.2.0.0/16', '10.20.0.0/16', '203.0.113.0/24', '10.40.0.0/16']))
    expect(paths.filter((path) => path.destinationPrefix === '10.20.0.0/16').every((path) => path.status === 'delivered')).toBe(true)
    expect(new Set(paths.filter((path) => path.destinationPrefix === '10.20.0.0/16').map((path) => path.connectionId))).toEqual(new Set(['er-eu', 'parallel-er']))
    expect(paths.find((path) => path.destinationPrefix === '203.0.113.0/24')).toMatchObject({ destinationName: 'New York office', status: 'unreachable' })
    const sitePaths = traceGroupedPaths(t, simulate(t), { kind: 'site', id: 'dc' }, 'to', 'everywhere')
    expect(sitePaths.some((path) => path.destinationPrefix === '10.20.0.0/16')).toBe(false)
    expect(sitePaths.find((path) => path.destinationPrefix === '10.2.0.0/16')).toMatchObject({ status: 'delivered', sourceSiteHops: ['dc'] })
  })

  it('deduplicates shared prefixes and handles empty/provisional workspaces', () => {
    const t = structuredClone(example)
    t.spokes[1].prefixes.push('10.1.0.0/16')
    t.sites[0].prefixes = ['10.2.0.0/16']
    const paths = traceGroupedPaths(t, simulate(t), { kind: 'site', id: 'ny' }, 'to', 'everywhere')
    expect(paths.filter((path) => path.destinationPrefix === '10.2.0.0/16').every((path) => path.destinationName === 'Americas applications, London datacenter')).toBe(true)
    expect(traceGroupedPaths(t, { ...simulate(t), converged: false }, { kind: 'site', id: 'ny' }, 'to', 'everywhere')).toEqual([])
    expect(traceGroupedPaths(t, { ...simulate(t), converged: false }, { kind: 'site', id: 'ny' }, 'from', 'everywhere')).toEqual([])
    t.spokes = []; t.sites = [t.sites[1]]; t.connections = []; t.siteLinks = []
    expect(traceGroupedPaths(t, simulate(t), { kind: 'site', id: 'ny' }, 'to', 'everywhere')).toEqual([])
    expect(traceGroupedPaths(t, simulate(t), { kind: 'site', id: 'ny' }, 'from', 'everywhere')).toEqual([])
  })

  it('filters outgoing groups to VNets or on-premises sites without adding hubs as duplicate destinations', () => {
    const t = structuredClone(example)
    const simulation = simulate(t)
    const source = { kind: 'spoke' as const, id: 'eu-apps' }
    expect(traceGroupedPaths(t, simulation, source, 'to', 'vnets').map((path) => path.destinationName)).toEqual(['Americas applications'])
    const sites = traceGroupedPaths(t, simulation, source, 'to', 'sites')
    expect(new Set(sites.flatMap((path) => path.destinationName.split(', ')))).toEqual(new Set(['London datacenter', 'New York office', 'Berlin branch']))
    expect(sites.every((path) => path.sourceName === 'Europe applications')).toBe(true)
    expect(new Set(traceGroupedPaths(t, simulation, { kind: 'hub', id: 'eu' }, 'to', 'vnets').map((path) => path.destinationPrefix)))
      .toEqual(new Set(['10.1.0.0/16', '10.2.0.0/16']))
    expect(traceGroupedPaths(t, simulation, { kind: 'spoke', id: 'deleted' }, 'to', 'everywhere')).toEqual([])
  })

  it('traces incoming groups independently from each source, including prefixless sites and unreachable paths', () => {
    const t = structuredClone(example)
    const simulation = simulate(t)
    const target = { kind: 'spoke' as const, id: 'eu-apps' }
    const sites = traceGroupedPaths(t, simulation, target, 'from', 'sites')
    expect(new Set(sites.map((path) => path.sourceName))).toEqual(new Set(['London datacenter', 'New York office', 'Berlin branch']))
    expect(sites.every((path) => path.destinationName === 'Europe applications' && path.destinationPrefix === '10.1.0.0/16')).toBe(true)
    expect(sites.find((path) => path.sourceName === 'New York office')).toMatchObject({ status: 'delivered', sourceConnectionId: 'vpn-us', hubs: ['us', 'eu'] })
    expect(sites.find((path) => path.sourceName === 'Berlin branch')).toMatchObject({ status: 'unreachable', hubs: [] })
    const vnets = traceGroupedPaths(t, simulation, target, 'from', 'vnets')
    expect(vnets).toHaveLength(1)
    expect(vnets[0]).toMatchObject({ sourceName: 'Americas applications', sourceSpokeId: 'us-apps', destinationPrefix: '10.1.0.0/16', status: 'delivered', hubs: ['us', 'eu'] })
    const everywhere = traceGroupedPaths(t, simulation, target, 'from', 'everywhere')
    expect(everywhere).toEqual([...vnets, ...sites])
    t.spokes[0].prefixes = []
    expect(traceGroupedPaths(t, simulate(t), target, 'from', 'everywhere')).toEqual([])
  })

  it('retains different incoming sources sharing a prefix and traces every selected destination prefix', () => {
    const t = structuredClone(example)
    t.spokes.push({ ...t.spokes[1], id: 'shared-vnet', name: 'Shared-prefix VNet' })
    const paths = traceGroupedPaths(t, simulate(t), { kind: 'site', id: 'dc' }, 'from', 'vnets')
    expect(new Set(paths.map((path) => path.sourceName))).toEqual(new Set(['Europe applications', 'Americas applications', 'Shared-prefix VNet']))
    expect(new Set(paths.map((path) => path.sourceSpokeId))).toEqual(new Set(['eu-apps', 'us-apps', 'shared-vnet']))
    expect(new Set(paths.map((path) => path.destinationPrefix))).toEqual(new Set(['10.20.0.0/16', '10.20.10.0/24']))
    expect(paths.every((path) => path.status === 'delivered')).toBe(true)
  })

  it('uses the selected hub routes for a spoke-to-site path', () => {
    const t = structuredClone(example)
    const paths = traceNodePath(t, simulate(t), { kind: 'spoke', id: 'eu-apps' }, '10.30.0.5')
    expect(paths[0]).toMatchObject({ hubs: ['eu', 'us'], connectionId: 'vpn-us', status: 'delivered' })
  })
  it('does not send traffic inside a source spoke through the hub', () => {
    const t = structuredClone(example)
    expect(traceNodePath(t, simulate(t), { kind: 'spoke', id: 'eu-apps' }, '10.1.0.5')[0]).toMatchObject({
      hubs: [], siteId: 'eu-apps', status: 'delivered',
    })
  })
  it('follows advertisements from a site into Azure toward a spoke', () => {
    const t = structuredClone(example)
    const paths = traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.2.0.5')
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.every((p) => p.status === 'delivered' && p.connectionId === 'us-apps' && !!p.sourceConnectionId)).toBe(true)
    expect(paths[0].sourceSiteHops).toEqual(['dc'])
  })
  it('uses on-premises best paths and withdraws a failed peer link', () => {
    const t = structuredClone(example)
    t.sites[1].prefixes = ['10.90.0.0/16']
    t.siteLinks.push({ id: 'wan', name: 'WAN', a: 'dc', b: 'ny', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } })
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.1')[0]).toMatchObject({ siteHops: ['dc', 'ny'], status: 'delivered' })
    t.siteLinks[0].enabled = false
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.1')[0].status).toBe('unreachable')
  })
  it('does not highlight a nonexistent route or trace provisional calculations', () => {
    const t = structuredClone(example)
    const simulation = simulate(t)
    expect(traceNodePath(t, simulation, { kind: 'hub', id: 'eu' }, '203.0.113.1')[0].status).toBe('unreachable')
    expect(traceNodePath(t, { ...simulation, converged: false }, { kind: 'site', id: 'dc' }, '10.1.0.1')).toEqual([])
  })
  it('uses assigned prefixes rather than treating transit advertisements as site ownership', () => {
    const t = structuredClone(example)
    t.sites[1].prefixes = ['10.30.0.0/16']
    expect(nodePrefixes(t, { kind: 'site', id: 'ny' })).toEqual(['10.30.0.0/16'])
    expect(nodePrefixes(t, { kind: 'hub', id: 'eu' })).toEqual(['10.1.0.0/16'])
  })
  it('retains the exact preferred parallel on-premises link in a site-origin path', () => {
    const t = structuredClone(example)
    t.sites[1].prefixes = ['10.90.0.0/16']
    const link = { id: 'primary', name: 'Primary', a: 'dc', b: 'ny', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }
    t.siteLinks.push(link, { ...structuredClone(link), id: 'backup', name: 'Backup', bToA: { prefixes: [], prepend: [65020] } })
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.5')[0].siteLinkIds).toEqual(['primary'])
    t.siteLinks[0].enabled = false
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.5')[0].siteLinkIds).toEqual(['backup'])
  })
  it('traces bidirectional ECMP paths for a standalone VNet connected to two spoke NVAs', () => {
    const t = structuredClone(example)
    t.spokes.push({ id: 'eu-nva-2', name: 'Europe NVA 2', hubId: 'eu', prefixes: ['10.11.0.0/16'] })
    t.sites.push(
      { id: 'nva-1', name: 'NVA 1', asn: 65051, prefixes: [] },
      { id: 'nva-2', name: 'NVA 2', asn: 65052, prefixes: [] },
    )
    t.connections.push(
      { id: 'peer-1', name: 'Peer 1', hubId: 'eu', siteId: 'nva-1', spokeId: 'eu-apps', peerIp: '10.1.0.4', transport: 'SpokeNVA', enabled: true, learnSiteRoutes: true, routes: [], inbound: [], outbound: [] },
      { id: 'peer-2', name: 'Peer 2', hubId: 'eu', siteId: 'nva-2', spokeId: 'eu-nva-2', peerIp: '10.11.0.4', transport: 'SpokeNVA', enabled: true, learnSiteRoutes: true, routes: [], inbound: [], outbound: [] },
    )
    t.spokes.push({ id: 'shared-downstream', name: 'Shared downstream VNet', prefixes: ['10.220.0.0/16'], nvaSpokeIds: ['eu-apps', 'eu-nva-2'] })
    const sim = simulate(t)
    const hubForward = traceNodePath(t, sim, { kind: 'hub', id: 'eu' }, '10.220.0.10')
    expect(hubForward).toHaveLength(2)
    const forward = traceNodePath(t, sim, { kind: 'spoke', id: 'us-apps' }, '10.220.0.10')
    expect(forward.every((p) => p.status === 'delivered' && p.siteId === 'shared-downstream')).toBe(true)
    expect(new Set(forward.map((p) => p.nvaSpokeId))).toEqual(new Set(['eu-apps', 'eu-nva-2']))
    const reverse = traceNodePath(t, sim, { kind: 'spoke', id: 'shared-downstream' }, '10.2.0.10')
    expect(reverse).toHaveLength(2)
    expect(reverse.every((p) => p.status === 'delivered' && p.siteId === 'us-apps')).toBe(true)
    expect(new Set(reverse.map((p) => p.sourceNvaSpokeId))).toEqual(new Set(['eu-apps', 'eu-nva-2']))
  })
})
