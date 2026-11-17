import { cidr, contains, ipv4 } from './validation'
import { inventoryOwners, namedEndpoints, publicIpv4, workloadEndpointKey } from './inventory'
import type { InventoryTopology } from './inventory'
import { simulate, type Simulation } from './routing'
import { traceNodePath, type NodePath, type PathNode } from './paths'
import { simulateAzNet, traceAzNetFlow, type AzEndpointRef, type AzFlowTrace, type AzSimulationResult } from './azure-net/engine'
import { applyInternetEgress } from './packet-egress'
import { completePacketNsg, endpointNsg, type NsgAssessment, type TupleUncertainty } from './packet-security'
import { tracePublicIngress } from './packet-ingress'
import { traceLoadBalancer, type LoadBalancerPacketAssessment } from './packet-load-balancer'
import type { HaPortsAssessment } from './ha-ports'

export interface WorkloadEndpoint { kind: 'workload'; workloadId: string; nicId: string; ipConfigurationId: string }
export type PacketEndpoint = WorkloadEndpoint | { kind: 'external'; address: string } | { kind: 'public-ip'; publicIpId: string }
  | { kind: 'load-balancer'; loadBalancerId: string; frontendId: string }
export interface FiveTuple {
  sourceAddress: string
  destinationAddress: string
  protocol: 'tcp' | 'udp'
  sourcePort: number
  destinationPort: number
}
export interface PacketRequest { source: PacketEndpoint; target: PacketEndpoint; protocol: 'tcp' | 'udp'; sourcePort: number; destinationPort: number }
export interface PacketStep {
  entity: { kind: string; id: string }
  before: FiveTuple
  after: FiveTuple | null
  evidence: string
  edgeId?: string
  routeId?: string
  tableId?: string
  uncertainty?: TupleUncertainty
}
export interface PacketLeg {
  direction: 'forward' | 'reply'
  routing: 'reachable' | 'unreachable' | 'not-assessed'
  tuple?: FiveTuple
  steps: PacketStep[]
  native?: AzFlowTrace | NodePath[]
  reasons: string[]
  session?: 'conditional-response'
}
export interface PacketResult {
  source: PacketEndpoint
  target: PacketEndpoint
  forward: PacketLeg
  reply: PacketLeg
  delivery: 'not-assessed'
  security: 'denied' | 'not-assessed'
  translation: 'snat' | 'dnat' | 'snat-dnat' | 'none' | 'not-assessed'
  egress?: 'configured' | 'blocked' | 'legacy-implicit' | 'not-assessed'
  ingress?: 'configured' | 'blocked' | 'not-assessed'
  loadBalancer?: LoadBalancerPacketAssessment
  haPorts?: { forward: HaPortsAssessment[]; reply: HaPortsAssessment[]; symmetry: 'symmetric' | 'asymmetric' | 'not-assessed' }
  limitations: string[]
  nsg?: { forward: NsgAssessment; reply: NsgAssessment }
}

export function validatePacketRequest(input: unknown): asserts input is PacketRequest {
  const object = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value)
  if (!object(input)) throw new Error('Packet request object required.')
  const request = input as PacketRequest
  if (Object.keys(request).some((key) => !['source', 'target', 'protocol', 'sourcePort', 'destinationPort'].includes(key))) throw new Error('Unknown packet request field.')
  if (!['tcp', 'udp'].includes(request.protocol)
    || [request.sourcePort, request.destinationPort].some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('Packet tracing supports TCP/UDP with ports 1-65535.')
  }
  for (const endpoint of [request.source, request.target]) {
    if (!object(endpoint)) throw new Error('Explicit packet endpoints required.')
    if (endpoint.kind === 'external') {
      if (Object.keys(endpoint).some((key) => !['kind', 'address'].includes(key)) || typeof endpoint.address !== 'string'
        || !publicIpv4(endpoint.address)) throw new Error('External endpoint requires an explicit public IPv4 address.')
    } else if (endpoint.kind === 'public-ip') {
      if (endpoint === request.source || Object.keys(endpoint).some((key) => !['kind', 'publicIpId'].includes(key))
        || typeof endpoint.publicIpId !== 'string' || !endpoint.publicIpId || endpoint.publicIpId.length > 120) {
        throw new Error('Public-IP endpoints are destination-only and require an original public-IP ID.')
      }
    } else if (endpoint.kind === 'load-balancer') {
      if (endpoint === request.source || Object.keys(endpoint).some((key) => !['kind', 'loadBalancerId', 'frontendId'].includes(key))
        || [endpoint.loadBalancerId, endpoint.frontendId].some((id) => typeof id !== 'string' || !id || id.length > 120)) {
        throw new Error('Load Balancer endpoints are destination-only and require original service/frontend identities.')
      }
    } else if (endpoint.kind === 'workload') {
      if (Object.keys(endpoint).some((key) => !['kind', 'workloadId', 'nicId', 'ipConfigurationId'].includes(key))
        || [endpoint.workloadId, endpoint.nicId, endpoint.ipConfigurationId].some((id) => typeof id !== 'string' || !id || id.length > 120)) {
        throw new Error('Workload, NIC and IP-configuration identities are required.')
      }
    } else throw new Error('Unsupported packet endpoint.')
  }
}

export { workloadEndpointKey } from './inventory'

export function packetEndpointOptions(topology: InventoryTopology, unknownAddressLabel = 'address unknown') {
  return namedEndpoints(topology).map(({ workload, nic, config }) => {
    const ref: WorkloadEndpoint = { kind: 'workload', workloadId: workload.id, nicId: nic.id, ipConfigurationId: config.id }
    return { key: workloadEndpointKey(ref), ref, label: `${workload.name} / ${nic.name} / ${config.name} (${config.privateIp ?? unknownAddressLabel})` }
  })
}

export function tracePacket(topology: InventoryTopology, request: PacketRequest, simulation?: Simulation | AzSimulationResult): PacketResult {
  validatePacketRequest(request)
  if (topology.inventory?.capture?.configurationComplete === false) {
    const reasons = ['Connectivity configuration capture is incomplete or unsupported; missing owners, rules or services cannot prove delivery or isolation.']
    return { source: request.source, target: request.target,
      forward: { direction: 'forward', routing: 'not-assessed', steps: [], reasons },
      reply: { direction: 'reply', routing: 'not-assessed', steps: [], reasons },
      delivery: 'not-assessed', security: 'not-assessed', translation: 'not-assessed',
      limitations: ['Configuration observation only; no live connectivity, probe health or guest policy is certified.'] }
  }
  if (request.target.kind === 'load-balancer' || request.target.kind === 'public-ip' && topology.inventory?.loadBalancers?.some((lb) =>
    lb.frontends.some((frontend) => frontend.kind === 'public' && frontend.publicIpId === (request.target as Extract<PacketEndpoint, { kind: 'public-ip' }>).publicIpId))) {
    return traceLoadBalancer(topology, request, simulation)
  }
  if (request.target.kind === 'public-ip') return tracePublicIngress(topology, request, simulation)
  const resolve = (ref: PacketEndpoint) => {
    if (ref.kind === 'load-balancer') return { reason: 'Load Balancer endpoints require their explicit service path.' }
    if (ref.kind === 'public-ip') return { reason: 'Public-IP endpoints require the explicit ingress path.' }
    if (ref.kind === 'external') {
      const ip = ipv4(ref.address)!
      const connected = [...inventoryOwners(topology).flatMap((owner) => owner.prefixes), ...topology.sites.flatMap((site) => site.prefixes),
        ...(topology.version === 2 ? topology.vnets.flatMap((vnet) => vnet.appliances.flatMap((device) => device.advertisedPrefixes ?? [])) : []),
        ...(topology.inventory?.publicIps.flatMap((entry) => entry.address ? [`${entry.address}/32`] : []) ?? [])]
      connected.push(...(topology.inventory?.publicIpPrefixes?.flatMap((entry) => entry.prefix ? [entry.prefix] : []) ?? []))
      if (connected.some((prefix) => cidr(prefix) && contains(prefix, ip))) return { reason: 'A connected destination cannot be classified as Internet.' }
      return { address: ref.address, native: { kind: 'internet', ip: ref.address } as AzEndpointRef }
    }
    const entry = namedEndpoints(topology).find(({ workload, nic, config }) =>
      workload.id === ref.workloadId && nic.id === ref.nicId && config.id === ref.ipConfigurationId)
    if (!entry) return { reason: 'Workload/NIC/IP configuration ownership is missing.' }
    if (!entry.config.privateIp) return { reason: 'The selected IP configuration has unknown addressing.' }
    if (inventoryOwners(topology).filter((owner) => owner.prefixes.some((prefix) => contains(prefix, ipv4(entry.config.privateIp!)!))).length !== 1) {
      return { reason: 'The selected private address has ambiguous network ownership.' }
    }
    return {
      address: entry.config.privateIp,
      native: topology.version === 1 ? { kind: 'spoke', id: entry.nic.owner.id } as PathNode
        : { kind: 'subnet', vnetId: entry.nic.owner.id, subnetId: entry.config.subnetId } as AzEndpointRef,
    }
  }
  const source = resolve(request.source), target = resolve(request.target)
  const tuple: FiveTuple | undefined = source.address && target.address ? {
    sourceAddress: source.address, destinationAddress: target.address, protocol: request.protocol,
    sourcePort: request.sourcePort, destinationPort: request.destinationPort,
  } : undefined
  const nativeSimulation = simulation ?? (topology.version === 1 ? simulate(topology) : simulateAzNet(topology))
  const leg = (direction: 'forward' | 'reply'): PacketLeg => {
    const from = direction === 'forward' ? source : target
    const to = direction === 'forward' ? target : source
    const packet = tuple && (direction === 'forward' ? tuple : {
      ...tuple, sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
      sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort,
    })
    if (!packet || from.reason || to.reason) return { direction, routing: 'not-assessed', steps: [], reasons: [from.reason, to.reason].filter((reason): reason is string => !!reason) }
    if ((direction === 'forward' ? request.source : request.target).kind === 'external') return {
      direction, routing: 'not-assessed', tuple: packet, steps: [],
      reasons: ['Internet-to-private-workload initiation requires an explicitly selected public frontend or another supported ingress service; an inventory association is not a selected mapping.'],
    }
    if (topology.version === 1) {
      if (from.native!.kind === 'internet') return { direction, routing: 'not-assessed', tuple: packet, steps: [], reasons: ['Inbound Internet forwarding is not modeled.'] }
      const paths = traceNodePath(topology, nativeSimulation as Simulation, from.native as PathNode, to.address!)
      const incomplete = !paths.length || paths.some((path) => path.status === 'unknown' || path.traceComplete === false)
      const reachable = paths.length > 0 && paths.every((path) => path.status === 'delivered'
        && (to.native!.kind === 'internet' ? path.termination === 'internet' : path.termination === 'owner'
          && path.terminalKind === 'spoke' && path.siteId === (to.native as PathNode).id))
      return {
        direction, tuple: packet, routing: incomplete ? 'not-assessed' : reachable ? 'reachable' : 'unreachable', native: paths,
        steps: paths.flatMap((path) => path.hubs.map((id) => ({
          entity: { kind: 'hub', id }, before: packet, after: to.native!.kind === 'internet' ? null : packet, evidence: path.steps.join(' '),
        }))), reasons: incomplete ? ['Native routing coverage is incomplete.'] : [],
      }
    }
    const trace = traceAzNetFlow(topology, nativeSimulation as AzSimulationResult, from.native as AzEndpointRef, to.address!, { sourceAddress: packet.sourceAddress })
    const owned = trace.hops.some((hop) => hop.action === 'delivered' && (to.native!.kind === 'internet'
      ? hop.nodeKind === 'internet' || hop.matchedRoute?.nextHopType === 'Internet'
        || hop.nodeKind === 'vwan-hub' && !!topology.vwanHubs.find((hub) => hub.id === hop.nodeId)?.routingIntent.internet
      : hop.vnetId === (to.native as Extract<AzEndpointRef, { kind: 'subnet' }>).vnetId
        && hop.subnetId === (to.native as Extract<AzEndpointRef, { kind: 'subnet' }>).subnetId))
    return {
      direction, tuple: packet, routing: trace.status === 'not-assessed' ? 'not-assessed' : trace.status === 'delivered' && owned ? 'reachable' : 'unreachable',
      native: trace, reasons: [trace.summaryReason],
      steps: trace.hops.flatMap((hop) => [{
        entity: { kind: hop.nodeKind, id: hop.nodeId }, before: packet,
        after: to.native!.kind === 'internet' && hop.action === 'delivered' ? null : packet, evidence: hop.detail,
        ...(hop.edgeId ? { edgeId: hop.edgeId } : {}), ...(hop.matchedRoute ? { routeId: hop.matchedRoute.id } : {}),
        ...(hop.hubTableId ? { tableId: hop.hubTableId } : {}),
      }, ...(hop.haPorts ? [{ entity: { kind: 'load-balancer', id: hop.haPorts.loadBalancerId }, before: packet,
        after: hop.haPorts.status === 'selected' ? packet : null, routeId: hop.haPorts.ruleId, evidence: hop.haPorts.reason }] : [])]),
    }
  }
  const forward = leg('forward'), reply = leg('reply')
  const steering = (leg: PacketLeg) => !leg.native || Array.isArray(leg.native) ? [] : leg.native.hops
    .flatMap((hop) => hop.haPorts ? [hop.haPorts] : [])
  const forwardHa = steering(forward), replyHa = steering(reply)
  let haPorts: PacketResult['haPorts']
  if (forwardHa.length || replyHa.length) {
    const selected = forwardHa[0]?.applianceId
    const forwardTrace = !Array.isArray(forward.native) ? forward.native : undefined
    const replyTrace = !Array.isArray(reply.native) ? reply.native : undefined
    const known = forwardHa.length === 1 && forwardHa[0].status === 'selected' && forward.routing === 'reachable'
      && reply.routing === 'reachable' && forwardTrace && replyTrace
    const symmetric = known && forwardTrace.traversedApplianceIds.length === 1 && forwardTrace.traversedApplianceIds[0] === selected
      && replyTrace.traversedApplianceIds.length === 1 && replyTrace.traversedApplianceIds[0] === selected
      && replyHa.every((assessment) => assessment.loadBalancerId === forwardHa[0].loadBalancerId && assessment.status === 'selected')
    haPorts = { forward: forwardHa, reply: replyHa, symmetry: !known ? 'not-assessed' : symmetric ? 'symmetric' : 'asymmetric' }
    if (known && !symmetric) reply.reasons.push('HA ports return routing uses a different appliance or bypass; symmetric NVA forwarding is not established.')
  }
  for (const result of [forward, reply]) {
    if (!result.tuple) continue
    const from = result.direction === 'forward' ? request.source : request.target
    const to = result.direction === 'forward' ? request.target : request.source
    if (from.kind === 'workload') result.steps.unshift({
      entity: { kind: 'workload', id: from.workloadId }, before: result.tuple, after: result.tuple,
      evidence: `Routing origin at NIC ${from.nicId}, IP configuration ${from.ipConfigurationId}.`,
    })
    if (to.kind === 'workload' && result.routing === 'reachable') result.steps.push({
      entity: { kind: 'workload', id: to.workloadId }, before: result.tuple, after: result.tuple,
      evidence: `Routing reaches the subnet of NIC ${to.nicId}, IP configuration ${to.ipConfigurationId}; workload delivery is not assessed.`,
    })
  }
  const sourceNsg = forward.tuple ? endpointNsg(topology, request.source, 'outbound', forward.tuple, nativeSimulation)
    : { outcome: 'not-assessed' as const, checks: [] }
  const haPreserved = forwardHa.length === 1 && forwardHa[0].status === 'selected' && !Array.isArray(forward.native)
    && forward.native?.traversedApplianceIds.length === 1 && forward.native.traversedApplianceIds[0] === forwardHa[0].applianceId
    && request.source.kind === 'workload' && request.target.kind === 'workload'
  const egress: Pick<PacketResult, 'translation' | 'egress'> = sourceNsg.outcome === 'denied' ? { translation: 'not-assessed' as const }
    : haPreserved ? { translation: 'none' } : applyInternetEgress(topology, request, forward, reply, nativeSimulation)
  const nsg = completePacketNsg(topology, request.target, forward, reply, sourceNsg, nativeSimulation,
    egress.translation === 'snat' ? 'snat' : egress.translation === 'none' ? 'none' : 'not-assessed')
  if (haPorts && (haPorts.symmetry !== 'symmetric' || reply.routing !== 'reachable')) {
    delete reply.session
    nsg.reply = { outcome: 'not-assessed', checks: [] }
  }
  if (nsg.forward.outcome === 'denied') {
    egress.translation = forward.steps.some((step) => step.after && step.before.sourceAddress !== step.after.sourceAddress) ? 'snat' : 'not-assessed'
    if (request.target.kind === 'external') egress.egress = 'blocked'
  }
  return {
    source: request.source, target: request.target, forward, reply, ...(haPorts ? { haPorts } : {}),
    delivery: 'not-assessed', security: nsg.forward.outcome === 'denied' ? 'denied' : 'not-assessed', ...egress, nsg,
    limitations: ['Supported NSG checks and route/egress modeling do not prove guest/firewall policy, a listener, backend health or application delivery.',
      reply.session ? 'The response is conditional on this modeled outbound flow; it does not permit a new Internet-initiated connection.'
        : 'The reply is a separate routing probe, not proof that the destination generates a response or that a stateful session exists.'],
  }
}
