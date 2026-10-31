import { describe, expect, it } from 'vitest'
import { example } from './model'
import type { Connection, Hub, Topology, Transport } from './model'
import { simulate, traceFlow } from './routing'
import { applyRouteMap, propagateSites } from './bgp'
import { cidr, contains, ipv4, parseAsPath, validateTopology } from './validation'
import { nodePrefixes, traceNodePath } from './paths'
import { analyzeRouting } from './diagnostics'
import { neighborRoutes } from './route-views'

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

describe('spoke NVA BGP peering', () => {
  const network = (): Topology => ({
    version: 1, name: 'Spoke NVA network', hubs: [hub('a', 'ASPath'), hub('b', 'ASPath')],
    spokes: [
      { id: 'host', name: 'NVA VNet', hubId: 'a', prefixes: ['10.200.0.0/16'] },
      { id: 'workload', name: 'Remote workload', hubId: 'b', prefixes: ['10.201.0.0/16'] },
    ],
    sites: [
      { id: 'nva', name: 'Spoke appliance', asn: 65001, prefixes: [] },
      { id: 'branch', name: 'Downstream branch', asn: 65002, prefixes: ['10.80.0.0/16'] },
    ],
    connections: [{
      id: 'peer', name: 'NVA peering', hubId: 'a', siteId: 'nva', transport: 'SpokeNVA',
      spokeId: 'host', peerIp: '10.200.0.4', enabled: true, routes: [], learnSiteRoutes: true, inbound: [], outbound: [],
    }],
    siteLinks: [{ id: 'downstream', name: 'NVA to branch', a: 'nva', b: 'branch', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }],
  })

  it('imports a distinct NVA origin and traces both directions through its hosting spoke and downstream router', () => {
    const t = validateTopology(network()), simulation = simulate(t)
    expect(selected(t, 'a', '10.80.0.0/16')[0]).toMatchObject({ transport: 'SpokeNVA', nvaSpokeId: 'host', asPath: [65001, 65002] })
    expect(selected(t, 'b', '10.80.0.0/16')[0].asPath).toEqual([65520, 65520, 65001, 65002])
    expect(traceNodePath(t, simulation, { kind: 'spoke', id: 'workload' }, '10.80.0.1')[0]).toMatchObject({
      hubs: ['b', 'a'], nvaSpokeId: 'host', siteHops: ['nva', 'branch'], siteId: 'branch', status: 'delivered',
    })
    expect(traceNodePath(t, simulation, { kind: 'site', id: 'branch' }, '10.201.0.1')[0]).toMatchObject({
      hubs: ['a', 'b'], sourceNvaSpokeId: 'host', sourceSiteHops: ['branch', 'nva'], siteId: 'workload', status: 'delivered',
    })
    expect(neighborRoutes(t, simulation, { kind: 'hub', id: 'a' }, 'learned').find((peer) => peer.id === 'peer')!.after)
      .toEqual(expect.arrayContaining([expect.objectContaining({ prefix: '10.80.0.0/16', transport: 'SpokeNVA' })]))
    const report = analyzeRouting(t, { version: 1, intents: [], failureAnalysis: false }, { automatic: true })
    expect(report.complete).toBe(true)
    expect(report.findings.filter((finding) => ['wrong-exit', 'asymmetric', 'network-unreachable', 'network-return', 'unknown'].includes(finding.rule))).toEqual([])
  })

  it('preserves native JSON and rejects invalid attachment, reserved ASN, duplicate peers and peer AS paths', () => {
    const t = network()
    expect(validateTopology(JSON.parse(JSON.stringify(validateTopology(t))))).toEqual(validateTopology(t))
    for (const asn of [8074, 8075, 12076, 23456, 64496, 64511, 65515, 65517, 65520, 65535, 65536]) {
      const invalid = network(); invalid.sites[0].asn = asn
      expect(() => validateTopology(invalid)).toThrow(/2-byte ASN|non-Azure site ASN/)
    }
    for (const changes of [{ hubId: 'b' }, { spokeId: 'missing' }, { peerIp: '10.202.0.4' }]) {
      const invalid = network(); Object.assign(invalid.connections[0], changes)
      expect(() => validateTopology(invalid)).toThrow(/hosting spoke|hosting spoke address space/)
    }
    for (const path of [[65002], [65001, 65515]]) {
      const invalid = network(); invalid.connections[0].routes = [{ id: 'advertisement', prefix: '10.81.0.0/16', kind: 'bgp', asPath: path }]
      expect(() => validateTopology(invalid)).toThrow(/NVA ASN/)
    }
    const duplicate = network(); duplicate.connections.push({ ...duplicate.connections[0], id: 'second-peer' })
    expect(() => validateTopology(duplicate)).toThrow(/unique within a hub/)
    const tooMany = network()
    tooMany.connections = Array.from({ length: 9 }, (_, index) => ({ ...tooMany.connections[0], id: `peer-${index}`, peerIp: `10.200.0.${index + 4}` }))
    expect(() => validateTopology(tooMany)).toThrow(/at most 8/)
  })

  it('keeps directly attached VNet ranges as system routes, rejects reflected own-AS routes and withdraws a disabled peer', () => {
    const t = network()
    t.connections[0].routes = [{ id: 'more-specific', prefix: '10.200.1.0/24', asPath: [65001], kind: 'bgp' }]
    expect(selected(t, 'a', '10.200.0.0/16')[0].transport).toBe('VNet')
    expect(selected(t, 'a', '10.200.1.0/24')).toEqual([])
    t.siteLinks[0].bToA.prepend = [65515]
    expect(selected(t, 'a', '10.80.0.0/16')).toEqual([])
    t.siteLinks[0].bToA.prepend = []
    t.connections[0].enabled = false
    expect(selected(t, 'a', '10.80.0.0/16')).toEqual([])
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'branch' }, '10.201.0.1')[0].status).toBe('unreachable')
  })

  it('applies shared hosting-VNet maps to system and NVA routes, not integrated SD-WAN restrictions, including return filtering', () => {
    const t = network()
    t.routeMaps = [{ id: 'filter', name: 'Filter branch', hubId: 'a', rules: [{ id: 'drop', prefixes: ['10.80.0.0/16'], match: 'equals',
      action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] }]
    t.hubs[0].routeMapAssignments = [{ connectionId: 'host', inboundMapId: 'filter' }]
    const simulation = simulate(validateTopology(t))
    expect(selected(t, 'a', '10.80.0.0/16')).toEqual([])
    expect(neighborRoutes(t, simulation, { kind: 'hub', id: 'a' }, 'learned').find((peer) => peer.id === 'peer')!.before).toHaveLength(1)
    expect(neighborRoutes(t, simulation, { kind: 'hub', id: 'a' }, 'learned').find((peer) => peer.id === 'peer')!.after).toEqual([])
    t.routeMaps[0].rules[0].prefixes = ['10.201.0.0/16']
    t.hubs[0].routeMapAssignments = [{ connectionId: 'host', outboundMapId: 'filter' }]
    expect(traceNodePath(t, simulate(validateTopology(t)), { kind: 'site', id: 'branch' }, '10.201.0.1')[0].status).toBe('unreachable')
    t.hubs[0].routeMapAssignments = [{ connectionId: 'peer', inboundMapId: 'filter' }]
    expect(() => validateTopology(t)).toThrow(/hosting VNet connection/)
  })

  it('keeps NVA selection separate from VPN preference and applies private routing intent on both hubs', () => {
    for (const preference of ['ExpressRoute', 'VPN', 'ASPath'] as const) {
      const t = network()
      t.hubs[0].preference = preference
      const vpn = link('vpn', 'a', 'VPN', [65003, 65003, 65003], '10.80.0.0/16')
      t.connections.push(vpn); t.sites.push({ id: vpn.siteId, name: 'VPN backup', asn: 65003, prefixes: [] })
      expect(selected(t, 'a', '10.80.0.0/16')[0].transport).toBe('SpokeNVA')
      t.hubs.forEach((hub) => { hub.routingIntent.private = true })
      expect(traceNodePath(t, simulate(t), { kind: 'spoke', id: 'workload' }, '10.80.0.1')[0]).toMatchObject({
        status: 'delivered', firewalls: ['b', 'a'], nvaSpokeId: 'host', siteId: 'branch',
      })
    }
  })

  it('uses known downstream contributions for explicit aggregates and stops in aggregate holes without inventing ownership', () => {
    const t = network()
    t.connections[0].learnSiteRoutes = false
    t.connections[0].routes = [{ id: 'aggregate', prefix: '10.80.0.0/15', asPath: [65001, 65002], kind: 'bgp' }]
    const simulation = simulate(validateTopology(t))
    expect(traceFlow(t, simulation, 'b', '10.80.0.1')[0]).toMatchObject({ status: 'delivered', siteId: 'branch', nvaSpokeId: 'host' })
    expect(traceFlow(t, simulation, 'b', '10.81.0.1')[0]).toMatchObject({ status: 'unreachable', termination: 'summary-hole', hubs: ['b', 'a'] })
    expect(t.sites[0].prefixes).toEqual([])
  })
})

describe('ExpressRoute locations and private-peering attachments', () => {
  const network = (): Topology => ({
    ...topology([hub('a'), hub('b')], [link('vpn', 'b', 'VPN', [65001], '10.30.0.0/16')]),
    sites: [
      { id: 'er-site-a', name: 'ER site A', asn: 65010, prefixes: ['10.20.0.0/16'] },
      { id: 'er-site-b', name: 'ER site B', asn: 65020, prefixes: ['10.21.0.0/16'] },
      { id: 'vpn-site', name: 'VPN site', asn: 65001, prefixes: [] },
    ],
    spokes: [{ id: 'spoke-a', name: 'Spoke A', hubId: 'a', prefixes: ['10.1.0.0/16'] }, { id: 'spoke-b', name: 'Spoke B', hubId: 'b', prefixes: ['10.2.0.0/16'] }],
    erLocations: [{ id: 'london', name: 'London' }, { id: 'paris', name: 'Paris' }],
    erLinks: [
      { id: 'hub-a-er', name: 'Hub A ER', locationId: 'london', hubId: 'a', enabled: true, routes: [], learnSiteRoutes: false },
      { id: 'site-a-er', name: 'Site A ER', locationId: 'london', siteId: 'er-site-a', enabled: true, routes: [], learnSiteRoutes: true },
      { id: 'hub-b-er', name: 'Hub B ER', locationId: 'paris', hubId: 'b', enabled: true, routes: [], learnSiteRoutes: false },
      { id: 'site-b-er', name: 'Site B ER', locationId: 'paris', siteId: 'er-site-b', enabled: true, routes: [], learnSiteRoutes: true },
    ],
  })

  it('imports site routes with provider ASN and traces both physical ER segments in either direction', () => {
    const t = validateTopology(network()), simulation = simulate(t)
    expect(selected(t)[0]).toMatchObject({ transport: 'ExpressRoute', asPath: [12076, 65010], erLocationId: 'london' })
    expect(traceFlow(t, simulation, 'b', '10.20.0.1')[0]).toMatchObject({ hubs: ['b', 'a'], erLinkIds: ['hub-a-er', 'site-a-er'], status: 'delivered' })
    expect(traceNodePath(t, simulation, { kind: 'site', id: 'er-site-a' }, '10.2.0.1')[0]).toMatchObject({ sourceErLinkIds: ['site-a-er', 'hub-a-er'], hubs: ['a', 'b'], status: 'delivered' })
    expect(validateTopology(JSON.parse(JSON.stringify(t)))).toEqual(t)
  })

  it('exports local/remote VNet and VPN routes but no local/remote ER-learned routes', () => {
    const t = network(), simulation = simulate(t)
    expect(simulation.outbound['site-a-er'].map((route) => route.prefix).sort()).toEqual(['10.1.0.0/16', '10.2.0.0/16', '10.30.0.0/16'])
    expect(simulation.outbound['site-b-er'].some((route) => route.transport === 'ExpressRoute')).toBe(false)
    expect(traceNodePath(t, simulation, { kind: 'site', id: 'er-site-a' }, '10.21.0.1')[0].status).toBe('unreachable')
    t.erLinks![2].locationId = 'london'
    t.erLinks![3].locationId = 'london'
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'er-site-a' }, '10.21.0.1')[0].status).toBe('unreachable')
  })

  it('removes both private-AS ranges from ER customer exports without changing hub inputs or VPN exports', () => {
    const t = network()
    const path = [64512, 64511, 65534, 65536, 4200000000, 4199999999, 4294967294]
    t.connections[0].routes[0].asPath = path
    const simulation = simulate(t)
    for (const id of ['hub-a-er', 'site-a-er', 'hub-b-er', 'site-b-er']) {
      expect(simulation.outbound[id].find((route) => route.prefix === '10.30.0.0/16')!.asPath)
        .toEqual([12076, 64511, 65536, 4199999999])
    }
    expect(selected(t, 'b', '10.30.0.0/16')[0].asPath).toEqual(path)
    expect(simulation.outbound.vpn.find((route) => route.prefix === '10.1.0.0/16')!.asPath)
      .toEqual([65515, 65520, 65520])
  })

  it('retains public outbound route-map prepends ahead of the stripped VPN path', () => {
    const t = network()
    t.routeMaps = [{ id: 'prepend', name: 'Prepend', hubId: 'a', rules: [{
      id: 'prepend-rule', prefixes: ['10.30.0.0/16'], match: 'equals', action: 'prepend',
      summaryPrefixes: [], prepend: [64496, 64496], nextStep: 'terminate',
    }] }]
    t.hubs[0].routeMapAssignments = [{ connectionId: 'hub-a-er', outboundMapId: 'prepend' }]
    const simulation = simulate(validateTopology(t))
    expect(simulation.outbound['site-a-er'].find((route) => route.prefix === '10.30.0.0/16')!.asPath)
      .toEqual([12076, 64496, 64496])
  })

  it('uses the same post-policy customer export boundary for legacy ER connections', () => {
    const t = topology([hub('a')], [
      link('er', 'a', 'ExpressRoute', [12076, 65001]),
      link('vpn', 'a', 'VPN', [65002], '10.30.0.0/16'),
    ])
    t.connections[0].outbound = [{
      id: 'prepend', prefixes: ['10.30.0.0/16'], match: 'equals', prepend: [64496],
    }]
    const simulation = simulate(t)
    expect(simulation.outbound.er.find((route) => route.prefix === '10.30.0.0/16')!.asPath)
      .toEqual([12076, 64496])
    expect(selected(t, 'a', '10.30.0.0/16')[0].asPath).toEqual([65002])
    expect(simulation.outbound.vpn.find((route) => route.prefix === '10.20.0.0/16')!.asPath)
      .toEqual([65515, 12076, 65001])
  })

  it.each(['site-a-er', 'hub-a-er'])('withdraws routes and forwarding when %s fails', (id) => {
    const t = network()
    t.erLinks!.find((link) => link.id === id)!.enabled = false
    expect(selected(t)).toEqual([])
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'er-site-a' }, '10.1.0.1')[0].status).toBe('unreachable')
  })

  it('honors HRP and endpoint route maps on ER attachments', () => {
    const t = network()
    t.connections[0].hubId = 'a'
    t.connections[0].routes[0].prefix = '10.20.0.0/16'
    expect(selected(t)[0].connectionId).toBe('hub-a-er')
    t.hubs[0].preference = 'VPN'
    expect(selected(t)[0].connectionId).toBe('vpn')
    t.routeMaps = [{ id: 'er-drop', name: 'Drop ER', hubId: 'a', rules: [{ id: 'er-rule', prefixes: [], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] }]
    t.hubs[0].routeMapAssignments = [{ connectionId: 'hub-a-er', inboundMapId: 'er-drop', outboundMapId: 'er-drop' }]
    const simulation = simulate(validateTopology(t))
    expect(simulation.tables.a.find((decision) => decision.prefix === '10.20.0.0/16')!.candidates.every((route) => route.connectionId !== 'hub-a-er')).toBe(true)
    expect(simulation.outbound['site-a-er']).toEqual([])
  })

  it('supports explicit ads without leaking the provider ASN into site advertisements', () => {
    const t = network()
    t.erLinks![1].learnSiteRoutes = false
    t.erLinks![1].routes = [{ id: 'er-ad', prefix: '10.80.0.0/16', asPath: [65010, 65010], kind: 'bgp' }]
    expect(selected(validateTopology(t), 'a', '10.80.0.0/16')[0].asPath).toEqual([12076, 65010, 65010])
    t.erLinks![1].routes[0].asPath.unshift(12076)
    expect(() => validateTopology(t)).toThrow('added automatically')
  })

  it('applies site export and import policies independently without hiding summary holes', () => {
    const t = network()
    t.routeMaps = [
      { id: 'site-filter', name: 'Site export', siteId: 'er-site-a', rules: [{ id: 'site-drop', prefixes: ['10.20.0.0/16'], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] },
      { id: 'hub-summary', name: 'Azure summary', hubId: 'a', rules: [{ id: 'summarize-spoke', prefixes: ['10.1.0.0/16'], match: 'equals', action: 'summarize', summaryPrefixes: ['10.0.0.0/8'], prepend: [], nextStep: 'terminate' }] },
    ]
    t.sites[0].routeMapAssignments = [{ connectionId: 'site-a-er', outboundMapId: 'site-filter' }]
    t.hubs[0].routeMapAssignments = [{ connectionId: 'hub-a-er', outboundMapId: 'hub-summary' }]
    const simulation = simulate(validateTopology(t))
    expect(simulation.tables.a.some((decision) => decision.prefix === '10.20.0.0/16')).toBe(false)
    expect(traceNodePath(t, simulation, { kind: 'site', id: 'er-site-a' }, '10.1.0.1')[0]).toMatchObject({ status: 'delivered', sourceErLinkIds: ['site-a-er', 'hub-a-er'] })
    expect(traceNodePath(t, simulation, { kind: 'site', id: 'er-site-a' }, '10.99.0.1')[0].status).toBe('unreachable')
    t.sites[0].routeMapAssignments[0].inboundMapId = 'site-filter'
    t.routeMaps[0].rules[0].prefixes = []
    expect(traceNodePath(t, simulate(validateTopology(t)), { kind: 'site', id: 'er-site-a' }, '10.1.0.1')[0].status).toBe('unreachable')
  })

  it('retains the existing static-VPN policy bypass when advertising VPN destinations to ER', () => {
    const t = network()
    t.sites[2].vpnStaticRoutes = [{ id: 'er-vpn-static', prefix: '10.31.0.0/16', connectionId: 'vpn' }]
    t.routeMaps = [{ id: 'er-static-filter', name: 'Drop BGP', hubId: 'b', rules: [{ id: 'er-static-drop', prefixes: [], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] }]
    t.hubs[1].routeMapAssignments = [{ connectionId: 'hub-b-er', outboundMapId: 'er-static-filter' }]
    const simulation = simulate(validateTopology(t))
    expect(simulation.outbound['site-b-er'].map((route) => route.prefix)).toEqual(['10.31.0.0/16'])
    expect(traceNodePath(t, simulation, { kind: 'site', id: 'er-site-b' }, '10.31.0.1')[0]).toMatchObject({ status: 'delivered', connectionId: 'vpn' })
  })

  it('rejects dangling, ambiguous and duplicate ER resources without accepting statics', () => {
    for (const mutate of [
      (t: Topology) => { t.erLinks![0].locationId = 'missing' },
      (t: Topology) => { t.erLinks![0].siteId = 'er-site-a' },
      (t: Topology) => { t.erLinks![0].hubId = 'missing' },
      (t: Topology) => { t.erLocations![0].id = 'a' },
      (t: Topology) => { t.erLinks![1].routes = [{ id: 'invalid-static', prefix: '10.80.0.0/16', asPath: [], kind: 'vpn-static' }] },
    ]) {
      const t = network(); mutate(t)
      expect(() => validateTopology(t)).toThrow()
    }
  })
})

describe('site-owned VPN static prefixes', () => {
  it('migrates connection static entries without changing IDs, paths or round-trip behavior', () => {
    const t = structuredClone(example)
    t.connections[1].routes = [
      { id: 'legacy-static-a', prefix: '10.90.0.0/16', kind: 'vpn-static', asPath: [] },
      { id: 'legacy-static-b', prefix: '10.91.0.0/16', kind: 'vpn-static', asPath: [] },
    ]
    const normalized = validateTopology(t)
    expect(normalized.connections[1].routes).toEqual([])
    expect(normalized.sites[0].vpnStaticRoutes).toEqual([
      { id: 'legacy-static-a', prefix: '10.90.0.0/16', connectionId: 'vpn-eu' },
      { id: 'legacy-static-b', prefix: '10.91.0.0/16', connectionId: 'vpn-eu' },
    ])
    expect(validateTopology(JSON.parse(JSON.stringify(normalized)))).toEqual(normalized)
    expect(traceFlow(normalized, simulate(normalized), 'eu', '10.90.0.1')).toEqual(traceFlow(t, simulate(t), 'eu', '10.90.0.1'))
    expect(nodePrefixes(normalized, { kind: 'site', id: 'dc' })).toContain('10.91.0.0/16')
  })

  it('imports site static prefixes only on their associated VPN and withdraws them on failure', () => {
    const t = structuredClone(example)
    t.sites[0].vpnStaticRoutes = [{ id: 'site-static', prefix: '10.80.0.0/16', connectionId: 'vpn-eu' }]
    t.routeMaps = [{ id: 'drop-static-test', name: 'Drop BGP', siteId: 'dc', rules: [
      { id: 'drop-bgp', prefixes: [], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' },
    ] }]
    t.sites[0].routeMapAssignments = [{ connectionId: 'vpn-eu', outboundMapId: 'drop-static-test' }]
    const normalized = validateTopology(t)
    const result = simulate(normalized)
    expect(result.tables.eu.find((d) => d.prefix === '10.80.0.0/16')!.selected).toMatchObject([
      { kind: 'vpn-static', connectionId: 'vpn-eu', asPath: [], siteId: 'dc' },
    ])
    expect(traceFlow(normalized, result, 'us', '10.80.0.1')[0]).toMatchObject({ status: 'delivered', connectionId: 'vpn-eu' })
    normalized.connections[1].enabled = false
    expect(traceFlow(normalized, simulate(normalized), 'eu', '10.80.0.1')[0].status).toBe('unreachable')
  })

  it('rejects invalid networks, duplicate IDs and missing, foreign or non-VPN associations', () => {
    const t = structuredClone(example)
    t.sites[0].vpnStaticRoutes = [{ id: 'site-static', prefix: '10.80.0.0/16', connectionId: 'vpn-eu' }]
    for (const connectionId of ['missing', 'vpn-us', 'er-eu']) {
      t.sites[0].vpnStaticRoutes[0].connectionId = connectionId
      expect(() => validateTopology(t)).toThrow('attached S2S VPN')
    }
    t.sites[0].vpnStaticRoutes[0].connectionId = 'vpn-eu'
    t.sites[0].vpnStaticRoutes[0].prefix = '10.80.0.1/16'
    expect(() => validateTopology(t)).toThrow('Invalid static IPv4')
    t.sites[0].vpnStaticRoutes[0].prefix = '10.80.0.0/16'
    t.sites[0].vpnStaticRoutes[0].id = t.connections[0].routes[0].id
    expect(() => validateTopology(t)).toThrow('Duplicate ID')
  })
})

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
  it.each(['ExpressRoute', 'VPN'] as const)('keeps nominal local preference but warns for the measured four-versus-one origin paths in %s mode', (preference) => {
    const t = topology([hub('a', preference), hub('b')], [link('local', 'a', 'VPN', [65001, 65001, 65001, 65001]), link('remote', 'b', 'VPN', [65002])])
    expect(selected(t)[0].connectionId).toBe('local')
    expect(simulate(t).warnings.join(' ')).toContain('arrival-order')
  })
  it.each(['ExpressRoute', 'VPN'] as const)('compares the two-AS warning threshold before inter-hub prepends in %s mode', (preference) => {
    const t = topology([hub('a', preference), hub('b')], [link('local', 'a', 'VPN', Array(3).fill(65001)), link('remote', 'b', 'VPN', [65002, 65002])])
    for (const length of [2, 3]) {
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
    expect(simulate(t).warnings.join(' ')).not.toContain('arrival-order')
  })
  it.each([[3, 'local'], [4, 'local'], [10, 'remote']] as const)('compares remote ER received length including inter-hub prepends against VPN length %i', (length, expected) => {
    const t = topology([hub('a', 'ASPath'), hub('b', 'ASPath')], [
      link('local', 'a', 'VPN', Array(length).fill(65012)),
      link('remote', 'b', 'ExpressRoute', [12076, 133937]),
    ])
    expect(selected(t)[0].connectionId).toBe(expected)
    if (expected === 'remote') {
      expect(selected(t)[0].asPath).toEqual([65520, 65520, 12076, 133937])
    }
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
  it('uses shortest received paths between remote ER candidates', () => {
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
  it('retains a private-only firewall Internet fallback without installing a hub default', () => {
    const t = topology([hub('a')], [])
    t.hubs[0].routingIntent.private = true
    const result = simulate(t)
    expect(result.firewallTables.a.find((d) => d.prefix === '0.0.0.0/0')?.selected[0].transport).toBe('Internet')
    expect(result.tables.a.some((d) => d.prefix === '0.0.0.0/0')).toBe(false)
    expect(traceFlow(t, result, 'a', '8.8.8.8')[0].status).toBe('unreachable')
    t.hubs[0].routingIntent.privatePrefixes = ['8.8.8.8/32']
    expect(traceFlow(t, simulate(t), 'a', '8.8.8.8')[0]).toMatchObject({ status: 'delivered', firewalls: ['a'] })
  })
  it('preserves a learned private-only firewall default instead of replacing it with Internet egress', () => {
    const t = topology([hub('a')], [link('vpn', 'a', 'VPN', [65001], '0.0.0.0/0')])
    t.hubs[0].routingIntent.private = true
    const result = simulate(t)
    expect(result.firewallTables.a.find((d) => d.prefix === '0.0.0.0/0')?.selected[0].connectionId).toBe('vpn')
    expect(traceFlow(t, result, 'a', '10.90.1.1')[0]).toMatchObject({ status: 'delivered', firewalls: ['a'], connectionId: 'vpn' })
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
  it('continues a static VPN prefix through the selected on-premises links without changing hub selection', () => {
    const t = mesh()
    t.hubs.push(hub('b', 'ASPath'))
    t.connections[0].learnSiteRoutes = false
    t.sites[0].prefixes = ['10.0.0.0/8']
    t.sites[0].vpnStaticRoutes = [{ id: 'static-remote', prefix: '10.80.0.0/16', connectionId: 'vpn' }]
    t.siteLinks.push({ ...structuredClone(t.siteLinks[0]), id: 'backup-wan', bToA: { prefixes: [], prepend: [65050, 65050] } })
    const simulation = simulate(t)
    expect(simulation.tables.a.find((route) => route.prefix === '10.80.0.0/16')!.selected[0])
      .toMatchObject({ kind: 'vpn-static', asPath: [], sitePath: ['vpn-site'], siteLinkIds: [] })
    expect(traceFlow(t, simulation, 'b', '10.80.0.5')).toMatchObject([{
      hubs: ['b', 'a'], connectionId: 'vpn', siteId: 'remote-site',
      siteHops: ['vpn-site', 'remote-site'], siteLinkIds: ['wan'], status: 'delivered',
    }])
    t.siteLinks[2].bToA.prepend = [65050]
    expect(traceFlow(t, simulate(t), 'b', '10.80.0.5').map((path) => path.siteLinkIds)).toEqual([['wan'], ['backup-wan']])
    t.siteLinks[0].enabled = false
    expect(traceFlow(t, simulate(t), 'b', '10.80.0.5')[0].siteLinkIds).toEqual(['backup-wan'])
  })
  it.each(['disconnected', 'filtered'])('keeps gateway statics installed but does not claim delivery to a %s known site', (failure) => {
    const t = mesh()
    t.connections[0].learnSiteRoutes = false
    t.sites[0].vpnStaticRoutes = [{ id: 'static-remote', prefix: '10.80.0.0/16', connectionId: 'vpn' }]
    if (failure === 'disconnected') t.siteLinks[0].enabled = false
    else t.siteLinks[0].bToA.prefixes = ['10.99.0.0/16']
    const simulation = simulate(t)
    expect(simulation.tables.a.find((route) => route.prefix === '10.80.0.0/16')!.selected[0].kind).toBe('vpn-static')
    expect(traceFlow(t, simulation, 'a', '10.80.0.5')[0]).toMatchObject({
      siteId: 'vpn-site', siteLinkIds: [], status: 'unreachable',
    })
  })
  it('resolves on-premises summaries after static VPN egress without delivering into aggregate holes', () => {
    const t = mesh()
    t.connections[0].learnSiteRoutes = false
    t.sites[0].vpnStaticRoutes = [{ id: 'static-summary', prefix: '10.0.0.0/8', connectionId: 'vpn' }]
    t.routeMaps = [{ id: 'site-summary', name: 'Site summary', siteId: 'remote-site', rules: [{
      id: 'summarize', prefixes: ['10.80.0.0/16'], match: 'equals', action: 'summarize',
      summaryPrefixes: ['10.0.0.0/8'], prepend: [], nextStep: 'terminate',
    }] }]
    t.sites[1].routeMapAssignments = [{ connectionId: 'wan', outboundMapId: 'site-summary' }]
    const simulation = simulate(t)
    expect(traceFlow(t, simulation, 'a', '10.80.0.5')[0]).toMatchObject({
      siteHops: ['vpn-site', 'remote-site'], siteLinkIds: ['wan'], status: 'delivered',
    })
    expect(traceFlow(t, simulation, 'a', '10.81.0.5')[0]).toMatchObject({ siteLinkIds: [], status: 'unreachable' })
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
