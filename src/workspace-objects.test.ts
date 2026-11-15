import { describe, expect, it } from 'vitest'
import { example, topologyObject } from './model'
import { createEmptyAzNetTopology } from './azure-net/model'
import {
  azWorkspaceIdentity, azWorkspaceObjects, vwanWorkspaceIdentity, vwanWorkspaceObjects, workspaceIdentityKey,
} from './workspace-objects'

describe('existing workspace object projections', () => {
  it('preserves legacy selections and logical NVA identity without changing VWAN configuration', () => {
    const topology = structuredClone(example)
    topology.connections[0].transport = 'SpokeNVA'
    topology.connections[0].spokeId = topology.spokes[0].id
    const before = JSON.stringify(topology)
    const objects = vwanWorkspaceObjects(topology)
    expect(objects).toHaveLength(topology.hubs.length + topology.spokes.length + topology.sites.length
      + topology.connections.length + topology.siteLinks.length + (topology.erLocations?.length ?? 0) + (topology.erLinks?.length ?? 0))
    for (const object of objects) {
      expect(topologyObject(topology, object.selection)?.name).toBe(object.name)
      expect(object.identity.id).toBe(object.selection.id)
    }
    expect(objects.find((object) => object.selection.kind === 'site' && object.identity.id === topology.connections[0].siteId)?.kindLabel).toBe('Spoke BGP NVA')
    expect(JSON.stringify(topology)).toBe(before)
  })

  it('projects nested disabled devices with their exact owner, not fabricated configuration objects', () => {
    const topology = createEmptyAzNetTopology()
    topology.vnets = [{
      id: 'vnet', name: 'Original name', label: 'Workspace controls', role: 'standalone',
      region: 'westeurope', prefixes: ['10.0.0.0/16'],
      subnets: [{ id: 'subnet', name: 'Work', prefix: '10.0.1.0/24',
        privateEndpoints: [{ id: 'pe', name: 'Endpoint', serviceName: 'Storage', ipAddress: '10.0.1.5' }] }],
      gateways: [
        { id: 'er', name: 'ER', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true },
        { id: 'vpn', name: 'VPN', kind: 'Vpn', asn: 65515, bgpEnabled: true, enabled: false },
      ],
      routeServer: { id: 'ars', name: 'ARS', enabled: false, branchToBranchTraffic: true, hubRoutingPreference: 'ASPath', peerApplianceIds: [] },
      appliances: [{ id: 'nva', name: 'NVA', kind: 'nva-vm', subnetId: 'subnet', privateIp: '10.0.1.4', enableIpForwarding: true, staticRoutes: [] }],
    }]
    topology.udrTables = [{ id: 'table', name: 'Table', routes: [], disableBgpRoutePropagation: false }]
    const before = JSON.stringify(topology)
    const objects = azWorkspaceObjects(topology)
    expect(objects.map((object) => object.identity.id)).toEqual(['vnet', 'subnet', 'er', 'vpn', 'ars', 'nva'])
    expect(objects.find((object) => object.identity.id === 'vpn')).toMatchObject({
      identity: { family: 'azure-net', kind: 'gateway', ownerId: 'vnet', id: 'vpn' },
      selection: { kind: 'gateway', vnetId: 'vnet', gatewayId: 'vpn' }, enabled: false,
      parents: ['Original name', 'Workspace controls'],
    })
    expect(objects.find((object) => object.identity.id === 'ars')?.enabled).toBe(false)
    expect(objects.find((object) => object.identity.id === 'nva')?.parents).toContain('Work')
    expect(JSON.stringify(topology)).toBe(before)
  })

  it('keeps opaque delimiters, provider families and owner scopes distinct', () => {
    const selections = [
      { kind: 'gateway' as const, vnetId: 'a:b', gatewayId: 'c' },
      { kind: 'gateway' as const, vnetId: 'a', gatewayId: 'b:c' },
      { kind: 'gateway' as const, vnetId: 'other', gatewayId: 'c' },
    ]
    const identities = [
      ...selections.map(azWorkspaceIdentity),
      azWorkspaceIdentity({ kind: 'site', siteId: 'same' }),
      vwanWorkspaceIdentity({ kind: 'site', id: 'same' }),
      azWorkspaceIdentity({ kind: 'subnet', vnetId: 'a:b', subnetId: 'c' }),
    ]
    expect(new Set(identities.map(workspaceIdentityKey)).size).toBe(identities.length)
    expect(identities.slice(0, 3).map((identity) => [identity.ownerId, identity.id])).toEqual([
      ['a:b', 'c'], ['a', 'b:c'], ['other', 'c'],
    ])
  })

  it('does not interpret retained extension flags as supported object status', () => {
    const topology = createEmptyAzNetTopology()
    topology.sites = ['one', 'two'].map((id) => Object.assign({
      id, name: id, asn: 65000, prefixes: ['10.0.0.0/24'],
    }, { enabled: false }))
    topology.siteLinks = [{ id: 'link', name: 'Link', siteAId: 'one', siteBId: 'two', enabled: false }]
    const before = JSON.stringify(topology)
    const objects = azWorkspaceObjects(topology)
    expect(objects.filter((object) => object.enabled === false).map((object) => object.identity.id)).toEqual(['link'])
    expect(JSON.stringify(topology)).toBe(before)

    const vwan = structuredClone(example)
    Object.assign(vwan.hubs[0], { enabled: false })
    expect(vwanWorkspaceObjects(vwan).find((object) => object.identity.id === vwan.hubs[0].id)?.enabled).toBeUndefined()
  })
})
