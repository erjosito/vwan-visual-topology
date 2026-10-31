import { describe, expect, it } from 'vitest'
import { applyRouteMapRules } from './bgp'
import { example } from './model'
import type { RouteMap, RouteMapRule, Topology } from './model'
import { simulate, traceFlow } from './routing'
import { parseHubPrependAsPath, parseAsPath, validateTopology } from './validation'
import { traceNodePath } from './paths'

const rule = (overrides: Partial<RouteMapRule> = {}): RouteMapRule => ({
  id: 'rule', prefixes: [], match: 'equals', action: 'permit', summaryPrefixes: [], prepend: [], nextStep: 'terminate', ...overrides,
})
const route = (prefix = '10.20.0.0/16', asPath = [65001]) => ({ prefix, asPath })
const map = (rules: RouteMapRule[]): RouteMap => ({ id: 'map', name: 'Shared map', hubId: 'eu', rules })
const network = (): Topology => {
  const topology = structuredClone(example)
  topology.hubs = [topology.hubs[0]]
  topology.spokes = [topology.spokes[0]]
  topology.sites[0].prefixes = ['10.20.0.0/16']
  topology.sites[1].prefixes = ['10.20.0.0/16']
  topology.connections = topology.connections.filter((connection) => connection.hubId === 'eu' && connection.transport !== 'SDWAN')
  topology.connections[1].siteId = 'ny'
  return topology
}

describe('ordered first-class route-map rules', () => {
  it('allows unmatched routes and uses OR within prefix lists without matching less-specific prefixes', () => {
    const rules = [rule({ prefixes: ['10.0.0.0/8', '172.16.0.0/12'], match: 'contains', action: 'drop' })]
    expect(applyRouteMapRules([route(), route('172.16.1.0/24'), route('0.0.0.0/0'), route('192.168.0.0/16')], rules))
      .toEqual([route('0.0.0.0/0'), route('192.168.0.0/16')])
    expect(applyRouteMapRules([route()], [rule({ prefixes: ['10.0.0.0/8'], action: 'drop' })])).toEqual([route()])
  })
  it('continues matching modified routes, but terminates only after a match', () => {
    const rules = [
      rule({ id: 'skip', prefixes: ['192.168.0.0/16'], action: 'drop' }),
      rule({ id: 'one', action: 'prepend', prepend: [64496], nextStep: 'continue' }),
      rule({ id: 'two', action: 'prepend', prepend: [64497] }),
      rule({ id: 'three', action: 'drop' }),
    ]
    expect(applyRouteMapRules([route()], rules)[0].asPath).toEqual([64497, 64496, 65001])
    expect(applyRouteMapRules([route()], [rule(), rule({ id: 'drop', action: 'drop' })])).toEqual([route()])
    expect(applyRouteMapRules([route()], [rule({ action: 'drop', nextStep: 'continue' })])).toEqual([])
  })
  it('clears AS paths on summary, deduplicates aggregates and retains components', () => {
    const input = [route('10.20.1.0/24'), route('10.20.2.0/24', [65002])]
    const result = applyRouteMapRules(input, [
      rule({ action: 'summarize', summaryPrefixes: ['10.20.0.0/16'], nextStep: 'continue' }),
      rule({ id: 'after', prefixes: ['10.20.0.0/16'], action: 'prepend', prepend: [64496] }),
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ prefix: '10.20.0.0/16', asPath: [64496], forwardingRoutes: input })
    expect(input.map((r) => r.asPath)).toEqual([[65001], [65002]])
  })
  it('never fabricates more-specific or unrelated advertisements even with unvalidated input', () => {
    expect(applyRouteMapRules([route()], [
      rule({ action: 'summarize', summaryPrefixes: ['10.20.1.0/24', '172.16.0.0/12'] }),
    ])).toEqual([route()])
  })
  it('can filter the newly summarized prefix in a subsequent rule', () => {
    expect(applyRouteMapRules([route('10.20.1.0/24')], [
      rule({ action: 'summarize', summaryPrefixes: ['10.20.0.0/16'], nextStep: 'continue' }),
      rule({ id: 'drop', prefixes: ['10.20.0.0/16'], action: 'drop' }),
    ])).toEqual([])
  })
  it('does not mutate existing aggregates when coalescing their advertisements', () => {
    const input = [
      { ...route(), forwardingRoutes: [route('10.20.1.0/24')] },
      { ...route(), forwardingRoutes: [route('10.20.2.0/24')] },
    ]
    const saved = structuredClone(input)
    expect(applyRouteMapRules(input, [])).toHaveLength(1)
    expect(input).toEqual(saved)
  })
})

describe('route-map resources and migration', () => {
  it('migrates first-match legacy rules losslessly and round-trips the saved resource', () => {
    const original = network()
    original.connections[0].inbound = [
      { id: 'legacy-one', prefixes: ['10.20.0.0/16'], match: 'equals', prepend: [64496] },
      { id: 'legacy-two', prefixes: [], match: 'equals', prepend: [] },
    ]
    original.connections[1].outbound = [{ id: 'legacy-out', prefixes: [], match: 'equals', prepend: [64497] }]
    const normalized = validateTopology(original)
    expect(normalized.routeMaps).toHaveLength(2)
    expect(normalized.routeMaps![0].name).toContain(original.connections[0].name)
    expect(normalized.connections[0].inbound).toEqual([])
    expect(normalized.hubs[0].routeMapAssignments?.find((a) => a.connectionId === normalized.connections[0].id)?.inboundMapId).toBe(normalized.routeMaps![0].id)
    expect(normalized.connections[0]).not.toHaveProperty('inboundMapId')
    expect(normalized.connections[1].outbound).toEqual([])
    expect(normalized.routeMaps![0].rules.every((rule) => rule.nextStep === 'terminate')).toBe(true)
    expect(simulate(normalized)).toEqual(simulate(original))
    expect(validateTopology(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized)
  })

  describe('router endpoint route-map assignments', () => {
    it('applies site outbound before provider and hub inbound policies, with independent directions and links', () => {
      const t = network()
      t.routeMaps = [
        { id: 'site-map', name: 'Site export', siteId: 'dc', rules: [rule({ id: 'site-rule', action: 'prepend', prepend: [65010, 65010] })] },
        map([rule({ action: 'prepend', prepend: [64496] })]),
      ]
      t.sites[0].routeMapAssignments = [{ connectionId: 'er-eu', outboundMapId: 'site-map' }]
      t.hubs[0].routeMapAssignments = [{ connectionId: 'er-eu', inboundMapId: 'map' }]
      const normalized = validateTopology(t)
      const rows = simulate(normalized).firewallTables.eu.find((d) => d.prefix === '10.20.0.0/16')!.candidates
      expect(rows.find((r) => r.connectionId === 'er-eu')!.asPath).toEqual([64496, 12076, 65010, 65010, 65010])
      expect(rows.find((r) => r.connectionId === 'vpn-eu')!.asPath).toEqual([65020])
      expect(validateTopology(normalized)).toEqual(normalized)
    })

    it('filters site imports from Azure independently on each connection without modifying hub exports', () => {
      const t = structuredClone(example)
      t.routeMaps = [{ id: 'site-map', name: 'Site import', siteId: 'dc', rules: [rule({ action: 'drop', prefixes: ['10.1.0.0/16'] })] }]
      t.sites[0].routeMapAssignments = [{ connectionId: 'er-eu', inboundMapId: 'site-map' }]
      expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.1.0.1')[0].sourceConnectionId).toBe('vpn-eu')
      t.sites[0].routeMapAssignments.push({ connectionId: 'vpn-eu', inboundMapId: 'site-map' })
      expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.1.0.1')[0].status).toBe('unreachable')
      expect(simulate(t).outbound['er-eu'].some((r) => r.prefix === '10.1.0.0/16')).toBe(true)
    })

    it('resolves site inbound Azure summaries to their contributing connection and rejects holes', () => {
      const t = network()
      t.connections[1].enabled = false
      t.routeMaps = [{ id: 'import', name: 'Import', siteId: 'dc', rules: [rule({ action: 'summarize', prefixes: ['10.1.0.0/16'], summaryPrefixes: ['10.0.0.0/8'] })] }]
      t.sites[0].routeMapAssignments = [{ connectionId: 'er-eu', inboundMapId: 'import' }]
      const result = simulate(validateTopology(t))
      expect(traceNodePath(t, result, { kind: 'site', id: 'dc' }, '10.1.0.1')[0]).toMatchObject({ status: 'delivered', sourceConnectionId: 'er-eu' })
      expect(traceNodePath(t, result, { kind: 'site', id: 'dc' }, '10.9.0.1')[0].status).toBe('unreachable')
    })

    it('applies both peer endpoints, detects policy-induced AS loops and retains summary forwarding provenance', () => {
      const t: Topology = { version: 1, name: 'Peer policies', hubs: [], spokes: [], connections: [], sites: [
        { id: 'a', name: 'A', asn: 65001, prefixes: [] },
        { id: 'b', name: 'B', asn: 65002, prefixes: ['10.20.1.0/24'] },
      ], siteLinks: [{ id: 'wan', name: 'WAN', a: 'a', b: 'b', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }] }
      t.routeMaps = [
        { id: 'export', name: 'Export', siteId: 'b', rules: [
          rule({ id: 'export-rule', action: 'summarize', prefixes: ['10.20.0.0/16'], match: 'contains', summaryPrefixes: ['10.20.0.0/16'], nextStep: 'continue' }),
          rule({ id: 'export-prepend', action: 'prepend', prepend: [65004] }),
        ] },
        { id: 'import', name: 'Import', siteId: 'a', rules: [rule({ id: 'import-rule', action: 'prepend', prepend: [65003] })] },
      ]
      t.sites[0].routeMapAssignments = [{ connectionId: 'wan', inboundMapId: 'import' }]
      t.sites[1].routeMapAssignments = [{ connectionId: 'wan', outboundMapId: 'export' }]
      const normalized = validateTopology(t)
      const result = simulate(normalized)
      expect(result.siteTables.a[0]).toMatchObject({ prefix: '10.20.0.0/16', asPath: [65003, 65002, 65004], siteLinkIds: ['wan'] })
      expect(traceNodePath(normalized, result, { kind: 'site', id: 'a' }, '10.20.1.1')[0]).toMatchObject({ status: 'delivered', siteHops: ['a', 'b'], siteLinkIds: ['wan'] })
      expect(traceNodePath(normalized, result, { kind: 'site', id: 'a' }, '10.20.2.1')[0].status).toBe('unreachable')
      t.routeMaps[1].rules[0].prepend = [65001]
      expect(simulate(t).siteTables.a).toEqual([])
    })

    it('keeps site summaries reachable only through known contributors and never applies BGP maps to VPN static entries', () => {
      const t = network()
      t.sites[0].prefixes = ['10.20.1.0/24']
      t.routeMaps = [{ id: 'export', name: 'Export', siteId: 'dc', rules: [rule({ action: 'summarize', prefixes: ['10.20.0.0/16'], match: 'contains', summaryPrefixes: ['10.20.0.0/16'] })] }]
      t.sites[0].routeMapAssignments = [{ connectionId: 'er-eu', outboundMapId: 'export' }]
      t.connections[1].enabled = false
      const result = simulate(validateTopology(t))
      expect(traceFlow(t, result, 'eu', '10.20.1.1')[0].status).toBe('delivered')
      expect(traceFlow(t, result, 'eu', '10.20.2.1')[0].status).toBe('unreachable')
      t.routeMaps[0].rules = [rule({ action: 'drop' })]
      t.connections[0].transport = 'VPN'
      t.connections[0].learnSiteRoutes = false
      t.sites[0].vpnStaticRoutes = [{ id: 'component', prefix: '10.20.1.0/24', connectionId: 'er-eu' }]
      expect(traceFlow(t, simulate(validateTopology(t)), 'eu', '10.20.1.1')[0].status).toBe('delivered')
    })

    it('rejects unattached links, cross-router maps, duplicate bindings and ambiguous ownership', () => {
      const t = network()
      t.routeMaps = [{ id: 'site-map', name: 'Policy', siteId: 'dc', rules: [] }]
      t.sites[0].routeMapAssignments = [{ connectionId: 'vpn-eu', inboundMapId: 'site-map' }]
      expect(() => validateTopology(t)).toThrow('not attached')
      t.sites[0].routeMapAssignments = [{ connectionId: 'er-eu', inboundMapId: 'site-map' }, { connectionId: 'er-eu', outboundMapId: 'site-map' }]
      expect(() => validateTopology(t)).toThrow('Duplicate router')
      t.sites[0].routeMapAssignments = []
      t.hubs[0].routeMapAssignments = [{ connectionId: 'er-eu', inboundMapId: 'site-map' }]
      expect(() => validateTopology(t)).toThrow('same hub or site')
      t.routeMaps[0].hubId = 'eu'
      expect(() => validateTopology(t)).toThrow('exactly one')
    })
  })
  it('shares a hub-scoped map and gives references precedence over legacy rules', () => {
    const t = network()
    t.routeMaps = [map([rule({ action: 'prepend', prepend: [64497] })])]
    t.connections.forEach((connection) => { connection.inboundMapId = 'map' })
    t.connections[0].inbound = [{ id: 'legacy', prefixes: [], match: 'equals', prepend: [64496] }]
    expect(simulate(t).firewallTables.eu.find((d) => d.prefix === '10.20.0.0/16')!.candidates.every((r) => r.asPath[0] === 64497)).toBe(true)
    const normalized = validateTopology(t)
    expect(normalized.routeMaps).toHaveLength(1)
    expect(normalized.connections[0].inbound).toEqual([])
  })
  it('migrates long and colliding identifiers to stable valid resource IDs', () => {
    const t = network()
    t.connections[0].id = 'a'.repeat(120)
    t.connections[0].inbound = [{ id: 'legacy-in', prefixes: [], match: 'equals', prepend: [64496] }]
    t.connections[0].outbound = [{ id: 'legacy-out', prefixes: [], match: 'equals', prepend: [64497] }]
    t.routeMaps = [{ ...map([]), id: `migrated-${'a'.repeat(101)}` }]
    const normalized = validateTopology(t)
    expect(new Set(normalized.routeMaps!.map((map) => map.id)).size).toBe(3)
    expect(validateTopology(normalized)).toEqual(normalized)
  })
  it('rejects dangling, cross-hub and integrated SDWAN assignments', () => {
    const t = structuredClone(example)
    t.routeMaps = [map([])]
    t.connections[0].inboundMapId = 'missing'
    expect(() => validateTopology(t)).toThrow('missing route map')
    t.connections[0].inboundMapId = 'map'
    t.connections[2].outboundMapId = 'map'
    expect(() => validateTopology(t)).toThrow('same hub')
    delete t.connections[2].outboundMapId
    t.connections[3].inboundMapId = 'map'
    expect(() => validateTopology(t)).toThrow('not supported')
  })
  it.each([65001, 65520, 65535, 65536, 8074, 8075, 12076, 23456, 4200000000, 0])('rejects unsupported prepend ASN %s', (asn) => {
    const t = network()
    t.routeMaps = [map([rule({ action: 'prepend', prepend: [asn] })])]
    expect(() => validateTopology(t)).toThrow()
  })
  it('enforces strict hub wizard ASN rules without changing site parsing or legacy simulation imports', () => {
    expect(parseHubPrependAsPath('1, 12345 12345 64495 64496 64511')).toEqual([1, 12345, 12345, 64495, 64496, 64511])
    for (const value of ['', '0', '8074', '8075', '12076', '23456', '64512', '65514', '65515', '65516', '65517', '65518', '65519', '65520', '65534', '65535', '65536', '4200000000', '12345 65001']) {
      expect(() => parseHubPrependAsPath(value)).toThrow()
    }
    expect(parseAsPath('65001 4200000000')).toEqual([65001, 4200000000])
    const t = network()
    t.routeMaps = [map([rule({ action: 'prepend', prepend: [64496] })])]
    expect(validateTopology(t).routeMaps![0].rules[0].prepend).toEqual([64496])
  })
  it('validates CIDRs, summary containment, enums and resource limits', () => {
    const t = network()
    const invalid = [
      rule({ prefixes: ['10.0.0.1/24'] }),
      rule({ action: 'summarize', prefixes: ['10.0.0.0/8'], summaryPrefixes: ['10.20.0.0/16'] }),
      rule({ action: 'summarize', prefixes: ['10.20.0.0/16'], summaryPrefixes: ['172.16.0.0/12'] }),
      rule({ action: 'summarize', summaryPrefixes: ['10.0.0.0/8'] }),
      rule({ action: 'summarize' }),
      rule({ nextStep: 'invalid' as RouteMapRule['nextStep'] }),
      rule({ action: 'invalid' as RouteMapRule['action'] }),
    ]
    for (const invalidRule of invalid) {
      t.routeMaps = [map([invalidRule])]
      expect(() => validateTopology(t)).toThrow()
    }
    t.routeMaps = [map(Array.from({ length: 21 }, (_, index) => rule({ id: `rule-${index}` })))]
    expect(() => validateTopology(t)).toThrow('at most 20')
    t.routeMaps = Array.from({ length: 241 }, (_, index) => ({ ...map([]), id: `map-${index}` }))
    expect(() => validateTopology(t)).toThrow('at most 240')
  })
})

describe('route-map selection and actual forwarding', () => {
  it('uses reusable inbound prepending for ASPath selection and leaves empty maps unchanged', () => {
    const t = network()
    t.hubs[0].preference = 'ASPath'
    t.connections[1].inbound = [{ id: 'pad', prefixes: [], match: 'equals', prepend: [64497] }]
    t.routeMaps = [map([])]
    t.connections[0].inboundMapId = 'map'
    expect(simulate(t).firewallTables.eu.find((d) => d.prefix === '10.20.0.0/16')!.selected[0].connectionId).toBe('er-eu')
    t.routeMaps[0].rules = [rule({ action: 'prepend', prepend: [64496, 64496] })]
    expect(simulate(t).firewallTables.eu.find((d) => d.prefix === '10.20.0.0/16')!.selected[0].connectionId).toBe('vpn-eu')
  })
  it('filters inbound before selection but outbound only after selection', () => {
    const t = network()
    t.routeMaps = [map([rule({ action: 'drop' })])]
    t.connections[0].inboundMapId = 'map'
    expect(simulate(t).firewallTables.eu.flatMap((d) => d.selected).map((r) => r.connectionId)).toEqual(['eu-apps', 'vpn-eu'])
    delete t.connections[0].inboundMapId
    t.connections[1].outboundMapId = 'map'
    const result = simulate(t)
    expect(result.outbound['vpn-eu']).toEqual([])
    expect(result.firewallTables.eu.find((d) => d.prefix === '10.20.0.0/16')!.selected[0].connectionId).toBe('er-eu')
  })
  it('does not process VPN site static routes with BGP maps in either direction', () => {
    const t = network()
    t.connections[1].learnSiteRoutes = false
    t.sites[1].vpnStaticRoutes = [{ id: 'static', prefix: '10.90.0.0/16', connectionId: 'vpn-eu' }]
    t.routeMaps = [map([rule({ action: 'drop' })])]
    t.connections[1].inboundMapId = 'map'
    t.connections[0].outboundMapId = 'map'
    const result = simulate(t)
    expect(result.firewallTables.eu.some((d) => d.prefix === '10.90.0.0/16')).toBe(true)
    expect(result.outbound['er-eu'].map((r) => r.prefix)).toEqual(['10.90.0.0/16'])
  })
  it('summarizes outbound advertisements without changing hub routes', () => {
    const t = network()
    t.routeMaps = [map([rule({ prefixes: ['10.20.0.0/16'], match: 'contains', action: 'summarize', summaryPrefixes: ['10.0.0.0/8'] })])]
    t.connections[1].outboundMapId = 'map'
    const result = simulate(t)
    expect(result.outbound['vpn-eu'].filter((r) => r.prefix === '10.0.0.0/8')).toHaveLength(1)
    expect(result.outbound['vpn-eu'].find((r) => r.prefix === '10.0.0.0/8')!.asPath).toEqual([])
    expect(result.firewallTables.eu.some((d) => d.prefix === '10.0.0.0/8')).toBe(false)
  })
  it('retains actual destinations and site-mesh provenance under inbound summaries across hubs', () => {
    const t = structuredClone(example)
    t.connections = [t.connections[0]]
    t.connections[0].learnSiteRoutes = true
    t.sites = [
      { id: 'dc', name: 'Datacenter', asn: 65001, prefixes: [] },
      { id: 'branch', name: 'Branch', asn: 65002, prefixes: ['10.20.1.0/24'] },
      { id: 'branch-two', name: 'Branch two', asn: 65003, prefixes: ['10.20.2.0/24'] },
    ]
    t.siteLinks = [{ id: 'wan', name: 'WAN', a: 'dc', b: 'branch', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } },
    { id: 'wan-two', name: 'WAN two', a: 'dc', b: 'branch-two', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }]
    t.routeMaps = [map([rule({ prefixes: ['10.20.0.0/16'], match: 'contains', action: 'summarize', summaryPrefixes: ['10.20.0.0/16'] })])]
    t.connections[0].inboundMapId = 'map'
    const result = simulate(t)
    const summary = result.firewallTables.eu.find((d) => d.prefix === '10.20.0.0/16')!
    expect(summary.selected).toHaveLength(1)
    expect(summary.selected[0]).toMatchObject({ asPath: [], forwardingRoutes: [{ prefix: '10.20.1.0/24' }, { prefix: '10.20.2.0/24' }] })
    expect(traceFlow(t, result, 'us', '10.20.2.1')[0]).toMatchObject({
      status: 'delivered', hubs: ['us', 'eu'], connectionId: 'er-eu', siteHops: ['dc', 'branch-two'],
    })
    expect(traceFlow(t, result, 'us', '10.20.3.1')[0].status).toBe('unreachable')
  })
  it('retains unreachable ECMP summary branches rather than claiming delivery on every selected path', () => {
    const t = network()
    t.connections[0].transport = 'VPN'
    t.sites[0].prefixes = ['10.20.1.0/24']
    t.sites[1].prefixes = ['10.20.2.0/24']
    t.routeMaps = [map([rule({ prefixes: ['10.20.0.0/16'], match: 'contains', action: 'summarize', summaryPrefixes: ['10.20.0.0/16'] })])]
    t.connections.forEach((connection) => { connection.inboundMapId = 'map' })
    const result = simulate(t)
    expect(result.firewallTables.eu.find((d) => d.prefix === '10.20.0.0/16')!.selected).toHaveLength(2)
    expect(traceFlow(t, result, 'eu', '10.20.1.1').map((path) => path.status).sort()).toEqual(['delivered', 'unreachable'])
  })
})
