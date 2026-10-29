import { describe, expect, it } from 'vitest'
import { example } from './model'
import { convertVpnRouting, suggestVpnRoutes, vpnRoutingMode } from './vpn-routing'
import { simulate, traceFlow } from './routing'
import { validateTopology } from './validation'

describe('VPN routing conversions', () => {
  it('seeds only site-side destinations, preserves existing BGP paths and does not invent return routes', () => {
    const topology = structuredClone(example)
    topology.sites[0].prefixes = ['10.90.0.0/16']
    const suggestions = suggestVpnRoutes(topology, topology.connections[1])
    expect(suggestions).toEqual([
      { prefix: '10.20.0.0/16', asPath: [65010, 65010, 65010] },
      { prefix: '10.90.0.0/16', asPath: [65010] },
    ])
    expect(suggestions.some((route) => route.prefix === '10.1.0.0/16')).toBe(false)
    topology.sites[0].prefixes = []
    topology.connections[1].routes = []
    expect(suggestVpnRoutes(topology, topology.connections[1])).toEqual([])
  })

  it('converts only the selected VPN atomically and preserves routing policies, other connections and route IDs', () => {
    const topology = structuredClone(example)
    topology.connections[1].enabled = false
    topology.connections[1].learnSiteRoutes = true
    topology.sites[0].vpnStaticRoutes = [{ id: 'existing-static', prefix: '10.90.0.0/16', connectionId: 'vpn-eu' }]
    topology.sites[1].vpnStaticRoutes = [{ id: 'other-static', prefix: '10.91.0.0/16', connectionId: 'vpn-us' }]
    topology.routeMaps = [{ id: 'preserved-map', name: 'Preserved', siteId: 'dc', rules: [] }]
    topology.sites[0].routeMapAssignments = [{ connectionId: 'vpn-eu', outboundMapId: 'preserved-map' }]
    const original = structuredClone(topology)
    expect(vpnRoutingMode(topology, topology.connections[1])).toBe('mixed')
    const next = convertVpnRouting(topology, 'vpn-eu', 'static', [
      { prefix: '10.20.0.0/16', asPath: [] }, { prefix: '10.90.0.0/16', asPath: [] },
    ])
    expect(topology).toEqual(original)
    expect(next.connections[1]).toEqual({ ...topology.connections[1], routes: [], learnSiteRoutes: false })
    expect(next.sites[0].vpnStaticRoutes).toEqual([
      { id: 'r3', prefix: '10.20.0.0/16', connectionId: 'vpn-eu' },
      { id: 'existing-static', prefix: '10.90.0.0/16', connectionId: 'vpn-eu' },
    ])
    expect(next.sites[0].routeMapAssignments).toEqual(topology.sites[0].routeMapAssignments)
    expect(next.sites[1].vpnStaticRoutes).toEqual(topology.sites[1].vpnStaticRoutes)
    expect(next.routeMaps).toEqual(topology.routeMaps)
    expect(next.connections.filter((connection) => connection.id !== 'vpn-eu')).toEqual(topology.connections.filter((connection) => connection.id !== 'vpn-eu'))
    expect(vpnRoutingMode(next, next.connections[1])).toBe('static')
  })

  it('moves static destinations into configurable BGP advertisements and applies their AS paths to forwarding', () => {
    const topology = convertVpnRouting(structuredClone(example), 'vpn-eu', 'static', [{ prefix: '10.90.0.0/16', asPath: [] }])
    const staticId = topology.sites[0].vpnStaticRoutes![0].id
    expect(traceFlow(topology, simulate(topology), 'us', '10.90.0.1')[0]).toMatchObject({ connectionId: 'vpn-eu', status: 'delivered' })
    expect(suggestVpnRoutes(topology, topology.connections[1])).toEqual([{ prefix: '10.90.0.0/16', asPath: [65010] }])
    const next = convertVpnRouting(topology, 'vpn-eu', 'bgp', [{ prefix: '10.90.0.0/16', asPath: [65010, 65040] }])
    expect(next.sites[0].vpnStaticRoutes).toEqual([])
    expect(next.connections[1].routes).toEqual([{ id: staticId, prefix: '10.90.0.0/16', asPath: [65010, 65040], kind: 'bgp' }])
    expect(simulate(next).tables.eu.find((decision) => decision.prefix === '10.90.0.0/16')!.selected[0]).toMatchObject({ kind: 'bgp', asPath: [65010, 65040] })
    expect(vpnRoutingMode(next, next.connections[1])).toBe('bgp')
    expect(validateTopology(JSON.parse(JSON.stringify(next)))).toEqual(next)
  })

  it('supports learned-only BGP but rejects empty statics, duplicates, malformed routes and non-VPN links', () => {
    const topology = structuredClone(example)
    expect(convertVpnRouting(topology, 'vpn-eu', 'bgp', [], true).connections[1].learnSiteRoutes).toBe(true)
    expect(() => convertVpnRouting(topology, 'er-eu', 'static', [{ prefix: '10.90.0.0/16', asPath: [] }])).toThrow('S2S VPN')
    expect(() => convertVpnRouting(topology, 'missing', 'static', [])).toThrow('S2S VPN')
    expect(() => convertVpnRouting(topology, 'vpn-eu', 'static', [])).toThrow('at least one')
    expect(() => convertVpnRouting(topology, 'vpn-eu', 'static', [{ prefix: '10.90.0.1/16', asPath: [] }])).toThrow('Invalid static IPv4')
    expect(() => convertVpnRouting(topology, 'vpn-eu', 'bgp', [{ prefix: '10.90.0.0/16', asPath: [] }])).toThrow('AS path')
    expect(() => convertVpnRouting(topology, 'vpn-eu', 'static', [{ prefix: '10.90.0.0/16', asPath: [] }, { prefix: '10.90.0.0/16', asPath: [] }])).toThrow('only once')
  })
})
