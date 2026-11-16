import type { AzNetTopology, AzVpnConnection } from './azure-net/model'
import { simulateAzNet, traceAzNetFlow, type AzEndpointRef, type AzSimulationResult } from './azure-net/engine'
import type { FiveTuple, PacketLeg, PacketStep } from './packet-flow'
import { cidr, contains, formatIpv4, ipv4 } from './validation'
import { mappedVpnAddress, validateVpnNat } from './vpn-nat'

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
      && ipv4(current[field]) !== undefined && contains(isSource ? rule.internalMapping : rule.externalMapping, ipv4(current[field])!))
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

export interface VpnNatPacketRequest {
  connectionId: string
  direction: 'ingress' | 'egress'
  tuple: FiveTuple
}
export interface VpnNatPacketResult {
  forward: PacketLeg
  reply: PacketLeg
  translation: 'none' | 'snat' | 'dnat' | 'snat-dnat'
  delivery: 'not-assessed'
  security: 'not-assessed'
  limitations: string[]
}

export function validateVpnNatPacketRequest(input: unknown): asserts input is VpnNatPacketRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['connectionId', 'direction', 'tuple'].includes(key))) throw new Error('VPN NAT packet request object required.')
  const request = input as VpnNatPacketRequest
  const { tuple, direction } = request
  if (typeof request.connectionId !== 'string' || !request.connectionId || request.connectionId.length > 120
    || !['ingress', 'egress'].includes(direction) || !tuple || typeof tuple !== 'object' || Array.isArray(tuple)
    || Object.keys(tuple).some((key) => !['sourceAddress', 'destinationAddress', 'protocol', 'sourcePort', 'destinationPort'].includes(key))
    || !['tcp', 'udp'].includes(tuple.protocol)
    || [tuple.sourceAddress, tuple.destinationAddress].some((address) => typeof address !== 'string' || ipv4(address) === undefined)
    || [tuple.sourcePort, tuple.destinationPort].some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('VPN NAT packet assessment requires explicit IPv4 TCP/UDP five-tuples.')
  }
}

export function traceVpnNatPacket(topology: AzNetTopology, request: VpnNatPacketRequest, simulation?: AzSimulationResult): VpnNatPacketResult {
  validateVpnNatPacketRequest(request)
  validateVpnNat(topology)
  const { tuple, direction } = request
  const connection = topology.vpnConnections.find((connection) => connection.id === request.connectionId)
  if (!connection?.nat) throw new Error('Select an original VPN connection with declared NAT rules.')
  const result: VpnNatPacketResult = {
    forward: { direction: 'forward', routing: 'not-assessed', tuple, steps: [], reasons: [] },
    reply: { direction: 'reply', routing: 'not-assessed', steps: [], reasons: [] },
    translation: 'none', security: 'not-assessed', delivery: 'not-assessed',
    limitations: ['One original VPN connection and one conditional forward/reply pair; no live session, NSG, firewall, guest policy or delivery guarantee.',
      'Dynamic allocation is illustrative: one isolated address/port binding, not port preservation, capacity, timeout or exhaustion prediction.'],
  }
  const refuse = (reason: string) => {
    result.forward.reasons.push(reason)
    result.reply.reasons.push('No bounded reply is assessed without a complete forward VPN path.')
    return result
  }
  if (!connection.enabled) return refuse('The original VPN connection is disabled.')
  if (topology.inventory?.capture?.configurationComplete === false) return refuse('Connectivity configuration capture is incomplete.')
  const site = topology.sites.find((site) => site.id === connection.siteId)
  if (!site) return refuse('The original VPN site is missing.')
  const initial = translateVpnTuple(connection, tuple, direction)
  if (initial.blocked) {
    result.forward.routing = 'unreachable'
    return refuse(initial.blocked)
  }
  const azureAddress = direction === 'ingress' ? initial.tuple.destinationAddress : tuple.sourceAddress
  const siteAddress = direction === 'ingress' ? tuple.sourceAddress : initial.tuple.destinationAddress
  const azureSubnets = topology.vnets.flatMap((vnet) => vnet.subnets.filter((subnet) => contains(subnet.prefix, ipv4(azureAddress)!))
    .map((subnet): AzEndpointRef => ({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })))
  const siteRanges = [...site.prefixes, ...connection.nat.rules.filter((rule) => rule.mode === 'IngressSNAT').map((rule) => rule.internalMapping)]
  if (azureSubnets.length !== 1 || !siteRanges.some((prefix) => contains(prefix, ipv4(siteAddress)!))) {
    return refuse('This bounded VPN assessment requires one unambiguous Azure subnet and an address in the selected original site; Internet, P2S and VNet-to-VNet are unsupported.')
  }
  // Reject a translated alias that points outside its original connection's site.
  if (direction === 'egress' && !connection.nat.rules.some((rule) => rule.mode === 'IngressSNAT'
    && contains(rule.externalMapping, ipv4(tuple.destinationAddress)!))
    && !site.prefixes.some((prefix) => contains(prefix, ipv4(tuple.destinationAddress)!))) return refuse('Destination is not owned by the selected VPN site.')
  const siteRef: AzEndpointRef = { kind: 'site', siteId: site.id }
  const source = direction === 'ingress' ? siteRef : azureSubnets[0]
  const target = direction === 'ingress' ? azureSubnets[0] : siteRef
  const native = simulation ?? simulateAzNet(topology)
  let session: VpnNatSession | undefined
  const trace = (leg: PacketLeg, origin: AzEndpointRef, original: FiveTuple, expectedDirection: 'ingress' | 'egress', reply?: VpnNatSession) => {
    let current = { ...original }
    let crossed = 0
    let outOfScope = false
    const steps: PacketStep[] = []
    const routed = traceAzNetFlow(topology, native, origin, original.destinationAddress, {
      sourceAddress: original.sourceAddress,
      vpnTranslation: (connectionId, actualDirection, destinationAddress) => {
        if (connectionId !== connection.id || actualDirection !== expectedDirection || crossed++ !== 0 || current.destinationAddress !== destinationAddress) {
          outOfScope = true
          return { destinationAddress, detail: '', blocked: 'The native path does not traverse the selected original VPN boundary exactly once in the expected direction.' }
        }
        const translated = translateVpnTuple(connection, current, actualDirection, reply)
        if (translated.blocked) return { destinationAddress, detail: '', blocked: translated.blocked }
        for (const binding of translated.bindings) {
          const rule = connection.nat!.rules.find((rule) => rule.id === binding.ruleId)!
          steps.push({ entity: { kind: 'vpn-nat-rule', id: rule.id }, before: binding.before, after: binding.after,
            edgeId: connection.id, evidence: `${rule.name}: ${rule.mode} ${rule.type}; ${rule.internalMapping} ↔ ${rule.externalMapping}${reply ? '; paired reverse mapping, no separate DNAT rule' : ''}` })
        }
        current = translated.tuple
        if (!reply) session = translated.session.bindings.length ? translated.session : undefined
        return { destinationAddress: current.destinationAddress, detail: steps.map((step) => step.evidence).join(' · ') || 'No matching VPN NAT mapping; tuple unchanged.' }
      },
    })
    leg.native = routed
    leg.steps = steps
    leg.tuple = current
    leg.routing = outOfScope || routed.status === 'not-assessed' ? 'not-assessed'
      : routed.status === 'delivered' && crossed === 1 ? 'reachable' : 'unreachable'
    leg.reasons = [routed.summaryReason, ...(crossed !== 1 ? ['Native routing did not traverse the selected original VPN NAT connection.'] : [])]
    return current
  }
  const delivered = trace(result.forward, source, tuple, direction)
  if (result.forward.routing !== 'reachable') {
    result.reply.reasons.push('No bounded reply is assessed without a complete forward VPN path.')
  } else {
    result.reply.session = 'conditional-response'
    trace(result.reply, target, reverseVpnTuple(delivered), direction === 'ingress' ? 'egress' : 'ingress', session)
    if (result.reply.routing === 'reachable' && !sameVpnTuple(result.reply.tuple!, reverseVpnTuple(tuple))) {
      result.reply.routing = 'unreachable'
      result.reply.reasons.push('The return tuple does not reverse the original request.')
    }
  }
  const bindings = result.forward.steps
  const snat = bindings.some((step) => step.before.sourceAddress !== step.after?.sourceAddress || step.before.sourcePort !== step.after?.sourcePort)
  const dnat = bindings.some((step) => step.before.destinationAddress !== step.after?.destinationAddress)
  result.translation = snat && dnat ? 'snat-dnat' : snat ? 'snat' : dnat ? 'dnat' : 'none'
  return result
}
