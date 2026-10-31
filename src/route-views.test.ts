import { describe, expect, it } from 'vitest'
import { example } from './model'
import type { RouteMapRule, RouterSelection, Topology } from './model'
import { simulate } from './routing'
import { azureRoutesAtSites } from './paths'
import { erLocationBgpTable, neighborRoutes } from './route-views'

const rule = (prefix: string, action: RouteMapRule['action']): RouteMapRule => ({
  id: prefix, prefixes: [prefix], match: 'equals', action, summaryPrefixes: ['10.0.0.0/8'], prepend: [64496], nextStep: 'terminate',
})

describe('ER location BGP tables', () => {
  const network = () => {
    const t = structuredClone(example)
    t.connections = []
    t.sites[0].prefixes = ['10.80.0.0/16']
    t.sites[1].prefixes = ['10.80.0.0/16']
    t.sites[2].prefixes = ['10.80.0.0/16']
    t.erLocations = [{ id: 'er', name: 'ER location' }]
    t.erLinks = [
      { id: 'hub-er', name: 'Hub attachment', locationId: 'er', hubId: 'eu', enabled: true, learnSiteRoutes: false },
      { id: 'parallel-hub-er', name: 'Parallel hub attachment', locationId: 'er', hubId: 'eu', enabled: true, learnSiteRoutes: false },
      { id: 'primary-er', name: 'Primary circuit', locationId: 'er', siteId: 'dc', enabled: true, learnSiteRoutes: true },
      { id: 'backup-er', name: 'Backup circuit', locationId: 'er', siteId: 'ny', enabled: true, learnSiteRoutes: true },
      { id: 'equal-er', name: 'Equal circuit', locationId: 'er', siteId: 'branch', enabled: true, learnSiteRoutes: true },
    ]
    assign(t, { kind: 'site', id: 'ny' }, 'backup-er', 'outbound', [
      { ...rule('10.80.0.0/16', 'prepend'), prepend: [65020] },
    ])
    return t
  }
  it('groups actual learned candidates with preferred paths, alternatives and distinct parallel neighbors', () => {
    const t = network(), simulation = simulate(t)
    const original = JSON.stringify({ t, simulation })
    const table = erLocationBgpTable(t, simulation, 'er')
    const onprem = table.find((decision) => decision.prefix === '10.80.0.0/16')!
    expect(onprem.candidates.map((route) => route.connectionId)).toEqual(['primary-er', 'backup-er', 'equal-er'])
    expect(onprem.selected.map((route) => route.connectionId)).toEqual(['primary-er', 'equal-er'])
    expect(onprem.selected.map((route) => route.asPath)).toEqual([[65010], [65030]])
    expect(onprem.explanation.join(' ')).toContain('2 equal-cost paths')
    const azure = table.find((decision) => decision.prefix === '10.1.0.0/16')!
    expect(azure.selected.map((route) => route.connectionId)).toEqual(['hub-er', 'parallel-hub-er'])
    expect(new Set(azure.candidates.map((route) => route.key)).size).toBe(2)
    expect(azure.candidates.every((route) => route.erHubLinkId === route.connectionId && !route.erSiteLinkId)).toBe(true)
    expect(JSON.stringify({ t, simulation })).toBe(original)
    expect(erLocationBgpTable(t, simulation, 'missing-location')).toEqual([])
  })
  it('respects neighbor outbound filters and promotes surviving paths after link withdrawals', () => {
    const t = network()
    assign(t, { kind: 'site', id: 'dc' }, 'primary-er', 'outbound', [rule('10.80.0.0/16', 'drop')])
    t.erLinks!.find((link) => link.id === 'equal-er')!.enabled = false
    const table = erLocationBgpTable(t, simulate(t), 'er')
    expect(table.find((decision) => decision.prefix === '10.80.0.0/16')!.selected.map((route) => route.connectionId)).toEqual(['backup-er'])
    t.erLinks!.find((link) => link.id === 'backup-er')!.enabled = false
    expect(erLocationBgpTable(t, simulate(t), 'er').some((decision) => decision.prefix === '10.80.0.0/16')).toBe(false)
    t.erLinks!.forEach((link) => { link.enabled = false })
    expect(erLocationBgpTable(t, simulate(t), 'er')).toEqual([])
  })
  it('compares hub and site advertisements by AS path without applying a hub system-route override', () => {
    const t = network()
    t.sites[0].prefixes.push('10.1.0.0/16')
    for (const id of ['hub-er', 'parallel-hub-er']) {
      assign(t, { kind: 'hub', id: 'eu' }, id, 'outbound', [
        { ...rule('10.1.0.0/16', 'prepend'), prepend: [64496, 64496, 64496] },
      ])
    }
    const simulation = simulate(t)
    const decision = erLocationBgpTable(t, simulation, 'er').find((decision) => decision.prefix === '10.1.0.0/16')!
    expect(decision.candidates).toHaveLength(3)
    expect(decision.selected.map((route) => route.connectionId)).toEqual(['primary-er'])
    expect(simulation.bgpTables.eu.find((decision) => decision.prefix === '10.1.0.0/16')!.selected[0].kind).toBe('system')
  })
})
function assign(t: Topology, owner: RouterSelection, connectionId: string, direction: 'inbound' | 'outbound', rules: RouteMapRule[]) {
  const id = `${owner.id}-${connectionId}-${direction}`
  t.routeMaps ??= []
  t.routeMaps.push({ id, name: id, ...(owner.kind === 'hub' ? { hubId: owner.id } : { siteId: owner.id }),
    rules: rules.map((rule) => ({ ...rule, id: `${id}-${rule.id}` })) })
  const node = (owner.kind === 'hub' ? t.hubs : t.sites).find((node) => node.id === owner.id)!
  node.routeMapAssignments ??= []
  const assignment = node.routeMapAssignments.find((assignment) => assignment.connectionId === connectionId)
  if (assignment) assignment[`${direction}MapId`] = id
  else node.routeMapAssignments.push({ connectionId, [`${direction}MapId`]: id })
}

describe('route inspection stages', () => {
  it('keeps the hub BGP table distinct from routing-intent and firewall forwarding entries', () => {
    const t = structuredClone(example)
    t.hubs[0].routingIntent = { private: true, internet: true, privatePrefixes: ['100.64.0.0/10'] }
    const simulation = simulate(t)
    expect(simulation.bgpTables.eu.some((decision) => decision.prefix === '10.20.0.0/16')).toBe(true)
    expect(simulation.bgpTables.eu.some((decision) => decision.prefix === '100.64.0.0/10' || decision.prefix === '0.0.0.0/0')).toBe(false)
    expect(simulation.tables.eu.some((decision) => decision.prefix === '100.64.0.0/10')).toBe(true)
    expect(simulation.firewallTables.eu.some((decision) => decision.prefix === '0.0.0.0/0')).toBe(true)
  })
  it('retains dropped, prepended and summarized inbound inputs without changing hub decisions or topology', () => {
    const t = structuredClone(example)
    t.connections[0].enabled = false
    t.sites[0].prefixes = ['10.60.0.0/16', '10.61.0.0/16', '10.62.0.0/16']
    assign(t, { kind: 'hub', id: 'eu' }, 'vpn-eu', 'inbound', [
      rule('10.60.0.0/16', 'drop'), rule('10.61.0.0/16', 'prepend'), rule('10.62.0.0/16', 'summarize'),
    ])
    const original = JSON.stringify(t), simulation = simulate(t)
    const peer = neighborRoutes(t, simulation, { kind: 'hub', id: 'eu' }, 'learned').find((peer) => peer.id === 'vpn-eu')!
    expect(peer.before.map((route) => route.prefix)).toEqual(['10.60.0.0/16', '10.61.0.0/16', '10.62.0.0/16'])
    expect(peer.before.every((route) => route.asPath.join(' ') === '65010')).toBe(true)
    expect(peer.after.map((route) => [route.prefix, route.asPath])).toEqual([['10.61.0.0/16', [64496, 65010]], ['10.0.0.0/8', []]])
    expect(simulation.tables.eu.some((decision) => decision.prefix === '10.60.0.0/16')).toBe(false)
    expect(simulation.tables.eu.find((decision) => decision.prefix === '10.61.0.0/16')!.selected[0].asPath).toEqual([64496, 65010])
    expect(JSON.stringify(t)).toBe(original)
  })

  it('shows outbound policy input separately from the advertisements actually sent to a VPN neighbor', () => {
    const t = structuredClone(example)
    assign(t, { kind: 'hub', id: 'us' }, 'vpn-us', 'outbound', [
      rule('10.1.0.0/16', 'drop'), rule('10.2.0.0/16', 'prepend'), rule('10.20.10.0/24', 'summarize'),
    ])
    const simulation = simulate(t)
    const peer = neighborRoutes(t, simulation, { kind: 'hub', id: 'us' }, 'advertised').find((peer) => peer.id === 'vpn-us')!
    expect(peer.before.some((route) => route.prefix === '10.1.0.0/16')).toBe(true)
    expect(peer.after.some((route) => route.prefix === '10.1.0.0/16')).toBe(false)
    expect(peer.before.find((route) => route.prefix === '10.2.0.0/16')!.asPath).toEqual([65515])
    expect(peer.after.find((route) => route.prefix === '10.2.0.0/16')!.asPath).toEqual([64496, 65515])
    expect(peer.after.some((route) => route.prefix === '10.0.0.0/8')).toBe(true)
    expect(peer.after).toEqual(simulation.outbound['vpn-us'])
  })

  it('includes Azure-learned routes and inbound policy effects in the site BGP table', () => {
    const t = structuredClone(example)
    t.connections = [t.connections[1]]
    assign(t, { kind: 'site', id: 'dc' }, 'vpn-eu', 'inbound', [
      rule('10.1.0.0/16', 'drop'), rule('10.2.0.0/16', 'prepend'),
    ])
    const simulation = simulate(t), routing = azureRoutesAtSites(t, simulation)
    const peer = neighborRoutes(t, simulation, { kind: 'site', id: 'dc' }, 'learned', routing)[0]
    expect(peer.before.some((route) => route.prefix === '10.1.0.0/16')).toBe(true)
    expect(peer.after.some((route) => route.prefix === '10.1.0.0/16')).toBe(false)
    expect(routing.candidates.dc.some((route) => route.prefix === '10.1.0.0/16')).toBe(false)
    expect(routing.tables.dc.find((route) => route.prefix === '10.2.0.0/16')!.asPath).toEqual([64496, 65515, 65520, 65520])
  })

  it('separates the sender outbound and receiver inbound policies on a site peer', () => {
    const t: Topology = { version: 1, name: 'Site peers', hubs: [], spokes: [], connections: [], sites: [
      { id: 'a', name: 'Site A', asn: 65010, prefixes: [] },
      { id: 'b', name: 'Site B', asn: 65020, prefixes: ['10.90.0.0/16'] },
    ], siteLinks: [{ id: 'wan', name: 'WAN', a: 'a', b: 'b', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }] }
    assign(t, { kind: 'site', id: 'b' }, 'wan', 'outbound', [rule('10.90.0.0/16', 'prepend')])
    assign(t, { kind: 'site', id: 'a' }, 'wan', 'inbound', [{ ...rule('10.90.0.0/16', 'prepend'), prepend: [64497] }])
    const simulation = simulate(t), routing = azureRoutesAtSites(t, simulation)
    const advertised = neighborRoutes(t, simulation, { kind: 'site', id: 'b' }, 'advertised', routing)[0]
    const learned = neighborRoutes(t, simulation, { kind: 'site', id: 'a' }, 'learned', routing)[0]
    expect(advertised.before[0].asPath).toEqual([65020])
    expect(advertised.after[0].asPath).toEqual([64496, 65020])
    expect(learned.before[0].asPath).toEqual([64496, 65020])
    expect(learned.after[0].asPath).toEqual([64497, 64496, 65020])
    expect(routing.tables.a[0].asPath).toEqual(learned.after[0].asPath)
  })

  it('uses the ER location perspective, keeps attachments distinct and retains pre-inbound routes', () => {
    const t = structuredClone(example)
    t.connections = []
    t.sites[0].prefixes = ['10.80.0.0/16']
    t.erLocations = [{ id: 'er', name: 'ER location' }]
    t.erLinks = [
      { id: 'hub-er', name: 'Hub attachment', locationId: 'er', hubId: 'eu', enabled: true, learnSiteRoutes: false },
      { id: 'site-er', name: 'Site circuit', locationId: 'er', siteId: 'dc', enabled: true, learnSiteRoutes: true },
    ]
    assign(t, { kind: 'hub', id: 'eu' }, 'hub-er', 'inbound', [rule('10.80.0.0/16', 'drop')])
    const simulation = simulate(t), router = { kind: 'erLocation' as const, id: 'er' }
    const learned = neighborRoutes(t, simulation, router, 'learned')
    const advertised = neighborRoutes(t, simulation, router, 'advertised')
    expect(learned.find((peer) => peer.id === 'site-er')!.after[0].asPath).toEqual([65010])
    expect(learned.find((peer) => peer.id === 'hub-er')!.after.some((route) => route.prefix === '10.1.0.0/16')).toBe(true)
    expect(advertised.find((peer) => peer.id === 'hub-er')!.after[0].asPath).toEqual([12076, 65010])
    expect(advertised.find((peer) => peer.id === 'site-er')!.after.some((route) => route.prefix === '10.80.0.0/16')).toBe(false)
    expect(advertised.find((peer) => peer.id === 'site-er')!.after.some((route) => route.prefix === '10.1.0.0/16')).toBe(true)
    expect(simulation.tables.eu.some((decision) => decision.prefix === '10.80.0.0/16')).toBe(false)
    t.erLinks[1].enabled = false
    expect(neighborRoutes(t, simulate(t), router, 'learned').find((peer) => peer.id === 'site-er')!.after).toEqual([])
  })
})
