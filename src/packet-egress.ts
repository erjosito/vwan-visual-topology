import { loadBalancerOutboundCandidates, namedEndpoints, natGatewayForSubnet, type InventoryTopology } from './inventory'
import { cidr, formatIpv4 } from './validation'
import type { FiveTuple, PacketLeg, PacketRequest, PacketResult } from './packet-flow'
import { applyRouterSnat } from './packet-snat'
import type { Simulation } from './routing'
import type { AzSimulationResult } from './azure-net/engine'

function reverse(tuple: FiveTuple): FiveTuple {
  return { ...tuple, sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
    sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort }
}

export function applyInternetEgress(topology: InventoryTopology, request: PacketRequest, forward: PacketLeg, reply: PacketLeg, simulation?: Simulation | AzSimulationResult):
  Pick<PacketResult, 'translation' | 'egress'> {
  const router = applyRouterSnat(topology, request, forward, reply, simulation)
  if (router) return router
  if (request.source.kind !== 'workload' || request.target.kind !== 'external') return { translation: 'not-assessed' }
  const source = request.source
  const entry = namedEndpoints(topology).find(({ workload, nic, config }) =>
    workload.id === source.workloadId && nic.id === source.nicId && config.id === source.ipConfigurationId)
  if (!entry || !forward.tuple || !forward.native) return { translation: 'not-assessed', egress: 'not-assessed' }
  const native = forward.native
  const candidates = loadBalancerOutboundCandidates(topology, source, request.protocol)
  if (Array.isArray(native) || native.traversedApplianceIds.length || native.hops.some((hop) => hop.nodeKind === 'vwan-hub' || hop.nodeKind === 'vnet-gateway')) {
    forward.reasons.push('The selected route leaves through a router or managed hub. A source-subnet NAT Gateway does not override that route; router translation is not assessed.')
    return { translation: 'not-assessed', egress: 'not-assessed' }
  }
  if (forward.routing !== 'reachable') return {
    translation: 'not-assessed', egress: candidates.length ? 'not-assessed' : native.status === 'dropped-no-outbound-access' ? 'blocked' : 'not-assessed',
  }
  const terminal = native.hops.at(-1)
  if (terminal?.nodeKind !== 'subnet' || terminal.vnetId !== entry.nic.owner.id || terminal.subnetId !== entry.config.subnetId
    || terminal.matchedRoute?.nextHopType !== 'Internet') return { translation: 'not-assessed', egress: 'not-assessed' }
  const gateway = natGatewayForSubnet(topology, entry.nic.owner, entry.config.subnetId)
  const instanceIp = topology.inventory?.publicIps.find((ip) => ip.id === entry.config.publicIpId)
  const subnet = topology.version === 2 ? topology.vnets.find((vnet) => vnet.id === entry.nic.owner.id)?.subnets
    .find((subnet) => subnet.id === entry.config.subnetId) : undefined
  if (subnet?.internetEgressStatus === 'unknown' && !gateway) {
    forward.reasons.push('Captured subnet NAT association is unknown; an instance public IP does not resolve the ultimate outbound mapping.')
    return { translation: 'not-assessed', egress: 'not-assessed' }
  }
  if (instanceIp?.sku === 'StandardV2' || instanceIp?.sku === 'Standard' && instanceIp.allocation === 'Dynamic') {
    forward.reasons.push('The declared instance public IP configuration is unsupported. No StandardV2 or invalid Standard dynamic mapping is inferred.')
    return { translation: 'not-assessed', egress: 'not-assessed' }
  }
  if (gateway && instanceIp && instanceIp.sku !== 'Standard') {
    forward.reasons.push('The NIC public IP SKU is unknown or incompatible with Standard NAT Gateway. Translation compatibility is not assessed.')
    return { translation: 'not-assessed', egress: 'not-assessed' }
  }
  let publicAddress: string | undefined
  let entity: { kind: string; id: string }
  let lbRuleId: string | undefined
  if (gateway) {
    if (gateway.publicIpIds.length) publicAddress = topology.inventory?.publicIps.find((ip) => ip.id === gateway.publicIpIds[0])?.address
    else {
      const prefix = topology.inventory?.publicIpPrefixes?.find((prefix) => prefix.id === gateway.publicIpPrefixIds?.[0])?.prefix
      if (prefix) publicAddress = formatIpv4(cidr(prefix)!.network)
    }
    entity = { kind: 'nat-gateway', id: gateway.id }
  } else if (instanceIp) {
    publicAddress = instanceIp.address
    entity = { kind: 'public-ip', id: instanceIp.id }
  } else if (candidates.length) {
    const mappings = new Set(candidates.map((candidate) => JSON.stringify([candidate.lb.id, candidate.pool.id,
      candidate.frontends.map((frontend) => frontend.id).sort()])))
    const candidate = [...candidates].sort((a, b) => a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0)[0]
    if (mappings.size !== 1 || candidates.some((entry) => !entry.primaryKnown || entry.unsupported || entry.lb.rulesStatus === 'unknown'
      || entry.pool.membersStatus === 'unknown')) {
      forward.reasons.push('Load Balancer outbound ownership, primary IPv4 association or supported rule coverage is unknown or ambiguous.')
      return { translation: 'not-assessed', egress: 'not-assessed' }
    }
    const frontend = [...candidate.frontends].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0]
    publicAddress = frontend?.kind === 'public' ? topology.inventory?.publicIps.find((ip) => ip.id === frontend.publicIpId)?.address : undefined
    entity = { kind: 'load-balancer', id: candidate.lb.id }
    lbRuleId = candidate.ruleId
  } else if (subnet?.defaultOutboundAccess === false) {
    forward.reasons.push('No explicit outbound method matches this packet protocol. An internal frontend or inbound NAT rule does not supply Internet SNAT.')
    return { translation: 'not-assessed', egress: 'blocked' }
  } else {
    forward.reasons.push('Legacy implicit outbound access: the existing subnet default is preserved, but its dynamic public address and response translation are unknown.')
    return { translation: 'not-assessed', egress: 'legacy-implicit' }
  }
  if (!publicAddress) {
    forward.reasons.push('An explicit outbound method is configured, but its allocated public address is unknown. No translated address or response mapping was invented.')
    return { translation: 'not-assessed', egress: 'not-assessed' }
  }
  const original = forward.tuple
  const translated: FiveTuple = { ...original, sourceAddress: publicAddress,
    sourcePort: gateway || lbRuleId ? 1024 + (original.sourcePort * 31 + original.destinationPort) % 64512 : original.sourcePort }
  const explanation = gateway
    ? 'Standard NAT Gateway takes precedence over instance public IPs and Load Balancer outbound rules on this direct Internet route. The selected pool address and SNAT port are illustrative, not Azure allocation or capacity predictions.'
    : lbRuleId ? 'The declared public Load Balancer outbound configuration supplies SNAT after route selection. Instance public IP and NAT Gateway take precedence. Pool address/port choice is illustrative; proprietary allocation, exhaustion, timers and live sessions are unassessed.'
      : 'Explicit instance public IP outbound mapping. This does not publish an inbound listener or establish security permission.'
  forward.steps = forward.steps.map((step) => step.after === null ? { ...step, after: step.before } : step)
  forward.steps.push({ entity, before: original, after: translated, evidence: explanation, ...(lbRuleId ? { routeId: lbRuleId } : {}) })
  reply.tuple = reverse(translated)
  reply.routing = 'reachable'
  reply.session = 'conditional-response'
  reply.reasons = ['Conditional response to this exact modeled outbound tuple, not a new reverse initiation. Listener, policy, runtime session state and application delivery remain unassessed.']
  reply.steps = [
    { entity, before: reverse(translated), after: reverse(original), evidence: 'Reverse the modeled outbound translation for response traffic only.' },
    { entity: { kind: 'workload', id: source.workloadId }, before: reverse(original), after: reverse(original),
      evidence: `Response mapping targets the original NIC ${source.nicId}, IP configuration ${source.ipConfigurationId}, in the directly associated subnet.` },
  ]
  return { translation: 'snat', egress: 'configured' }
}
