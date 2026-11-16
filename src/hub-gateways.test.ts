import { expect, it } from 'vitest'
import { azHubFirewallTopology, hubFirewallTopology } from '../tests/fixtures/hub-firewall'
import { azHubGatewayConnections, hubGatewayConnections } from './hub-gateways'

it('derives native VPN and both ER attachment forms without counting unrelated hubs, site attachments or NVAs', () => {
  const topology = hubFirewallTopology()
  topology.connections[1].enabled = false
  topology.connections.push(
    { ...topology.connections[0], id: 'direct-er', transport: 'ExpressRoute' },
    { ...topology.connections[0], id: 'nva', transport: 'SpokeNVA' },
    { ...topology.connections[0], id: 'other', hubId: 'other' },
  )
  topology.erLinks = [
    { id: 'hub-er', name: 'Hub ER', locationId: 'er', hubId: 'hub-local', enabled: false, learnSiteRoutes: true },
    { id: 'site-er', name: 'Site ER', locationId: 'er', siteId: 'branch-a', enabled: true, learnSiteRoutes: true },
  ]
  const before = structuredClone(topology)
  expect(hubGatewayConnections(topology, 'hub-local').map(({ id, transport, enabled }) => ({ id, transport, enabled }))).toEqual([
    { id: 'vpn-branch-a', transport: 'VPN', enabled: true },
    { id: 'vpn-branch-b', transport: 'VPN', enabled: false },
    { id: 'direct-er', transport: 'ExpressRoute', enabled: true },
    { id: 'hub-er', transport: 'ExpressRoute', enabled: false },
  ])
  expect(hubGatewayConnections(topology, 'missing')).toEqual([])
  expect(topology).toEqual(before)
})

it('derives mixed hub capability from target kind as well as ID, excludes SD-WAN, and retains disabled connections', () => {
  const topology = azHubFirewallTopology()
  topology.vpnConnections[1].enabled = false
  topology.vpnConnections.push(
    { ...topology.vpnConnections[0], id: 'vnet', targetKind: 'vnet-gateway' },
    { ...topology.vpnConnections[0], id: 'other', targetId: 'other' },
    { ...topology.vpnConnections[0], id: 'sdwan', transport: 'SDWAN' },
  )
  topology.erLinks = [
    { id: 'hub-er', name: 'Hub ER', locationId: 'er', targetKind: 'vwan-hub', targetId: 'hub-local', enabled: false },
    { id: 'site-er', name: 'Site ER', locationId: 'er', targetKind: 'site', targetId: 'hub-local', enabled: true },
  ]
  expect(azHubGatewayConnections(topology, 'hub-local').map(({ id, enabled }) => ({ id, enabled }))).toEqual([
    { id: 'vpn-branch-a', enabled: true }, { id: 'vpn-branch-b', enabled: false }, { id: 'hub-er', enabled: false },
  ])
  expect(azHubGatewayConnections(topology, 'missing')).toEqual([])
})
