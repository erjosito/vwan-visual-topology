import { cidr, contains, ipv4 } from './validation'
import { inventoryOwners, namedEndpoints, publicIpv4 } from './inventory'
import type { InventoryTopology } from './inventory'
import { simulate, type Simulation } from './routing'
import { traceNodePath, type NodePath, type PathNode } from './paths'
import { simulateAzNet, traceAzNetFlow, type AzEndpointRef, type AzFlowTrace, type AzSimulationResult } from './azure-net/engine'

export interface WorkloadEndpoint { kind: 'workload'; workloadId: string; nicId: string; ipConfigurationId: string }
export type PacketEndpoint = WorkloadEndpoint | { kind: 'external'; address: string }
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
}
export interface PacketLeg {
  direction: 'forward' | 'reply'
  routing: 'reachable' | 'unreachable' | 'not-assessed'
  tuple?: FiveTuple
  steps: PacketStep[]
  native?: AzFlowTrace | NodePath[]
  reasons: string[]
}
export interface PacketResult {
  source: PacketEndpoint
  target: PacketEndpoint
  forward: PacketLeg
  reply: PacketLeg
  delivery: 'not-assessed'
  security: 'not-assessed'
  translation: 'not-assessed'
  limitations: string[]
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
    } else if (endpoint.kind === 'workload') {
      if (Object.keys(endpoint).some((key) => !['kind', 'workloadId', 'nicId', 'ipConfigurationId'].includes(key))
        || [endpoint.workloadId, endpoint.nicId, endpoint.ipConfigurationId].some((id) => typeof id !== 'string' || !id || id.length > 120)) {
        throw new Error('Workload, NIC and IP-configuration identities are required.')
      }
    } else throw new Error('Unsupported packet endpoint.')
  }
}

export function workloadEndpointKey(ref: WorkloadEndpoint): string {
  return JSON.stringify(['workload', ref.workloadId, ref.nicId, ref.ipConfigurationId])
}

export function packetEndpointOptions(topology: InventoryTopology, unknownAddressLabel = 'address unknown') {
  return namedEndpoints(topology).map(({ workload, nic, config }) => {
    const ref: WorkloadEndpoint = { kind: 'workload', workloadId: workload.id, nicId: nic.id, ipConfigurationId: config.id }
    return { key: workloadEndpointKey(ref), ref, label: `${workload.name} / ${nic.name} / ${config.name} (${config.privateIp ?? unknownAddressLabel})` }
  })
}

export function tracePacket(topology: InventoryTopology, request: PacketRequest, simulation?: Simulation | AzSimulationResult): PacketResult {
  validatePacketRequest(request)
  const resolve = (ref: PacketEndpoint) => {
    if (ref.kind === 'external') {
      const ip = ipv4(ref.address)!
      const connected = [...inventoryOwners(topology).flatMap((owner) => owner.prefixes), ...topology.sites.flatMap((site) => site.prefixes),
        ...(topology.version === 2 ? topology.vnets.flatMap((vnet) => vnet.appliances.flatMap((device) => device.advertisedPrefixes ?? [])) : []),
        ...(topology.inventory?.publicIps.flatMap((entry) => entry.address ? [`${entry.address}/32`] : []) ?? [])]
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
      reasons: ['Public IP association is inventory only; inbound listener, DNAT and security readiness are not modeled.'],
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
    const trace = traceAzNetFlow(topology, nativeSimulation as AzSimulationResult, from.native as AzEndpointRef, to.address!)
    const owned = trace.hops.some((hop) => hop.action === 'delivered' && (to.native!.kind === 'internet' ? hop.nodeKind === 'internet'
      : hop.vnetId === (to.native as Extract<AzEndpointRef, { kind: 'subnet' }>).vnetId
        && hop.subnetId === (to.native as Extract<AzEndpointRef, { kind: 'subnet' }>).subnetId))
    return {
      direction, tuple: packet, routing: trace.status === 'not-assessed' ? 'not-assessed' : trace.status === 'delivered' && owned ? 'reachable' : 'unreachable',
      native: trace, reasons: [trace.summaryReason],
      steps: trace.hops.map((hop) => ({
        entity: { kind: hop.nodeKind, id: hop.nodeId }, before: packet,
        after: to.native!.kind === 'internet' && hop.action === 'delivered' ? null : packet, evidence: hop.detail,
        ...(hop.edgeId ? { edgeId: hop.edgeId } : {}), ...(hop.matchedRoute ? { routeId: hop.matchedRoute.id } : {}),
        ...(hop.hubTableId ? { tableId: hop.hubTableId } : {}),
      })),
    }
  }
  const forward = leg('forward'), reply = leg('reply')
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
  return {
    source: request.source, target: request.target, forward, reply,
    delivery: 'not-assessed', security: 'not-assessed', translation: 'not-assessed',
    limitations: ['Routing only: unchanged tuples are not proof of NAT, NSG/firewall policy, a listener, backend health or application delivery.',
      'The reply is a separate routing probe, not proof that the destination generates a response or that a stateful session exists.'],
  }
}
