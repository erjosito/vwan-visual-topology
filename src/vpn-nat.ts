import type { AzNetTopology, AzVpnConnection } from './azure-net/model'
import { cidr, contains, formatIpv4, ipv4 } from './validation'
import type { FiveTuple } from './packet-flow'

export interface VpnNatRule {
  id: string
  name: string
  type: 'Static' | 'Dynamic'
  mode: 'IngressSNAT' | 'EgressSNAT'
  internalMapping: string
  externalMapping: string
  ipConfigurationId?: 'default' | '0' | '1'
}
export interface VpnNat {
  purpose: 'overlap'
  connectionType: 'IPsec'
  trafficSelectors: 'route-based'
  rules: VpnNatRule[]
  bgpPeerIp?: string
  bgpPeerTranslatedIp?: string
  onPremisesRoutes?: string[]
}
export interface ClassicVpnNatGateway {
  sku: 'VpnGw2' | 'VpnGw3' | 'VpnGw4' | 'VpnGw5' | 'VpnGw2AZ' | 'VpnGw3AZ' | 'VpnGw4AZ' | 'VpnGw5AZ'
  bgpRouteTranslation: boolean
}
export interface VwanVpnNatGateway { bgpRouteTranslation: boolean }

export const VPN_NAT_CAPABILITIES = {
  classic: 'Classic VPN: VpnGw2–5 / VpnGw2AZ–5AZ, route-based IPsec, single gateway instance in this model.',
  vwan: 'Virtual WAN VPN: original site link connection, static rules on both instances; dynamic rules select instance 0 or 1. Classic SKUs do not apply.',
  scope: 'VPN overlap NAT only: no Internet breakout, NAT64, P2S, VNet-to-VNet, policy-based selectors, port-specific rules or pool exhaustion prediction.',
  legacy: 'VPN NAT authoring and packet assessment require the Azure/Full Hybrid workspace; legacy VWAN saves remain unchanged.',
} as const

export function vpnNatGateway(topology: AzNetTopology, connection: AzVpnConnection) {
  return connection.targetKind === 'vwan-hub'
    ? topology.vwanHubs.find((hub) => hub.id === connection.targetId)?.vpnNat
    : connection.targetKind === 'vnet-gateway'
      ? topology.vnets.flatMap((vnet) => vnet.gateways).find((gateway) => gateway.id === connection.targetId)?.vpnNat
      : undefined
}

const overlaps = (a: string, b: string) => !!cidr(a) && !!cidr(b)
  && (contains(a, cidr(b)!.network) || contains(b, cidr(a)!.network))
const inRange = (prefix: string, address: string) => ipv4(address) !== undefined && contains(prefix, ipv4(address)!)

export function mappedVpnAddress(address: string, from: string, to: string) {
  return formatIpv4(cidr(to)!.network + ipv4(address)! - cidr(from)!.network)
}

/** Separate provider admission: never infer a classic SKU or NAT associations from transport alone. */
export function validateVpnNat(topology: AzNetTopology): void {
  const fail = (message: string): never => { throw new Error(`VPN NAT: ${message}`) }
  const record = (input: unknown, keys: string[]) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('expected a configuration object.')
    if (Object.keys(input as object).some((key) => !keys.includes(key))) fail('unsupported configuration field or NAT mode.')
  }
  const gatewayOwners = [
    ...topology.vnets.flatMap((vnet) => vnet.gateways.filter((gateway) => gateway.vpnNat).map((gateway) => ({ gateway, classic: true }))),
    ...topology.vwanHubs.filter((hub) => hub.vpnNat).map((gateway) => ({ gateway, classic: false })),
  ]
  for (const { gateway, classic } of gatewayOwners) {
    const config = gateway.vpnNat!
    record(config, classic ? ['sku', 'bgpRouteTranslation'] : ['bgpRouteTranslation'])
    if (typeof config.bgpRouteTranslation !== 'boolean') fail('explicit gateway BGP route translation setting required.')
    if (classic && ('kind' in gateway && gateway.kind !== 'Vpn'
      || !/^VpnGw[2-5](AZ)?$/.test(String((config as ClassicVpnNatGateway).sku)))) fail('unsupported classic VPN gateway SKU.')
    if (classic && 'activeActive' in gateway && gateway.activeActive) fail('classic active-active instance pairing is outside this bounded model.')
  }
  const associations: { connection: AzVpnConnection; rule: VpnNatRule }[] = []
  for (const connection of topology.vpnConnections) {
    if (!connection.nat) continue
    const nat = connection.nat
    record(nat, ['purpose', 'connectionType', 'trafficSelectors', 'rules', 'bgpPeerIp', 'bgpPeerTranslatedIp', 'onPremisesRoutes'])
    if (nat.purpose !== 'overlap' || nat.connectionType !== 'IPsec' || nat.trafficSelectors !== 'route-based'
      || connection.transport === 'SDWAN' || connection.targetKind === 'appliance') fail('only route-based cross-premises IPsec overlap NAT is supported.')
    const gateway = vpnNatGateway(topology, connection)
    if (!gateway) fail('declare the original gateway capability before attaching rules.')
    if (connection.targetKind === 'vnet-gateway' && connection.bgpEnabled
      && !topology.vnets.flatMap((vnet) => vnet.gateways).find((gateway) => gateway.id === connection.targetId)?.bgpEnabled) fail('BGP-enabled NAT connections require BGP enabled on the classic gateway.')
    if (nat.onPremisesRoutes !== undefined && (!Array.isArray(nat.onPremisesRoutes) || nat.onPremisesRoutes.length > 500
      || nat.onPremisesRoutes.some((prefix) => typeof prefix !== 'string' || !cidr(prefix) || cidr(prefix)!.length === 0))) fail('manual on-premises routes must be bounded non-default IPv4 prefixes.')
    if ([nat.bgpPeerIp, nat.bgpPeerTranslatedIp].some((peer) => peer !== undefined && (typeof peer !== 'string' || ipv4(peer) === undefined))) fail('declared BGP peers must be IPv4 addresses.')
    if (!Array.isArray(nat.rules) || nat.rules.length < 1 || nat.rules.length > 500) fail('declare 1–500 connection-owned mapping rules.')
    const ids = new Set<string>()
    for (const rule of nat.rules) {
      record(rule, ['id', 'name', 'type', 'mode', 'internalMapping', 'externalMapping', 'ipConfigurationId'])
      if (typeof rule.id !== 'string' || !rule.id || rule.id.length > 120 || ids.has(rule.id)) fail('unique bounded rule IDs required.')
      ids.add(rule.id)
      if (typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 120 || rule.name.includes('/')) fail('rule names must be nonempty and cannot contain /.')
      if (!['Static', 'Dynamic'].includes(rule.type) || !['IngressSNAT', 'EgressSNAT'].includes(rule.mode)) fail('unsupported rule type or mode.')
      const internal = typeof rule.internalMapping === 'string' ? cidr(rule.internalMapping) : undefined
      const external = typeof rule.externalMapping === 'string' ? cidr(rule.externalMapping) : undefined
      if (!internal || !external || internal.length === 0 || external.length === 0) fail('non-default canonical IPv4 mappings required; Internet NAT and NAT64 are unsupported.')
      if (rule.type === 'Static' && internal!.length !== external!.length) fail('static mappings must have equal prefix lengths.')
      if (rule.type === 'Dynamic' && (connection.targetKind === 'vnet-gateway' && external!.length < 26 || external!.length < internal!.length)) fail('dynamic external pools must be no larger than the internal range; classic pools are limited to /26 or smaller.')
      if (connection.targetKind === 'vwan-hub') {
        if (rule.type === 'Dynamic' ? !['0', '1'].includes(rule.ipConfigurationId ?? '') : rule.ipConfigurationId !== undefined) fail('VWAN dynamic rules require instance 0 or 1; static rules apply to both instances.')
      } else if (rule.ipConfigurationId !== 'default') fail('classic single-instance rules require IP configuration default.')
      const own = nat.rules.filter((other) => other !== rule && other.mode === rule.mode && overlaps(rule.internalMapping, other.internalMapping))
      if (own.some((other) => !(connection.targetKind === 'vwan-hub'
        && (rule.type === 'Static' && internal!.length === 32 && other.type === 'Dynamic'
          || other.type === 'Static' && cidr(other.internalMapping)?.length === 32 && rule.type === 'Dynamic')))) fail('ambiguous internal mapping ranges.')
      associations.push({ connection, rule })
    }
    if (connection.bgpEnabled) {
      if (ipv4(nat.bgpPeerIp ?? '') === undefined || ipv4(nat.bgpPeerTranslatedIp ?? '') === undefined) fail('explicit original and configured BGP peer IPv4 addresses required.')
      if (inRange('169.254.0.0/16', nat.bgpPeerIp!) || inRange('169.254.0.0/16', nat.bgpPeerTranslatedIp!)) fail('APIPA BGP peers are unsupported with NAT.')
      const matching = nat.rules.filter((rule) => rule.mode === 'IngressSNAT' && inRange(rule.internalMapping, nat.bgpPeerIp!))
        .sort((a, b) => cidr(b.internalMapping)!.length - cidr(a.internalMapping)!.length)
      if (connection.targetKind === 'vnet-gateway' && matching.length) fail('this classic slice requires BGP peers excluded from NAT internal ranges (see documented peer caveat).')
      if (matching[0]?.type === 'Dynamic') fail('dynamic BGP peer translation requires a separate static /32 peer rule.')
      const expected = matching[0] ? mappedVpnAddress(nat.bgpPeerIp!, matching[0].internalMapping, matching[0].externalMapping) : nat.bgpPeerIp
      if (expected !== nat.bgpPeerTranslatedIp) fail('configured BGP peer must equal the unique static translated peer (or original excluded peer).')
      if (topology.vnets.some((vnet) => vnet.prefixes.some((prefix) => inRange(prefix, nat.bgpPeerTranslatedIp!)))) fail('configured BGP peer overlaps an Azure VNet address space.')
      if (gateway!.bgpRouteTranslation) {
        const prefixes = topology.sites.find((site) => site.id === connection.siteId)?.prefixes ?? []
        if (nat.rules.some((rule) => rule.mode === 'IngressSNAT' && !(rule.type === 'Static' && cidr(rule.internalMapping)?.length === 32)
          && prefixes.some((prefix) => overlaps(prefix, rule.internalMapping) && prefix !== rule.internalMapping))) fail('BGP must advertise exact ingress internal mapping prefixes, not aggregates or more-specifics.')
      }
    }
  }
  for (const { connection, rule } of associations) {
    const sameGateway = associations.filter((entry) => entry.connection.targetId === connection.targetId && entry.connection.targetKind === connection.targetKind)
    if (new Set(sameGateway.map((entry) => entry.rule.id)).size > 500) fail('gateway rule limit exceeded.')
    for (const other of sameGateway) {
      if (other.rule === rule) continue
      const reused = (['id', 'name', 'type', 'mode', 'internalMapping', 'externalMapping', 'ipConfigurationId'] as const)
        .every((field) => other.rule[field] === rule[field])
      if (other.rule.name === rule.name && other.rule.id !== rule.id) fail('gateway rule names must be unique.')
      if (other.rule.id === rule.id && (!reused || rule.type === 'Dynamic'
        || rule.mode === 'IngressSNAT' && other.connection.siteId !== connection.siteId)) fail('dynamic rules are single-connection; shared static associations must be identical and ingress must represent the same site.')
      if (!reused && overlaps(rule.externalMapping, other.rule.externalMapping)) fail('translated external mappings overlap.')
    }
    if (rule.mode === 'IngressSNAT' && associations.some((other) => other.connection.targetId !== connection.targetId
      && other.rule.mode === 'IngressSNAT' && other.connection.siteId !== connection.siteId && overlaps(rule.externalMapping, other.rule.externalMapping))) {
      fail('translated ingress ranges for distinct sites overlap across modeled gateways.')
    }
    const gatewayConnections = topology.vpnConnections.filter((other) => other.targetId === connection.targetId && other.targetKind === connection.targetKind)
    const unTranslated = [
      ...topology.vnets.flatMap((vnet) => vnet.prefixes),
      ...gatewayConnections
        .flatMap((other) => (topology.sites.find((site) => site.id === other.siteId)?.prefixes ?? [])
          .filter((prefix) => !other.nat?.rules.some((mapping) => mapping.mode === 'IngressSNAT'
            && (mapping.internalMapping === prefix || mapping.externalMapping === prefix)))),
      ...topology.sites.filter((site) => !gatewayConnections.some((connection) => connection.siteId === site.id)
        || topology.erLinks.some((link) => link.enabled && link.targetKind === 'site' && link.targetId === site.id)).flatMap((site) => site.prefixes),
    ]
    if (unTranslated.some((prefix) => overlaps(prefix, rule.externalMapping))) fail('translated range overlaps an untranslated connected network.')
    if (rule.mode === 'EgressSNAT' && [
      ...(topology.sites.find((site) => site.id === connection.siteId)?.prefixes ?? [])
        .filter((prefix) => !connection.nat?.rules.some((mapping) => mapping.mode === 'IngressSNAT' && mapping.externalMapping === prefix)),
      ...(connection.nat?.rules.filter((mapping) => mapping.mode === 'IngressSNAT').map((mapping) => mapping.internalMapping) ?? []),
    ].some((prefix) => overlaps(prefix, rule.externalMapping))) fail('Azure external mapping overlaps the original branch local address space.')
  }
}

export function translateVpnRoutes<T extends { prefix: string; explanation: string }>(
  topology: AzNetTopology, connection: AzVpnConnection, routes: T[], mode: VpnNatRule['mode'],
): T[] {
  if (!connection.bgpEnabled || !vpnNatGateway(topology, connection)?.bgpRouteTranslation) return routes
  return routes.map((route) => {
    const rule = connection.nat?.rules.find((rule) => rule.mode === mode && rule.internalMapping === route.prefix)
    return rule ? { ...route, prefix: rule.externalMapping, natOriginalPrefix: route.prefix, natRuleId: rule.id,
      explanation: `${route.explanation}. ${rule.mode} ${rule.name}: ${route.prefix} → ${rule.externalMapping}` } : route
  })
}

export interface VpnNatBinding { ruleId: string; before: FiveTuple; after: FiveTuple }
export interface VpnNatSession { connectionId: string; direction: 'ingress' | 'egress'; bindings: VpnNatBinding[] }
export interface VpnNatTranslation {
  tuple: FiveTuple
  bindings: VpnNatBinding[]
  session: VpnNatSession
  blocked?: string
}
const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple, sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
  sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
export const reverseVpnTuple = reverse
export const sameVpnTuple = (a: FiveTuple, b: FiveTuple) => a.sourceAddress === b.sourceAddress && a.destinationAddress === b.destinationAddress
  && a.sourcePort === b.sourcePort && a.destinationPort === b.destinationPort && a.protocol === b.protocol

/** Session is local to one assessed forward/reply pair; it is not evidence of live gateway state. */
export function translateVpnTuple(connection: AzVpnConnection, tuple: FiveTuple, direction: 'ingress' | 'egress', reply?: VpnNatSession): VpnNatTranslation {
  const session: VpnNatSession = { connectionId: connection.id, direction, bindings: [] }
  let current = { ...tuple }
  const result = (blocked?: string): VpnNatTranslation => ({ tuple: current, bindings: session.bindings, session, ...(blocked ? { blocked } : {}) })
  if (reply) {
    if (reply.connectionId !== connection.id || reply.direction === direction || !reply.bindings.length || !sameVpnTuple(tuple, reverse(reply.bindings.at(-1)!.after))) {
      return result('Reply does not match the assessed VPN connection and reverse five-tuple.')
    }
    for (const binding of [...reply.bindings].reverse()) {
      if (!sameVpnTuple(current, reverse(binding.after))) return result('Reply is outside the bounded VPN NAT session.')
      const before = current
      current = reverse(binding.before)
      session.bindings.push({ ruleId: binding.ruleId, before, after: current })
    }
    return result()
  }
  const sourceMode = direction === 'ingress' ? 'IngressSNAT' : 'EgressSNAT'
  for (const field of ['destinationAddress', 'sourceAddress'] as const) {
    const isSource = field === 'sourceAddress'
    const rules = connection.nat?.rules.filter((rule) => (rule.mode === sourceMode) === isSource
      && inRange(isSource ? rule.internalMapping : rule.externalMapping, current[field]))
      .sort((a, b) => cidr(isSource ? b.internalMapping : b.externalMapping)!.length - cidr(isSource ? a.internalMapping : a.externalMapping)!.length) ?? []
    const rule = rules[0]
    if (!rule) continue
    if (!isSource && rule.type === 'Dynamic') return result('Dynamic VPN NAT permits initiation only from the internal mapping; no assessed session exists.')
    const before = { ...current }
    if (rule.type === 'Static') current[field] = mappedVpnAddress(current[field], isSource ? rule.internalMapping : rule.externalMapping, isSource ? rule.externalMapping : rule.internalMapping)
    else {
      // One isolated modeled allocation, not an Azure allocator or a capacity/port-preservation prediction.
      current.sourceAddress = formatIpv4(cidr(rule.externalMapping)!.network)
      current.sourcePort = 49152
    }
    session.bindings.push({ ruleId: rule.id, before, after: { ...current } })
  }
  return result()
}
