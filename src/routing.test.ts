import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { example } from './model'
import type { Connection, Hub, RouteMapRule, Topology, Transport } from './model'
import { simulate, traceFlow } from './routing'
import { applyRouteMap, propagateSites } from './bgp'
import { cidr, contains, ipv4, parseAsPath, validateTopology } from './validation'
import { nodePrefixes, traceNodePath } from './paths'
import { analyzeRouting } from './diagnostics'
import { neighborRoutes } from './route-views'

type TestLink = Connection & { testAsPath?: number[]; testPrefix?: string }
const hub = (id: string, preference: Hub['preference'] = 'ExpressRoute'): Hub => ({
  id, name: id, region: 'West Europe', preference, routingIntent: { private: false, internet: false, privatePrefixes: [] },
})
const link = (id: string, hubId: string, transport: Transport, asPath: number[], prefix = '10.20.0.0/16'): TestLink => ({
  id, name: id, hubId, siteId: id + '-site', enabled: true, transport, learnSiteRoutes: asPath.length > 0, inbound: [], outbound: [],
  testAsPath: asPath, testPrefix: prefix,
})
const topology = (hubs: Hub[], connections: TestLink[]): Topology => {
  const routeMaps: NonNullable<Topology['routeMaps']> = []
  const sites = connections.map((c, i) => {
    const rawPath = c.testAsPath ?? [65001 + i]
    const prefix = c.testPrefix ?? '10.20.0.0/16'
    if (rawPath.length === 0) {
      return {
        id: c.siteId,
        name: c.siteId,
        asn: 65001 + i,
        prefixes: [],
        vpnStaticRoutes: [{ id: `${c.id}-static`, prefix, connectionId: c.id }],
      }
    }
    const effective = c.transport === 'ExpressRoute' && rawPath[0] === 12076 ? rawPath.slice(1) : rawPath
    const asn = effective[effective.length - 1]
    const prepend = effective.slice(0, -1)
    if (prepend.length > 0) {
      routeMaps.push({
        id: `${c.id}-out`,
        name: `${c.id}-out`,
        siteId: c.siteId,
        rules: [{ id: `${c.id}-rule`, prefixes: [], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend, nextStep: 'terminate' }],
      })
    }
    return {
      id: c.siteId,
      name: c.siteId,
      asn,
      prefixes: [prefix],
      ...(prepend.length > 0 ? { routeMapAssignments: [{ connectionId: c.id, outboundMapId: `${c.id}-out` }] } : {}),
    }
  })
  const cleanConnections: Connection[] = connections.map((c) => {
    const clone = { ...c }
    delete clone.testAsPath
    delete clone.testPrefix
    return clone
  })
  return {
    version: 1, name: 'Test network', hubs, connections: cleanConnections, spokes: [], siteLinks: [], sites,
    ...(routeMaps.length > 0 ? { routeMaps } : {}),
  }
}
const selected = (t: Topology, hubId = 'a', prefix = '10.20.0.0/16') =>
  simulate(t).firewallTables[hubId].find((d) => d.prefix === prefix)?.selected ?? []

describe('WAN-wide branch-to-branch routing', () => {
  it.each<Transport>(['VPN', 'ExpressRoute', 'SDWAN', 'SpokeNVA'])('gates %s origins locally and across hubs without breaking VNet connectivity', (origin) => {
    for (const receiver of ['VPN', 'ExpressRoute', 'SDWAN', 'SpokeNVA'] as Transport[]) {
      for (const remote of [false, true]) {
        const t = topology([hub('a'), hub('b')], [
          link('origin', 'a', origin, [65001]),
          link('receiver', remote ? 'b' : 'a', receiver, [65002], '10.30.0.0/16'),
        ])
        t.spokes = [{ id: 'workload', name: 'Workload', hubId: 'b', prefixes: ['10.1.0.0/16'] }]
        for (const [index, connection] of t.connections.entries()) {
          if (connection.transport !== 'SpokeNVA') continue
          connection.spokeId = `host-${connection.id}`
          connection.peerIp = `10.200.${index}.4`
          t.spokes.push({ id: connection.spokeId, name: connection.spokeId, hubId: connection.hubId, prefixes: [`10.200.${index}.0/24`] })
        }
        const admitted = validateTopology(t)
        const enabled = simulate(admitted)
        expect(enabled.outbound.receiver.some((r) => r.prefix === '10.20.0.0/16'))
          .toBe(origin !== 'ExpressRoute' || receiver !== 'ExpressRoute')
        expect(simulate({ ...admitted, allowBranchToBranchTraffic: true })).toEqual(enabled)
        const disabled = validateTopology({ ...admitted, allowBranchToBranchTraffic: false })
        expect(validateTopology(JSON.parse(JSON.stringify(disabled)))).toEqual(disabled)
        const result = simulate(disabled)
        expect(result.bgpTables.b.some((d) => d.prefix === '10.20.0.0/16')).toBe(true)
        expect(result.outbound.receiver.some((r) => r.prefix === '10.20.0.0/16')).toBe(false)
        expect(traceNodePath(disabled, result, { kind: 'site', id: 'receiver-site' }, '10.20.0.1')[0].status).toBe('unreachable')
        expect(traceNodePath(disabled, result, { kind: 'site', id: 'receiver-site' }, '10.1.0.1')[0].status).toBe('delivered')
        expect(traceNodePath(disabled, result, { kind: 'spoke', id: 'workload' }, '10.20.0.1')[0].status).toBe('delivered')
        expect(result.outbound.workload.some((r) => r.prefix === '10.20.0.0/16')).toBe(true)
      }
    }
  })

  it('suppresses static VPN and summarized branch origins before outbound policies, not hub learning', () => {
    const t = topology([hub('a')], [
      link('static', 'a', 'VPN', [], '10.40.0.0/16'),
      link('origin', 'a', 'VPN', [65001]),
      link('receiver', 'a', 'VPN', [65002], '10.30.0.0/16'),
    ])
    t.allowBranchToBranchTraffic = false
    t.routeMaps = [{ id: 'summarize', name: 'Inbound summary', hubId: 'a', rules: [{
      id: 'sum', prefixes: ['10.20.0.0/16'], match: 'equals', action: 'summarize',
      summaryPrefixes: ['10.0.0.0/8'], prepend: [], nextStep: 'terminate',
    }] }]
    t.hubs[0].routeMapAssignments = [{ connectionId: 'origin', inboundMapId: 'summarize' }]
    const result = simulate(validateTopology(t))
    expect(result.bgpTables.a.map((d) => d.prefix)).toEqual(expect.arrayContaining(['10.40.0.0/16', '10.0.0.0/8']))
    expect(result.outbound.receiver).toEqual([])
  })

  it('leaves independent on-premises and Global Reach transit available', () => {
    const t = topology([hub('a')], [
      link('origin', 'a', 'VPN', [65001]), link('receiver', 'a', 'VPN', [65002], '10.30.0.0/16'),
    ])
    t.allowBranchToBranchTraffic = false
    t.siteLinks = [{ id: 'wan', name: 'Private WAN', a: 'origin-site', b: 'receiver-site', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }]
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'receiver-site' }, '10.20.0.1')[0])
      .toMatchObject({ status: 'delivered', hubs: [], siteLinkIds: ['wan'] })
    t.siteLinks = []
    t.erLocations = [{ id: 'location', name: 'Frankfurt', globalReachEnabled: true }]
    t.erLinks = t.sites.map((site) => ({ id: `er-${site.id}`, name: site.name, siteId: site.id, locationId: 'location', enabled: true, learnSiteRoutes: true }))
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'receiver-site' }, '10.20.0.1')[0])
      .toMatchObject({ status: 'delivered', hubs: [], sourceErLinkIds: ['er-receiver-site', 'er-origin-site'] })
  })

  it('rejects non-boolean WAN controls instead of reverting silently to enabled', () => {
    for (const value of ['false', 0, null, {}, []]) expect(() => validateTopology({ ...example, allowBranchToBranchTraffic: value })).toThrow(/boolean/)
    expect(validateTopology(example)).not.toHaveProperty('allowBranchToBranchTraffic')
  })
})

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
      spokeId: 'host', peerIp: '10.200.0.4', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [],
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
    const duplicate = network(); duplicate.connections.push({ ...duplicate.connections[0], id: 'second-peer' })
    expect(() => validateTopology(duplicate)).toThrow(/unique within a hub/)
    const tooMany = network()
    tooMany.connections = Array.from({ length: 9 }, (_, index) => ({ ...tooMany.connections[0], id: `peer-${index}`, peerIp: `10.200.0.${index + 4}` }))
    expect(() => validateTopology(tooMany)).toThrow(/at most 8/)
  })

  it('keeps directly attached VNet ranges as system routes, rejects reflected own-AS routes and withdraws a disabled peer', () => {
    const t = network()
    t.sites[0].prefixes = ['10.200.1.0/24']
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
      t.connections.push({
        id: 'vpn', name: 'vpn', hubId: 'a', siteId: 'vpn-site', enabled: true, transport: 'VPN', learnSiteRoutes: true,
        inbound: [{ id: 'vpn-prepend', prefixes: [], match: 'equals', prepend: [64496, 64496] }], outbound: [],
      })
      t.sites.push({ id: 'vpn-site', name: 'VPN backup', asn: 65003, prefixes: ['10.80.0.0/16'] })
      expect(selected(t, 'a', '10.80.0.0/16')[0].transport).toBe('SpokeNVA')
      t.hubs.forEach((hub) => { hub.routingIntent.private = true })
      expect(traceNodePath(t, simulate(t), { kind: 'spoke', id: 'workload' }, '10.80.0.1')[0]).toMatchObject({
        status: 'delivered', firewalls: ['b', 'a'], nvaSpokeId: 'host', siteId: 'branch',
      })
    }
  })

  it('uses known downstream contributions for explicit aggregates and stops in aggregate holes without inventing ownership', () => {
    const t = network()
    t.routeMaps = [{
      id: 'nva-summary', name: 'NVA summary', siteId: 'nva',
      rules: [{ id: 'sum', prefixes: ['10.80.0.0/16'], match: 'equals', action: 'summarize', summaryPrefixes: ['10.80.0.0/15'], prepend: [], nextStep: 'terminate' }],
    }]
    t.sites[0].routeMapAssignments = [{ connectionId: 'peer', outboundMapId: 'nva-summary' }]
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
      { id: 'vpn-site', name: 'VPN site', asn: 65001, prefixes: ['10.30.0.0/16'] },
    ],
    spokes: [{ id: 'spoke-a', name: 'Spoke A', hubId: 'a', prefixes: ['10.1.0.0/16'] }, { id: 'spoke-b', name: 'Spoke B', hubId: 'b', prefixes: ['10.2.0.0/16'] }],
    erLocations: [{ id: 'london', name: 'London' }, { id: 'paris', name: 'Paris' }],
    erLinks: [
      { id: 'hub-a-er', name: 'Hub A ER', locationId: 'london', hubId: 'a', enabled: true, learnSiteRoutes: false },
      { id: 'site-a-er', name: 'Site A ER', locationId: 'london', siteId: 'er-site-a', enabled: true, learnSiteRoutes: true },
      { id: 'hub-b-er', name: 'Hub B ER', locationId: 'paris', hubId: 'b', enabled: true, learnSiteRoutes: false },
      { id: 'site-b-er', name: 'Site B ER', locationId: 'paris', siteId: 'er-site-b', enabled: true, learnSiteRoutes: true },
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
    const prepend = [64512, 64511, 65534, 65536, 4200000000, 4199999999]
    t.sites[2].asn = 4294967294
    t.routeMaps = [{
      id: 'vpn-site-out', name: 'VPN site out', siteId: 'vpn-site',
      rules: [{ id: 'p', prefixes: [], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend, nextStep: 'terminate' }],
    }]
    t.sites[2].routeMapAssignments = [{ connectionId: 'vpn', outboundMapId: 'vpn-site-out' }]
    const path = [...prepend, 4294967294]
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
    t.sites[2].prefixes = ['10.20.0.0/16']
    expect(selected(t)[0].connectionId).toBe('hub-a-er')
    t.hubs[0].preference = 'VPN'
    expect(selected(t)[0].connectionId).toBe('vpn')
    t.routeMaps = [{ id: 'er-drop', name: 'Drop ER', hubId: 'a', rules: [{ id: 'er-rule', prefixes: [], match: 'equals', action: 'drop', summaryPrefixes: [], prepend: [], nextStep: 'terminate' }] }]
    t.hubs[0].routeMapAssignments = [{ connectionId: 'hub-a-er', inboundMapId: 'er-drop', outboundMapId: 'er-drop' }]
    const simulation = simulate(validateTopology(t))
    expect(simulation.tables.a.find((decision) => decision.prefix === '10.20.0.0/16')!.candidates.every((route) => route.connectionId !== 'hub-a-er')).toBe(true)
    expect(simulation.outbound['site-a-er']).toEqual([])
  })

  it('prepends provider ASN automatically on site advertisements over ER attachments', () => {
    const t = network()
    t.routeMaps = [{
      id: 'site-a-prepend', name: 'Site A prepend', siteId: 'er-site-a',
      rules: [{ id: 'p', prefixes: [], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend: [65010], nextStep: 'terminate' }],
    }]
    t.sites[0].routeMapAssignments = [{ connectionId: 'site-a-er', outboundMapId: 'site-a-prepend' }]
    expect(selected(validateTopology(t), 'a', '10.20.0.0/16')[0].asPath).toEqual([12076, 65010, 65010])
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

  it('rejects dangling, ambiguous and duplicate ER resources', () => {
    for (const mutate of [
      (t: Topology) => { t.erLinks![0].locationId = 'missing' },
      (t: Topology) => { t.erLinks![0].siteId = 'er-site-a' },
      (t: Topology) => { t.erLinks![0].hubId = 'missing' },
      (t: Topology) => { t.erLocations![0].id = 'a' },
    ]) {
      const t = network(); mutate(t)
      expect(() => validateTopology(t)).toThrow()
    }
  })

  it('enforces ExpressRoute SKU regional compatibility (#44) and Global Reach branch-to-branch routing (#45)', () => {
    const t = network()
    t.erLocations![0].peeringLocation = 'London'
    t.erLocations![0].sku = 'Local'
    t.hubs[0].region = 'West Europe' // London ER Local only reaches UK South / UK West
    const simLocal = simulate(validateTopology(t))
    expect(simLocal.tables.a.some((d) => d.prefix === '10.20.0.0/16')).toBe(false)
    const diagLocal = analyzeRouting(validateTopology(t), { version: 1, intents: [], failureAnalysis: false }, { automatic: true })
    expect(diagLocal.findings.some((f) => f.rule === 'er-sku-region')).toBe(true)

    t.erLocations![0].sku = 'Standard'
    const simStandard = simulate(validateTopology(t))
    expect(simStandard.tables.a.some((d) => d.prefix === '10.20.0.0/16')).toBe(true)

    t.erLocations![0].globalReachLocationIds = ['paris']
    const validatedGr = validateTopology(t)
    const simGr = simulate(validatedGr)
    expect(traceNodePath(validatedGr, simGr, { kind: 'site', id: 'er-site-a' }, '10.21.0.1')[0]).toMatchObject({
      status: 'delivered',
      siteId: 'er-site-b',
    })
  })
})

describe('site-owned VPN static prefixes', () => {
  it('ignores legacy connection and ER link routes in imported JSON and omits them when validated', () => {
    const raw = JSON.parse(JSON.stringify(example)) as Record<string, unknown>
    const connections = raw.connections as Array<Record<string, unknown>>
    connections[0].routes = [{ id: 'legacy-er-route', prefix: '10.90.0.0/16', kind: 'bgp', asPath: [12076, 65010] }]
    connections[1].routes = [{ id: 'legacy-vpn-static', prefix: '10.91.0.0/16', kind: 'vpn-static', asPath: [] }]
    raw.erLocations = [{ id: 'loc-1', name: 'Location 1' }]
    raw.erLinks = [{
      id: 'er-link-1', name: 'ER Link 1', locationId: 'loc-1', siteId: 'dc', enabled: true, learnSiteRoutes: true,
      routes: [{ id: 'legacy-er-link-route', prefix: '10.92.0.0/16', kind: 'bgp', asPath: [65010] }],
    }]
    const normalized = validateTopology(raw)
    expect('routes' in normalized.connections[0]).toBe(false)
    expect('routes' in normalized.connections[1]).toBe(false)
    expect('routes' in normalized.erLinks![0]).toBe(false)
    expect(JSON.stringify(normalized)).not.toContain('legacy-er-route')
    expect(JSON.stringify(normalized)).not.toContain('legacy-vpn-static')
    expect(JSON.stringify(normalized)).not.toContain('legacy-er-link-route')
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
    t.sites[0].vpnStaticRoutes[0].id = t.connections[0].id
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
    t.connections[1].inbound = [{ id: 'p', prefixes: [], match: 'equals', prepend: [64496] }]
    expect(selected(t)[0].connectionId).toBe('er')
  })
  it.each(['ExpressRoute', 'VPN'] as const)('keeps nominal local preference but warns for the measured four-versus-one origin paths in %s mode', (preference) => {
    const t = topology([hub('a', preference), hub('b')], [link('local', 'a', 'VPN', [65001, 65001, 65001, 65001]), link('remote', 'b', 'VPN', [65002])])
    expect(selected(t)[0].connectionId).toBe('local')
    expect(simulate(t).warnings.join(' ')).toContain('arrival-order')
  })
  it.each(['ExpressRoute', 'VPN'] as const)('compares the two-AS warning threshold before inter-hub prepends in %s mode', (preference) => {
    for (const length of [2, 3]) {
      const t = topology([hub('a', preference), hub('b')], [link('local', 'a', 'VPN', Array(length).fill(65001)), link('remote', 'b', 'VPN', [65002, 65002])])
      expect(simulate(t).warnings.join(' ')).not.toContain('arrival-order')
    }
    const t = topology([hub('a', preference), hub('b')], [link('local', 'a', 'VPN', Array(4).fill(65001)), link('remote', 'b', 'VPN', [65002, 65002])])
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
    const t = topology([hub('a'), hub('b')], [link('vpn', 'a', 'VPN', []), link('er', 'a', 'ExpressRoute', [12076, 65010])])
    t.connections[1].enabled = false
    expect(selected(t, 'b')).toHaveLength(1)
    expect(nodePrefixes(t, { kind: 'site', id: 'vpn-site' })).toContain('10.20.0.0/16')
    t.connections[1].enabled = true
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
  it('models SD-WAN outbound learning and hub eBGP own-AS loop rejection (#19, #20)', () => {
    const sim = simulate(example)
    const sdwanOutbound = sim.outbound['sdwan-eu']
    expect(sdwanOutbound.some((r) => r.prefix === '10.1.0.0/16' && r.asPath[0] === 65515)).toBe(true)
    expect(sdwanOutbound.some((r) => r.prefix === '10.40.0.0/16')).toBe(false)

    const ownAs = structuredClone(example)
    ownAs.routeMaps = [{
      id: 'site-own-as', name: 'Prepend hub ASN', siteId: 'ny',
      rules: [{ id: 'r1', prefixes: ['10.30.0.0/16'], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend: [65515], nextStep: 'terminate' }],
    }, {
      id: 'dc-own-as', name: 'Prepend ER MSEE ASN', siteId: 'dc',
      rules: [{ id: 'r2', prefixes: ['10.20.10.0/24'], match: 'equals', action: 'prepend', summaryPrefixes: [], prepend: [65520], nextStep: 'terminate' }],
    }]
    ownAs.sites.find((s) => s.id === 'ny')!.routeMapAssignments = [{ connectionId: 'vpn-us', outboundMapId: 'site-own-as' }]
    ownAs.sites.find((s) => s.id === 'dc')!.routeMapAssignments = [
      { connectionId: 'er-eu', outboundMapId: 'dc-own-as' },
      { connectionId: 'vpn-eu', outboundMapId: 'dc-own-as' },
    ]
    const ownAsSim = simulate(ownAs)
    expect(ownAsSim.bgpTables['us'].some((d) => d.prefix === '10.30.0.0/16')).toBe(false)
    expect(ownAsSim.bgpTables['eu'].some((d) => d.prefix === '10.20.10.0/24')).toBe(false)
    expect(ownAsSim.bgpTables['eu'].some((d) => d.prefix === '10.20.0.0/16')).toBe(true)
  })
})

describe('recorded net-lab-builder summarization pilot', () => {
  const archive = JSON.parse(readFileSync(resolve('verification', 'issue-98-routemap-archive.json'), 'utf8')) as {
    cases: { id: string; topology: unknown; present: { prefix: string; asPath: number[] }[]; absent: string[] }[]
  }

  it.each(archive.cases)('matches archived VPN-branch prefix and AS-path observations: $id', (entry) => {
    const topology = validateTopology(entry.topology)
    expect(validateTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    const simulation = simulate(topology)
    expect(simulation.converged).toBe(true)
    const received = neighborRoutes(topology, simulation, { kind: 'site', id: 'nva1' }, 'learned')
      .find((peer) => peer.id === 'cx-nva1')!.after
    const advertised = neighborRoutes(topology, simulation, { kind: 'hub', id: 'hub-eu1' }, 'advertised')
      .find((peer) => peer.id === 'cx-nva1')!.after
    for (const routes of [received, advertised]) {
      for (const expected of entry.present) expect(routes).toContainEqual(expect.objectContaining(expected))
      for (const prefix of entry.absent) expect(routes.some((route) => route.prefix === prefix)).toBe(false)
    }
  })

  const extensions = JSON.parse(readFileSync(resolve('verification', 'issue-101-routemap-archive.json'), 'utf8')) as {
    baseCase: string
    cases: { id: string; name: string; allowBranchToBranchTraffic: boolean; rules: RouteMapRule[]; present: { prefix: string; asPath: number[] }[]; absent: string[] }[]
  }
  it.each(extensions.cases)('replays archived B2B/AS-path policy advertisements without losing hub routes: $id', (entry) => {
    const base = validateTopology(archive.cases.find((c) => c.id === extensions.baseCase)!.topology)
    base.name = entry.name
    base.allowBranchToBranchTraffic = entry.allowBranchToBranchTraffic
    base.routeMaps = [{ id: 'archive-policy', name: entry.name, hubId: 'hub-eu1', rules: entry.rules }]
    base.hubs.find((h) => h.id === 'hub-eu1')!.routeMapAssignments = [{ connectionId: 'cx-nva1', outboundMapId: 'archive-policy' }]
    const admitted = validateTopology(base)
    expect(validateTopology(JSON.parse(JSON.stringify(admitted)))).toEqual(admitted)
    const simulation = simulate(admitted)
    expect(simulation.converged).toBe(true)
    for (const kind of ['hub', 'site'] as const) {
      const routes = neighborRoutes(admitted, simulation, { kind, id: kind === 'hub' ? 'hub-eu1' : 'nva1' }, kind === 'hub' ? 'advertised' : 'learned')
        .find((peer) => peer.id === 'cx-nva1')!.after
      for (const present of entry.present) expect(routes).toContainEqual(expect.objectContaining(present))
      for (const absent of entry.absent) expect(routes.some((route) => route.prefix === absent)).toBe(false)
    }
    for (const prefix of ['10.0.1.0/24', '10.0.2.0/24', '10.0.3.0/24']) {
      expect(simulation.bgpTables['hub-eu1'].find((d) => d.prefix === prefix)!.selected[0].asPath).toEqual([12076, 133937])
    }
    if (entry.id !== 'as-path-drop') {
      const summary = simulation.outbound['cx-nva1'].find((r) => r.prefix === '10.0.0.0/16')!
      expect(summary.forwardingRoutes!.map((r) => r.prefix)).toEqual(['10.0.128.0/24'])
    }
  })

  it('also retains hub origination on summarized spoke-NVA exports and policy snapshots', () => {
    const topology = validateTopology(archive.cases.find((entry) => entry.id === 'er-only-summary')!.topology)
    topology.spokes = [{ id: 'nva-host', name: 'NVA host', hubId: 'hub-eu1', prefixes: ['10.100.0.0/24'] }]
    topology.connections[0] = { ...topology.connections[0], transport: 'SpokeNVA', spokeId: 'nva-host', peerIp: '10.100.0.4' }
    topology.hubs[0].routeMapAssignments![0].connectionId = 'nva-host'
    const simulation = simulate(validateTopology(topology))
    for (const routes of [
      simulation.outbound['cx-nva1'], simulation.outbound['nva-host'],
      neighborRoutes(topology, simulation, { kind: 'hub', id: 'hub-eu1' }, 'advertised')
        .find((peer) => peer.id === 'cx-nva1')!.after,
    ]) {
      expect(routes).toContainEqual(expect.objectContaining({ prefix: '10.0.0.0/16', asPath: [65515] }))
      expect(routes.some((route) => ['10.0.1.0/24', '10.0.2.0/24', '10.0.3.0/24'].includes(route.prefix))).toBe(false)
    }
  })
})

describe('topology and input validation', () => {
  it('accepts zero, one, or multiple site prefixes up to 30 and preserves role without mutating input', () => {
    const topology = structuredClone(example)
    topology.sites[0].prefixes = ['10.90.0.0/16']
    expect(validateTopology(topology).sites[0].prefixes).toEqual(['10.90.0.0/16'])
    topology.sites[0].prefixes.push('10.91.0.0/16', '10.90.0.0/16')
    expect(validateTopology(topology).sites[0].prefixes).toEqual(['10.90.0.0/16', '10.91.0.0/16'])
    expect(topology.sites[0].prefixes).toEqual(['10.90.0.0/16', '10.91.0.0/16', '10.90.0.0/16'])
    const siteTables = propagateSites(validateTopology(topology)).tables
    expect(siteTables[topology.sites[0].id].some((r) => r.prefix === '10.91.0.0/16' && r.sitePath.includes(topology.sites[0].id))).toBe(true)
    topology.sites[0].prefixes = []
    expect(validateTopology(topology).sites[0].prefixes).toEqual([])
    topology.sites[0].prefixes = Array.from({ length: 31 }, (_, i) => `10.${i}.0.0/16`)
    expect(() => validateTopology(topology)).toThrow('Site originated prefixes must be an array with at most 30 entries.')
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
    t.sites[0].vpnStaticRoutes = [{ id: 'bad-static', prefix: '10.80.0.0/16', connectionId: 'er-eu' }]
    expect(() => validateTopology(t)).toThrow('attached S2S VPN')
  })
  it('auto-infers SpokeNVA peerIp from the hosting spoke prefix and validates standalone VNets behind NVA spokes', () => {
    const t = structuredClone(example)
    t.sites.push({ id: 'nva-eu', name: 'EU Spoke NVA', asn: 65050, prefixes: [] })
    t.connections.push({
      id: 'nva-peer-eu',
      name: 'EU NVA Peering',
      hubId: 'eu',
      siteId: 'nva-eu',
      spokeId: 'eu-apps',
      transport: 'SpokeNVA',
      enabled: true,
      learnSiteRoutes: true,
      inbound: [],
      outbound: [],
    })
    t.spokes.push({
      id: 'downstream-vnet',
      name: 'Downstream workload VNet',
      prefixes: ['10.150.0.0/16'],
      nvaSpokeIds: ['eu-apps'],
    })
    const validated = validateTopology(t)
    const peer = validated.connections.find((c) => c.id === 'nva-peer-eu')!
    expect(peer.peerIp).toBe('10.1.0.4')
    const downstream = validated.spokes.find((s) => s.id === 'downstream-vnet')!
    expect(downstream.hubId).toBeUndefined()
    expect(downstream.nvaSpokeIds).toEqual(['eu-apps'])
    const sim = simulate(validated)
    const hubRoute = sim.tables.eu.find((d) => d.prefix === '10.150.0.0/16')
    expect(hubRoute?.selected[0]).toMatchObject({
      connectionId: 'nva-peer-eu',
      nvaSpokeId: 'eu-apps',
      siteId: 'nva-eu',
      asPath: [65050],
    })
    const flow = traceFlow(validated, sim, 'eu', '10.150.0.10')
    expect(flow[0]).toMatchObject({
      status: 'delivered',
      hubs: ['eu'],
      connectionId: 'nva-peer-eu',
      nvaSpokeId: 'eu-apps',
      siteId: 'downstream-vnet',
    })
  })
  it('suppresses 0.0.0.0/0 outbound by default and exports it only on attachments with propagateDefaultRoute enabled', () => {
    const t = structuredClone(example)
    t.hubs[0].routingIntent.internet = true
    t.erLocations = [{ id: 'loc-eu', name: 'EU MSEE' }]
    t.erLinks = [
      { id: 'er-hub-eu', name: 'EU Hub ER', locationId: 'loc-eu', hubId: 'eu', enabled: true, learnSiteRoutes: false },
      { id: 'er-site-dc', name: 'DC ER', locationId: 'loc-eu', siteId: 'dc', enabled: true, learnSiteRoutes: true },
    ]
    const defaultSim = simulate(validateTopology(t))
    expect(defaultSim.outbound['er-eu'].some((r) => r.prefix === '0.0.0.0/0')).toBe(false)
    expect(defaultSim.outbound['vpn-eu'].some((r) => r.prefix === '0.0.0.0/0')).toBe(false)
    expect(defaultSim.outbound['eu-apps'].some((r) => r.prefix === '0.0.0.0/0')).toBe(false)
    expect(defaultSim.outbound['er-hub-eu'].some((r) => r.prefix === '0.0.0.0/0')).toBe(false)

    // Enable propagateDefaultRoute on VPN connection, ER connection, spoke, and hub ER link
    t.connections.find((c) => c.id === 'vpn-eu')!.propagateDefaultRoute = true
    t.connections.find((c) => c.id === 'er-eu')!.propagateDefaultRoute = true
    t.spokes.find((s) => s.id === 'eu-apps')!.propagateDefaultRoute = true
    t.erLinks![0].propagateDefaultRoute = true
    const optInSim = simulate(validateTopology(t))
    expect(optInSim.outbound['vpn-eu'].find((r) => r.prefix === '0.0.0.0/0')).toMatchObject({ prefix: '0.0.0.0/0', asPath: [65515] })
    expect(optInSim.outbound['er-eu'].find((r) => r.prefix === '0.0.0.0/0')).toMatchObject({ prefix: '0.0.0.0/0', asPath: [12076] })
    expect(optInSim.outbound['eu-apps'].find((r) => r.prefix === '0.0.0.0/0')).toMatchObject({ prefix: '0.0.0.0/0', asPath: [65515] })
    expect(optInSim.outbound['er-hub-eu'].find((r) => r.prefix === '0.0.0.0/0')).toMatchObject({ prefix: '0.0.0.0/0', asPath: [12076] })

    // Private-only routing intent should not leak synthetic firewall Internet fallback as 0.0.0.0/0
    t.hubs[0].routingIntent.internet = false
    t.hubs[0].routingIntent.private = true
    const privateOnlySim = simulate(validateTopology(t))
    expect(privateOnlySim.outbound['vpn-eu'].some((r) => r.prefix === '0.0.0.0/0')).toBe(false)

    // Rejects propagateDefaultRoute on standalone VNet or site-side ER link
    const badVnet = structuredClone(t)
    badVnet.spokes.push({ id: 'standalone', name: 'Standalone', prefixes: ['10.199.0.0/24'], propagateDefaultRoute: true })
    expect(() => validateTopology(badVnet)).toThrow('Standalone VNets cannot enable hub default-route propagation.')
    const badErLink = structuredClone(t)
    badErLink.erLinks![1].propagateDefaultRoute = true
    expect(() => validateTopology(badErLink)).toThrow('Configure ER default-route propagation on the hub attachment, not the site attachment.')
  })
})
