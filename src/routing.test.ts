import { describe, expect, it } from 'vitest'
import { example } from './model'
import type { Connection, Hub, Topology, Transport } from './model'
import { simulate, traceFlow } from './routing'
import { applyRouteMap, propagateSites } from './bgp'
import { cidr, contains, ipv4, parseAsPath, validateTopology } from './validation'

const hub = (id: string, preference: Hub['preference'] = 'ExpressRoute'): Hub => ({
  id, name: id, region: 'West Europe', preference, routingIntent: { private: false, internet: false, privatePrefixes: [] },
})
const link = (id: string, hubId: string, transport: Transport, asPath: number[], prefix = '10.20.0.0/16'): Connection => ({
  id, name: id, hubId, siteId: id + '-site', enabled: true, transport, learnSiteRoutes: false, inbound: [], outbound: [],
  routes: [{ id: id + '-route', prefix, asPath, kind: 'bgp' }],
})
const topology = (hubs: Hub[], connections: Connection[]): Topology => ({
  version: 1, name: 'Test network', hubs, connections, spokes: [], siteLinks: [],
  sites: connections.map((c, i) => ({ id: c.siteId, name: c.siteId, asn: 65001 + i, prefixes: [] })),
})
const selected = (t: Topology, hubId = 'a', prefix = '10.20.0.0/16') =>
  simulate(t).firewallTables[hubId].find((d) => d.prefix === prefix)?.selected ?? []

describe('hub best path and inter-hub propagation', () => {
  it('prefers local ER over shorter VPN with default HRP', () => {
    const t = topology([hub('a')], [link('er', 'a', 'ExpressRoute', [12076, 65001, 65001]), link('vpn', 'a', 'VPN', [65002])])
    expect(selected(t).map((r) => r.connectionId)).toEqual(['er'])
  })
  it('prefers local VPN even when its path is longer with VPN HRP', () => {
    const t = topology([hub('a', 'VPN')], [link('er', 'a', 'ExpressRoute', [12076, 65001]), link('vpn', 'a', 'VPN', [65002, 65002, 65002])])
    expect(selected(t)[0].connectionId).toBe('vpn')
  })
  it('chooses shortest first with ASPath HRP and ER for a local tie', () => {
    const t = topology([hub('a', 'ASPath')], [link('er', 'a', 'ExpressRoute', [12076, 65001]), link('vpn', 'a', 'VPN', [65002])])
    expect(selected(t)[0].connectionId).toBe('vpn')
    t.connections[1].routes[0].asPath.push(65002)
    expect(selected(t)[0].connectionId).toBe('er')
  })
  it('prefers local even when a remote VPN advertisement is shorter in ER mode', () => {
    const t = topology([hub('a'), hub('b')], [link('local', 'a', 'VPN', [65001, 65001, 65001, 65001]), link('remote', 'b', 'VPN', [65002])])
    expect(selected(t)[0].connectionId).toBe('local')
    expect(simulate(t).warnings.join(' ')).not.toContain('arrival-order')
  })
  it.each(['ExpressRoute', 'VPN'] as const)('warns only when local received paths are at least two longer in %s mode', (preference) => {
    const t = topology([hub('a', preference), hub('b')], [link('local', 'a', 'VPN', Array(3).fill(65001)), link('remote', 'b', 'VPN', [65002])])
    for (const length of [3, 4]) {
      t.connections[0].routes[0].asPath = Array(length).fill(65001)
      expect(simulate(t).warnings.join(' ')).not.toContain('arrival-order')
    }
    t.connections[0].routes[0].asPath.push(65001)
    expect(simulate(t).warnings.join(' ')).toContain('arrival-order')
    expect(selected(t)[0].connectionId).toBe('local')
  })
  it('allows remote VPN to win with ASPath and prepends 65520 twice', () => {
    const t = topology([hub('a', 'ASPath'), hub('b')], [link('local', 'a', 'VPN', [65001, 65001, 65001, 65001]), link('remote', 'b', 'VPN', [65002])])
    expect(selected(t)[0]).toMatchObject({ connectionId: 'remote', remote: true, asPath: [65520, 65520, 65002] })
  })
  it('considers remote ER last in ASPath mode', () => {
    const t = topology([hub('a', 'ASPath'), hub('b')], [link('local', 'a', 'VPN', Array(8).fill(65001)), link('remote', 'b', 'ExpressRoute', [12076, 65002])])
    expect(selected(t)[0].connectionId).toBe('local')
  })
  it('exports only the origin hub best paths, not all advertisements', () => {
    const t = topology([hub('a'), hub('b', 'VPN')], [link('er', 'b', 'ExpressRoute', [12076, 65001]), link('vpn', 'b', 'VPN', [65002, 65002])])
    const d = simulate(t).tables.a[0]
    expect(d.candidates.map((r) => r.connectionId)).toEqual(['vpn'])
  })
  it('prefers VPN over ER when all candidate sources are remote', () => {
    const t = topology([hub('a'), hub('b'), hub('c')], [link('er', 'b', 'ExpressRoute', [12076, 65001]), link('vpn', 'c', 'VPN', [65002])])
    expect(selected(t)[0].connectionId).toBe('vpn')
  })
  it('retains all modeled ECMP paths and removes failed links', () => {
    const t = topology([hub('a')], [link('v1', 'a', 'VPN', [65001]), link('v2', 'a', 'VPN', [65002])])
    expect(selected(t)).toHaveLength(2)
    expect(traceFlow(t, simulate(t), 'a', '10.20.0.1')).toHaveLength(2)
    t.connections[0].enabled = false
    expect(selected(t)[0].connectionId).toBe('v2')
  })
  it('does not relabel an SD-WAN NVA as a VPN gateway', () => {
    const t = topology([hub('a', 'VPN')], [link('er', 'a', 'ExpressRoute', [12076, 65001]), link('sd', 'a', 'SDWAN', [65100, 65002, 65002])])
    expect(selected(t)[0].connectionId).toBe('er')
    expect(simulate(t).warnings.join(' ')).toContain('independent NVA')
  })
  it('uses longest prefix before connection preference during forwarding', () => {
    const t = topology([hub('a')], [link('er', 'a', 'ExpressRoute', [12076, 65001]), link('vpn', 'a', 'VPN', [65002], '10.20.10.0/24')])
    expect(traceFlow(t, simulate(t), 'a', '10.20.10.3')[0].connectionId).toBe('vpn')
  })
  it('propagates spoke routes and prefers a directly connected system route over BGP', () => {
    const t = topology([hub('a'), hub('b')], [link('vpn', 'a', 'VPN', [65002])])
    t.spokes.push({ id: 'spoke', name: 'Spoke', hubId: 'a', prefixes: ['10.20.0.0/16'] })
    expect(selected(t)[0].transport).toBe('VNet')
    expect(selected(t, 'b')[0].asPath).toEqual([65520, 65520])
  })
  it('propagates VPN site static imports without granting them hub-table static priority', () => {
    const t = topology([hub('a'), hub('b')], [link('vpn', 'a', 'VPN', [])])
    t.connections[0].routes[0].kind = 'vpn-static'
    expect(selected(t, 'b')).toHaveLength(1)
    t.connections.push(link('er', 'a', 'ExpressRoute', [12076, 65010]))
    expect(selected(t)[0].connectionId).toBe('er')
  })
  it('does not propagate default routes between hubs', () => {
    const t = topology([hub('a'), hub('b')], [link('vpn', 'a', 'VPN', [65002], '0.0.0.0/0')])
    expect(simulate(t).tables.b).toHaveLength(0)
    expect(traceFlow(t, simulate(t), 'b', '8.8.8.8')[0].status).toBe('unreachable')
  })
  it.each(['ExpressRoute', 'VPN', 'ASPath'] as const)('prefers secure remote paths to unsecured remote ER under %s', (preference) => {
    const t = topology([hub('a', preference), hub('b'), hub('c')], [
      link('er', 'b', 'ExpressRoute', [12076, 65001]),
      link('secure', 'c', 'ExpressRoute', Array(8).fill(65002)),
    ])
    t.hubs[2].routingIntent.private = true
    expect(selected(t)[0].connectionId).toBe('secure')
    expect(traceFlow(t, simulate(t), 'a', '10.20.1.1')[0]).toMatchObject({ connectionId: 'secure', firewalls: ['c'] })
  })
  it('uses locality for equal AS path lengths before transport preference', () => {
    const t = topology([hub('a', 'ASPath'), hub('b')], [
      link('local', 'a', 'VPN', [65001, 65001, 65001]),
      link('remote', 'b', 'VPN', [65002]),
    ])
    expect(selected(t)[0].connectionId).toBe('local')
  })
  it('uses shortest received paths between remote ER candidates even when they are considered last', () => {
    const t = topology([hub('a', 'ASPath'), hub('b'), hub('c')], [
      link('short', 'b', 'ExpressRoute', [12076, 65001]),
      link('long', 'c', 'ExpressRoute', [12076, 65002, 65002]),
    ])
    expect(selected(t)[0].connectionId).toBe('short')
  })
})

describe('routing intent has distinct hub and firewall forwarding tables', () => {
  it('redirects RFC1918 to firewall and retains exact routes on firewall', () => {
    const t = topology([hub('a')], [link('er', 'a', 'ExpressRoute', [12076, 65001])])
    t.hubs[0].routingIntent.private = true
    const result = simulate(t)
    expect(result.tables.a.map((d) => d.prefix)).toEqual(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'])
    expect(result.firewallTables.a[0].selected[0].connectionId).toBe('er')
    expect(traceFlow(t, result, 'a', '10.20.1.1')[0]).toMatchObject({ status: 'delivered', firewalls: ['a'], connectionId: 'er' })
    expect(traceFlow(t, result, 'a', '10.90.1.1')[0].status).toBe('unreachable')
  })
  it('requires explicit non-RFC1918 private prefixes', () => {
    const t = topology([hub('a')], [link('vpn', 'a', 'VPN', [65001], '100.64.0.0/16')])
    t.hubs[0].routingIntent.private = true
    expect(traceFlow(t, simulate(t), 'a', '100.64.1.1')[0].status).toBe('unreachable')
    t.hubs[0].routingIntent.privatePrefixes = ['100.64.0.0/10']
    expect(traceFlow(t, simulate(t), 'a', '100.64.1.1')[0].firewalls).toEqual(['a'])
  })
  it('inspects in both hubs along an inter-hub flow', () => {
    const t = topology([hub('a'), hub('b')], [link('vpn', 'b', 'VPN', [65002])])
    t.hubs.forEach((h) => { h.routingIntent.private = true })
    expect(traceFlow(t, simulate(t), 'a', '10.20.1.1')[0]).toMatchObject({ hubs: ['a', 'b'], firewalls: ['a', 'b'], status: 'delivered' })
  })
  it('shows direct Internet egress separately from private next hops', () => {
    const t = topology([hub('a')], [])
    t.hubs[0].routingIntent.internet = true
    const result = simulate(t)
    expect(result.tables.a[0].selected[0].transport).toBe('Firewall')
    expect(traceFlow(t, result, 'a', '8.8.8.8')[0].steps.join(' ')).toContain('Direct Internet egress')
  })
})

describe('route maps and on-premises transit', () => {
  it('applies first-match prefix rules and leaves unmatched paths unchanged', () => {
    const rules = [
      { id: 'r1', prefixes: ['10.0.0.0/8'], match: 'contains' as const, prepend: [64496, 64496] },
      { id: 'r2', prefixes: [], match: 'equals' as const, prepend: [64497] },
    ]
    expect(applyRouteMap('10.20.0.0/16', [65001], rules)).toEqual([64496, 64496, 65001])
    expect(applyRouteMap('172.16.0.0/16', [65001], rules.slice(0, 1))).toEqual([65001])
  })
  it('inbound prepending changes ASPath best selection', () => {
    const t = topology([hub('a', 'ASPath')], [link('one', 'a', 'VPN', [65001]), link('two', 'a', 'VPN', [65002, 65002])])
    t.connections[0].inbound = [{ id: 'map', prefixes: [], match: 'equals', prepend: [64496, 64496] }]
    expect(selected(t)[0].connectionId).toBe('two')
  })
  it('outbound prepending changes advertisements but not Azure best selection', () => {
    const t = topology([hub('a')], [link('er', 'a', 'ExpressRoute', [12076, 65001]), link('vpn', 'a', 'VPN', [65002])])
    t.spokes.push({ id: 's', name: 'Source', hubId: 'a', prefixes: ['10.1.0.0/16'] })
    const before = selected(t).map((r) => r.key)
    t.connections[1].outbound = [{ id: 'map', prefixes: ['10.1.0.0/16'], match: 'equals', prepend: [64496, 64496] }]
    const result = simulate(t)
    expect(selected(t).map((r) => r.key)).toEqual(before)
    expect(result.outbound.vpn.find((r) => r.prefix === '10.1.0.0/16')!.asPath).toEqual([64496, 64496, 65515])
  })
  const mesh = () => {
    const t = topology([hub('a')], [link('vpn', 'a', 'VPN', [65001], '10.10.0.0/16')])
    t.sites[0].asn = 65001
    t.sites.push({ id: 'remote-site', name: 'Remote branch', asn: 65050, prefixes: ['10.80.0.0/16'] },
      { id: 'other-branch', name: 'Other branch', asn: 65051, prefixes: ['10.81.0.0/16'] })
    t.siteLinks.push({ id: 'wan', name: 'WAN', a: t.sites[0].id, b: 'remote-site', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: ['10.80.0.0/16'], prepend: [65050] } })
    t.siteLinks.push({ id: 'branch-wan', name: 'Branch WAN', a: 'remote-site', b: 'other-branch', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } })
    t.connections[0].learnSiteRoutes = true
    return t
  }
  it('propagates only allowed on-premises prefixes with prepends and traces transit', () => {
    const t = mesh()
    const result = simulate(t)
    expect(result.tables.a.some((d) => d.prefix === '10.81.0.0/16')).toBe(false)
    expect(selected(t, 'a', '10.80.0.0/16')[0].asPath).toEqual([65001, 65050, 65050])
    expect(traceFlow(t, result, 'a', '10.80.0.5')[0].siteHops).toEqual(['vpn-site', 'remote-site'])
  })
  it('withdraws mesh routes after a link failure and honors disabled imports', () => {
    const t = mesh()
    t.siteLinks[0].enabled = false
    expect(selected(t, 'a', '10.80.0.0/16')).toHaveLength(0)
    t.siteLinks[0].enabled = true
    t.connections[0].learnSiteRoutes = false
    expect(selected(t, 'a', '10.80.0.0/16')).toHaveLength(0)
  })
  it('retains exact selected parallel link IDs through site, hub and summarized flow routes', () => {
    const t = mesh()
    t.siteLinks.push({
      ...structuredClone(t.siteLinks[0]), id: 'backup-wan',
      bToA: { prefixes: ['10.80.0.0/16'], prepend: [65050, 65050] },
    })
    const result = propagateSites(t)
    const candidates = result.candidates['vpn-site'].filter((route) => route.prefix === '10.80.0.0/16')
    expect(candidates.map((route) => route.asPath)).toEqual([[65050, 65050], [65050, 65050, 65050]])
    expect(candidates.map((route) => route.siteLinkIds)).toEqual([['wan'], ['backup-wan']])
    expect(result.tables['vpn-site'].filter((route) => route.prefix === '10.80.0.0/16')).toEqual([candidates[0]])
    expect(result.candidates['vpn-site'].some((route) => route.prefix === '10.81.0.0/16')).toBe(false)
    expect(result.tables['remote-site'].filter((route) => route.sitePath.length === 1).every((route) => route.siteLinkIds?.length === 0)).toBe(true)
    expect(selected(t, 'a', '10.80.0.0/16')[0].siteLinkIds).toEqual(['wan'])
    expect(traceFlow(t, simulate(t), 'a', '10.80.0.5')[0].siteLinkIds).toEqual(['wan'])
    t.routeMaps = [{ id: 'summary-map', name: 'Summary', hubId: 'a', rules: [{
      id: 'summary-rule', prefixes: ['10.80.0.0/16'], match: 'equals', action: 'summarize',
      summaryPrefixes: ['10.0.0.0/8'], prepend: [], nextStep: 'terminate',
    }] }]
    t.connections[0].inboundMapId = 'summary-map'
    expect(selected(t, 'a', '10.0.0.0/8')[0].forwardingRoutes![0].siteLinkIds).toEqual(['wan'])
    expect(traceFlow(t, simulate(t), 'a', '10.80.0.5')[0].siteLinkIds).toEqual(['wan'])
    t.siteLinks[0].enabled = false
    const withdrawn = propagateSites(t)
    expect(withdrawn.candidates['vpn-site'].filter((route) => route.prefix === '10.80.0.0/16')).toEqual([candidates[1]])
    expect(withdrawn.tables['vpn-site'].filter((route) => route.prefix === '10.80.0.0/16')).toEqual([candidates[1]])
    expect(traceFlow(t, simulate(t), 'a', '10.80.0.5')[0].siteLinkIds).toEqual(['backup-wan'])
  })
  it('does not advertise a route into an AS already present in its path', () => {
    const t = mesh()
    t.siteLinks[0].bToA.prepend = [65001]
    const siteResult = propagateSites(t)
    // Importer loop prevention must also inspect policy-modified paths.
    expect(siteResult.tables['vpn-site'].some((r) => r.prefix === '10.80.0.0/16' && r.asPath.includes(65001))).toBe(false)
  })
})

describe('topology and input validation', () => {
  it('accepts zero or one site prefix and multiple connection routes, but rejects multiple originated prefixes without mutating input', () => {
    const topology = structuredClone(example)
    topology.sites[0].prefixes = ['10.90.0.0/16']
    expect(validateTopology(topology).sites[0].prefixes).toEqual(['10.90.0.0/16'])
    expect(validateTopology(topology).connections[0].routes).toHaveLength(2)
    topology.sites[0].prefixes.push('10.91.0.0/16')
    expect(() => validateTopology(topology)).toThrow('only one originated prefix')
    expect(topology.sites[0].prefixes).toEqual(['10.90.0.0/16', '10.91.0.0/16'])
    topology.sites[0].prefixes = []
    expect(validateTopology(topology).sites[0].prefixes).toEqual([])
  })
  it('round-trips the example through the versioned schema', () => {
    expect(validateTopology(JSON.parse(JSON.stringify(example)))).toEqual({ ...example, routeMaps: [] })
    expect(simulate(example)).toEqual(simulate(validateTopology(example)))
  })
  it.each(['10.0.0.1/24', '256.0.0.0/8', '10.0.0.0/33', '10.0.0.0/-1', '010.0.0.0/8'])('rejects invalid network prefix %s', (value) => {
    expect(cidr(value)).toBeUndefined()
  })
  it('handles /0, /32 and unsigned IPv4 boundaries', () => {
    expect(contains('0.0.0.0/0', ipv4('255.255.255.255')!)).toBe(true)
    expect(contains('255.255.255.255/32', ipv4('255.255.255.254')!)).toBe(false)
    expect(cidr('255.255.255.255/32')).toEqual({ network: 4294967295, length: 32 })
  })
  it('rejects dangling references and duplicate identifiers', () => {
    const t = structuredClone(example)
    t.connections[0].hubId = 'missing'
    expect(() => validateTopology(t)).toThrow('missing hub')
    t.connections[0].hubId = t.hubs[0].id
    t.sites[0].id = t.hubs[0].id
    expect(() => validateTopology(t)).toThrow('Duplicate ID')
  })
  it('rejects private and reserved Azure route-map ASNs and maps on SD-WAN', () => {
    const t = structuredClone(example)
    t.connections[0].inbound = [{ id: 'map', prefixes: [], match: 'equals', prepend: [65001] }]
    expect(() => validateTopology(t)).toThrow('public 2-byte')
    t.connections[0].inbound[0].prepend = [12076]
    expect(() => validateTopology(t)).toThrow('public 2-byte')
    t.connections[0].inbound[0].prepend = [64496]
    expect(() => validateTopology(t)).not.toThrow()
    t.connections[0].transport = 'SDWAN'
    expect(() => validateTopology(t)).toThrow('not supported')
  })
  it('rejects invalid AS paths and non-VPN static routes', () => {
    expect(() => parseAsPath('65001 evil')).toThrow()
    expect(parseAsPath('65001 65001,4200000000')).toEqual([65001, 65001, 4200000000])
    const t = structuredClone(example)
    t.connections[0].routes[0].kind = 'vpn-static'
    t.connections[0].routes[0].asPath = []
    expect(() => validateTopology(t)).toThrow('only on VPN')
  })
})
