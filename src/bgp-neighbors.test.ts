import { expect, it } from 'vitest'
import { bgpNeighborTopology, bgpNeighborVwanTopology } from '../tests/fixtures/bgp-neighbors'
import { inspectAzBgp, inspectVwanBgp } from './bgp-neighbors'

it('projects known VWAN, MSEE and site identities in both perspectives without manufacturing sessions', () => {
  const topology = bgpNeighborVwanTopology()
  const before = JSON.stringify(topology)
  const inspection = inspectVwanBgp(topology)
  const hub = inspection.resources.find((resource) => resource.id === 'managed-hub')!
  const site = inspection.resources.find((resource) => resource.id === 'branch')!
  expect(hub).toMatchObject({ asn: 65515, instances: [] })
  expect(inspection.resources.find((resource) => resource.id === 'remote-hub')).toMatchObject({ asn: 65515, instances: [] })
  expect(inspection.resources.find((resource) => resource.id === 'edge-location')).toMatchObject({ asn: 12076, instances: [] })
  expect(site.asn).toBe(65050)
  expect(inspection.managedRelationships.filter((relationship) => relationship.resourceKeys.includes(hub.key))
    .map((relationship) => relationship.kind).sort()).toEqual(['express-route', 'inter-hub', 'vpn'])
  expect(inspection.managedRelationships.filter((relationship) => relationship.resourceKeys.includes(site.key))
    .map((relationship) => relationship.connectionId).sort()).toEqual(['er-site', 'managed-vpn'])
  expect(inspection.neighbors).toEqual([])
  expect(JSON.stringify(topology)).toBe(before)
  const ids = inspection.managedRelationships.map((relationship) => relationship.id)
  topology.hubs.reverse()
  topology.hubs[0].name = 'Renamed remote hub'
  expect(inspectVwanBgp(topology).managedRelationships.map((relationship) => relationship.id)).toEqual(ids)
})

it('keeps WAN scope, static VPN, disabled links and failure availability distinct from native session state', () => {
  const topology = bgpNeighborVwanTopology()
  topology.hubs[0].wanId = 'wan-a'
  topology.hubs[1].wanId = 'wan-b'
  topology.wans = [{ id: 'wan-a', name: 'WAN A' }, { id: 'wan-b', name: 'WAN B' }]
  topology.connections[0].learnSiteRoutes = false
  topology.sites[0].vpnStaticRoutes = [{ id: 'static', prefix: '203.0.113.0/24', connectionId: 'managed-vpn' }]
  expect(inspectVwanBgp(topology).managedRelationships.find((relationship) => relationship.connectionId === 'managed-vpn'))
    .toMatchObject({ kind: 'vpn-static', enabled: true })
  topology.erLinks![0].enabled = false
  topology.interWanVpns = [{ id: 'legacy', name: 'Unknown inter-WAN VPN', aHubId: 'managed-hub', bHubId: 'remote-hub',
    enabled: true, status: 'unknown', aToB: [], bToA: [] }]
  const inspection = inspectVwanBgp(topology, ['managed-hub'])
  expect(inspection.managedRelationships.some((relationship) => relationship.kind === 'inter-hub')).toBe(false)
  expect(inspection.managedRelationships.every((relationship) => !relationship.enabled)).toBe(true)
  expect(inspection.managedRelationships.find((relationship) => relationship.connectionId === 'managed-vpn')?.reason).toContain('Static VPN')
  expect(inspection.neighbors).toEqual([])
})

it('preserves standalone configured ASNs, instance scopes and disabled gateway BGP while showing managed VPN and ER metadata', () => {
  const topology = bgpNeighborTopology()
  topology.vnets[3].gateways[0].asn = 65090
  delete topology.vnets[3].gateways[0].activeActive
  topology.vnets[3].gateways[0].bgpEnabled = false
  const inspection = inspectAzBgp(topology)
  expect(inspection.resources.find((resource) => resource.id === 'vpn-as')).toMatchObject({ asn: 65090, instances: [] })
  expect(inspection.resources.find((resource) => resource.id === 'vpn-aa')?.instances).toHaveLength(2)
  expect(inspection.managedRelationships.find((relationship) => relationship.connectionId === 'branch-as'))
    .toMatchObject({ name: 'Branch active-standby', kind: 'vpn', enabled: false })
  expect(inspection.managedRelationships.find((relationship) => relationship.connectionId === 'er-azure'))
    .toMatchObject({ name: 'Azure ER', kind: 'express-route', enabled: true })
})
