import { expect, it } from 'vitest'
import { vpnGatewayModeTopology } from '../../tests/fixtures/vpn-gateway-mode'
import { parseAzNetTopology } from './admission'
import { importAzNetCapture } from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { runAzNetDiagnostics } from './diagnostics'
import { simulateAzNet } from './engine'

it('preserves explicit modes and absent legacy mode without changing resource-level route results', () => {
  const topology = vpnGatewayModeTopology()
  const before = simulateAzNet(topology)
  for (const mode of [undefined, false, true]) {
    if (mode === undefined) delete topology.vnets[0].gateways[0].activeActive
    else topology.vnets[0].gateways[0].activeActive = mode
    const admitted = parseAzNetTopology(JSON.parse(JSON.stringify(topology)))
    expect(admitted.vnets[0].gateways[0].activeActive).toBe(mode)
    expect(simulateAzNet(admitted)).toEqual(before)
  }
  expect(() => parseAzNetTopology({ ...topology, vnets: [{ ...topology.vnets[0],
    gateways: [{ ...topology.vnets[0].gateways[0], activeActive: 'false' }] }] })).toThrow()
})

it('imports actual modes without inventing a missing mode and rejects truthy nonboolean capture values', () => {
  for (const mode of [undefined, false, true, 'false']) {
    const capture = { kind: 'azure-network-capture', version: 2, resourceGroup: 'synthetic',
      vnets: [{ name: 'hub', addressSpace: { addressPrefixes: ['10.0.0.0/16'] }, subnets: [] }],
      vnetGateways: [{ name: 'vpn', vnetName: 'hub', gatewayType: 'Vpn',
        ...(mode === undefined ? {} : { activeActive: mode }) }] }
    if (typeof mode === 'string') expect(() => importAzNetCapture(capture)).toThrow(/activeActive/)
    else expect(importAzNetCapture(capture).topology.vnets[0].gateways[0].activeActive).toBe(mode)
  }
})

it('exports one versus two public IP configurations and discloses the legacy deployment default', () => {
  const topology = vpnGatewayModeTopology()
  for (const mode of [undefined, false, true]) {
    topology.vnets[0].gateways[0].activeActive = mode
    const result = generateAzNetBicep(topology)
    expect(result.text).toContain(`activeActive: ${mode === true}`)
    expect(result.text.includes("name: 'gwipconfig2'")).toBe(mode === true)
    expect(result.text.includes("name: 'Standalone VPN-pip2'")).toBe(mode === true)
    expect(result.warnings.some((warning) => warning.includes('unspecified mode'))).toBe(mode === undefined)
    expect(result.warnings.some((warning) => warning.includes('ARS route-exchange requirements'))).toBe(mode !== true)
  }
})

it('flags the ARS mode and ASN boundary even for VPN-static routing, without flagging isolated standby or disabled resources', () => {
  const topology = vpnGatewayModeTopology()
  const gateway = topology.vnets[0].gateways[0]
  const findings = () => runAzNetDiagnostics(topology, simulateAzNet(topology)).filter((finding) => finding.id.startsWith('ars-vpn-mode:'))
  expect(findings()).toHaveLength(1)
  gateway.activeActive = false
  gateway.bgpEnabled = false
  expect(findings()).toHaveLength(1)
  gateway.activeActive = true
  expect(findings()).toHaveLength(0)
  gateway.asn = 65020
  expect(findings()).toHaveLength(1)
  topology.vnets[0].routeServer!.branchToBranchTraffic = false
  expect(findings()).toHaveLength(0)
  topology.vnets[0].routeServer!.branchToBranchTraffic = true
  gateway.enabled = false
  expect(findings()).toHaveLength(0)
})
