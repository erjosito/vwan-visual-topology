import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareAzNetWithObservations,
  importAzNetCapture,
} from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { analyzeAzNetConnectivity, runAzNetDiagnostics } from './diagnostics'
import { getAzNetEndpoints } from './endpoints'
import {
  lookupSubnetEffectiveRoute,
  simulateAzNet,
  traceAzNetFlow,
  traceAzNetPair,
} from './engine'
import {
  AZURE_NET_SAMPLES,
  createEmptyAzNetTopology,
  validateAzNetTopology,
  type AzNetTopology,
} from './model'
import {
  ER_PEERING_LOCATIONS_CATALOG,
  evaluateErSkuRegionalCompatibility,
  findErPeeringLocationEntry,
} from '../er-locations-catalog'

describe('Azure Networking Simulator Engine & Diagnostics', () => {
  function transitTopology(transport: 'ExpressRoute' | 'Vpn' = 'ExpressRoute'): AzNetTopology {
    const topology = createEmptyAzNetTopology()
    topology.vnets = [
      {
        id: 'hub', name: 'Hub', role: 'hub', region: 'West Europe', prefixes: ['10.0.0.0/16'],
        subnets: [{ id: 'gateway', name: 'GatewaySubnet', prefix: '10.0.255.0/27' }],
        gateways: [{ id: 'gw', name: 'Gateway', kind: transport, asn: 65515, enabled: true, bgpEnabled: true }],
        appliances: [],
      },
      {
        id: 'spoke', name: 'Spoke', role: 'spoke', region: 'West Europe', prefixes: ['10.1.0.0/16'],
        subnets: [{ id: 'work', name: 'Workload', prefix: '10.1.1.0/24' }],
        gateways: [], appliances: [],
      },
    ]
    topology.vnetPeerings = [{
      id: 'peer', name: 'Hub-Spoke', enabled: true, vnetAId: 'hub', vnetBId: 'spoke',
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
    }]
    topology.sites = [{ id: 'site', name: 'On-prem', asn: 65001, prefixes: ['172.16.0.0/24'] }]
    if (transport === 'ExpressRoute') {
      topology.erLocations = [{ id: 'er', name: 'Amsterdam', peeringLocation: 'Amsterdam', sku: 'Standard' }]
      topology.erLinks = [
        { id: 'er-gw', name: 'Gateway circuit', locationId: 'er', targetKind: 'vnet-gateway', targetId: 'gw', enabled: true },
        { id: 'er-site', name: 'Site circuit', locationId: 'er', targetKind: 'site', targetId: 'site', enabled: true },
      ]
    } else {
      topology.vpnConnections = [{ id: 'vpn', name: 'S2S', siteId: 'site', targetKind: 'vnet-gateway', targetId: 'gw', bgpEnabled: true, enabled: true }]
    }
    return topology
  }

  const expectedPair = { scope: 'pair', sourceKey: 'subnet:spoke:work', destinationKey: 'site:site:172.16.0.0/24' } as const

  it('checks distinct on-premises sites across their prefixes in landscape scope and clears repaired failures', () => {
    const topology = createEmptyAzNetTopology()
    topology.sites = [
      { id: 'a', name: 'A', asn: 65001, prefixes: ['10.10.0.0/24', '10.11.0.0/24', '10.10.0.0/24'] },
      { id: 'b', name: 'B', asn: 65002, prefixes: ['10.20.0.0/24'] },
      { id: 'c', name: 'C', asn: 65003, prefixes: ['10.30.0.0/24'] },
    ]
    const scope = { scope: 'landscape' } as const
    const disconnected = analyzeAzNetConnectivity(topology, simulateAzNet(topology), scope)
    expect(disconnected).toMatchObject({ checked: 5, total: 5, complete: true })
    expect(disconnected.findings).toHaveLength(5)
    expect(new Set(disconnected.findings.map((finding) => finding.id)).size).toBe(5)
    for (const finding of disconnected.findings) {
      expect(finding).toMatchObject({ category: 'connectivity-failure', severity: 'error' })
      expect(finding.sampleFlow!.source).not.toEqual(finding.sampleFlow!.destination)
      expect(finding.summary).toContain('Forward')
      expect(finding.summary).toContain('Return')
    }
    topology.siteLinks = [
      { id: 'ab', name: 'A-B', siteAId: 'a', siteBId: 'b', enabled: true },
      { id: 'bc', name: 'B-C', siteAId: 'b', siteBId: 'c', enabled: true },
    ]
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), scope).findings).toEqual([])
  })

  it('includes workload and distinct-site pairs without treating infrastructure or self pairs as workloads', () => {
    const topology = transitTopology()
    topology.vnets[0].subnets.push({ id: 'hub-work', name: 'Hub workload', prefix: '10.0.1.0/24' })
    topology.sites.push({ id: 'other', name: 'Other site', asn: 65002, prefixes: ['172.18.0.0/24'] })
    const report = analyzeAzNetConnectivity(topology, simulateAzNet(topology), { scope: 'landscape' })
    expect(report).toMatchObject({ checked: 6, total: 6, complete: true })
    expect(report.findings.some((finding) => finding.sourceKey?.startsWith('site:') &&
      finding.destinationKey?.startsWith('site:'))).toBe(true)
    expect(report.findings.some((finding) => finding.sourceKey?.endsWith(':gateway') ||
      finding.destinationKey?.endsWith(':gateway'))).toBe(false)
  })

  it('exposes incomplete landscape coverage when the shared pair budget is exhausted', () => {
    const topology = createEmptyAzNetTopology()
    topology.sites = Array.from({ length: 22 }, (_, i) => ({
      id: `site-${i}`, name: `Site ${i}`, asn: 65000 + i, prefixes: [`10.${i}.0.0/24`],
    }))
    const report = analyzeAzNetConnectivity(topology, simulateAzNet(topology), { scope: 'landscape' })
    expect(report).toMatchObject({ checked: 200, total: 231, complete: false })
    expect(report.findings).toHaveLength(200)
  })

  it.each(['ExpressRoute', 'Vpn'] as const)('analyzes %s transit loss in both directions and clears findings after repair', (transport) => {
    const topology = transitTopology(transport)
    const analyze = () => analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair)
    expect(analyze()).toMatchObject({ checked: 1, total: 1, complete: true, findings: [] })
    for (const disabled of ['remote', 'transit', 'both']) {
      topology.vnetPeerings[0].bToA.useRemoteGateways = disabled === 'transit'
      topology.vnetPeerings[0].aToB.allowGatewayTransit = disabled === 'remote'
      const finding = analyze().findings[0]
      expect(finding).toMatchObject({ category: 'connectivity-failure', severity: 'error', peeringId: 'peer' })
      expect(finding.summary).toContain('Return')
      expect(finding.summary).toContain('useRemoteGateways / allowGatewayTransit')
      topology.vnetPeerings[0].bToA.useRemoteGateways = true
      topology.vnetPeerings[0].aToB.allowGatewayTransit = true
      expect(analyze().findings).toEqual([])
    }
  })

  it('distinguishes intentional suppression from a failed expected flow and honors alternate UDR paths', () => {
    const topology = JSON.parse(readFileSync(resolve(process.cwd(), 'samples', 'azure-net', 'uc1-hub-spoke-nva-ars-baseline.json'), 'utf8')) as AzNetTopology
    const table = topology.udrTables.find((t) => t.id === 'rt-spoke1')!
    table.disableBgpRoutePropagation = true
    table.routes.push({
      id: 'branch', name: 'Branch via NVA', prefix: '10.250.0.0/16', nextHopType: 'VirtualAppliance',
      nextHopIp: '10.100.2.4', enabled: true,
    })
    const scope = { scope: 'pair', sourceKey: 'subnet:vnet-spoke1:sub-spoke1-work', destinationKey: 'site:site-branch1:10.250.0.0/16' } as const
    const simulation = simulateAzNet(topology)
    expect(simulation.subnetTables['sub-spoke1-work'].suppressedBgpRoutes.length).toBeGreaterThan(0)
    expect(analyzeAzNetConnectivity(topology, simulation, scope).findings).toEqual([])
    table.routes = table.routes.filter((r) => r.id !== 'branch')
    const isolatedSimulation = simulateAzNet(topology)
    expect(runAzNetDiagnostics(topology, isolatedSimulation)).toContainEqual(expect.objectContaining({
      category: 'bgp-routes-suppressed', subnetId: 'sub-spoke1-work', severity: 'info',
    }))
    expect(analyzeAzNetConnectivity(topology, isolatedSimulation, scope).findings[0]?.category).toBe('connectivity-failure')
  })

  it('reports a missing ER return advertisement even when a UDR preserves the outbound path', () => {
    const topology = transitTopology()
    topology.udrTables = [{
      id: 'rt', name: 'Explicit next hop', disableBgpRoutePropagation: false,
      routes: [{ id: 'onprem', name: 'On-prem', prefix: '172.16.0.0/24', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.2.4', enabled: true }],
    }]
    topology.vnets[0].subnets.push({ id: 'nva-sub', name: 'NVA', prefix: '10.0.2.0/24' })
    topology.vnets[0].appliances.push({
      id: 'nva', name: 'Router', kind: 'nva-vm', subnetId: 'nva-sub', privateIp: '10.0.2.4',
      enableIpForwarding: true, staticRoutes: [],
    })
    topology.vnets[1].subnets[0].routeTableId = 'rt'
    topology.vnetPeerings[0].bToA.useRemoteGateways = false
    const simulation = simulateAzNet(topology)
    const pair = traceAzNetPair(topology, simulation,
      { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '10.1.1.4',
      { kind: 'site', siteId: 'site' }, '172.16.0.4')
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).not.toBe('delivered')
    expect(analyzeAzNetConnectivity(topology, simulation, expectedPair).findings[0].summary).toContain('Return')
  })

  it('does not report lost gateway transit when an alternate local ER path still delivers both ways', () => {
    const topology = transitTopology()
    topology.vnetPeerings[0].aToB.allowGatewayTransit = false
    topology.vnetPeerings[0].bToA.useRemoteGateways = false
    topology.vnets[1].gateways.push({
      id: 'spoke-gw', name: 'Alternate gateway', kind: 'ExpressRoute', asn: 65515, enabled: true, bgpEnabled: true,
    })
    topology.vnets[1].subnets.push({ id: 'spoke-gateway', name: 'GatewaySubnet', prefix: '10.1.255.0/27' })
    topology.erLinks.push({
      id: 'alternate', name: 'Alternate circuit connection', locationId: 'er',
      targetKind: 'vnet-gateway', targetId: 'spoke-gw', enabled: true,
    })
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings).toEqual([])
  })

  it.each(['blackhole', 'unreachable', 'loop'] as const)('reports an actual %s in the expected forwarding path', (failure) => {
    const topology = transitTopology()
    topology.udrTables.push({
      id: 'bad-path', name: 'Broken route', disableBgpRoutePropagation: false,
      routes: [{
        id: 'broken', name: 'Broken', prefix: '172.16.0.0/24', enabled: true,
        nextHopType: failure === 'blackhole' ? 'None' : 'VirtualAppliance',
        nextHopIp: failure === 'loop' ? '10.0.2.4' : '10.0.99.4',
      }],
    })
    topology.vnets[1].subnets[0].routeTableId = 'bad-path'
    if (failure === 'loop') {
      topology.vnets[0].subnets.push({ id: 'nva-sub', name: 'NVA', prefix: '10.0.2.0/24', routeTableId: 'bad-path' })
      topology.vnets[0].appliances.push({
        id: 'nva', name: 'Looping router', kind: 'nva-vm', subnetId: 'nva-sub', privateIp: '10.0.2.4',
        enableIpForwarding: true,
        staticRoutes: [{ id: 'to-second', prefix: '172.16.0.0/24', nextHopKind: 'appliance', nextHopIp: '10.0.2.5', enabled: true }],
      }, {
        id: 'second-nva', name: 'Second router', kind: 'nva-vm', subnetId: 'nva-sub', privateIp: '10.0.2.5',
        enableIpForwarding: true,
        staticRoutes: [{ id: 'to-first', prefix: '172.16.0.0/24', nextHopKind: 'appliance', nextHopIp: '10.0.2.4', enabled: true }],
      })
    }
    const simulation = simulateAzNet(topology)
    const trace = traceAzNetFlow(topology, simulation, { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '172.16.0.4')
    expect(trace.status).toBe(failure === 'loop' ? 'loop' : failure === 'blackhole' ? 'dropped-blackhole' : 'dropped-no-route')
    const finding = analyzeAzNetConnectivity(topology, simulation, expectedPair).findings[0]
    expect(finding).toMatchObject({ category: 'connectivity-failure', severity: 'error' })
    expect(finding.summary).toContain(trace.summaryReason)
  })

  it('still flags invalid GatewaySubnet propagation while leaving informational findings non-actionable', () => {
    const topology = transitTopology()
    topology.udrTables.push({ id: 'gateway-table', name: 'Gateway', disableBgpRoutePropagation: true, routes: [] })
    topology.vnets[0].subnets[0].routeTableId = 'gateway-table'
    expect(runAzNetDiagnostics(topology, simulateAzNet(topology)))
      .toContainEqual(expect.objectContaining({ category: 'gateway-subnet-bgp-disabled', severity: 'error' }))
  })

  it('keeps intentional isolation outside the expected scope and exposes limits and removed endpoints', () => {
    const topology = transitTopology()
    topology.vnets.push({
      id: 'isolated', name: 'Isolated', role: 'spoke', region: 'West Europe', prefixes: ['10.9.0.0/16'],
      subnets: [{ id: 'isolated-work', name: 'Work', prefix: '10.9.1.0/24' }], gateways: [], appliances: [],
    })
    topology.sites[0].prefixes.push('172.17.0.0/24')
    const simulation = simulateAzNet(topology)
    expect(analyzeAzNetConnectivity(topology, simulation, expectedPair).findings).toEqual([])
    const all = analyzeAzNetConnectivity(topology, simulation, { scope: 'all' })
    expect(all.findings.some((f) => f.vnetId === 'isolated')).toBe(true)
    expect(all).toMatchObject({ total: 5, checked: 5, complete: true })
    expect(analyzeAzNetConnectivity(topology, simulation, { scope: 'all' }, 1))
      .toMatchObject({ total: 5, checked: 1, complete: false })
    topology.sites[0].prefixes.reverse()
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair).findings).toEqual([])
    topology.sites[0].prefixes = ['172.17.0.0/24']
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair))
      .toMatchObject({ total: 1, checked: 0, complete: false })
    topology.vnets[1].subnets = []
    expect(analyzeAzNetConnectivity(topology, simulateAzNet(topology), expectedPair))
      .toMatchObject({ total: 1, checked: 0, complete: false })
    expect(getAzNetEndpoints(topology).filter((e) => e.group === 'site').map((e) => e.prefix))
      .toEqual(['172.17.0.0/24'])
  })

  it('finds stateful asymmetry in the scoped pair without treating harmless path differences as faults', () => {
    const topology = AZURE_NET_SAMPLES[0].topology
    const analysis = analyzeAzNetConnectivity(topology, simulateAzNet(topology), {
      scope: 'pair', sourceKey: 'subnet:vnet-spoke-data:sub-data-db', destinationKey: 'site:site-munich-hq:172.16.10.0/24',
    })
    expect(analysis.findings[0]).toMatchObject({ category: 'asymmetric-firewall-bypass', severity: 'warning' })
    expect(analysis.findings[0].summary).toContain('AzFW-Hub-WEU')
    const harmless = transitTopology()
    harmless.vnets[0].gateways.push({
      id: 'vpn-gw', name: 'VPN return gateway', kind: 'Vpn', asn: 65515, enabled: true, bgpEnabled: true,
    })
    harmless.vpnConnections.push({
      id: 'vpn-return', name: 'VPN return path', siteId: 'site', targetKind: 'vnet-gateway',
      targetId: 'vpn-gw', bgpEnabled: true, enabled: true, inboundPrepend: [65002, 65002, 65002],
    })
    const simulation = simulateAzNet(harmless)
    // Model an independent on-premises preference for the VPN return route.
    simulation.siteRibs.site = simulation.siteRibs.site.map((route) => ({
      ...route, preferred: route.originProtocol === 'VPN' || route.originProtocol === 'VNet',
    }))
    const pair = traceAzNetPair(harmless, simulation,
      { kind: 'subnet', vnetId: 'spoke', subnetId: 'work' }, '10.1.1.4',
      { kind: 'site', siteId: 'site' }, '172.16.0.4')
    expect(pair.forward.traversedEdgeIds).toContain('er-gw')
    expect(pair.reverse.traversedEdgeIds).toContain('vpn-return')
    expect(pair.symmetricInspection).toBe(true)
    expect(analyzeAzNetConnectivity(harmless, simulation, expectedPair).findings).toEqual([])
  })

  it('validates all 5 canonical Azure Networking sample topologies and keeps samples/azure-net + public/docs/samples/azure-net in sync', () => {
    const samplesDir = resolve(process.cwd(), 'samples', 'azure-net')
    const publicDir = resolve(process.cwd(), 'public', 'docs', 'samples', 'azure-net')

    for (const sample of AZURE_NET_SAMPLES) {
      const errors = validateAzNetTopology(sample.topology)
      expect(errors, `Sample ${sample.id} had validation errors`).toEqual([])
      const sim = simulateAzNet(sample.topology)
      expect(Object.keys(sim.subnetTables).length).toBeGreaterThan(0)
      const bicep = generateAzNetBicep(sample.topology)
      expect(bicep.resourceCount).toBeGreaterThan(0)

      const samplePath = resolve(samplesDir, `${sample.id}.json`)
      const onDisk = JSON.parse(readFileSync(samplePath, 'utf-8')) as AzNetTopology
      expect(onDisk).toEqual(sample.topology)
    }

    const sampleFiles = readdirSync(samplesDir).filter((f) => f.endsWith('.json'))
    expect(sampleFiles.length).toBeGreaterThanOrEqual(14)
    for (const file of sampleFiles) {
      const srcPath = resolve(samplesDir, file)
      const pubPath = resolve(publicDir, file)
      const srcTopo = JSON.parse(readFileSync(srcPath, 'utf-8')) as AzNetTopology
      const pubTopo = JSON.parse(readFileSync(pubPath, 'utf-8')) as AzNetTopology
      expect(validateAzNetTopology(srcTopo), `${file} validation`).toEqual([])
      expect(pubTopo, `${file} public mirror`).toEqual(srcTopo)
    }
  })

  it('evaluates Private Endpoint /32 LPM override and GatewaySubnet asymmetric firewall bypass in Sample 1', () => {
    const topo = AZURE_NET_SAMPLES[0].topology
    const sim = simulateAzNet(topo)
    const spokeDataDbTable = sim.subnetTables['sub-data-db']
    expect(spokeDataDbTable).toBeDefined()

    // 10.2.2.15 is the Private Endpoint in VNet-Spoke-Data -> /32 InterfaceEndpoint beats 10.0.0.0/8 UDR in sub-data-db and peered VNet-Hub-WEU
    const peWinner = lookupSubnetEffectiveRoute(spokeDataDbTable, '10.2.2.15')
    expect(peWinner?.nextHopType).toBe('InterfaceEndpoint')
    expect(peWinner?.prefix).toBe('10.2.2.15/32')

    // 10.1.1.10 is a VM in VNet-Spoke-App -> matches 10.0.0.0/8 UDR to Azure Firewall (10.0.1.4)
    const vmWinner = lookupSubnetEffectiveRoute(spokeDataDbTable, '10.1.1.10')
    expect(vmWinner?.nextHopType).toBe('VirtualAppliance')
    expect(vmWinner?.nextHopIp).toBe('10.0.1.4')

    // VNet-Spoke-Data (10.2.1.4) <-> Munich Core DC (172.16.10.4) has an asymmetric firewall bypass on GatewaySubnet
    const pair = traceAzNetPair(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-data', subnetId: 'sub-data-db' },
      '10.2.1.4',
      { kind: 'site', siteId: 'site-munich-hq' },
      '172.16.10.4',
    )
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).toBe('delivered')
    expect(pair.symmetricInspection).toBe(false)
    expect(pair.asymmetricBypassApplianceNames[0]).toContain('AzFW-Hub-WEU')

    const findings = runAzNetDiagnostics(topo, sim)
    expect(findings.some((f) => f.category === 'gateway-subnet-missing-udr')).toBe(true)
    expect(findings.some((f) => f.category === 'private-endpoint-udr-bypass')).toBe(true)
  })

  it('propagates Azure Route Server (ASN 65515) BGP routes and detects disableBgpRoutePropagation blackholes in Sample 2', () => {
    const topo = AZURE_NET_SAMPLES[1].topology
    const sim = simulateAzNet(topo)

    // VNet-Spoke-SAP (sub-sap-app) learns 192.168.100.0/24 from ARS via SDWAN-Edge-NVA (10.100.2.10)
    const sapAppTable = sim.subnetTables['sub-sap-app']
    const sdwanRoute = lookupSubnetEffectiveRoute(sapAppTable, '192.168.100.10')
    expect(sdwanRoute?.source).toBe('RouteServer')
    expect(sdwanRoute?.nextHopType).toBe('VirtualAppliance')
    expect(sdwanRoute?.nextHopIp).toBe('10.100.2.10')

    // sub-sap-db has disableBgpRoutePropagation=true -> BGP routes suppressed -> drops private flow
    const brokenTable = sim.subnetTables['sub-sap-db']
    expect(brokenTable.bgpPropagationDisabled).toBe(true)
    expect(brokenTable.suppressedBgpRoutes.length).toBeGreaterThan(0)

    const brokenTrace = traceAzNetFlow(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-erp', subnetId: 'sub-sap-db' },
      '192.168.100.10',
    )
    expect(brokenTrace.status).toBe('dropped-no-route')

    const findings = runAzNetDiagnostics(topo, sim)
    expect(findings).toContainEqual(expect.objectContaining({ category: 'bgp-routes-suppressed', severity: 'info' }))
  })

  it('traces multi-region Managed VNRA 100 Gbps transit and catches allowVirtualNetworkAccess=false in Sample 3', () => {
    const topo = AZURE_NET_SAMPLES[2].topology
    const sim = simulateAzNet(topo)

    // VNet-Spoke-WEU-A -> VNet-Spoke-NEU-B succeeds across both regional VNRAs
    const okPair = traceAzNetPair(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-r1-a', subnetId: 'sub-r1a-work' },
      '10.11.1.4',
      { kind: 'subnet', vnetId: 'vnet-spoke-r2-b', subnetId: 'sub-r2b-work' },
      '10.21.1.4',
    )
    expect(okPair.forward.status).toBe('delivered')
    expect(okPair.reverse.status).toBe('delivered')
    expect(okPair.forward.traversedApplianceIds).toEqual(['app-vnra-r1', 'app-vnra-r2'])

    // VNet-Spoke-NEU-C has allowVirtualNetworkAccess=false on its peering with VNet-Hub-Region2-NEU
    const blockedTrace = traceAzNetFlow(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-spoke-r2-c', subnetId: 'sub-r2c-work' },
      '10.11.1.4',
    )
    expect(blockedTrace.status).toBe('dropped-peering-access')

    const findings = runAzNetDiagnostics(topo, sim)
    expect(findings.some((f) => f.category === 'vnra-peering-access-disabled')).toBe(true)
  })

  it('models Hybrid Secured vWAN Hub and Classic Hub-and-Spoke coexistence in Sample 4', () => {
    const topo = AZURE_NET_SAMPLES[3].topology
    const sim = simulateAzNet(topo)

    const pair = traceAzNetPair(
      topo,
      sim,
      { kind: 'subnet', vnetId: 'vnet-vwan-spoke-1', subnetId: 'sub-vwan-ai' },
      '10.50.1.4',
      { kind: 'subnet', vnetId: 'vnet-legacy-spoke', subnetId: 'sub-leg-core' },
      '10.61.1.4',
    )
    expect(pair.forward.status).toBe('delivered')
    expect(pair.reverse.status).toBe('delivered')
    expect(pair.symmetricInspection).toBe(true)
  })

  it('validates UC1–UC5 JSON topologies, GatewaySubnet proxy parity, and Bicep generation', () => {
    const ucFiles = [
      'uc1-hub-spoke-nva-ars-baseline.json',
      'uc2-gateway-subnet-missing-udr-asymmetry.json',
      'uc3-bgp-propagation-and-peering-gates.json',
      'uc4-private-endpoint-udr-override.json',
      'uc5-ars-branch-to-branch-and-bgp-selection.json',
    ]

    const loaded: Record<string, AzNetTopology> = {}
    for (const file of ucFiles) {
      const raw = readFileSync(resolve(process.cwd(), 'samples', 'azure-net', file), 'utf-8')
      const topo = JSON.parse(raw) as AzNetTopology
      expect(validateAzNetTopology(topo), `${file} schema validation`).toEqual([])
      const bicep = generateAzNetBicep(topo)
      expect(bicep.resourceCount, `${file} bicep resourceCount`).toBeGreaterThan(0)
      expect(bicep.text).toContain("resource vnet_vnet_hub 'Microsoft.Network/virtualNetworks@")
      expect(bicep.text).toContain("name: 'snet-gw-proxy'")
      expect(bicep.text).toContain('id: rt_rt_gw_subnet.id')
      loaded[file] = topo
    }

    // UC1: snet-gw-proxy and GatewaySubnet have identical effective routes and symmetric inspection
    const uc1 = loaded['uc1-hub-spoke-nva-ars-baseline.json']
    const sim1 = simulateAzNet(uc1)
    const gwSubRoutes = sim1.subnetTables['sub-hub-gw'].routes
    const proxyRoutes = sim1.subnetTables['sub-hub-gw-proxy'].routes
    expect(proxyRoutes.map((r) => `${r.prefix}:${r.source}:${r.nextHopType}:${r.active}`)).toEqual(
      gwSubRoutes.map((r) => `${r.prefix}:${r.source}:${r.nextHopType}:${r.active}`),
    )
    const uc1Pair = traceAzNetPair(
      uc1,
      sim1,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.1.4',
      { kind: 'site', siteId: 'site-branch1' },
      '192.168.100.4',
    )
    expect(uc1Pair.symmetricInspection).toBe(true)

    // UC2: Missing UDR on rt-gw-subnet causes asymmetric bypass on return path
    const uc2 = loaded['uc2-gateway-subnet-missing-udr-asymmetry.json']
    const sim2 = simulateAzNet(uc2)
    const uc2Pair = traceAzNetPair(
      uc2,
      sim2,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.1.4',
      { kind: 'site', siteId: 'site-branch1' },
      '192.168.100.4',
    )
    expect(uc2Pair.symmetricInspection).toBe(false)
    // The sample's site prefix is 10.250.0.0/16, not the NVA advertisement above.
    // An unrelated firewall UDR is not proof of asymmetric site connectivity.
    expect(runAzNetDiagnostics(uc2, sim2).some((f) => f.category === 'gateway-subnet-missing-udr')).toBe(false)

    // UC3: disableBgpRoutePropagation on rt-spoke2 + allowForwardedTraffic=false on vnet-spoke1
    const uc3 = loaded['uc3-bgp-propagation-and-peering-gates.json']
    const sim3 = simulateAzNet(uc3)
    expect(sim3.subnetTables['sub-spoke2-work'].bgpPropagationDisabled).toBe(true)
    const spoke2ToSpoke1Flow = traceAzNetFlow(
      uc3,
      sim3,
      { kind: 'subnet', vnetId: 'vnet-spoke2', subnetId: 'sub-spoke2-work' },
      '10.101.1.4',
    )
    expect(spoke2ToSpoke1Flow.status).toBe('dropped-peering-forwarded-traffic')

    // UC4: RouteTableEnabled allows /32 UDR to override Private Endpoint InterfaceEndpoint
    const uc4 = loaded['uc4-private-endpoint-udr-override.json']
    const sim4 = simulateAzNet(uc4)
    const peWinner4 = lookupSubnetEffectiveRoute(sim4.subnetTables['sub-spoke2-work'], '10.101.2.4')
    expect(peWinner4?.source).toBe('User')
    expect(peWinner4?.nextHopType).toBe('VirtualAppliance')
    expect(peWinner4?.nextHopIp).toBe('10.100.2.4')

    // UC5: ARS branchToBranchTraffic=false suppresses NVA<->VNG transit
    const uc5 = loaded['uc5-ars-branch-to-branch-and-bgp-selection.json']
    const sim5 = simulateAzNet(uc5)
    const arsRib5 = sim5.routeServerRibs['ars-hub']
    expect(arsRib5.some((r) => r.prefix === '192.168.100.0/24' && r.preferred)).toBe(true)
    expect(sim1.gatewayRibs['vng-hub-vpn'].some((r) => r.prefix === '192.168.100.0/24')).toBe(true)
    const vngRib5 = sim5.gatewayRibs['vng-hub-vpn']
    expect(vngRib5.some((r) => r.prefix === '192.168.100.0/24')).toBe(false)
  })

  it('imports azure-network-capture v2 JSON and compares NIC effective routes including GatewaySubnet proxy', () => {
    const rawUc1 = readFileSync(
      resolve(process.cwd(), 'samples', 'azure-net', 'uc1-hub-spoke-nva-ars-baseline.json'),
      'utf-8',
    )
    const uc1 = JSON.parse(rawUc1) as AzNetTopology
    const sim1 = simulateAzNet(uc1)
    const proxySimulated = sim1.subnetTables['sub-hub-gw-proxy'].routes

    const capture = {
      kind: 'azure-network-capture',
      version: 2,
      resourceGroup: 'rg-aznet-sim-lab',
      vnets: [
        {
          id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet-aznet-hub',
          name: 'vnet-aznet-hub',
          location: 'swedencentral',
          addressSpace: { addressPrefixes: ['10.100.0.0/16'] },
          subnets: [
            {
              id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet-aznet-hub/subnets/GatewaySubnet',
              name: 'GatewaySubnet',
              addressPrefix: '10.100.0.0/26',
              routeTable: {
                id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/routeTables/rt-gw-subnet',
              },
            },
            {
              id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet-aznet-hub/subnets/snet-gw-proxy',
              name: 'snet-gw-proxy',
              addressPrefix: '10.100.4.0/24',
              routeTable: {
                id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/routeTables/rt-gw-subnet',
              },
            },
          ],
        },
      ],
      routeTables: [
        {
          id: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/routeTables/rt-gw-subnet',
          name: 'rt-gw-subnet',
          disableBgpRoutePropagation: false,
          routes: [
            {
              name: 'udr-gw-to-spoke1-via-nva',
              addressPrefix: '10.101.0.0/16',
              nextHopType: 'VirtualAppliance',
              nextHopIpAddress: '10.100.2.4',
            },
          ],
        },
      ],
      nicEffectiveRoutes: [
        {
          nicName: 'nic-vm-gw-proxy',
          nicId: '/subscriptions/000/resourceGroups/rg/providers/Microsoft.Network/networkInterfaces/nic-vm-gw-proxy',
          vnetName: 'vnet-aznet-hub',
          subnetName: 'snet-gw-proxy',
          effectiveRoutes: proxySimulated.map((r) => ({
            addressPrefix: [r.prefix],
            nextHopType: r.nextHopType,
            nextHopIpAddress: r.nextHopIp ? [r.nextHopIp] : [],
            source: r.source === 'RouteServer' ? 'VirtualNetworkGateway' : r.source,
            state: r.active ? 'Active' : 'Invalid',
          })),
        },
      ],
    }

    const imported = importAzNetCapture(capture)
    expect(imported.topology.vnets).toHaveLength(1)
    expect(imported.observations).toBeDefined()

    const directCompare = compareAzNetWithObservations(uc1, sim1, imported.observations!)
    expect(directCompare.subnetComparisons).toHaveLength(1)
    expect(directCompare.subnetComparisons[0].proxyForGatewaySubnet).toBe(true)
    expect(directCompare.subnetComparisons[0].mismatchCount).toBe(0)
    expect(directCompare.totalMatchedRoutes).toBeGreaterThan(0)
  })

  it('reproduces all 8 empirical live Azure captures (uc1..uc8) with zero effective-route mismatches', () => {
    const pairs: Array<[string, string]> = [
      ['uc1-capture.json', 'uc1-hub-spoke-nva-ars-baseline.json'],
      ['uc2-capture.json', 'uc2-gateway-subnet-missing-udr-asymmetry.json'],
      ['uc3-capture.json', 'uc3-bgp-propagation-and-peering-gates.json'],
      ['uc4-capture.json', 'uc4-private-endpoint-udr-override.json'],
      ['uc5-capture.json', 'uc5-ars-branch-to-branch-and-bgp-selection.json'],
      ['uc6-capture.json', 'uc6-ars-default-route-self-blackhole.json'],
      ['uc7-capture.json', 'uc7-bgp-lpm-bypasses-summary-udr.json'],
      ['uc8-capture.json', 'uc8-udr-next-hop-types-and-vng-transit-trap.json'],
    ]

    for (const [capFile, sampleFile] of pairs) {
      const capRaw = readFileSync(
        resolve(process.cwd(), 'verification', 'azure-net-2026-11-03', capFile),
        'utf-8',
      )
      const cap = JSON.parse(capRaw)
      const imp = importAzNetCapture(cap)
      expect(imp.observations, `${capFile} observations`).toBeDefined()

      const impSim = simulateAzNet(imp.topology)
      const impCmp = compareAzNetWithObservations(imp.topology, impSim, imp.observations!)
      const mismatched = impCmp.subnetComparisons.flatMap((sc) =>
        sc.rows.filter((r) => !r.matched).map((r) => ({ vnet: sc.vnetName, subnet: sc.subnetName, ...r })),
      )
      expect(mismatched, `${capFile} imported mismatches`).toEqual([])
      expect(impCmp.totalMismatchedRoutes, `${capFile} imported mismatches`).toBe(0)
      expect(impCmp.totalMatchedRoutes, `${capFile} imported matches`).toBeGreaterThanOrEqual(27)

      const sampleRaw = readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', sampleFile),
        'utf-8',
      )
      const sample = JSON.parse(sampleRaw) as AzNetTopology
      const sampleSim = simulateAzNet(sample)
      const sampleCmp = compareAzNetWithObservations(sample, sampleSim, imp.observations!)
      expect(sampleCmp.totalMismatchedRoutes, `${capFile} vs ${sampleFile} mismatches`).toBe(0)
      expect(sampleCmp.totalMatchedRoutes, `${capFile} vs ${sampleFile} matches`).toBeGreaterThanOrEqual(25)
    }
  })

  it('validates Phase 2 unusual scenarios (UC6..UC9) and reserved ASN / static route edge cases', () => {
    // UC6: NVA advertises 0.0.0.0/0 to ARS -> ARS injects 0.0.0.0/0 -> 10.100.2.4 into snet-nva, causing self-loop
    const uc6 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc6-ars-default-route-self-blackhole.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc6)).toEqual([])
    expect(generateAzNetBicep(uc6).resourceCount).toBeGreaterThan(0)
    const sim6 = simulateAzNet(uc6)
    const nvaDefaultWinner = lookupSubnetEffectiveRoute(sim6.subnetTables['sub-hub-nva'], '8.8.8.8')
    expect(nvaDefaultWinner?.source).toBe('RouteServer')
    expect(nvaDefaultWinner?.nextHopIp).toBe('10.100.2.4')
    const spokeToInternet6 = traceAzNetFlow(
      uc6,
      sim6,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '8.8.8.8',
    )
    expect(spokeToInternet6.status).toBe('loop')
    const diag6 = runAzNetDiagnostics(uc6, sim6)
    expect(diag6.some((f) => f.category === 'ars-default-route-self-loop')).toBe(true)

    // Remediating UC6 by adding UDR 0.0.0.0/0 -> Internet on rt-hub-nva breaks the self-loop
    const uc6Fixed = JSON.parse(JSON.stringify(uc6)) as AzNetTopology
    uc6Fixed.udrTables.find((t) => t.id === 'rt-hub-nva')!.routes.push({
      id: 'udr-nva-internet',
      name: 'default-to-internet',
      prefix: '0.0.0.0/0',
      nextHopType: 'Internet',
      enabled: true,
    })
    const sim6Fixed = simulateAzNet(uc6Fixed)
    const nvaDefaultFixed = lookupSubnetEffectiveRoute(sim6Fixed.subnetTables['sub-hub-nva'], '8.8.8.8')
    expect(nvaDefaultFixed?.source).toBe('User')
    expect(nvaDefaultFixed?.nextHopType).toBe('Internet')
    const spokeToInternet6Fixed = traceAzNetFlow(
      uc6Fixed,
      sim6Fixed,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '8.8.8.8',
    )
    expect(spokeToInternet6Fixed.status).toBe('delivered')
    expect(spokeToInternet6Fixed.traversedApplianceIds).toContain('app-hub-nva')

    // UC7: More-specific /16 BGP route (10.250.0.0/16) wins by LPM over summary /8 UDR (10.0.0.0/8 -> NVA)
    const uc7 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc7-bgp-lpm-bypasses-summary-udr.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc7)).toEqual([])
    const sim7 = simulateAzNet(uc7)
    const lpm16Winner = lookupSubnetEffectiveRoute(sim7.subnetTables['sub-spoke1-work'], '10.250.0.100')
    expect(lpm16Winner?.prefix).toBe('10.250.0.0/16')
    expect(lpm16Winner?.source).toBe('VirtualNetworkGateway')
    const lpm8Winner = lookupSubnetEffectiveRoute(sim7.subnetTables['sub-spoke1-work'], '10.200.1.4')
    expect(lpm8Winner?.prefix).toBe('10.0.0.0/8')
    expect(lpm8Winner?.source).toBe('User')
    const pair7 = traceAzNetPair(
      uc7,
      sim7,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.1.4',
      { kind: 'site', siteId: 'site-branch1' },
      '10.250.0.100',
    )
    expect(pair7.forward.status).toBe('delivered')
    expect(pair7.reverse.status).toBe('delivered')
    expect(pair7.symmetricInspection).toBe(false)
    const diag7 = runAzNetDiagnostics(uc7, sim7)
    expect(diag7.some((f) => f.category === 'bgp-lpm-bypasses-udr')).toBe(true)
    expect(diag7.some((f) => f.category === 'asymmetric-firewall-bypass')).toBe(true)

    // UC8: NextHopType=None blackhole, NextHopType=Internet override, and invalid NextHopType=VirtualNetworkGateway for Spoke2
    const uc8 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc8-udr-next-hop-types-and-vng-transit-trap.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc8)).toEqual([])
    const sim8 = simulateAzNet(uc8)
    const carveoutFlow = traceAzNetFlow(
      uc8,
      sim8,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.101.128.10',
    )
    expect(carveoutFlow.status).toBe('dropped-blackhole')
    const spoke1ToSpoke2InvalidVng = traceAzNetFlow(
      uc8,
      sim8,
      { kind: 'subnet', vnetId: 'vnet-spoke1', subnetId: 'sub-spoke1-work' },
      '10.102.1.4',
    )
    expect(spoke1ToSpoke2InvalidVng.status).toBe('dropped-no-route')
    const diag8 = runAzNetDiagnostics(uc8, sim8)
    expect(diag8.some((f) => f.category === 'udr-vng-vnet-transit')).toBe(true)

    // UC9: VNet-to-VNet transit hairpin via shared ExpressRoute MSEE (ASN 12076)
    const uc9 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc9-expressroute-hairpin-two-vnets.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    expect(validateAzNetTopology(uc9)).toEqual([])
    const sim9 = simulateAzNet(uc9)
    const spokeAToSpokeB = traceAzNetFlow(
      uc9,
      sim9,
      { kind: 'subnet', vnetId: 'vnet-spoke-a', subnetId: 'sub-spoke-a-work' },
      '10.201.1.4',
    )
    expect(spokeAToSpokeB.status).toBe('delivered')
    expect(spokeAToSpokeB.hops.some((h) => h.nodeKind === 'er-location')).toBe(true)

    // Reserved ASN (65515 / 12076) on NVA peering with ARS is rejected
    const ucReservedAsn = JSON.parse(JSON.stringify(uc6Fixed)) as AzNetTopology
    ucReservedAsn.vnets[0].appliances[0].asn = 65515
    const simReserved = simulateAzNet(ucReservedAsn)
    expect(
      simReserved.routeServerRibs['ars-hub'].some((r) => r.prefix === '192.168.100.0/24'),
    ).toBe(false)
  })

  it('validates disablePeeringRoutePropagation (Preview), PeerBypass diagnostics, defaultOutboundAccess, and ExpressRoute MSEE Hairpin diagnostics', () => {
    // 1. ExpressRoute MSEE Hairpin diagnostic on UC9
    const uc9 = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'samples', 'azure-net', 'uc9-expressroute-hairpin-two-vnets.json'),
        'utf-8',
      ),
    ) as AzNetTopology
    const sim9 = simulateAzNet(uc9)
    const diag9 = runAzNetDiagnostics(uc9, sim9)
    expect(diag9.some((f) => f.category === 'expressroute-msee-hairpin')).toBe(true)

    // 2. Peering LPM bypasses summary UDR + disablePeeringRoutePropagation suppression
    const peerTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    // Add a direct spoke-to-spoke peering between VNet-Spoke-App (10.1.0.0/16) and VNet-Spoke-Data (10.2.0.0/16)
    peerTopo.vnetPeerings.push({
      id: 'peer-app-data-direct',
      name: 'Spoke-App ↔ Spoke-Data Direct',
      vnetAId: 'vnet-spoke-app',
      vnetBId: 'vnet-spoke-data',
      enabled: true,
      aToB: {
        allowVirtualNetworkAccess: true,
        allowForwardedTraffic: true,
        allowGatewayTransit: false,
        useRemoteGateways: false,
      },
      bToA: {
        allowVirtualNetworkAccess: true,
        allowForwardedTraffic: true,
        allowGatewayTransit: false,
        useRemoteGateways: false,
      },
    })
    const rtSpokeApp = peerTopo.udrTables.find((t) => t.id === 'rt-spoke-to-fw')!
    rtSpokeApp.routes = [
      {
        id: 'udr-summary-rfc1918',
        name: 'summary-10-8-to-fw',
        prefix: '10.0.0.0/8',
        nextHopType: 'VirtualAppliance',
        nextHopIp: '10.0.1.4',
        enabled: true,
      },
    ]
    const simPeerBefore = simulateAzNet(peerTopo)
    const diagPeerBefore = runAzNetDiagnostics(peerTopo, simPeerBefore)
    expect(diagPeerBefore.some((f) => f.category === 'peering-lpm-bypasses-udr')).toBe(true)
    const winnerBefore = lookupSubnetEffectiveRoute(
      simPeerBefore.subnetTables['sub-app-web'],
      '10.2.1.10',
    )
    expect(winnerBefore?.source).toBe('System')
    expect(winnerBefore?.nextHopType).toBe('VNetPeering')

    // Enable disablePeeringRoutePropagation on rt-spoke-to-fw -> VNetPeering route is suppressed and 10.0.0.0/8 UDR wins
    rtSpokeApp.disablePeeringRoutePropagation = true
    const simPeerAfter = simulateAzNet(peerTopo)
    const appWebTableAfter = simPeerAfter.subnetTables['sub-app-web']
    expect(appWebTableAfter.peeringPropagationDisabled).toBe(true)
    expect(appWebTableAfter.suppressedPeeringRoutes.length).toBeGreaterThan(0)
    const winnerAfter = lookupSubnetEffectiveRoute(appWebTableAfter, '10.2.1.10')
    expect(winnerAfter?.source).toBe('User')
    expect(winnerAfter?.nextHopType).toBe('VirtualAppliance')
    const diagPeerAfter = runAzNetDiagnostics(peerTopo, simPeerAfter)
    expect(diagPeerAfter.some((f) => f.category === 'peering-lpm-bypasses-udr')).toBe(false)

    // 3. Subnet defaultOutboundAccess=false and Internet egress tracing
    const egressTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    const spokeWebSub = egressTopo.vnets
      .find((v) => v.id === 'vnet-spoke-app')!
      .subnets.find((s) => s.id === 'sub-app-web')!
    // Remove 0.0.0.0/0 UDR from rt-spoke-to-fw so sub-app-web relies on System 0.0.0.0/0 -> Internet
    const rtApp = egressTopo.udrTables.find((t) => t.id === 'rt-spoke-to-fw')!
    rtApp.routes = rtApp.routes.filter((r) => r.prefix !== '0.0.0.0/0')

    // With defaultOutboundAccess undefined/true, spoke bypasses Hub Firewall directly to Internet
    const simEgressOpen = simulateAzNet(egressTopo)
    const openInternetTrace = traceAzNetFlow(
      egressTopo,
      simEgressOpen,
      { kind: 'subnet', vnetId: 'vnet-spoke-app', subnetId: 'sub-app-web' },
      '20.50.60.70',
    )
    expect(openInternetTrace.status).toBe('delivered')
    const diagEgressOpen = runAzNetDiagnostics(egressTopo, simEgressOpen)
    expect(diagEgressOpen.some((f) => f.category === 'subnet-internet-bypasses-firewall')).toBe(true)

    // With defaultOutboundAccess=false and no explicit egress, outbound Internet flow is dropped
    spokeWebSub.defaultOutboundAccess = false
    const simEgressBlocked = simulateAzNet(egressTopo)
    const blockedInternetTrace = traceAzNetFlow(
      egressTopo,
      simEgressBlocked,
      { kind: 'subnet', vnetId: 'vnet-spoke-app', subnetId: 'sub-app-web' },
      '20.50.60.70',
    )
    expect(blockedInternetTrace.status).toBe('dropped-no-outbound-access')
    const diagEgressBlocked = runAzNetDiagnostics(egressTopo, simEgressBlocked)
    expect(diagEgressBlocked.some((f) => f.category === 'subnet-default-outbound-disabled')).toBe(
      true,
    )

    // 4. Optional diagram node labels validate cleanly up to 120 chars and reject overly long strings
    const labeledTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    labeledTopo.vnets[0].label = 'Core Security Hub'
    labeledTopo.sites[0].label = 'Primary On-Prem DC'
    expect(validateAzNetTopology(labeledTopo)).toEqual([])
    labeledTopo.vnets[0].label = 'x'.repeat(121)
    expect(validateAzNetTopology(labeledTopo).some((e) => e.includes('120 characters'))).toBe(true)
  })

  it('validates #43-#49: ER peering locations catalog, ER SKU regional restrictions, ER Global Reach, peering/gateway transit diagnostics, and empty default topology', () => {
    // #43: Internal catalog of 149 ExpressRoute peering locations & providers
    expect(ER_PEERING_LOCATIONS_CATALOG.length).toBeGreaterThanOrEqual(140)
    const frankfurt = findErPeeringLocationEntry('Frankfurt')
    expect(frankfurt).toBeDefined()
    expect(frankfurt?.geopoliticalRegion).toBe('Europe')
    expect(frankfurt?.localAzureRegions).toContain('Germany West Central')

    // #44: ExpressRoute SKU regional compatibility evaluator (Local / Standard / Premium)
    expect(evaluateErSkuRegionalCompatibility('Local', 'Frankfurt', 'germanywestcentral').allowed).toBe(true)
    expect(evaluateErSkuRegionalCompatibility('Local', 'Frankfurt', 'westeurope').allowed).toBe(false)
    expect(evaluateErSkuRegionalCompatibility('Standard', 'Frankfurt', 'westeurope').allowed).toBe(true)
    expect(evaluateErSkuRegionalCompatibility('Standard', 'Frankfurt', 'eastus').allowed).toBe(false)
    expect(evaluateErSkuRegionalCompatibility('Premium', 'Frankfurt', 'eastus').allowed).toBe(true)

    // #44 in AzNet engine & diagnostics: ER Local at Frankfurt connected to Hub VNet in westeurope is blocked
    const erLocalTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    erLocalTopo.erLocations[0].peeringLocation = 'Frankfurt'
    erLocalTopo.erLocations[0].sku = 'Local'
    const simErLocal = simulateAzNet(erLocalTopo)
    const diagErLocal = runAzNetDiagnostics(erLocalTopo, simErLocal)
    expect(diagErLocal.some((f) => f.category === 'er-sku-regional-mismatch')).toBe(true)
    // Upgrade to Standard (both Frankfurt and westeurope are in Europe) -> allowed
    erLocalTopo.erLocations[0].sku = 'Standard'
    const simErStd = simulateAzNet(erLocalTopo)
    const diagErStd = runAzNetDiagnostics(erLocalTopo, simErStd)
    expect(diagErStd.some((f) => f.category === 'er-sku-regional-mismatch')).toBe(false)

    // #45: ExpressRoute Global Reach circuit-to-circuit connectivity between two on-premises sites
    const grTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    grTopo.erLocations.push({
      id: 'er-loc-amsterdam',
      name: 'ER-Amsterdam-Primary',
      peeringLocation: 'Amsterdam',
      sku: 'Standard',
      x: 110,
      y: 440,
    })
    grTopo.sites.push({
      id: 'site-amsterdam-dc',
      name: 'Amsterdam Branch DC',
      asn: 65020,
      prefixes: ['172.20.0.0/16'],
      x: 30,
      y: 440,
    })
    grTopo.erLinks.push({
      id: 'erlink-ams-site',
      name: 'Amsterdam-to-MSEE',
      locationId: 'er-loc-amsterdam',
      targetKind: 'site',
      targetId: 'site-amsterdam-dc',
      enabled: true,
      weight: 0,
      prepend: [],
    })
    grTopo.erGlobalReachLinks = [
      {
        id: 'gr-fra-ams',
        name: 'GlobalReach-FRA-AMS',
        locationAId: grTopo.erLocations[0].id,
        locationBId: 'er-loc-amsterdam',
        enabled: true,
      },
    ]
    expect(validateAzNetTopology(grTopo)).toEqual([])
    const simGr = simulateAzNet(grTopo)
    const grTrace = traceAzNetFlow(
      grTopo,
      simGr,
      { kind: 'site', siteId: 'site-munich-hq' },
      '172.20.1.10',
    )
    expect(grTrace.status).toBe('delivered')
    expect(grTrace.hops.some((h) => h.detail.includes('Global Reach'))).toBe(true)

    // #48: Disabling useRemoteGateways or allowGatewayTransit flags broken spoke-to-onprem connectivity
    const brokenTransitTopo = JSON.parse(JSON.stringify(AZURE_NET_SAMPLES[0].topology)) as AzNetTopology
    const hubAppPeering = brokenTransitTopo.vnetPeerings.find((p) => p.id === 'peer-hub-app')!
    hubAppPeering.bToA.useRemoteGateways = false
    const simBrokenTransit = simulateAzNet(brokenTransitTopo)
    const diagBrokenTransit = runAzNetDiagnostics(brokenTransitTopo, simBrokenTransit)
    expect(diagBrokenTransit.some((f) => f.category === 'spoke-onprem-gateway-transit-disabled')).toBe(true)

    // Empty default topology helper
    const emptyTopo = createEmptyAzNetTopology()
    expect(emptyTopo.vnets).toEqual([])
    expect(emptyTopo.sites).toEqual([])
    expect(emptyTopo.erLocations).toEqual([])
  })
})

