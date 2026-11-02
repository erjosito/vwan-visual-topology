import { describe, expect, it } from 'vitest'
import { runAzNetDiagnostics } from './diagnostics'
import {
  lookupSubnetEffectiveRoute,
  simulateAzNet,
  traceAzNetFlow,
  traceAzNetPair,
} from './engine'
import { AZURE_NET_SAMPLES, validateAzNetTopology } from './model'

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
})
