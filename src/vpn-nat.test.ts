import { describe, expect, it } from 'vitest'
import type { AzNetTopology } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { simulateAzNet, traceAzNetFlow } from './azure-net/engine'
import { translateVpnRoutes, validateVpnNat } from './vpn-nat'
import { reverseVpnTuple, translateVpnTuple, traceVpnNatPacket } from './vpn-nat-packet'
import { vpnNatFixture } from '../tests/fixtures/vpn-nat'
import { executePlatform } from './platform/service'
import { generateAzNetBicep } from './azure-net/bicep-export'
import { importAzNetCapture } from './azure-net/azure-import'
import { example } from './model'
import { validateTopology } from './validation'

const tuple = { sourceAddress: '10.0.0.4', destinationAddress: '192.168.2.5', protocol: 'tcp' as const, sourcePort: 12345, destinationPort: 443 }

describe.each(['classic', 'vwan'] as const)('%s VPN overlap NAT', (provider) => {
  it('persists optional NAT configuration without changing old saves', () => {
    const topology = vpnNatFixture(provider)
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology)))).toEqual(topology)
    delete topology.vpnConnections[0].nat
    topology.vnets[0].gateways.forEach((gateway) => { delete gateway.vpnNat })
    topology.vwanHubs.forEach((hub) => { delete hub.vpnNat })
    expect(parseAzNetTopology(topology)).toEqual(topology)
    expect(() => simulateAzNet(topology)).not.toThrow()
  })

  it.each((['gateway', 'connection'] as const).flatMap((owner) =>
    [false, 0, null, ''].map((value) => ({ owner, value }))))('rejects explicit malformed $owner NAT: $value', ({ owner, value }) => {
    const topology = vpnNatFixture(provider)
    if (owner === 'gateway') {
      delete topology.vpnConnections[0].nat
      const gateway = provider === 'classic' ? topology.vnets[0].gateways[0] : topology.vwanHubs[0]
      Object.assign(gateway, { vpnNat: value })
    } else Object.assign(topology.vpnConnections[0], { nat: value })
    expect(() => parseAzNetTopology(topology)).toThrow(/VPN NAT: expected a configuration object/)
    expect(() => simulateAzNet(topology)).toThrow(/VPN NAT: expected a configuration object/)
    expect(executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology } }).status).toBe('invalid')
  })

  it('translates exact learned and advertised BGP prefixes in the existing native RIBs', () => {
    const topology = vpnNatFixture(provider)
    const simulation = simulateAzNet(topology)
    const rib = provider === 'classic' ? simulation.gatewayRibs.gw : simulation.vwanHubRibs.hub
    expect(rib.some((route) => route.prefix === '192.168.1.0/24' && route.natOriginalPrefix === '10.0.0.0/24')).toBe(true)
    expect(simulation.siteRibs.branch.some((route) => route.prefix === '192.168.2.0/24' && route.natOriginalPrefix === '10.0.0.0/24')).toBe(true)
    const routes = [{ prefix: '10.8.0.0/16', explanation: 'untouched' }]
    expect(translateVpnRoutes(topology, topology.vpnConnections[0], routes, 'IngressSNAT')).toEqual(routes)
    delete topology.vpnConnections[0].nat
    expect(translateVpnRoutes(topology, topology.vpnConnections[0], routes, 'IngressSNAT')).toEqual(routes)
  })

  it.each(['ingress', 'egress'] as const)('supports static %s initiation and paired return reversal using native forwarding', (direction) => {
    const topology = vpnNatFixture(provider)
    const wire = direction === 'ingress' ? tuple : { ...tuple, sourceAddress: '10.0.0.5', destinationAddress: '192.168.1.4' }
    const result = traceVpnNatPacket(topology, { connectionId: 'vpn', direction, tuple: wire })
    expect(result.forward.reasons).toBeDefined()
    expect(result.forward.routing, JSON.stringify(result.forward.native)).toBe('reachable')
    expect(result.reply.routing, JSON.stringify(result.reply.native)).toBe('reachable')
    expect(result.forward.steps).toHaveLength(2)
    expect(result.forward.tuple).toMatchObject({ sourceAddress: direction === 'ingress' ? '192.168.1.4' : '192.168.2.5',
      destinationAddress: direction === 'ingress' ? '10.0.0.5' : '10.0.0.4' })
    expect(result.reply.tuple).toEqual(reverseVpnTuple(wire))
    expect(result.reply.session).toBe('conditional-response')
    expect(result.security).toBe('not-assessed')
    expect(result.delivery).toBe('not-assessed')
  })

  it('allows dynamic internal-side initiation and only the paired bounded reply', () => {
    const topology = vpnNatFixture(provider), connection = topology.vpnConnections[0]
    Object.assign(connection.nat!.rules[0], { type: 'Dynamic', externalMapping: '192.168.1.0/28',
      ipConfigurationId: provider === 'classic' ? 'default' : '0' })
    const result = traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'ingress', tuple })
    expect(result.forward.routing, JSON.stringify(result.forward.native)).toBe('reachable')
    expect(result.reply.routing, JSON.stringify(result.reply.native)).toBe('reachable')
    expect(result.forward.tuple).toMatchObject({ sourceAddress: '192.168.1.0', sourcePort: 49152 })
    expect(result.reply.tuple).toEqual(reverseVpnTuple(tuple))
    const unsolicited = traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'egress',
      tuple: { ...tuple, sourceAddress: '10.0.0.5', destinationAddress: '192.168.1.0' } })
    expect(unsolicited.forward.routing).toBe('unreachable')
    expect(unsolicited.forward.reasons.join()).toContain('internal mapping')
    const translated = translateVpnTuple(connection, tuple, 'ingress')
    expect(translateVpnTuple(connection, { ...reverseVpnTuple(translated.tuple), destinationPort: 5555 }, 'egress', translated.session).blocked).toBeTruthy()
  })

  it('does not silently assess NAT from an address-only route probe', () => {
    const topology = vpnNatFixture(provider)
    expect(traceAzNetFlow(topology, simulateAzNet(topology), { kind: 'site', siteId: 'branch' }, tuple.destinationAddress).status).toBe('not-assessed')
  })

  it('does not let NAT bypass a native return UDR blackhole', () => {
    const topology = vpnNatFixture(provider)
    topology.udrTables.push({ id: 'deny', name: 'Return blackhole', disableBgpRoutePropagation: false,
      routes: [{ id: 'deny-route', name: 'Deny reply', prefix: '192.168.1.0/24', nextHopType: 'None', enabled: true }] })
    topology.vnets[0].subnets[0].routeTableId = 'deny'
    const result = traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'ingress', tuple })
    expect(result.forward.routing).toBe('reachable')
    expect(result.reply.routing).toBe('unreachable')
    expect(result.reply.steps).toHaveLength(0)
  })

  it('supports dynamic egress internal-side initiation, not an unsolicited branch initiation', () => {
    const topology = vpnNatFixture(provider), connection = topology.vpnConnections[0]
    Object.assign(connection.nat!.rules[1], { type: 'Dynamic', externalMapping: '192.168.2.0/28',
      ipConfigurationId: provider === 'classic' ? 'default' : '1' })
    const result = traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'egress',
      tuple: { ...tuple, sourceAddress: '10.0.0.5', destinationAddress: '192.168.1.4', protocol: 'udp' } })
    expect(result.forward.routing).toBe('reachable')
    expect(result.reply.routing).toBe('reachable')
    expect(traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'ingress', tuple }).forward.routing).toBe('unreachable')
  })

  it('exposes the same bounded result through the existing headless provider and warns on non-equivalent Bicep export', () => {
    const topology = vpnNatFixture(provider), vpnPacket = { connectionId: 'vpn', direction: 'ingress' as const, tuple }
    const result = executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'full', topology }, vpnPacket })
    expect(result.status).toBe('complete')
    expect(result.vpnPacket).toEqual(traceVpnNatPacket(topology, vpnPacket))
    expect(generateAzNetBicep(topology).warnings.join()).toContain('not an equivalent NAT deployment')
  })

  it('uses explicit post-NAT routes for non-BGP tunnels without inventing BGP advertisements', () => {
    const topology = vpnNatFixture(provider), connection = topology.vpnConnections[0]
    connection.bgpEnabled = false
    connection.staticPrefixes = ['192.168.1.0/24']
    connection.nat!.onPremisesRoutes = ['192.168.2.0/24']
    topology.sites[0].prefixes = ['192.168.1.0/24']
    const result = traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'ingress', tuple })
    expect(result.forward.routing, JSON.stringify(result.forward.native)).toBe('reachable')
    expect(result.reply.routing, JSON.stringify(result.reply.native)).toBe('reachable')
    const manual = simulateAzNet(topology).siteRibs.branch.find((route) => route.prefix === '192.168.2.0/24')
    expect(manual?.originProtocol).toBe('Static')
    delete connection.nat!.onPremisesRoutes
    expect(traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'ingress', tuple }).forward.routing).toBe('unreachable')
  })

  it('does not classify a suitable public external mapping as Internet breakout', () => {
    const topology = vpnNatFixture(provider), connection = topology.vpnConnections[0]
    connection.nat!.rules[0].externalMapping = '20.40.1.0/24'
    connection.nat!.rules[1].externalMapping = '20.40.2.0/24'
    const result = traceVpnNatPacket(topology, { connectionId: 'vpn', direction: 'ingress',
      tuple: { ...tuple, destinationAddress: '20.40.2.5' } })
    expect(result.forward.routing, JSON.stringify(result.forward.native)).toBe('reachable')
    expect(result.reply.routing, JSON.stringify(result.reply.native)).toBe('reachable')
  })

  it('does not translate learned routes or Azure advertisements on an unassociated connection', () => {
    const topology = vpnNatFixture(provider)
    topology.sites.push({ id: 'plain-site', name: 'No NAT site', asn: 65002, prefixes: ['10.0.0.0/24'] })
    topology.vpnConnections.push({ ...topology.vpnConnections[0], id: 'plain', siteId: 'plain-site', nat: undefined })
    const simulation = simulateAzNet(topology)
    const rib = provider === 'classic' ? simulation.gatewayRibs.gw : simulation.vwanHubRibs.hub
    expect(rib.some((route) => route.connectionId === 'plain' && route.prefix === '10.0.0.0/24' && !route.natOriginalPrefix)).toBe(true)
    expect(simulation.siteRibs['plain-site'].some((route) => route.connectionId === 'plain' && route.prefix === '192.168.2.0/24')).toBe(false)
  })

  it('retains explicit post-NAT routes when BGP translation is disabled', () => {
    const topology = vpnNatFixture(provider)
    const gateway = provider === 'classic' ? topology.vnets[0].gateways[0].vpnNat! : topology.vwanHubs[0].vpnNat!
    gateway.bgpRouteTranslation = false
    const simulation = simulateAzNet(topology)
    const rib = provider === 'classic' ? simulation.gatewayRibs.gw : simulation.vwanHubRibs.hub
    expect(rib.some((route) => route.prefix === '192.168.1.0/24')).toBe(false)
  })
})

describe.each([
  ['vnetGateways', 'natRules'],
  ['vpnConnections', 'ingressNatRules'],
  ['vpnConnections', 'egressNatRules'],
] as const)('captured %s.%s admission', (section, field) => {
  const capture = (resource: Record<string, unknown>) => ({
    kind: 'azure-network-capture', version: 2, [section]: [resource],
  })

  it('rejects a malformed resource collection containing known NAT', () => {
    const root = { ...capture({}), [section]: { [field]: [{ id: 'original-azure-nat-rule' }] } }
    expect(() => importAzNetCapture(root)).toThrow(/Malformed VPN NAT capture/)
  })

  it.each(['flattened', 'properties'] as const)('rejects known %s associations', (placement) => {
    const declaration = { [field]: [{ id: 'original-azure-nat-rule' }] }
    const resource = placement === 'flattened' ? declaration : { properties: declaration }
    expect(() => importAzNetCapture(capture(resource))).toThrow(/capture reconstruction is unsupported/)
  })

  it.each((['flattened', 'properties'] as const).flatMap((placement) =>
    [{ id: 'original-azure-nat-rule' }, {}, 'original-azure-nat-rule', true, false, 0, ''].map((value) =>
      ({ placement, value }))))('rejects malformed $placement declaration: $value', ({ placement, value }) => {
    const declaration = { [field]: value }
    const resource = placement === 'flattened' ? declaration : { properties: declaration }
    expect(() => importAzNetCapture(capture(resource))).toThrow(/Malformed VPN NAT capture/)
  })

  it('does not let empty ARM properties hide a flattened known association', () => {
    expect(() => importAzNetCapture(capture({ [field]: [{ id: 'original-azure-nat-rule' }], properties: {} })))
      .toThrow(/capture reconstruction is unsupported/)
  })

  it.each([
    { label: 'absent', value: undefined }, { label: 'null', value: null }, { label: 'empty array', value: [] },
  ])('retains captures with absent or empty associations: $label', ({ value }) => {
    expect(() => importAzNetCapture(capture({ [field]: value }))).not.toThrow()
    expect(() => importAzNetCapture(capture({ properties: { [field]: value } }))).not.toThrow()
  })
})

describe('VPN NAT capability admission', () => {
  it('rejects legacy NAT fields instead of dropping them, while preserving old saves', () => {
    expect(validateTopology(structuredClone(example))).toBeDefined()
    const legacy = { ...structuredClone(example), connections: example.connections.map((connection) => ({ ...connection, nat: {} })) }
    expect(() => validateTopology(legacy)).toThrow(/legacy VWAN/)
    expect(executePlatform({ contractVersion: 1, operation: 'simulate', document: { mode: 'vwan', topology: example },
      vpnPacket: { connectionId: 'vpn', direction: 'ingress', tuple } }).status).toBe('invalid')
  })

  it.each(['natRules', 'ingressNatRules', 'egressNatRules'])('fails closed on unmodeled captured %s associations', (field) => {
    expect(() => importAzNetCapture({ kind: 'azure-network-capture', version: 2,
      vpnConnections: [{ properties: { [field]: [{ id: 'original-azure-nat-rule' }] } }] })).toThrow(/capture reconstruction is unsupported/)
  })

  it.each([
    ['static size', (t: AzNetTopology) => { t.vpnConnections[0].nat!.rules[0].externalMapping = '192.168.1.0/25' }, /equal prefix/],
    ['external overlap', (t: AzNetTopology) => { t.vpnConnections[0].nat!.rules[0].externalMapping = '192.168.2.0/24' }, /overlap/],
    ['untranslated overlap', (t: AzNetTopology) => { t.vpnConnections[0].nat!.rules[0].externalMapping = '10.0.0.0/24' }, /untranslated/],
    ['APIPA', (t: AzNetTopology) => { t.vpnConnections[0].nat!.bgpPeerIp = '169.254.1.1' }, /APIPA/],
    ['peer mismatch', (t: AzNetTopology) => { t.vpnConnections[0].nat!.bgpPeerTranslatedIp = '172.20.0.2' }, /configured BGP peer/],
    ['classic SKU', (t: AzNetTopology) => { Object.assign(t.vnets[0].gateways[0].vpnNat!, { sku: 'Basic' }) }, /SKU/],
    ['classic active-active', (t: AzNetTopology) => { t.vnets[0].gateways[0].activeActive = true }, /active-active/],
    ['classic BGP disabled', (t: AzNetTopology) => { t.vnets[0].gateways[0].bgpEnabled = false }, /BGP enabled/],
    ['classic BGP peer in mapping', (t: AzNetTopology) => { t.vpnConnections[0].nat!.bgpPeerIp = '10.0.0.9' }, /excluded/],
    ['SD-WAN', (t: AzNetTopology) => { t.vpnConnections[0].transport = 'SDWAN' }, /IPsec/],
    ['policy selectors', (t: AzNetTopology) => { Object.assign(t.vpnConnections[0].nat!, { trafficSelectors: 'policy-based' }) }, /IPsec/],
    ['P2S', (t: AzNetTopology) => { Object.assign(t.vpnConnections[0].nat!, { connectionType: 'P2S' }) }, /IPsec/],
    ['VNet-to-VNet', (t: AzNetTopology) => { Object.assign(t.vpnConnections[0].nat!, { connectionType: 'VNet-to-VNet' }) }, /IPsec/],
    ['Internet NAT', (t: AzNetTopology) => { Object.assign(t.vpnConnections[0].nat!, { purpose: 'Internet' }) }, /IPsec/],
    ['NAT64', (t: AzNetTopology) => { t.vpnConnections[0].nat!.rules[0].internalMapping = '2001:db8::/64' }, /IPv4/],
    ['BGP more-specific', (t: AzNetTopology) => { t.sites[0].prefixes = ['10.0.0.0/25'] }, /exact ingress/],
  ] as const)('rejects %s', (_name, update, message) => {
    const topology = vpnNatFixture()
    update(topology)
    expect(() => parseAzNetTopology(topology)).toThrow(message)
  })

  it('rejects sharing dynamic rule identity on different connections', () => {
    const topology = vpnNatFixture()
    Object.assign(topology.vpnConnections[0].nat!.rules[0], { type: 'Dynamic', externalMapping: '192.168.1.0/28' })
    topology.vpnConnections.push({ ...structuredClone(topology.vpnConnections[0]), id: 'second' })
    expect(() => validateVpnNat(topology)).toThrow(/single-connection/)
  })

  it('validates provider-specific instance and BGP peer constraints', () => {
    const topology = vpnNatFixture('vwan'), nat = topology.vpnConnections[0].nat!
    nat.bgpPeerIp = '10.0.0.9'; nat.bgpPeerTranslatedIp = '192.168.1.9'
    expect(() => validateVpnNat(topology)).not.toThrow()
    Object.assign(nat.rules[0], { type: 'Dynamic', externalMapping: '192.168.1.0/28', ipConfigurationId: '0' })
    expect(() => validateVpnNat(topology)).toThrow(/static.*peer rule/)
    nat.rules.push({ id: 'peer', name: 'Peer', type: 'Static', mode: 'IngressSNAT', internalMapping: '10.0.0.9/32', externalMapping: '192.168.3.9/32' })
    nat.bgpPeerTranslatedIp = '192.168.3.9'
    expect(() => validateVpnNat(topology)).not.toThrow()
    nat.rules.reverse()
    expect(() => validateVpnNat(topology)).not.toThrow()
  })

  it.each([
    { mode: 'IngressSNAT', bgpEnabled: true, peer: '172.20.0.1', translatedPeer: '172.20.0.1' },
    { mode: 'IngressSNAT', bgpEnabled: false, peer: '10.0.0.9', translatedPeer: '192.168.3.9' },
    { mode: 'EgressSNAT', bgpEnabled: true, peer: '10.0.0.9', translatedPeer: '192.168.1.9' },
  ] as const)('rejects non-peer host overrides: $mode, BGP $bgpEnabled, peer $peer', ({ mode, bgpEnabled, peer, translatedPeer }) => {
    const topology = vpnNatFixture('vwan'), connection = topology.vpnConnections[0], nat = connection.nat!
    connection.bgpEnabled = bgpEnabled
    nat.bgpPeerIp = peer
    nat.bgpPeerTranslatedIp = translatedPeer
    Object.assign(nat.rules.find((rule) => rule.mode === mode)!, { type: 'Dynamic',
      externalMapping: mode === 'IngressSNAT' ? '192.168.1.0/28' : '192.168.2.0/28', ipConfigurationId: '0' })
    nat.rules.push({ id: 'host', name: 'Host override', type: 'Static', mode,
      internalMapping: '10.0.0.9/32', externalMapping: '192.168.3.9/32' })
    expect(() => validateVpnNat(topology)).toThrow(/ambiguous internal mapping ranges/)
    nat.rules.reverse()
    expect(() => validateVpnNat(topology)).toThrow(/ambiguous internal mapping ranges/)
  })

  it('does not exempt unrelated static /32 mappings from exact BGP prefix admission', () => {
    const topology = vpnNatFixture('vwan')
    Object.assign(topology.vpnConnections[0].nat!.rules[0], { internalMapping: '10.0.0.9/32', externalMapping: '192.168.3.9/32' })
    expect(() => validateVpnNat(topology)).toThrow(/exact ingress internal mapping prefixes/)
  })

  it('does not apply classic SKU or static instance rules to the VWAN resource model', () => {
    const topology = vpnNatFixture('vwan')
    Object.assign(topology.vwanHubs[0].vpnNat!, { sku: 'VpnGw2' })
    expect(() => validateVpnNat(topology)).toThrow(/unsupported configuration field/)
    delete (topology.vwanHubs[0].vpnNat as unknown as Record<string, unknown>).sku
    topology.vpnConnections[0].nat!.rules[0].ipConfigurationId = 'default'
    expect(() => validateVpnNat(topology)).toThrow(/static rules apply to both/)
    Object.assign(topology.vpnConnections[0].nat!.rules[0], { type: 'Dynamic', externalMapping: '192.168.1.0/28' })
    expect(() => validateVpnNat(topology)).toThrow(/instance 0 or 1/)
  })

  it('rejects classic dynamic pools larger than /26 and unsupported port mapping fields', () => {
    const topology = vpnNatFixture(), rule = topology.vpnConnections[0].nat!.rules[0]
    rule.type = 'Dynamic'
    expect(() => validateVpnNat(topology)).toThrow(/\/26/)
    rule.type = 'Static'
    Object.assign(rule, { internalPort: 443 })
    expect(() => validateVpnNat(topology)).toThrow(/unsupported configuration field/)
  })

  it('rejects translated ingress conflicts on different modeled gateways', () => {
    const topology = vpnNatFixture('vwan')
    topology.vwanHubs.push({ ...structuredClone(topology.vwanHubs[0]), id: 'second-hub' })
    topology.sites.push({ id: 'second-site', name: 'Second branch', asn: 65002, prefixes: ['10.0.0.0/24'] })
    topology.vpnConnections.push({ ...structuredClone(topology.vpnConnections[0]), id: 'second-connection',
      targetId: 'second-hub', siteId: 'second-site' })
    expect(() => validateVpnNat(topology)).toThrow(/overlap across modeled gateways/)
  })

  it('rejects a configured BGP peer collision with an untranslated Azure network', () => {
    const topology = vpnNatFixture()
    topology.vnets[0].prefixes.push('172.20.0.0/24')
    expect(() => validateVpnNat(topology)).toThrow(/peer overlaps an Azure VNet/)
  })
})
