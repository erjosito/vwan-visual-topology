import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareAzNetWithObservations,
  importAzNetCapture,
} from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { runAzNetDiagnostics } from './diagnostics'
import {
  lookupSubnetEffectiveRoute,
  simulateAzNet,
  traceAzNetFlow,
  traceAzNetPair,
} from './engine'
import { AZURE_NET_SAMPLES, validateAzNetTopology, type AzNetTopology } from './model'

describe('Azure Networking Simulator Engine & Diagnostics', () => {
  it('validates all 4 canonical Azure Networking sample topologies with zero schema errors', () => {
    for (const sample of AZURE_NET_SAMPLES) {
      const errors = validateAzNetTopology(sample.topology)
      expect(errors, `Sample ${sample.id} had validation errors`).toEqual([])
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
    expect(findings.some((f) => f.category === 'bgp-propagation-blackhole')).toBe(true)
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
    expect(runAzNetDiagnostics(uc2, sim2).some((f) => f.category === 'gateway-subnet-missing-udr')).toBe(
      true,
    )

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
})
