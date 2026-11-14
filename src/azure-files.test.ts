/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { importAzureCapture } from './azure-import'
import { bicepDefaults, generateBicep } from './bicep-export'
import { validateTopology } from './validation'
import { example } from './model'
import { contextObservationFixture } from '../tests/azure-observation-fixture'

const base = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network'
function capture() {
  return {
    kind: 'azure-vwan-capture', version: 1, collectorVersion: '1', capturedAt: '2026-09-10T12:00:00Z', complete: true, warnings: [],
    wan: { id: `${base}/virtualWans/wan`, name: 'Captured WAN', type: 'Standard', allowBranchToBranchTraffic: true, allowVnetToVnetTraffic: true },
    hubs: [{
      id: `${base}/virtualHubs/west`, name: 'West hub', location: 'westeurope', virtualWanId: `${base}/virtualWans/wan`,
      addressPrefix: '10.250.0.0/23', hubRoutingPreference: 'VpnGateway', unsupportedFeatures: [] as string[],
      routingPolicies: [] as { destinations: string[]; nextHop: string }[], gatewayTypes: [] as string[],
      connections: [{ name: 'Application VNet', virtualNetworkId: `${base}/virtualNetworks/app`, addressPrefixes: ['10.20.0.0/16'] as string[] | null, defaultRouting: true }],
    }],
  }
}

describe('offline Azure capture import', () => {
  it('migrates explicit contexts without mistaking incomplete or contradictory scope for complete provenance', () => {
    const input = contextObservationFixture()
    const load = () => importAzureCapture({ ...input, version: 1 })
    let imported = load()
    expect(imported.spokes[0].hubRouting).toMatchObject({ status: 'captured', associatedTableId: 'business',
      propagatedTableIds: ['business'], labels: ['red'] })
    expect(imported.azureImport?.hubs[0].routingScopeComplete).toBe(true)
    expect(validateTopology(JSON.parse(JSON.stringify(imported)))).toEqual(imported)
    input.hubs[0].gatewayTypes = ['VPN']
    expect(load().azureImport?.hubs[0].routingScopeComplete).toBe(false)
    input.hubs[0].gatewayTypes = []
    const connection = input.hubs[0].connections[0] as Record<string, unknown>
    delete connection.enableInternetSecurity
    imported = load()
    expect(imported.azureImport?.hubs[0].routingScopeComplete).toBe(false)
    expect(imported.spokes[0].hubRouting?.status).toBe('unknown')
    expect(imported.azureImport?.hubs[0].limitations.join(' ')).toContain('internet-security flag is unknown')
    connection.enableInternetSecurity = false
    input.hubs[0].routeTablesStatus = 'unknown'
    expect(load().hubs[0].routeTablesStatus).toBe('unknown')
    expect(load().azureImport?.hubs[0].routingScopeComplete).toBe(false)
  })

  it('preserves disabled branch transit in native import and generated Bicep', () => {
    const input = capture()
    input.wan.allowBranchToBranchTraffic = false
    const imported = importAzureCapture(input)
    expect(imported.allowBranchToBranchTraffic).toBe(false)
    expect(imported.azureImport?.warnings.join(' ')).not.toContain('WAN transit flags differ')
    expect(generateBicep(imported, bicepDefaults(imported)).text).toContain('allowBranchToBranchTraffic: false')
    expect(generateBicep(importAzureCapture(capture()), bicepDefaults(imported)).text).toContain('allowBranchToBranchTraffic: true')
    expect(() => importAzureCapture({ ...input, wan: { ...input.wan, allowBranchToBranchTraffic: 'false' } })).toThrow(/boolean/)
  })

  it('maps case-insensitive ARM associations, preserves provenance, and never invents on-premises routes', () => {
    const input = capture()
    input.hubs[0].virtualWanId = input.wan.id.toUpperCase()
    input.hubs[0].gatewayTypes = ['ExpressRoute', 'VPN']
    const result = importAzureCapture({ ...input, token: 'discard-this-unknown-field' })
    expect(result.hubs[0]).toMatchObject({ preference: 'VPN', region: 'westeurope' })
    expect(result.spokes[0]).toMatchObject({ hubId: result.hubs[0].id, prefixes: ['10.20.0.0/16'] })
    expect(result.connections).toEqual([])
    expect(result.sites).toEqual([])
    expect(result.azureImport?.hubs[0].addressPrefix).toBe('10.250.0.0/23')
    expect(result.azureImport?.warnings.join(' ')).toContain('ExpressRoute gateway')
    const saved = validateTopology(JSON.parse(JSON.stringify(result)))
    expect(saved).toEqual(result)
    expect(JSON.stringify(saved)).not.toContain('discard-this-unknown-field')
    input.hubs[0].id = input.hubs[0].id.toUpperCase()
    input.hubs[0].connections[0].virtualNetworkId = input.hubs[0].connections[0].virtualNetworkId.toUpperCase()
    expect(importAzureCapture(input).hubs[0].id).toBe(result.hubs[0].id)
    expect(importAzureCapture(input).spokes[0].id).toBe(result.spokes[0].id)
  })

  it('stably distinguishes duplicate display names across resource groups', () => {
    const input = capture()
    const other = structuredClone(input.hubs[0])
    other.id = other.id.replace('/network/', '/another-group/')
    other.connections[0].virtualNetworkId = other.connections[0].virtualNetworkId.replace('/network/', '/another-group/')
    other.addressPrefix = '10.251.0.0/23'
    input.hubs.push(other)
    const first = importAzureCapture(input)
    input.hubs.reverse()
    const second = importAzureCapture(input)
    expect(new Set(first.hubs.map((hub) => hub.id)).size).toBe(2)
    expect(second.hubs.map((hub) => hub.id).sort()).toEqual(first.hubs.map((hub) => hub.id).sort())
    expect(second.spokes.map((spoke) => spoke.id).sort()).toEqual(first.spokes.map((spoke) => spoke.id).sort())
  })

  it('maps all Azure preferences and multiple IPv4 prefixes without losing networks', () => {
    for (const [azure, app] of [['ExpressRoute', 'ExpressRoute'], ['VpnGateway', 'VPN'], ['ASPath', 'ASPath']]) {
      const input = capture()
      input.hubs[0].hubRoutingPreference = azure
      input.hubs[0].connections[0].addressPrefixes = ['10.20.0.0/16', '10.21.0.0/16']
      const result = importAzureCapture(input)
      expect(result.hubs[0].preference).toBe(app)
      expect(result.spokes[0].prefixes).toEqual(['10.20.0.0/16', '10.21.0.0/16'])
    }
  })

  it('keeps missing, IPv6 and custom-routing imports explicitly structure-only', () => {
    const input = capture()
    input.complete = false
    input.hubs[0].connections[0].addressPrefixes = ['2001:db8::/64', '10.20.0.0/16']
    input.hubs[0].connections[0].defaultRouting = false
    input.hubs[0].unsupportedFeatures = ['Custom route table is not simulated.']
    const result = importAzureCapture(input)
    expect(result.spokes[0].prefixes).toEqual(['10.20.0.0/16'])
    expect(result.azureImport?.warnings.join(' ')).toMatch(/incomplete.*custom|custom.*incomplete/is)
    expect(result.azureImport?.warnings.join(' ')).toContain('IPv6')
    expect(() => generateBicep(result, bicepDefaults(result))).toThrow(/unsupported or incompletely captured/)
    input.hubs[0].connections[0].addressPrefixes = null
    expect(importAzureCapture(input).spokes).toEqual([])
  })

  it('maps only Azure Firewall intent and discloses unsupported providers/destinations', () => {
    const input = capture()
    input.hubs[0].routingPolicies = [{ destinations: ['PrivateTraffic', 'Internet'], nextHop: `${base}/azureFirewalls/firewall` }]
    ;(input.hubs[0].connections[0] as Record<string, unknown>).enableInternetSecurity = true
    const imported = importAzureCapture(input)
    expect(imported.hubs[0].routingIntent).toMatchObject({ private: true, internet: true })
    expect(imported.spokes[0].propagateDefaultRoute).toBe(true)
    input.hubs[0].routingPolicies = [{ destinations: ['Internet', '10.0.0.0/8'], nextHop: `${base}/networkVirtualAppliances/nva` }]
    ;(input.hubs[0].connections[0] as Record<string, unknown>).enableInternetSecurity = null
    const result = importAzureCapture(input)
    expect(result.hubs[0].routingIntent.internet).toBe(false)
    expect(result.spokes[0].propagateDefaultRoute).toBeUndefined()
    expect(result.azureImport?.warnings.join(' ')).toContain('non-Azure-Firewall')
    expect(result.azureImport?.warnings.join(' ')).toContain('Unsupported routing-intent destination')
  })

  it('rejects unsupported, ambiguous and malformed captures rather than guessing', () => {
    for (const change of [
      (c: ReturnType<typeof capture>) => { c.version = 2 },
      (c: ReturnType<typeof capture>) => { c.wan.type = 'Basic' },
      (c: ReturnType<typeof capture>) => { c.hubs[0].hubRoutingPreference = 'Unknown' },
      (c: ReturnType<typeof capture>) => { c.hubs[0].virtualWanId += 'different' },
      (c: ReturnType<typeof capture>) => { c.hubs.push(structuredClone(c.hubs[0])) },
      (c: ReturnType<typeof capture>) => { c.hubs[0].connections.push(structuredClone(c.hubs[0].connections[0])) },
      (c: ReturnType<typeof capture>) => { c.hubs[0].addressPrefix = '10.250.0.1/23' },
      (c: ReturnType<typeof capture>) => { c.hubs[0].connections[0].addressPrefixes = ['not-a-network'] },
      (c: ReturnType<typeof capture>) => { c.capturedAt = 'not-a-date' },
      (c: ReturnType<typeof capture>) => { c.hubs[0].connections = Array.from({ length: 61 }, () => structuredClone(c.hubs[0].connections[0])) },
    ]) {
      const input = capture(); change(input)
      expect(() => importAzureCapture(input)).toThrow()
    }
  })

  it('prunes deleted hub provenance without clearing the persistent limitations report', () => {
    const input = importAzureCapture(capture())
    input.hubs = []; input.spokes = []
    const saved = validateTopology(input)
    expect(saved.azureImport?.hubs).toEqual([])
    expect(saved.azureImport?.warnings.length).toBeGreaterThan(0)
    if (saved.azureImport) saved.azureImport.capturedAt = 'invalid'
    expect(() => validateTopology(saved)).toThrow(/timestamp/)
  })
})

describe('offline Bicep export', () => {
  it('emits deterministic schema-checked WAN/hubs with every routing preference and no source resources', () => {
    const topology = importAzureCapture(capture())
    const singleHub = generateBicep(topology, bicepDefaults(topology)).text
    topology.hubs.push(
      { ...structuredClone(topology.hubs[0]), id: 'er-hub', name: 'ER hub', region: 'eastus', preference: 'ExpressRoute' },
      { ...structuredClone(topology.hubs[0]), id: 'as-hub', name: 'AS hub', region: 'uksouth', preference: 'ASPath' },
    )
    const settings = bicepDefaults(topology)
    settings.hubs[1].addressPrefix = '10.251.0.0/23'
    settings.hubs[2].addressPrefix = '10.252.0.0/24'
    const result = generateBicep(topology, settings)
    expect(result.resourceCount).toBe(4)
    expect(result.text).toContain("'VpnGateway'")
    expect(result.text).toContain("'ExpressRoute'")
    expect(result.text).toContain("'ASPath'")
    expect(result.text).toContain("'eastus'")
    expect(result.text).toContain("'uksouth'")
    expect(result.text).not.toContain('/subscriptions/')
    expect(result.text).not.toMatch(/resource .*?(azureFirewalls|hubVirtualNetworkConnections|expressRouteGateways|vpnGateways)/)
    expect(generateBicep(topology, { ...settings, hubs: [...settings.hubs].reverse() }).text).toBe(result.text)
    const directory = join('test-artifacts', 'azure-files', 'bicep')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'main.bicep'), result.text)
    writeFileSync(join(directory, 'single-hub.bicep'), singleHub)
  })

  it('never allocates infrastructure prefixes from destination prefixes', () => {
    const defaults = bicepDefaults(example)
    expect(defaults.hubs.every((hub) => hub.addressPrefix === '')).toBe(true)
    expect(() => generateBicep(example, defaults)).toThrow(/explicit IPv4/)
    const topology = importAzureCapture(capture())
    const settings = bicepDefaults(topology)
    for (const prefix of ['', '10.250.0.1/23', '10.250.0.0/25', '10.20.0.0/23']) {
      settings.hubs[0].addressPrefix = prefix
      expect(() => generateBicep(topology, settings)).toThrow()
    }
    settings.hubs[0].addressPrefix = '10.250.0.0/23'
    topology.hubs.push({ ...structuredClone(topology.hubs[0]), id: 'other' })
    settings.hubs.push({ ...settings.hubs[0], hubId: 'other', name: 'other' })
    expect(() => generateBicep(topology, settings)).toThrow(/overlap/)
  })

  it('requires explicit exclusion of secured/policy hubs, with an omission report', () => {
    const topology = importAzureCapture(capture())
    topology.hubs.push({ ...structuredClone(topology.hubs[0]), id: 'secured', name: 'Secured' })
    topology.hubs[1].routingIntent.internet = true
    const settings = bicepDefaults(topology)
    settings.hubs[1].addressPrefix = '10.251.0.0/23'
    expect(() => generateBicep(topology, settings)).toThrow(/Secured hubs/)
    settings.hubs[1].selected = false
    const result = generateBicep(topology, settings)
    expect(result.resourceCount).toBe(2)
    expect(result.warnings.join(' ')).toContain('Excluded hubs: Secured')
    topology.sites.push({ id: 'site', name: 'Site', asn: 65001, prefixes: ['10.30.0.0/16'] })
    topology.connections.push({ id: 'vpn', name: 'VPN', hubId: topology.hubs[0].id, siteId: 'site', transport: 'VPN', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [] })
    topology.routeMaps = [{ id: 'map', name: 'Map', hubId: topology.hubs[0].id, rules: [] }]
    topology.hubs[0].routeMapAssignments = [{ connectionId: 'vpn', inboundMapId: 'map' }]
    expect(() => generateBicep(topology, settings)).toThrow(/Assigned hub route maps/)
  })

  it('validates names, canonical locations and selections; suggests collision-safe names', () => {
    const topology = importAzureCapture(capture())
    const settings = bicepDefaults(topology)
    for (const value of ["bad'${deployment()}", 'x'.repeat(51), '-bad', 'bad.']) {
      expect(() => generateBicep(topology, { ...settings, wanName: value })).toThrow(/Resource names/)
    }
    expect(() => generateBicep(topology, { ...settings, location: 'West Europe' })).toThrow(/canonical/)
    expect(() => generateBicep(topology, { ...settings, hubs: [] })).toThrow(/at least one/)
    expect(() => generateBicep(topology, { ...settings, hubs: [settings.hubs[0], settings.hubs[0]] })).toThrow(/duplicate/)
    topology.hubs.push({ ...structuredClone(topology.hubs[0]), id: 'other' })
    const defaults = bicepDefaults(topology)
    expect(defaults.hubs[0].name).not.toBe(defaults.hubs[1].name)
    defaults.hubs[1].name = defaults.hubs[0].name.toUpperCase()
    defaults.hubs[1].addressPrefix = '10.251.0.0/23'
    expect(() => generateBicep(topology, defaults)).toThrow(/unique/)
  })

  it('exports secured hubs (AZFW_Hub + routingIntent) and existing-VNet spoke attachments when explicitly configured (#4)', () => {
    const topology = importAzureCapture(capture())
    topology.hubs[0].routingIntent = { private: true, internet: true, privatePrefixes: [] }
    topology.spokes.push({ id: 'spoke-2', name: 'Database VNet', hubId: topology.hubs[0].id, prefixes: ['10.21.0.0/16'], propagateDefaultRoute: true })

    const settings = bicepDefaults(topology)
    // Source VNet IDs are never auto-populated as deployment targets
    expect(settings.spokes?.every((spoke) => !spoke.selected && spoke.existingVnetId === '')).toBe(true)
    expect(() => generateBicep(topology, settings)).toThrow(/Secured hubs require firewall deployment support/)

    // Custom non-RFC1918 private prefixes are blocked on Azure Routing Intent
    topology.hubs[0].routingIntent.privatePrefixes = ['100.64.0.0/10']
    settings.hubs[0].firewallPolicyId = `${base}/firewallPolicies/fw-policy`
    expect(() => generateBicep(topology, settings)).toThrow(/RFC 1918/)
    topology.hubs[0].routingIntent.privatePrefixes = []

    // Invalid firewall policy ID is rejected
    settings.hubs[0].firewallPolicyId = `${base}/virtualNetworks/not-a-policy`
    expect(() => generateBicep(topology, settings)).toThrow(/firewallPolicies/)

    settings.hubs[0].firewallPolicyId = `${base}/firewallPolicies/fw-policy`
    settings.hubs[0].firewallName = 'west-hub-fw'
    settings.hubs[0].firewallTier = 'Premium'
    settings.spokes![0].selected = true
    expect(() => generateBicep(topology, settings)).toThrow(/virtualNetworks/)

    const targetVnet1 = '/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/target-rg/providers/Microsoft.Network/virtualNetworks/app-vnet'
    const targetVnet2 = '/subscriptions/22222222-2222-2222-2222-222222222222/resourceGroups/target-rg/providers/Microsoft.Network/virtualNetworks/db-vnet'
    settings.spokes![0].existingVnetId = targetVnet1
    settings.spokes![0].enableInternetSecurity = false
    settings.spokes![1].selected = true
    settings.spokes![1].existingVnetId = targetVnet1
    expect(() => generateBicep(topology, settings)).toThrow(/unique across selected spoke attachments/)

    settings.spokes![1].existingVnetId = targetVnet2
    settings.spokes![1].enableInternetSecurity = true
    const exported = generateBicep(topology, settings)
    // 1 WAN + 1 hub + 1 AZFW_Hub + 1 routingIntent + 2 hubVirtualNetworkConnections = 6 resources
    expect(exported.resourceCount).toBe(6)
    expect(exported.text).toContain("resource hubFirewalls 'Microsoft.Network/azureFirewalls@2024-10-01'")
    expect(exported.text).toContain("name: 'AZFW_Hub'")
    expect(exported.text).toContain("firewallTier: 'Premium'")
    expect(exported.text).toContain("resource hubRoutingIntents 'Microsoft.Network/virtualHubs/routingIntent@2024-10-01'")
    expect(exported.text).toContain("'PrivateTraffic'")
    expect(exported.text).toContain("'Internet'")
    expect(exported.text).toContain("resource spokeConnections 'Microsoft.Network/virtualHubs/hubVirtualNetworkConnections@2024-10-01'")
    expect(exported.text).toContain(targetVnet1)
    expect(exported.text).toContain(targetVnet2)
    expect(exported.text).not.toContain(capture().hubs[0].connections[0].virtualNetworkId)

    const directory = join('test-artifacts', 'azure-files', 'bicep')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'extended.bicep'), exported.text)

    // Spoke NVA peers block exporting that spoke attachment
    topology.sites.push({ id: 'nva-site', name: 'NVA appliance', asn: 65010, prefixes: ['10.90.0.0/24'], role: 'spoke-nva' })
    topology.connections.push({
      id: 'nva-conn', name: 'NVA peer', hubId: topology.hubs[0].id, spokeId: topology.spokes[0].id, siteId: 'nva-site',
      transport: 'SpokeNVA', enabled: true, learnSiteRoutes: true, inbound: [], outbound: [],
    })
    expect(() => generateBicep(topology, settings)).toThrow(/Spoke NVA BGP peers/)
  })
})
