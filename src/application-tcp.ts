import type { ApplicationDecision, ApplicationReference, ApplicationRequest, ApplicationResult, ApplicationService } from './application'
import { namedEndpoints, ownsInventoryAddress, type InventoryTopology } from './inventory'
import { simulateAzNet } from './azure-net/engine'
import { traceInventoryPacketLeg } from './packet-ingress'
import { assessEndpointNsg, assessNsgPoint, endpointNsg, nsgScope, type NsgAssessment, type NsgCheck, type TupleUncertainty } from './packet-security'
import type { FiveTuple, PacketLeg } from './packet-flow'

const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple, sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
  sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
const routers = (leg: PacketLeg) => !Array.isArray(leg.native) && leg.native?.hops.some((hop) =>
  ['appliance', 'vnet-gateway', 'vwan-hub', 'site', 'er-location'].includes(hop.nodeKind))
const aggregate = (checks: NsgCheck[]): NsgAssessment => ({ checks, outcome: checks.some((check) => check.outcome === 'denied') ? 'denied'
  : checks.some((check) => check.outcome === 'not-assessed') ? 'not-assessed' : 'allowed' })

export function evaluateTcpProxy(topology: InventoryTopology, request: Extract<ApplicationRequest, { kind: 'tcp' }>, service: ApplicationService): ApplicationResult {
  const selected: ApplicationReference = { kind: 'service', id: service.id }
  const config = service.tcpProxy, source = request.client
  const backend = config && namedEndpoints(topology).find(({ workload, nic, config: ip }) => workload.id === config.backend.workloadId
    && nic.id === config.backend.nicId && ip.id === config.backend.ipConfigurationId)
  const target: ApplicationReference | null = config ? { kind: 'workload', ...config.backend } : null
  const references = [selected, ...service.references, ...(target ? [target] : []), ...(source.kind === 'workload' ? [source] : [])]
  const base = { outcome: 'not-assessed' as const, reasons: ['This TCP provider requires explicit original private gateway configuration.'], references,
    provenance: 'declared-configuration' as const }
  const decisions: ApplicationDecision[] = [
    { ...base, id: 'listener-match', kind: 'listener-match', evidence: { serviceId: service.id, listenerId: config?.listenerId ?? null,
      ruleId: config?.ruleId ?? null, priority: config?.rulePriority ?? null, scheme: 'tcp', host: null, port: request.port } },
    { ...base, id: 'request-route', kind: 'request-route', evidence: { serviceId: service.id, path: '', poolId: config?.poolId ?? null,
      candidates: target ? [target] : [], unsupportedFeatures: service.unsupportedFeatures } },
    ...(['client-to-proxy', 'proxy-to-backend'] as const).map((leg): ApplicationDecision => ({ ...base, id: leg, kind: 'network-leg',
      evidence: { leg, source: leg === 'client-to-proxy' ? source : selected, target: leg === 'client-to-proxy' ? selected : target,
        before: null, after: null, packetEvidence: null } })),
    { ...base, id: 'response-assumption', kind: 'response-assumption',
      evidence: { conditional: true, owner: selected, httpAvailability: 'not-assessed', tlsAvailability: 'not-assessed' } },
  ]
  const result: ApplicationResult = { version: 1, kind: 'tcp', configuration: 'not-assessed', availability: 'not-assessed', decisions, connections: [],
    uncertainties: [], limitations: [
      'Private Standard_v2/WAF_v2 TCP passthrough with one declared instance and one original workload backend only. No TLS termination, HTTP/WAF inspection, Proxy Protocol, DNS, public frontends, extra routers or Private Link composition.',
      'Frontend and backend are separate TCP connections, not an end-to-end NAT session. Instance addressing, ephemeral ports and health are declarations, not live observations; autoscale, capacity and failover are not assessed.'] }
  const finish = (reason?: string) => {
    if (reason) for (const decision of decisions.filter((decision) => decision.outcome === 'not-assessed')) decision.reasons = [reason]
    result.uncertainties = decisions.filter((decision) => decision.outcome === 'not-assessed')
      .map(({ id, reasons, references }) => ({ decisionId: id, reasons, references }))
    return result
  }
  if (topology.version !== 2 || service.kind !== 'application-gateway' || !config || service.owner?.kind !== 'vnet'
    || source.kind !== 'workload' || service.unsupportedFeatures.length || config.proxyProtocol
    || config.provisioningState !== 'succeeded' || topology.inventory?.capture?.configurationComplete === false) {
    return finish('The original TCP provider configuration, capture completeness or supported private-client slice is not established.')
  }
  decisions[0].outcome = request.port === config.frontendPort ? 'satisfied' : 'violated'
  decisions[0].reasons = ['Only the original declared TCP listener port selects this rule.']
  if (decisions[0].outcome === 'violated') return finish()
  decisions[1].outcome = config.declaredHealth === 'healthy' ? 'satisfied' : config.declaredHealth === 'unhealthy' ? 'violated' : 'not-assessed'
  decisions[1].reasons = ['One original backend is selected only when its default TCP probe health is explicitly declared healthy; this is not a live health result.']
  if (decisions[1].outcome !== 'satisfied') return finish()
  const client = namedEndpoints(topology).find(({ workload, nic, config }) => workload.id === source.workloadId
    && nic.id === source.nicId && config.id === source.ipConfigurationId)
  if (!client || !backend || !config.frontendAddress || !config.instanceAddress
    || !ownsInventoryAddress(topology, client.nic.owner, client.config.subnetId, client.config.privateIp)
    || !ownsInventoryAddress(topology, backend.nic.owner, backend.config.subnetId, backend.config.privateIp)) {
    return finish('The original client, frontend, instance or backend allocation is unknown or ambiguous.')
  }
  const simulation = simulateAzNet(topology), owner = service.owner
  const clientTuple = { protocol: 'tcp' as const, sourceAddress: client.config.privateIp!, destinationAddress: config.frontendAddress,
    sourcePort: request.sourcePort, destinationPort: config.frontendPort }
  const backendTuple = { protocol: 'tcp' as const, sourceAddress: config.instanceAddress, destinationAddress: backend.config.privateIp!,
    sourcePort: 49152, destinationPort: config.backendPort }
  for (const id of ['client-to-proxy', 'proxy-to-backend'] as const) {
    const first = id === 'client-to-proxy', tuple = first ? clientTuple : backendTuple
    const from = first ? { owner: client.nic.owner, subnetId: client.config.subnetId } : { owner, subnetId: config.subnetId }
    const to = first ? { owner, subnetId: config.subnetId } : { owner: backend.nic.owner, subnetId: backend.config.subnetId }
    const forward = traceInventoryPacketLeg(topology, simulation, from.owner, from.subnetId, tuple, 'forward', to)
    const reply = traceInventoryPacketLeg(topology, simulation, to.owner, to.subnetId, reverse(tuple), 'reply', from)
    if (routers(forward) || routers(reply)) return finish('This TCP connection crosses an additional router whose translation and policy are not qualified.')
    const uncertainty: TupleUncertainty | undefined = first ? undefined : { sourcePorts: [1024, 65535] }
    const checks = first ? endpointNsg(topology, source, 'outbound', tuple, simulation).checks
      : [assessNsgPoint(topology, owner, { kind: 'subnet', id: config.subnetId }, 'outbound', tuple,
        { ...nsgScope(topology, owner, config.subnetId, simulation), uncertainty })]
    if (forward.routing === 'reachable' && !checks.some((check) => check.outcome === 'denied')) checks.push(...(first
      ? [assessNsgPoint(topology, owner, { kind: 'subnet', id: config.subnetId }, 'inbound', tuple, nsgScope(topology, owner, config.subnetId, simulation))]
      : assessEndpointNsg(topology, backend.nic.owner, backend.nic.id, backend.config.subnetId, 'inbound', tuple,
        { ...nsgScope(topology, backend.nic.owner, backend.config.subnetId, simulation), uncertainty }).checks))
    const filtering = aggregate(checks)
    const outcome = filtering.outcome === 'denied' || forward.routing === 'unreachable' || reply.routing === 'unreachable' ? 'violated'
      : filtering.outcome === 'allowed' && forward.routing === 'reachable' && reply.routing === 'reachable' ? 'satisfied' : 'not-assessed'
    const response: NsgAssessment = outcome === 'satisfied' ? { outcome: 'allowed', conditionalResponse: true,
      checks: checks.toReversed().map((check) => ({ ...check, tuple: reverse(check.tuple),
        direction: check.direction === 'outbound' ? 'inbound' : 'outbound', ruleId: undefined, priority: undefined,
        uncertainty: check.uncertainty ? { destinationPorts: check.uncertainty.sourcePorts } : undefined,
        reason: 'Conditional response to this connection only; the two proxy legs do not create a new reverse initiation or live session.' })),
    } : { outcome: 'not-assessed', checks: [] }
    if (outcome === 'satisfied') reply.session = 'conditional-response'
    if (filtering.outcome === 'denied') {
      const denied = checks.find((check) => check.outcome === 'denied')!
      forward.steps = [{ entity: { kind: denied.target.kind, id: denied.target.id }, before: tuple, after: null,
        evidence: 'The new TCP connection is denied by its visible subnet/NIC filtering; no response connection is established.' }]
      reply.steps = []
    }
    if (uncertainty) {
      forward.steps = forward.steps.map((step) => ({ ...step, uncertainty }))
      reply.steps = reply.steps.map((step) => ({ ...step, uncertainty: { destinationPorts: uncertainty.sourcePorts } }))
    }
    result.connections!.push({ id, forward, reply, nsg: { forward: filtering, reply: response } })
    const decision = decisions.find((decision) => decision.kind === 'network-leg' && decision.evidence.leg === id)!
    if (decision.kind === 'network-leg') {
      decision.outcome = outcome; decision.provenance = 'native-packet-evidence'
      decision.reasons = ['Native forward/return routes and visible filtering are evaluated independently for this TCP connection. The backend connection starts at the declared gateway instance, not the client or frontend IP.']
      decision.evidence = { ...decision.evidence, before: tuple, after: tuple, packetEvidence: { section: 'application-connections', connectionId: id } }
    }
    if (outcome !== 'satisfied') return finish()
  }
  decisions.at(-1)!.outcome = 'satisfied'
  decisions.at(-1)!.reasons = ['The two independently routed conditional TCP responses are associated by this declared proxy; no application, TLS or live session continuity is verified.']
  return finish()
}
