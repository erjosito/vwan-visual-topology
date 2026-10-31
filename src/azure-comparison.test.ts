import { describe, expect, it } from 'vitest'
import { azureBase, comparisonDesign, gatewayArm, hubArm, observationFixture, spokeArm } from '../tests/azure-observation-fixture'
import {
  armKey,
  describeObservedNextHopType,
  describeObservedResource,
  normalizeObservedAsPath,
  normalizeObservedPrefix,
  parseAzureObservation,
  resolveObservedHubSnapshot,
} from './azure-observation'
import { compareAzure, defaultComparisonProfile } from './azure-comparison'
import type { AzureObservation } from './azure-observation'
import { importAzureCapture } from './azure-import'
import { simulate } from './routing'
import { validateTopology } from './validation'

function setup() {
  const design = comparisonDesign(), capture = observationFixture(), observation = parseAzureObservation(capture)
  const profile = { ...defaultComparisonProfile(design, observation), hubs: { [armKey(hubArm)]: 'h' },
    spokes: { [armKey(spokeArm('a'))]: 'a', [armKey(spokeArm('b'))]: 'b' } }
  return { design, capture, observation, profile }
}
describe('Azure observation validation and normalization', () => {
  it('preserves associated prefixes, all next hops, origins and repeated ASNs without mutating input', () => {
    const capture = observationFixture(), row = capture.observations.tables[0].routes[0]
    row.addressPrefixes.push('2001:db8::/64'); row.nextHops.push('unrecognized next hop'); row.asPath = '12076-12076-65001'
    const before = JSON.stringify(capture), observation = parseAzureObservation(capture)
    expect(observation.tables[0].routes[0]).toEqual(row)
    expect(JSON.stringify(capture)).toBe(before)
    expect(normalizeObservedAsPath(row.asPath)).toBe('12076 12076 65001')
    expect(normalizeObservedAsPath(' 12076, 12076 65001 ')).toBe('12076 12076 65001')
    expect(normalizeObservedAsPath('{65001,65002}')).toBeUndefined()
    expect(normalizeObservedPrefix(' 10.1.0.7/24 ')).toBe('10.1.0.0/24')
    expect(normalizeObservedPrefix('2001:db8::/64')).toBeUndefined()
  })
  it('rejects wrong versions, scope escapes, contradictory status, invalid times and excessive expanded work', () => {
    for (const edit of [
      (capture: ReturnType<typeof observationFixture>) => { capture.version = 1 },
      (capture: ReturnType<typeof observationFixture>) => { capture.observations.tables[0].hubResourceId = `${azureBase}/virtualHubs/foreign` },
      (capture: ReturnType<typeof observationFixture>) => { capture.observations.tables[0].resourceId = `${hubArm}/hubRouteTables/defaultRouteTable/child` },
      (capture: ReturnType<typeof observationFixture>) => { capture.observations.tables[0].status = 'empty' },
      (capture: ReturnType<typeof observationFixture>) => { capture.observations.startedAt = 'not a timestamp' },
      (capture: ReturnType<typeof observationFixture>) => { capture.context.subscriptionId = '33333333-3333-3333-3333-333333333333' },
      (capture: ReturnType<typeof observationFixture>) => {
        const row = capture.observations.tables[0].routes[0]
        row.addressPrefixes = Array(100).fill('10.1.0.0/24'); row.nextHops = Array(128).fill('unknown')
        capture.observations.tables[0].routes = Array(8).fill(row)
      },
    ]) {
      const capture = observationFixture(); edit(capture)
      expect(() => parseAzureObservation(capture)).toThrow()
    }
  })
  it('only auto-binds retained ARM-derived identities, never names', () => {
    const { capture, observation, design } = setup()
    design.hubs[0].name = observation.hubs[0].name
    expect(defaultComparisonProfile(design, observation).hubs).toEqual({})
    const imported = importAzureCapture({ ...capture, version: 1 })
    const profile = defaultComparisonProfile(imported, observation)
    expect(Object.values(profile.hubs)).toEqual([imported.hubs[0].id])
    expect(Object.values(profile.spokes)).toEqual(imported.spokes.map((spoke) => spoke.id))
    expect(profile.completeDesign).toBe(false)
  })
})
describe('scoped selected-route comparison', () => {
  it('matches selected forwarding routes without modifying design, observations or mappings', () => {
    const { design, observation, profile } = setup()
    const before = JSON.stringify({ design, observation, profile })
    const report = compareAzure(design, observation, profile)
    expect(report.rows.filter((row) => row.area === 'route').map((row) => row.status)).toEqual(['match', 'match'])
    expect(JSON.stringify({ design, observation, profile })).toBe(before)
  })
  it('identifies changed routing preference and spoke address space with their actual compared values', () => {
    const { design, observation, profile } = setup()
    design.hubs[0].preference = 'ExpressRoute'; design.spokes[0].prefixes = ['10.11.0.0/24']
    const report = compareAzure(design, observation, profile)
    const hub = report.rows.find((row) => row.area === 'structure' && row.prefix === 'Observed west')!
    const spoke = report.rows.find((row) => row.area === 'structure' && row.prefix === 'Observed a')!
    expect(hub.status).toBe('changed')
    expect(hub.configuration?.find((field) => field.label === 'Hub routing preference')).toMatchObject({ designed: 'ExpressRoute', observed: 'VPN' })
    expect(spoke.status).toBe('changed')
    expect(spoke.configuration?.find((field) => field.label === 'Address spaces')).toMatchObject({ designed: ['10.11.0.0/24'], observed: ['10.1.0.0/24'] })
  })
  it('distinguishes an observed unmodeled prefix even when its next hop is unknown', () => {
    const { design, observation, profile } = setup()
    observation.tables[0].routes.push({ addressPrefixes: ['10.88.0.0/24'], nextHopType: 'Unknown', nextHops: ['unknown'], routeOrigin: 'unknown', asPath: '65099' })
    expect(compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.88.0.0/24')?.status).toBe('azure-only')
  })
  it('requires complete comparable observation and explicit exact-prefix model coverage before declaring missing', () => {
    const { design, observation, profile } = setup()
    observation.tables[0].routes = []; observation.tables[0].status = 'empty'
    expect(compareAzure(design, observation, profile).rows.filter((row) => row.area === 'route').every((row) => row.status === 'unknown')).toBe(true)
    profile.completeDesign = true; profile.prefixes = ['10.1.0.0/24']
    expect(compareAzure(design, observation, profile).rows.find((row) => row.area === 'route')?.status).toBe('design-only')
    for (const status of ['denied', 'failed', 'unsupported', 'truncated'] as const) {
      observation.tables[0].status = status
      expect(compareAzure(design, observation, profile).rows.find((row) => row.area === 'route')?.status).toBe('unknown')
    }
  })
  it('retains empty prefix arrays as unknown coverage rather than dropping a row or inventing missing routes', () => {
    const { capture, design, profile } = setup()
    capture.observations.tables[0].routes = [{ addressPrefixes: [], nextHops: [], nextHopType: '', routeOrigin: '', asPath: '' }]
    const observation = parseAzureObservation(capture)
    expect(observation.tables[0].routes).toHaveLength(1)
    profile.completeDesign = true; profile.prefixes = ['10.1.0.0/24']
    expect(compareAzure(design, observation, profile).rows.find((row) => row.area === 'route')?.status).toBe('unknown')
  })
  it('does not equate an aggregate with an expected more-specific route', () => {
    const { design, observation, profile } = setup()
    profile.completeDesign = true; profile.prefixes = ['10.1.0.0/24']
    observation.tables[0].routes[0].addressPrefixes = ['10.0.0.0/8']
    expect(compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.1.0.0/24')?.status).toBe('design-only')
  })
  it('reports changed resolved next hops, but unknown identity/type remains unassessed', () => {
    const { design, observation, profile } = setup(), row = observation.tables[0].routes[0]
    row.nextHops = [spokeArm('b').toUpperCase()]
    expect(compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.1.0.0/24')?.status).toBe('next-hop')
    row.nextHops = ['unknown']
    expect(compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.1.0.0/24')?.status).toBe('unknown')
    row.nextHops = [spokeArm('a')]; row.nextHopType = 'Virtual Appliance'
    expect(compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.1.0.0/24')?.status).toBe('unknown')
  })
  it('compares selected paths only and retains repeated ASNs when AS-path comparison is requested', () => {
    const { design, observation, profile } = setup()
    design.sites.push({ id: 's', name: 'Branch', asn: 65001, prefixes: ['10.9.0.0/24'] })
    design.connections = [
      { id: 'primary', name: 'Primary', siteId: 's', hubId: 'h', transport: 'VPN', enabled: true, learnSiteRoutes: true,
        inbound: [{ id: 'p', prefixes: [], match: 'equals', prepend: [65001] }], outbound: [] },
      { id: 'backup', name: 'Backup', siteId: 's', hubId: 'h', transport: 'VPN', enabled: true, learnSiteRoutes: true,
        inbound: [{ id: 'b', prefixes: [], match: 'equals', prepend: [65001, 65001] }], outbound: [] },
    ]
    profile.nextHops[armKey(gatewayArm)] = { kind: 'gateway', id: 'h', transport: 'VPN' }
    profile.compareAsPaths = true
    observation.tables[0].routes.push({ addressPrefixes: ['10.9.0.0/24'], nextHopType: 'VPN_S2S_Gateway', nextHops: [gatewayArm], routeOrigin: gatewayArm, asPath: '65001-65001' })
    const result = () => compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.9.0.0/24')!
    expect(result().status).toBe('match')
    expect(result().designed).toHaveLength(1)
    observation.tables[0].routes.at(-1)!.asPath = '65001'
    expect(result().status).toBe('attribute')
    profile.compareAsPaths = false
    expect(result().status).toBe('match')
  })
  it('treats ECMP as associated tuple sets, independent of row and next-hop array order', () => {
    const { design, observation, profile } = setup()
    design.spokes.push({ id: 'c', name: 'Parallel local spoke', hubId: 'h', prefixes: ['10.1.0.0/24'] })
    profile.spokes[armKey(spokeArm('c'))] = 'c'
    observation.tables[0].routes[0].nextHops = [spokeArm('c'), spokeArm('a')]
    expect(compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.1.0.0/24')?.status).toBe('match')
    observation.tables[0].routes.reverse()
    observation.tables[0].routes.at(-1)!.nextHops.reverse()
    expect(compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.1.0.0/24')?.status).toBe('match')
  })
  it('keeps AS paths associated with their remote-hub first hops instead of comparing independent attribute sets', () => {
    const { design, observation, profile } = setup()
    for (const [id, asn] of [['east', 65001], ['north', 65002]] as const) {
      design.hubs.push({ ...structuredClone(design.hubs[0]), id, name: id })
      design.sites.push({ id, name: id, asn, prefixes: ['10.9.0.0/24'] })
      design.connections.push({ id, name: id, siteId: id, hubId: id, enabled: true, transport: 'VPN', learnSiteRoutes: true, inbound: [], outbound: [] })
      const remote = `${azureBase}/virtualHubs/${id}`
      profile.hubs[armKey(remote)] = id
      observation.tables[0].routes.push({ addressPrefixes: ['10.9.0.0/24'], nextHopType: 'Remote Hub', nextHops: [remote], routeOrigin: remote, asPath: `65520-65520-${asn}` })
    }
    profile.compareAsPaths = true
    const status = () => compareAzure(design, observation, profile).rows.find((row) => row.prefix === '10.9.0.0/24')?.status
    expect(status()).toBe('match')
    const routes = observation.tables[0].routes.slice(-2)
    ;[routes[0].asPath, routes[1].asPath] = [routes[1].asPath, routes[0].asPath]
    expect(status()).toBe('attribute')
  })
  it('does not infer absence in stale, secured, custom, incomplete or context-unknown captures', () => {
    const { design, observation, profile } = setup()
    profile.completeDesign = true; profile.prefixes = ['10.1.0.0/24']
    const edits: ((value: AzureObservation) => void)[] = [
      (value) => { value.tables[0].capturedAt = new Date(Date.now() - 90_000_000).toISOString() },
      (value) => { value.hubs[0].privateIntent = true },
      (value) => { value.tables[0].resourceId = `${hubArm}/hubRouteTables/custom` },
      (value) => { value.hubs[0].limitations.push('Incomplete capture') },
      (value) => { value.context.azureCliVersion = null },
      (value) => { value.hubs[0].spokes[0].enableInternetSecurity = true },
    ]
    for (const edit of edits) {
      const changed = structuredClone(observation); changed.tables[0].routes = []; changed.tables[0].status = 'empty'; edit(changed)
      expect(compareAzure(design, changed, profile).rows.find((row) => row.area === 'route')?.status).toBe('unknown')
    }
  })
  it('does not mislabel unsupported intent or IPv6 as a known configuration mismatch', () => {
    const { capture, design, profile } = setup()
    capture.hubs[0].routingPolicies = [{ destinations: ['PrivateTraffic'], nextHop: `${azureBase}/networkVirtualAppliances/nva` }]
    capture.hubs[0].connections[0].addressPrefixes!.push('2001:db8::/64')
    design.hubs[0].routingIntent.private = true
    const report = compareAzure(design, parseAzureObservation(capture), profile)
    expect(report.rows.find((row) => row.prefix === 'Observed west')?.status).toBe('unknown')
    expect(report.rows.find((row) => row.prefix === 'Observed a')?.status).toBe('unknown')
    expect(report.rows.filter((row) => row.area === 'route').every((row) => row.status === 'unknown')).toBe(true)
  })
  it('does not treat a truncated original site-selection baseline as a certified prediction', () => {
    const { design, observation, profile } = setup()
    design.sites = [{ id: 'origin', name: 'Origin', asn: 65001, prefixes: ['10.9.0.0/24'] }, { id: 'peer', name: 'Peer', asn: 65002, prefixes: [] }]
    design.siteLinks = Array.from({ length: 33 }, (_, index) => ({ id: `link-${index}`, name: `Link ${index}`, a: 'origin', b: 'peer', enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }))
    const report = compareAzure(design, observation, profile)
    expect(report.rows.filter((row) => row.area === 'route').every((row) => row.status === 'unknown')).toBe(true)
  })
  it('keeps layout and display names out of staleness while routing and mappings invalidate results', () => {
    const { design, observation, profile } = setup(), report = compareAzure(design, observation, profile)
    design.name = 'Renamed'; design.hubs[0].name = 'Renamed hub'; design.layout = { mode: 'constellation', positions: {} }
    expect(compareAzure(design, observation, profile).revision).toBe(report.revision)
    design.spokes[0].prefixes = ['10.11.0.0/24']
    expect(compareAzure(design, observation, profile).revision).not.toBe(report.revision)
    profile.hubs = {}
    expect(compareAzure(design, observation, profile).profileKey).not.toBe(report.profileKey)
  })
  it('persists v2 observed effective-route snapshots in native JSON and resolves inspector labels (#3)', () => {
    const capture = observationFixture()
    capture.observations.tables[0].routes.push(
      {
        addressPrefixes: ['0.0.0.0/0'],
        nextHopType: 'AzureFirewall',
        nextHops: [`${azureBase}/azureFirewalls/west-fw`],
        routeOrigin: `${hubArm}/hubRouteTables/defaultRouteTable`,
        asPath: '',
      },
      {
        addressPrefixes: ['10.50.0.0/16', '10.51.0.0/16'],
        nextHopType: 'ExpressRouteGateway',
        nextHops: [`${azureBase}/expressRouteGateways/west-er-gw`, `${azureBase}/vpnGateways/west-vpn-gw`],
        routeOrigin: `${hubArm}/hubBgpConnections/nva-peer`,
        asPath: '65515-65010-65010',
      },
      {
        addressPrefixes: ['10.99.0.0/24'],
        nextHopType: 'CustomAppliance',
        nextHops: ['unmapped-appliance-id'],
        routeOrigin: 'custom-origin',
        asPath: '{65001,65002}',
      },
    )
    const importedV1 = importAzureCapture({ ...capture, version: 1 })
    const importedV2 = importAzureCapture(capture)
    expect(simulate(importedV2).tables).toEqual(simulate(importedV1).tables)
    expect(importedV2.azureImport?.tables).toHaveLength(1)
    expect(importedV2.azureImport?.spokes).toHaveLength(2)

    const roundTrip = validateTopology(JSON.parse(JSON.stringify(importedV2)))
    expect(roundTrip.azureImport?.tables).toEqual(importedV2.azureImport?.tables)
    const hubId = roundTrip.hubs[0].id
    const snapshot = resolveObservedHubSnapshot(roundTrip, hubId)!
    expect(snapshot.table?.status).toBe('complete')
    expect(snapshot.table?.routes).toHaveLength(5)
    expect(snapshot.isStale).toBe(false)

    const staleCopy = structuredClone(roundTrip)
    staleCopy.azureImport!.tables![0].capturedAt = '2020-01-01T00:00:00Z'
    const staleSnapshot = resolveObservedHubSnapshot(staleCopy, hubId)!
    expect(staleSnapshot.isStale).toBe(true)
    expect(staleSnapshot.notices.join(' ')).toContain('older than 24 hours')

    expect(describeObservedResource(spokeArm('a'), hubId, roundTrip)).toMatchObject({ label: 'Observed a (VNet connection)', known: true })
    expect(describeObservedResource(hubArm, hubId, roundTrip)).toMatchObject({ label: 'Observed west (local hub)', known: true })
    expect(describeObservedResource(`${azureBase}/azureFirewalls/west-fw`, hubId, roundTrip)).toMatchObject({ label: 'Azure Firewall (west-fw)', known: true })
    expect(describeObservedResource(`${azureBase}/expressRouteGateways/west-er-gw`, hubId, roundTrip)).toMatchObject({ label: 'ExpressRoute gateway (west-er-gw)', known: true })
    expect(describeObservedResource(`${azureBase}/vpnGateways/west-vpn-gw`, hubId, roundTrip)).toMatchObject({ label: 'S2S VPN gateway (west-vpn-gw)', known: true })
    expect(describeObservedResource(`${hubArm}/hubRouteTables/defaultRouteTable`, hubId, roundTrip)).toMatchObject({ label: 'Observed west · defaultRouteTable (route table)', known: true })
    expect(describeObservedResource(`${hubArm}/hubBgpConnections/nva-peer`, hubId, roundTrip)).toMatchObject({ label: 'Observed west · nva-peer (BGP connection)', known: true })
    expect(describeObservedResource('unmapped-appliance-id', hubId, roundTrip)).toMatchObject({ label: 'Unknown resource (unmapped-appliance-id)', known: false })
    expect(describeObservedNextHopType('AzureFirewall')).toEqual({ label: 'AzureFirewall (Secured hub firewall)', known: true })
    expect(describeObservedNextHopType('CustomAppliance')).toEqual({ label: 'Unknown type (CustomAppliance)', known: false })

    for (const status of ['empty', 'denied', 'failed', 'truncated', 'unsupported'] as const) {
      const copy = structuredClone(roundTrip)
      copy.azureImport!.tables![0].status = status
      if (status !== 'truncated') copy.azureImport!.tables![0].routes = []
      const state = resolveObservedHubSnapshot(copy, hubId)!
      expect(state.notices.length).toBeGreaterThan(1)
    }
  })
})
