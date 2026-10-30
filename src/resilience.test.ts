import { describe, expect, it } from 'vitest'
import type { Topology } from './model'
import { singleLinkIsolation } from './resilience'

function fixture(): Topology {
  return {
    version: 1, name: 'Link isolation',
    hubs: [{ id: 'h', name: 'Hub', region: '', preference: 'ASPath', routingIntent: { private: false, internet: false, privatePrefixes: [] } }],
    spokes: [{ id: 'v', name: 'Spoke', hubId: 'h', prefixes: ['10.1.0.0/24'] }],
    sites: ['a', 'b', 'already-isolated'].map((id, i) => ({ id, name: id, asn: 65001 + i, prefixes: [] })),
    connections: [{ id: 'vpn', name: 'VPN', hubId: 'h', siteId: 'a', transport: 'VPN', enabled: true, routes: [], learnSiteRoutes: true, inbound: [], outbound: [] }],
    siteLinks: [{ id: 'wan', name: 'WAN', a: 'a', b: 'b', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }],
  }
}
describe('structural single-link isolation', () => {
  it('identifies separated groups without attributing already isolated nodes to a failure', () => {
    const topology = fixture(), original = JSON.stringify(topology)
    const risks = singleLinkIsolation(topology)
    expect(risks.map((risk) => risk.linkId).sort()).toEqual(['v', 'vpn', 'wan'])
    expect(risks.find((risk) => risk.linkId === 'vpn')?.groups.map((group) => group.map((node) => node.id))).toEqual([['h', 'v'], ['a', 'b']])
    expect(risks.flatMap((risk) => risk.groups.flat()).some((node) => node.id === 'already-isolated')).toBe(false)
    expect(JSON.stringify(topology)).toBe(original)
  })
  it('handles parallel links, disabled backups and cycles rather than treating every attachment as a bridge', () => {
    const topology = fixture()
    topology.connections.push({ ...topology.connections[0], id: 'backup' })
    expect(singleLinkIsolation(topology).map((risk) => risk.linkId).sort()).toEqual(['v', 'wan'])
    topology.connections[1].enabled = false
    expect(singleLinkIsolation(topology).some((risk) => risk.linkId === 'vpn')).toBe(true)
    topology.connections[1] = { ...topology.connections[0], id: 'other-site', siteId: 'b' }
    expect(singleLinkIsolation(topology).map((risk) => risk.linkId)).toEqual(['v'])
  })
  it('checks individual ER legs and implicit inter-hub links', () => {
    const topology = fixture()
    topology.connections = []; topology.siteLinks = []; topology.spokes = []
    topology.hubs.push({ ...topology.hubs[0], id: 'h2', name: 'Second hub' })
    topology.erLocations = [{ id: 'er', name: 'Peering location' }]
    topology.erLinks = [
      { id: 'hub-leg', name: 'Hub circuit', locationId: 'er', hubId: 'h', enabled: true, routes: [], learnSiteRoutes: false },
      { id: 'site-leg', name: 'Site circuit', locationId: 'er', siteId: 'a', enabled: true, routes: [], learnSiteRoutes: true },
    ]
    expect(singleLinkIsolation(topology).map((risk) => risk.linkId).sort()).toEqual(['hub-leg', 'interhub:h:h2', 'site-leg'])
    topology.hubs.push({ ...topology.hubs[0], id: 'h3', name: 'Third hub' })
    expect(singleLinkIsolation(topology).map((risk) => risk.linkId).sort()).toEqual(['hub-leg', 'site-leg'])
  })
})
