import { namedEndpoints, ownsInventoryAddress, sameInventoryOwner, type InventoryTopology } from './inventory'
import { simulateAzNet, type AzSimulationResult } from './azure-net/engine'
import { traceInventoryPacketLeg } from './packet-ingress'
import { traceLoadBalancer } from './packet-load-balancer'
import { assessNsgPoint, endpointNsg, nsgScope, type NsgAssessment } from './packet-security'
import type { FiveTuple, PacketLeg, PacketRequest, PacketResult } from './packet-flow'

const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple,
  sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
  sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
const hasRouter = (leg: PacketLeg) => !Array.isArray(leg.native) && leg.native?.hops.some((hop) =>
  ['appliance', 'vnet-gateway', 'vwan-hub', 'site', 'er-location'].includes(hop.nodeKind))
const aggregate = (checks: NsgAssessment['checks']): NsgAssessment => ({ checks,
  outcome: checks.some((check) => check.outcome === 'denied') ? 'denied'
    : checks.some((check) => check.outcome === 'not-assessed') ? 'not-assessed' : 'allowed' })

export function tracePrivateLink(topology: InventoryTopology, request: PacketRequest, simulation?: AzSimulationResult): PacketResult {
  const result: PacketResult = { source: request.source, target: request.target, translation: 'not-assessed',
    ingress: 'not-assessed', delivery: 'not-assessed', security: 'not-assessed',
    forward: { direction: 'forward', routing: 'not-assessed', steps: [], reasons: [] },
    reply: { direction: 'reply', routing: 'not-assessed', steps: [], reasons: [] },
    limitations: ['Declared IPv4 TCP/UDP Private Link Service to a Standard internal NIC-backed LB only. Consumer and provider networks remain separate; this is not VNet transit.',
      'One original provider NAT configuration, ordinary non-floating LB rules, no Proxy Protocol v2 or intermediate routers. Allocations, health, sessions and application delivery are not live observations.',
      'Probes are independent. Concurrent NAT port allocation, exhaustion and connection capacity are not assessed.'] }
  const stop = (reason: string, blocked = false) => {
    result.forward.routing = blocked ? 'unreachable' : 'not-assessed'
    result.forward.reasons.push(reason)
    result.ingress = blocked ? 'blocked' : 'not-assessed'
    return result
  }
  if (topology.version !== 2 || request.source.kind !== 'workload' || request.target.kind !== 'private-endpoint') {
    return stop('Private Link forwarding requires an original version-2 workload and Private Endpoint destination.')
  }
  const destination = request.target, source = request.source
  const consumer = topology.vnets.flatMap((vnet) => vnet.subnets.flatMap((subnet) =>
    (subnet.privateEndpoints ?? []).map((endpoint) => ({ vnet, subnet, endpoint })))).find(({ endpoint }) => endpoint.id === destination.privateEndpointId)
  const endpoint = namedEndpoints(topology).find(({ workload, nic, config }) => workload.id === source.workloadId
    && nic.id === source.nicId && config.id === source.ipConfigurationId)
  if (!consumer || !endpoint?.config.privateIp) return stop('The original consumer Private Endpoint or source NIC allocation is missing.')
  if (!ownsInventoryAddress(topology, endpoint.nic.owner, endpoint.config.subnetId, endpoint.config.privateIp)
    || !ownsInventoryAddress(topology, { kind: 'vnet', id: consumer.vnet.id }, consumer.subnet.id, consumer.endpoint.ipAddress)) {
    return stop('The original consumer source or Private Endpoint allocation has ambiguous network ownership.')
  }
  const connection = topology.inventory?.privateEndpointConnections?.find((connection) => connection.privateEndpointId === consumer.endpoint.id)
  const service = topology.inventory?.privateLinkServices?.find((service) => service.id === connection?.serviceId)
  if (!connection || !service || connection.state === 'unknown') return stop('The original Private Endpoint service binding or approval is unknown; no provider path is inferred.')
  if (connection.state !== 'approved') return stop('Only an explicitly approved Private Endpoint connection can forward to the declared service.', true)
  if (service.provisioningState !== 'succeeded' || service.proxyProtocol || service.natIpConfigurations.length !== 1) {
    return stop('Private Link requires declared successful provisioning, one original NAT configuration and Proxy Protocol v2 disabled for this qualified slice.')
  }
  const nat = service.natIpConfigurations[0]
  const provider = service.owner.kind === 'vnet' ? topology.vnets.find((vnet) => vnet.id === service.owner.id) : undefined
  if (provider?.subnets.find((subnet) => subnet.id === nat.subnetId)?.privateLinkServiceNetworkPolicies !== 'Disabled') {
    return stop('The original Private Link Service NAT subnet must explicitly disable Private Link Service network policies.')
  }
  const native = simulation ?? simulateAzNet(topology)
  const original: FiveTuple = { sourceAddress: endpoint.config.privateIp, destinationAddress: consumer.endpoint.ipAddress,
    protocol: request.protocol, sourcePort: request.sourcePort, destinationPort: request.destinationPort }
  const consumerOwner = { kind: 'vnet' as const, id: consumer.vnet.id }
  result.forward = traceInventoryPacketLeg(topology, native, endpoint.nic.owner, endpoint.config.subnetId, original, 'forward',
    { owner: consumerOwner, subnetId: consumer.subnet.id })
  if (result.forward.routing !== 'reachable') return stop('Native routing does not reach the selected original Private Endpoint.', result.forward.routing === 'unreachable')
  if (hasRouter(result.forward)) return stop('Consumer routing through additional routers and translations is not assessed by this Private Link slice.')
  const sourceNsg = endpointNsg(topology, source, 'outbound', original, native)
  const consumerChecks = [...sourceNsg.checks]
  if (['Enabled', 'NetworkSecurityGroupEnabled'].includes(consumer.subnet.privateEndpointNetworkPolicies ?? 'Disabled')) {
    consumerChecks.push(assessNsgPoint(topology, consumerOwner, { kind: 'subnet', id: consumer.subnet.id }, 'inbound', original,
      nsgScope(topology, consumerOwner, consumer.subnet.id, native)))
  }
  const consumerNsg = aggregate(consumerChecks)
  if (consumerNsg.outcome !== 'allowed') {
    result.nsg = { forward: consumerNsg, reply: { outcome: 'not-assessed', checks: [] } }
    if (consumerNsg.outcome === 'denied') result.security = 'denied'
    return stop('Consumer source or enabled Private Endpoint subnet filtering does not establish permission.', consumerNsg.outcome === 'denied')
  }
  const lb = topology.inventory?.loadBalancers?.find((lb) => lb.id === service.loadBalancerId)
  const frontend = lb?.frontends.find((frontend) => frontend.id === service.frontendId)
  if (!lb || !sameInventoryOwner(lb.owner, service.owner) || frontend?.kind !== 'private' || !frontend.privateIp
    || !ownsInventoryAddress(topology, service.owner, nat.subnetId, nat.privateIp)) {
    return stop('The original provider internal Load Balancer allocation or NAT ownership is unknown.')
  }
  if (lb.rulesStatus !== 'unknown' && !lb.rules.some((rule) => rule.frontendId === service.frontendId
    && rule.protocol === request.protocol && rule.frontendPort === request.destinationPort && !rule.floatingIp && !rule.haPorts)) {
    return stop('Only an ordinary non-floating Load Balancer rule can bind this Private Link service port; inbound NAT and HA ports are not assessed.')
  }
  const providerTuple = { ...original, sourceAddress: nat.privateIp, destinationAddress: frontend.privateIp,
    sourcePort: 1024 + (original.sourcePort * 31 + original.destinationPort + connection.id.length) % 64512 }
  const providerResult = traceLoadBalancer(topology, { ...request, sourcePort: providerTuple.sourcePort,
    target: { kind: 'load-balancer', loadBalancerId: service.loadBalancerId, frontendId: service.frontendId } }, native,
  { owner: service.owner, subnetId: nat.subnetId, address: nat.privateIp, uncertainty: { sourcePorts: [0, 65535] } })
  result.forward.steps.push({ entity: { kind: 'private-endpoint', id: consumer.endpoint.id }, before: original, after: original,
    routeId: connection.id, evidence: 'The explicitly approved original Private Endpoint connection selects only its bound provider service, not general provider VNet connectivity.' },
  { entity: { kind: 'private-link-service', id: service.id }, before: original, after: providerTuple, routeId: nat.id,
    uncertainty: { sourcePorts: [0, 65535] },
    evidence: 'Private Link maps the consumer destination to the original internal LB frontend and the source to the original provider NAT configuration. Source port selection is illustrative.' },
  ...providerResult.forward.steps)
  result.forward.routing = providerResult.forward.routing
  result.forward.reasons.push(...providerResult.forward.reasons)
  result.loadBalancer = providerResult.loadBalancer
  result.reply = providerResult.reply
  result.translation = 'snat-dnat'
  result.ingress = providerResult.ingress
  const consumerReturn = traceInventoryPacketLeg(topology, native, consumerOwner, consumer.subnet.id, reverse(original), 'reply',
    { owner: endpoint.nic.owner, subnetId: endpoint.config.subnetId })
  if (hasRouter(consumerReturn)) {
    consumerReturn.routing = 'not-assessed'
    consumerReturn.reasons.push('The consumer return crosses another router; the exact Private Endpoint conditional response is not established.')
  }
  if (result.reply.routing === 'reachable' && consumerReturn.routing === 'reachable'
    && providerResult.nsg?.forward.outcome === 'allowed' && providerResult.nsg.reply.outcome === 'allowed'
    && providerResult.reply.session === 'conditional-response') {
    result.reply.steps.push({ entity: { kind: 'private-link-service', id: service.id }, before: reverse(providerTuple), after: reverse(original),
      routeId: connection.id, evidence: 'The exact conditional response reverses this provider NAT and approved Private Endpoint mapping, retaining the original consumer connection identity.' },
    ...consumerReturn.steps)
    result.reply.session = 'conditional-response'
  } else {
    if (result.reply.routing === 'reachable') result.reply.routing = consumerReturn.routing === 'reachable' ? 'not-assessed' : consumerReturn.routing
    result.reply.steps.push({ entity: { kind: 'private-endpoint', id: consumer.endpoint.id }, before: reverse(providerTuple), after: null,
      evidence: 'Both original provider and consumer return paths are required before asserting a Private Link conditional response.' })
    result.reply.reasons.push(...consumerReturn.reasons)
    delete result.reply.session
  }
  const forwardNsg = aggregate([...consumerChecks, ...(providerResult.nsg?.forward.checks ?? [])])
  if (!providerResult.nsg || providerResult.nsg.forward.outcome === 'not-assessed') {
    if (forwardNsg.outcome !== 'denied') forwardNsg.outcome = 'not-assessed'
  }
  result.nsg = { forward: forwardNsg, reply: { outcome: 'not-assessed', checks: [] } }
  if (forwardNsg.outcome === 'allowed' && result.forward.routing === 'reachable' && result.reply.routing === 'reachable'
    && providerResult.nsg?.reply.outcome === 'allowed') {
    result.nsg.reply = { ...providerResult.nsg.reply, checks: [...providerResult.nsg.reply.checks, ...consumerChecks.toReversed().map((check) => ({
      ...check, tuple: reverse(check.tuple), direction: check.direction === 'outbound' ? 'inbound' as const : 'outbound' as const,
      reason: 'Conditional response to the allowed original consumer flow, not a new reverse initiation.',
    }))], conditionalResponse: true }
  } else delete result.reply.session
  result.security = forwardNsg.outcome === 'denied' ? 'denied' : 'not-assessed'
  return result
}
