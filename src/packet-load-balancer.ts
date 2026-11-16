import { inventoryOwners, namedEndpoints, workloadEndpointKey, type InventoryTopology, type WorkloadIpReference } from './inventory'
import { contains, ipv4 } from './validation'
import { simulate, type Simulation } from './routing'
import { simulateAzNet, type AzSimulationResult } from './azure-net/engine'
import { assessEndpointNsg, completePacketNsg, endpointNsg, nsgScope, type NsgCheck } from './packet-security'
import { traceInventoryPacketLeg } from './packet-ingress'
import type { FiveTuple, PacketLeg, PacketRequest, PacketResult, WorkloadEndpoint } from './packet-flow'

export interface LoadBalancerPacketAssessment {
  id: string
  frontendId: string
  ruleId: string
  kind: 'load-balancing' | 'inbound-nat'
  eligible: WorkloadIpReference[]
  selected?: WorkloadIpReference
  probes: { target: WorkloadIpReference; declared: 'healthy' | 'unhealthy' | 'unknown'; eligibility: 'eligible' | 'ineligible' | 'unknown'; checks: NsgCheck[] }[]
}
const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple, sourceAddress: tuple.destinationAddress,
  destinationAddress: tuple.sourceAddress, sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
const ref = (target: WorkloadIpReference): WorkloadEndpoint => ({ kind: 'workload', ...target })
const same = (a: WorkloadIpReference, b: WorkloadIpReference) => workloadEndpointKey(ref(a)) === workloadEndpointKey(ref(b))
const unknownRouter = (topology: InventoryTopology, leg: PacketLeg, publicFlow = false) => Array.isArray(leg.native)
  ? leg.native.some((path) => path.firewalls?.length || path.sourceNvaSpokeId || path.nvaSpokeId)
  : leg.native?.hops.some((hop) => hop.nodeKind === 'appliance' || hop.nodeKind === 'vnet-gateway'
    || hop.nodeKind === 'vwan-hub' && topology.version === 2
      && (publicFlow ? topology.vwanHubs.find((hub) => hub.id === hop.nodeId)?.routingIntent.internet
        : topology.vwanHubs.find((hub) => hub.id === hop.nodeId)?.routingIntent.private))
const knownAddress = (topology: InventoryTopology, address?: string) => !!address
  && inventoryOwners(topology).filter((owner) => owner.prefixes.some((prefix) => contains(prefix, ipv4(address)!))).length === 1

export function traceLoadBalancer(topology: InventoryTopology, request: PacketRequest, simulation?: Simulation | AzSimulationResult): PacketResult {
  const result: PacketResult = { source: request.source, target: request.target, ingress: 'not-assessed',
    forward: { direction: 'forward', routing: 'not-assessed', steps: [], reasons: [] },
    reply: { direction: 'reply', routing: 'not-assessed', steps: [], reasons: [] },
    translation: 'not-assessed', delivery: 'not-assessed', security: 'not-assessed',
    limitations: ['Regional Standard NIC-associated IPv4 TCP/UDP and ordinary non-floating rules only. Backend selection is deterministic illustration, not Azure proprietary hashing or an observed session.',
      'Declared health is unverified. Probe permission and client data permission are separate; no OS, listener, live probe timer, existing-flow migration, fragmentation, HA ports or Floating IP/DSR readiness is inferred.'] }
  const stop = (reason: string, blocked = false) => {
    result.ingress = blocked ? 'blocked' : 'not-assessed'
    result.forward.reasons.push(reason)
    if (blocked) result.forward.routing = 'unreachable'
    return result
  }
  const destination = request.target
  const lb = topology.inventory?.loadBalancers?.find((lb) => destination.kind === 'load-balancer'
    ? lb.id === destination.loadBalancerId : destination.kind === 'public-ip'
      && lb.frontends.some((frontend) => frontend.kind === 'public' && frontend.publicIpId === destination.publicIpId))
  const frontend = lb?.frontends.find((frontend) => destination.kind === 'load-balancer' ? frontend.id === destination.frontendId
    : destination.kind === 'public-ip' && frontend.kind === 'public' && frontend.publicIpId === destination.publicIpId)
  if (!lb || !frontend) return stop('The selected Load Balancer/frontend has no original ownership.', true)
  if (lb.rulesStatus === 'unknown') return stop('Captured Load Balancer rules are unknown; no mapping or outbound permission is inferred.')
  const publicIp = frontend.kind === 'public' ? topology.inventory?.publicIps.find((ip) => ip.id === frontend.publicIpId) : undefined
  if (frontend.kind === 'public' && (publicIp?.sku !== 'Standard' || publicIp.allocation !== 'Static')) {
    return stop('The original LB public allocation is missing or has unsupported/unknown SKU or allocation.')
  }
  const address = frontend.kind === 'public' ? publicIp?.address : frontend.privateIp
  if (!address) return stop('The original Load Balancer frontend allocation is unknown; no IP is fabricated.')
  if (frontend.kind === 'private' && !knownAddress(topology, address)) return stop('The original internal frontend address has ambiguous network ownership.')
  const source = request.source
  const sourceEndpoint = source.kind === 'workload' ? namedEndpoints(topology).find(({ workload, nic, config }) => same(source,
    { workloadId: workload.id, nicId: nic.id, ipConfigurationId: config.id })) : undefined
  if (frontend.kind === 'public' ? source.kind !== 'external' : source.kind !== 'workload') {
    return stop('Public LB initiation requires an explicit Internet client; internal LB requires an original private client. Additional egress/DNAT translation stages are not inferred.')
  }
  const sourceAddress = source.kind === 'external' ? source.address : sourceEndpoint?.config.privateIp
  if (!sourceAddress) return stop('The original client NIC addressing is unknown.')
  if (source.kind === 'workload' && !knownAddress(topology, sourceAddress)) return stop('The original client address has ambiguous network ownership.')
  if (source.kind === 'external' && [...inventoryOwners(topology).flatMap((owner) => owner.prefixes), ...topology.sites.flatMap((site) => site.prefixes),
    ...(topology.inventory?.publicIps.flatMap((ip) => ip.address ? [`${ip.address}/32`] : []) ?? []),
    ...(topology.inventory?.publicIpPrefixes?.flatMap((prefix) => prefix.prefix ? [prefix.prefix] : []) ?? []),
    ...(topology.version === 2 ? topology.vnets.flatMap((vnet) => vnet.appliances.flatMap((device) => device.advertisedPrefixes ?? [])) : [])]
    .some((prefix) => contains(prefix, ipv4(sourceAddress)!))) return stop('A connected client cannot be classified as Internet.')
  const original: FiveTuple = { sourceAddress, destinationAddress: address, protocol: request.protocol,
    sourcePort: request.sourcePort, destinationPort: request.destinationPort }
  const native = simulation ?? (topology.version === 1 ? simulate(topology) : simulateAzNet(topology))
  result.forward.tuple = original
  if (frontend.kind === 'private') {
    result.forward = traceInventoryPacketLeg(topology, native, sourceEndpoint!.nic.owner, sourceEndpoint!.config.subnetId, original,
      'forward', { owner: lb.owner, subnetId: frontend.subnetId })
    if (result.forward.routing !== 'reachable') return stop('Native routing does not reach this internal frontend; the LB creates no BGP or UDR route.', result.forward.routing === 'unreachable')
    if (unknownRouter(topology, result.forward)) {
      result.forward.steps.push({ entity: { kind: 'load-balancer', id: lb.id }, before: original, after: null,
        evidence: 'Private frontend access crosses an additional router whose translation is not assessed.' })
      return stop('The private client tuple after additional routing/translation boundaries is unassessed.')
    }
  } else result.forward = { direction: 'forward', tuple: original, routing: 'reachable', steps: [], reasons: [] }
  const rule = lb.rules.find((rule) => rule.frontendId === frontend.id && (rule.protocol === request.protocol && rule.frontendPort === request.destinationPort || rule.haPorts))
  const inbound = lb.inboundNatRules.find((rule) => rule.frontendId === frontend.id && rule.protocol === request.protocol && rule.frontendPort === request.destinationPort)
  if (!rule && !inbound) return stop('No original Load Balancer rule or inbound NAT mapping matches this frontend/protocol/port.', true)
  if (rule?.floatingIp || rule?.haPorts) return stop('HA ports and Floating IP/DSR require separate modeled backend OS/forwarding capabilities. The original destination is not silently DNATed.')
  const selectedRule = rule ?? inbound!
  const pool = lb.pools.find((pool) => pool.id === selectedRule.poolId)!
  const assessment: LoadBalancerPacketAssessment = { id: lb.id, frontendId: frontend.id, ruleId: selectedRule.id,
    kind: rule ? 'load-balancing' : 'inbound-nat', eligible: [], probes: [] }
  result.loadBalancer = assessment
  if (pool.membersStatus === 'unknown') return stop('Original Load Balancer backend membership is incomplete; no hidden backend is invented.')
  if (frontend.kind === 'private' && source.kind === 'workload' && pool.members.some((member) => same(member, source))) {
    return stop('A backend accessing its own internal Load Balancer frontend is unsupported by Azure; no hairpin delivery is inferred.', true)
  }
  if (rule) {
    const probe = lb.probes.find((probe) => probe.id === rule.probeId)!
    assessment.probes = pool.members.map((target) => {
      const entry = namedEndpoints(topology).find(({ workload, nic, config }) => same(target,
        { workloadId: workload.id, nicId: nic.id, ipConfigurationId: config.id }))!
      const declared = probe.health.find((health) => same(health.target, target))?.status ?? 'unknown'
      const checks = knownAddress(topology, entry.config.privateIp) ? assessEndpointNsg(topology, entry.nic.owner, entry.nic.id, entry.config.subnetId,
        'inbound', { ...original, sourceAddress: '168.63.129.16', destinationAddress: entry.config.privateIp!,
          protocol: 'tcp', sourcePort: 49152, destinationPort: probe.port }, {
          ...nsgScope(topology, entry.nic.owner, entry.config.subnetId, native), purpose: 'health-probe',
          standardPublicIngress: true, uncertainty: { sourcePorts: [1, 65535] },
        }) : { outcome: 'not-assessed' as const, checks: [] }
      return { target, declared, checks: checks.checks, eligibility: declared === 'unhealthy' || checks.outcome === 'denied' ? 'ineligible' as const
        : declared === 'healthy' && checks.outcome === 'allowed' ? 'eligible' as const : 'unknown' as const }
    })
    assessment.eligible = assessment.probes.filter((probe) => probe.eligibility === 'eligible').map((probe) => probe.target)
    if (!assessment.eligible.length) return stop(assessment.probes.some((probe) => probe.eligibility === 'unknown')
      ? 'No known-eligible backend: declared health, original addressing or probe filtering is unknown.'
      : 'No healthy probe-reachable backend is eligible for this new flow.', !assessment.probes.some((probe) => probe.eligibility === 'unknown'))
    const eligible = [...assessment.eligible].sort((a, b) => workloadEndpointKey(ref(a)) < workloadEndpointKey(ref(b)) ? -1 : 1)
    const fields = rule.affinity === 'client-ip' ? [original.sourceAddress, original.destinationAddress]
      : rule.affinity === 'client-ip-protocol' ? [original.sourceAddress, original.destinationAddress, original.protocol]
        : [original.sourceAddress, original.destinationAddress, original.protocol, original.sourcePort, original.destinationPort]
    const key = JSON.stringify([lb.id, frontend.id, pool.id, fields])
    let hash = 2166136261
    for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619)
    assessment.selected = eligible[(hash >>> 0) % eligible.length]
  } else {
    assessment.selected = inbound!.target
    assessment.eligible = [inbound!.target]
  }
  const target = ref(assessment.selected!), entry = namedEndpoints(topology).find(({ workload, nic, config }) => same(target,
    { workloadId: workload.id, nicId: nic.id, ipConfigurationId: config.id }))!
  if (!knownAddress(topology, entry.config.privateIp)) return stop('The original selected backend NIC allocation is unknown or ambiguous.')
  const mapped: FiveTuple = { ...original, destinationAddress: entry.config.privateIp!, destinationPort: selectedRule.backendPort }
  result.forward.steps.push({ entity: { kind: 'load-balancer', id: lb.id }, before: original, after: mapped, routeId: selectedRule.id,
    evidence: rule ? 'Ordinary non-floating LB maps the original frontend to an illustrative known-eligible backend, preserving client source. This selection is not an observed Azure hash/session.'
      : 'The original inbound NAT rule targets its specific backend association without requiring or consulting a health probe.' },
  { entity: { kind: 'workload', id: target.workloadId }, before: mapped, after: mapped,
    evidence: 'The original selected private backend NIC receives the mapped tuple subject to its own subnet/NIC NSGs; listener readiness is unassessed.' })
  const response = reverse(mapped)
  result.reply = traceInventoryPacketLeg(topology, native, entry.nic.owner, entry.config.subnetId, response, 'reply',
    frontend.kind === 'private' ? { owner: sourceEndpoint!.nic.owner, subnetId: sourceEndpoint!.config.subnetId } : undefined,
    undefined, undefined, frontend.kind === 'public')
  if (unknownRouter(topology, result.reply, frontend.kind === 'public')) {
    result.reply.routing = 'not-assessed'
    result.reply.reasons.push('The backend return crosses another router; frontend inverse mapping and symmetry are not established.')
  }
  if (result.reply.routing === 'reachable') {
    result.reply.steps.push({ entity: { kind: 'load-balancer', id: lb.id }, before: response, after: reverse(original),
      evidence: 'Conditional response reverses this original frontend mapping. NAT Gateway, instance public IP and outbound-rule precedence for new flows do not replace this established response owner.' })
    result.reply.session = 'conditional-response'
  } else result.reply.steps.push({ entity: { kind: 'load-balancer', id: lb.id }, before: response, after: null,
    evidence: 'A reachable symmetric backend return is not established; no inverse mapping is asserted.' })
  const sourceNsg = source.kind === 'workload' ? endpointNsg(topology, source, 'outbound', original, native) : { outcome: 'allowed' as const, checks: [] }
  result.nsg = completePacketNsg(topology, target, result.forward, result.reply, sourceNsg, native, 'none', true)
  result.security = result.nsg.forward.outcome === 'denied' ? 'denied' : 'not-assessed'
  result.ingress = result.nsg.forward.outcome === 'denied' ? 'blocked' : result.nsg.forward.outcome === 'allowed' ? 'configured' : 'not-assessed'
  result.translation = result.forward.steps.some((step) => step.after && (step.before.destinationAddress !== step.after.destinationAddress
    || step.before.destinationPort !== step.after.destinationPort)) ? 'dnat' : 'not-assessed'
  return result
}
