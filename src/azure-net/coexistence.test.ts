import { expect, it } from 'vitest'
import { coexistenceTopology } from '../../tests/fixtures/coexistence'
import { inspectAzBgp } from '../bgp-neighbors'
import { parseAzNetTopology } from './admission'
import { importAzNetCapture } from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { basicGatewayFix, coexistenceFindings } from './coexistence'
import { lookupSubnetEffectiveRoute, simulateAzNet, traceAzNetPair } from './engine'

it.each([true, false])('exchanges ER and VPN site routes through same-VNet ARS with VPN BGP=%s', (bgpEnabled) => {
  const topology = coexistenceTopology()
  topology.vnets[0].gateways[0].bgpEnabled = bgpEnabled
  topology.vpnConnections[0].bgpEnabled = bgpEnabled
  const result = simulateAzNet(topology)
  expect(result.controlPlaneComplete).toBe(true)
  expect(result.routeServerInbound!.ars['gateway:vpn']).toEqual(expect.arrayContaining([
    expect.objectContaining({ prefix: '192.0.2.0/24' }),
  ]))
  expect(result.gatewayRibs['er-gw']).toEqual(expect.arrayContaining([
    expect.objectContaining({ prefix: '192.0.2.0/24', nextHopKind: 'vnet-gateway', nextHopId: 'vpn', preferred: true }),
  ]))
  expect(result.siteRibs['er-site']).toEqual(expect.arrayContaining([
    expect.objectContaining({ prefix: '192.0.2.0/24', preferred: true }),
  ]))
  expect(result.siteRibs.site).toEqual(expect.arrayContaining([
    expect.objectContaining({ prefix: '198.51.100.0/24', preferred: true }),
  ]))
  const forward = traceAzNetPair(topology, result, { kind: 'site', siteId: 'er-site' },
    '198.51.100.4', { kind: 'site', siteId: 'site' }, '192.0.2.4')
  expect(forward.forward.status).toBe('delivered')
  expect(forward.reverse.status).toBe('delivered')
  expect(inspectAzBgp(topology, result).managedRelationships.find((relationship) => relationship.connectionId === 'gateway:vpn'))
    .toMatchObject({ enabled: true })
})

it.each(['absent', 'disabled', 'b2b-off', 'standby', 'mode-unknown', 'asn', 'remote'] as const)(
  'does not grant ER-to-VPN branch transit with ARS boundary %s', (boundary) => {
    const topology = coexistenceTopology()
    const vnet = topology.vnets[0]
    if (boundary === 'absent') delete vnet.routeServer
    if (boundary === 'disabled') vnet.routeServer!.enabled = false
    if (boundary === 'b2b-off') vnet.routeServer!.branchToBranchTraffic = false
    if (boundary === 'standby') vnet.gateways[0].activeActive = false
    if (boundary === 'mode-unknown') delete vnet.gateways[0].activeActive
    if (boundary === 'asn') vnet.gateways[0].asn = 65020
    if (boundary === 'remote') {
      topology.vnets.push({ id: 'other', name: 'Other VNet', role: 'standalone', region: 'West Europe',
        prefixes: ['10.1.0.0/16'], subnets: [], gateways: [], appliances: [], routeServer: vnet.routeServer })
      delete vnet.routeServer
    }
    const result = simulateAzNet(topology)
    expect(result.siteRibs['er-site'].some((route) => route.prefix === '192.0.2.0/24')).toBe(false)
    expect(result.siteRibs.site.some((route) => route.prefix === '198.51.100.0/24')).toBe(false)
    if (['standby', 'mode-unknown', 'asn'].includes(boundary)) {
      expect(result.controlPlaneComplete).toBe(false)
      expect(traceAzNetPair(topology, result, { kind: 'site', siteId: 'er-site' }, '198.51.100.4',
        { kind: 'site', siteId: 'site' }, '192.0.2.4').forward.status).toBe('not-assessed')
    }
  })

it('keeps Azure connectivity to ER-only and VPN-only sites separate from branch transit without ARS', () => {
  const topology = coexistenceTopology()
  delete topology.vnets[0].routeServer
  const result = simulateAzNet(topology)
  expect(lookupSubnetEffectiveRoute(result.subnetTables.app, '192.0.2.4')?.nextHopResourceId).toBe('vpn')
  expect(lookupSubnetEffectiveRoute(result.subnetTables.app, '198.51.100.4')?.nextHopResourceId).toBe('er-gw')
})

it('exchanges static VPN site prefixes with an NVA without inventing external VPN BGP neighbors', () => {
  const topology = coexistenceTopology()
  topology.vnets[0].gateways[0].bgpEnabled = false
  topology.vpnConnections[0].bgpEnabled = false
  topology.vnets[0].appliances = [{
    id: 'nva', name: 'NVA', kind: 'nva-vm', subnetId: 'app', privateIp: '10.0.1.4',
    asn: 65050, bgpEnabled: true, enableIpForwarding: true, staticRoutes: [], advertisedPrefixes: ['198.18.0.0/24'],
  }]
  topology.vnets[0].routeServer!.peerApplianceIds = ['nva']
  const result = simulateAzNet(topology)
  expect(result.nvaBgpPeers!.nva[0].routes.some((route) => route.prefix === '192.0.2.0/24')).toBe(true)
  expect(result.gatewayRibs.vpn.some((route) => route.prefix === '198.18.0.0/24')).toBe(true)
  const inspection = inspectAzBgp(topology, result)
  expect(inspection.neighbors.filter((neighbor) => neighbor.connectionId === 's2s').every((neighbor) => neighbor.availability === 'unavailable')).toBe(true)
})

it('applies gateway outbound policy once to original ARS attributes before adding transport ASNs', () => {
  const topology = coexistenceTopology()
  const ars = topology.vnets[0].routeServer!
  ars.routeMaps = [{
    id: 'export', name: 'ER export', rules: [{
      id: 'prepend', prefixes: ['192.0.2.0/24'], match: 'equals', action: 'prepend', prepend: [64510],
      summaryPrefixes: [], nextStep: 'terminate',
      matchConditions: [{ property: 'asPath', match: 'equals', values: ['65001'] }],
    }],
  }]
  ars.routeMapAssignments = [{ connectionId: 'gateway:er-gw', outboundMapId: 'export' }]
  const result = simulateAzNet(topology)
  expect(result.routeServerOutbound!.ars['gateway:er-gw'].find((route) => route.prefix === '192.0.2.0/24')?.asPath).toEqual([64510, 65001])
  expect(result.siteRibs['er-site'].find((route) => route.prefix === '192.0.2.0/24')?.asPath).toEqual([12076, 64510])
  ars.routeMaps[0].rules[0].action = 'drop'
  expect(simulateAzNet(topology).siteRibs['er-site'].some((route) => route.prefix === '192.0.2.0/24')).toBe(false)
})

it('does not turn ARS into ER circuit-to-circuit branch transit', () => {
  const topology = coexistenceTopology()
  Object.assign(topology.vnets[0].gateways[0], { kind: 'ExpressRoute', sku: 'ErGw1AZ' })
  topology.vpnConnections = []
  topology.erLocations.push({ id: 'msee-other', name: 'London', peeringLocation: 'London', sku: 'Standard' })
  topology.erLinks.push(
    { id: 'other-azure', name: 'Other circuit Azure', locationId: 'msee-other', targetKind: 'vnet-gateway', targetId: 'vpn', enabled: true },
    { id: 'other-site', name: 'Other circuit branch', locationId: 'msee-other', targetKind: 'site', targetId: 'site', enabled: true },
  )
  const result = simulateAzNet(topology)
  expect(result.siteRibs['er-site'].some((route) => route.prefix === '192.0.2.0/24')).toBe(false)
  expect(result.siteRibs.site.some((route) => route.prefix === '198.51.100.0/24')).toBe(false)
})

it('retains semantic-invalid coexistence settings for diagnosis and leaves unknown metadata unspecified', () => {
  const topology = coexistenceTopology()
  const gateway = topology.vnets[0].gateways[0]
  gateway.vpnType = 'PolicyBased'
  gateway.sku = 'Basic'
  topology.vnets[0].subnets[0].prefix = '10.0.255.0/28'
  const admitted = parseAzNetTopology(JSON.parse(JSON.stringify(topology)))
  expect(admitted.vnets[0].gateways[0]).toMatchObject({ vpnType: 'PolicyBased', sku: 'Basic' })
  expect(coexistenceFindings(admitted).filter((finding) => finding.severity === 'error')).toHaveLength(3)
  delete gateway.sku
  delete gateway.vpnType
  expect(coexistenceFindings(topology).filter((finding) => finding.severity === 'warning')).toHaveLength(2)
  expect(gateway.sku).toBeUndefined()
  expect(gateway.vpnType).toBeUndefined()
})

it('targets the actual Basic gateway, preserves NAT capability and refuses stale or unknown-SKU fixes', () => {
  const topology = coexistenceTopology()
  const gateway = topology.vnets[0].gateways[0]
  gateway.sku = ' basic '
  const finding = coexistenceFindings(topology).find((finding) => finding.id.endsWith(':sku:vpn'))!
  expect(basicGatewayFix(topology, finding)).toEqual({ gateway, sku: 'VpnGw1AZ' })
  gateway.vpnNat = { sku: 'VpnGw2AZ', bgpRouteTranslation: false }
  expect(basicGatewayFix(topology, finding)).toEqual({ gateway, sku: 'VpnGw2AZ' })
  gateway.sku = 'VpnGw2'
  expect(basicGatewayFix(topology, finding)).toBeUndefined()
  delete gateway.sku
  const unknown = coexistenceFindings(topology).find((candidate) => candidate.id === finding.id)!
  expect(basicGatewayFix(topology, unknown)).toBeUndefined()
  gateway.sku = 'Basic'
  topology.vnets[0].gateways[1].enabled = false
  expect(basicGatewayFix(topology, finding)).toBeUndefined()
})

it.each(['VpnGw1', 'VpnGw1AZ', 'VpnGw2', 'VpnGw2AZ'])('does not misdiagnose supported %s as Basic', (sku) => {
  const topology = coexistenceTopology()
  Object.assign(topology.vnets[0].gateways[0], { sku, vpnGatewayGeneration: 'Generation1' })
  expect(coexistenceFindings(topology).filter((finding) => finding.severity !== 'info')).toEqual([])
})

it('identifies enabled overlapping GatewaySubnet UDRs without confusing valid return routes or disabled rows', () => {
  const topology = coexistenceTopology()
  topology.vnets[0].subnets[0].routeTableId = 'gateway-udr'
  topology.udrTables = [{
    id: 'gateway-udr', name: 'Gateway UDR', disableBgpRoutePropagation: false,
    routes: [
      { id: 'self', name: 'Gateway range', prefix: '10.0.255.0/27', nextHopType: 'None', enabled: true },
      { id: 'default', name: 'Default', prefix: '0.0.0.0/0', nextHopType: 'Internet', enabled: true },
      { id: 'endpoint', name: 'Possible BGP endpoint', prefix: '10.0.255.4/32', nextHopType: 'None', enabled: true },
      { id: 'return', name: 'Workload return', prefix: '10.0.1.0/24', nextHopType: 'VnetLocal', enabled: true },
      { id: 'disabled', name: 'Inactive', prefix: '10.0.255.0/27', nextHopType: 'None', enabled: false },
      { id: 'summary', name: 'Less-specific summary', prefix: '10.0.0.0/8', nextHopType: 'None', enabled: true },
    ],
  }]
  const findings = coexistenceFindings(topology).filter((finding) => finding.id.includes(':udr:'))
  expect(findings.map((finding) => [finding.id.split(':').at(-1), finding.severity])).toEqual([
    ['self', 'error'], ['default', 'error'], ['endpoint', 'warning'],
  ])
  expect(findings[0]).toMatchObject({ vnetId: 'hub', subnetId: 'gateway' })
  expect(findings[0].summary).toContain('Gateway UDR/Gateway range')
})

it('imports actual routing type and gateway SKU from both ARM and CLI shapes, without substituting defaults', () => {
  for (const nested of [true, false]) for (const captured of [true, false]) {
    const settings = { gatewayType: 'Vpn', ...(captured ? { vpnType: 'PolicyBased', sku: { name: 'Basic' }, vpnGatewayGeneration: 'Generation2' } : {}) }
    const result = importAzNetCapture({
      kind: 'azure-network-capture', version: 2, resourceGroup: 'synthetic',
      vnets: [{ name: 'hub', addressSpace: { addressPrefixes: ['10.0.0.0/16'] }, subnets: [] }],
      vnetGateways: [{ name: 'vpn', vnetName: 'hub', ...(nested ? { properties: settings } : settings) }],
    }).topology.vnets[0].gateways[0]
    expect(result.vpnType).toBe(captured ? 'PolicyBased' : undefined)
    expect(result.sku).toBe(captured ? 'Basic' : undefined)
    expect(result.vpnGatewayGeneration).toBe(captured ? 'Generation2' : undefined)
  }
})

it.each(['VpnGw4AZ', 'VpnGw5AZ'])('retains current %s support without a tutorial-derived SKU allowlist', (sku) => {
  const topology = coexistenceTopology()
  Object.assign(topology.vnets[0].gateways[0], { sku, vpnGatewayGeneration: 'Generation2' })
  expect(coexistenceFindings(topology).filter((finding) => finding.severity !== 'info')).toEqual([])
  const output = generateAzNetBicep(topology)
  expect(output.text).toContain(`name: '${sku}'`)
  expect(output.text).toContain("vpnGatewayGeneration: 'Generation2'")
  topology.vnets[0].gateways[0].vpnGatewayGeneration = 'Generation1'
  expect(coexistenceFindings(topology).some((finding) => finding.id.endsWith(':generation:vpn') && finding.severity === 'error')).toBe(true)
})

it('preserves explicit settings in the Bicep starter and warns rather than silently repairing invalid coexistence', () => {
  const topology = coexistenceTopology()
  topology.vnets[0].gateways[0].vpnType = 'PolicyBased'
  topology.vnets[0].gateways[0].sku = 'Basic'
  const result = generateAzNetBicep(topology)
  expect(result.text).toContain("vpnType: 'PolicyBased'")
  expect(result.text).toContain("name: 'Basic'")
  expect(result.warnings.join(' ')).toContain('does not support ER/VPN coexistence')
})
