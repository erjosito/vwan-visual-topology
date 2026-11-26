import type { ApplicationDecision, ApplicationReference, ApplicationRequest, ApplicationResult, ApplicationService } from './application'
import { namedEndpoints, ownsInventoryAddress, type InventoryOwner, type InventoryTopology } from './inventory'
import { simulateAzNet, type AzSimulationResult } from './azure-net/engine'
import { traceInventoryPacketLeg } from './packet-ingress'
import { assessEndpointNsg, assessNsgPoint, endpointNsg, nsgScope, type NsgAssessment, type NsgCheck, type TupleUncertainty } from './packet-security'
import { cidr, contains, formatIpv4, ipv4 } from './validation'
import type { FiveTuple, PacketLeg, WorkloadEndpoint } from './packet-flow'

const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple, sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
  sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
const reverseUncertainty = (value: TupleUncertainty): TupleUncertainty => ({
  sourceAddressPrefixes: value.destinationAddressPrefixes, destinationAddressPrefixes: value.sourceAddressPrefixes,
  sourcePorts: value.destinationPorts, destinationPorts: value.sourcePorts,
})
const otherRouter = (leg: PacketLeg, firewallId: string) => Array.isArray(leg.native) || leg.native?.hops.some((hop) =>
  hop.nodeKind === 'appliance' && hop.nodeId !== firewallId || ['vnet-gateway', 'vwan-hub', 'site', 'er-location'].includes(hop.nodeKind))
const filtering = (checks: NsgCheck[]): NsgAssessment => ({ checks, outcome: checks.some((check) => check.outcome === 'denied') ? 'denied'
  : checks.some((check) => check.outcome === 'not-assessed') ? 'not-assessed' : 'allowed' })
type Point = { owner: InventoryOwner; subnetId: string; endpoint?: WorkloadEndpoint; appliance?: { id: string; privateIp: string } }
type Connection = NonNullable<ApplicationResult['connections']>[number]

function connection(topology: InventoryTopology, simulation: AzSimulationResult, id: Connection['id'], tuple: FiveTuple,
  from: Point, to: Point, firewallId: string, uncertainty?: TupleUncertainty, applicationProxyId?: string): Connection {
  const forward = traceInventoryPacketLeg(topology, simulation, from.owner, from.subnetId, tuple, 'forward', to,
    from.appliance?.id, from.appliance?.privateIp, false, applicationProxyId)
  const reply = traceInventoryPacketLeg(topology, simulation, to.owner, to.subnetId, reverse(tuple), 'reply', from, to.appliance?.id, to.appliance?.privateIp)
  if (otherRouter(forward, firewallId)) forward.routing = 'not-assessed'
  if (otherRouter(reply, firewallId)) reply.routing = 'not-assessed'
  const returnVariants: PacketLeg[] = []
  for (const prefix of uncertainty?.sourceAddressPrefixes ?? []) {
    const range = cidr(prefix)!
    for (let ip = range.network + 4; ip < range.network + 2 ** (32 - range.length) - 1; ip++) {
      const variant = traceInventoryPacketLeg(topology, simulation, to.owner, to.subnetId,
        { ...reverse(tuple), destinationAddress: formatIpv4(ip) }, 'reply', from)
      if (otherRouter(variant, firewallId)) variant.routing = 'not-assessed'
      returnVariants.push(variant)
    }
  }
  if (returnVariants.length) {
    reply.routing = returnVariants.every((leg) => leg.routing === 'reachable') ? 'reachable'
      : returnVariants.every((leg) => leg.routing === 'unreachable') ? 'unreachable' : 'not-assessed'
    reply.reasons.push('Return routes are checked for every usable address in the declared Firewall subnet; the private VIP is not asserted to be the serving-instance SNAT address.')
  }
  const checks = from.endpoint ? endpointNsg(topology, from.endpoint, 'outbound', tuple, simulation).checks
    : [assessNsgPoint(topology, from.owner, { kind: 'subnet', id: from.subnetId }, 'outbound', tuple,
      { ...nsgScope(topology, from.owner, from.subnetId, simulation), uncertainty })]
  if (forward.routing === 'reachable' && !checks.some((check) => check.outcome === 'denied')) checks.push(...(to.endpoint
    ? assessEndpointNsg(topology, to.owner, to.endpoint.nicId, to.subnetId, 'inbound', tuple,
      { ...nsgScope(topology, to.owner, to.subnetId, simulation), uncertainty }).checks
    : [assessNsgPoint(topology, to.owner, { kind: 'subnet', id: to.subnetId }, 'inbound', tuple, nsgScope(topology, to.owner, to.subnetId, simulation))]))
  const permission = filtering(checks)
  const established = forward.routing === 'reachable' && reply.routing === 'reachable' && permission.outcome === 'allowed'
  const response: NsgAssessment = established ? { outcome: 'allowed', conditionalResponse: true, checks: checks.toReversed().map((check) => ({
    ...check, tuple: reverse(check.tuple), direction: check.direction === 'outbound' ? 'inbound' : 'outbound', ruleId: undefined, priority: undefined,
    uncertainty: check.uncertainty && reverseUncertainty(check.uncertainty),
    reason: 'Conditional response to this connection only; the two proxy legs do not create a new reverse initiation or live session.',
  })) } : { outcome: 'not-assessed', checks: [] }
  if (established) reply.session = 'conditional-response'
  if (uncertainty) {
    forward.steps = forward.steps.map((step) => ({ ...step, uncertainty }))
    reply.steps = reply.steps.map((step) => ({ ...step, uncertainty: reverseUncertainty(uncertainty) }))
  }
  if (permission.outcome === 'denied') {
    const denied = checks.find((check) => check.outcome === 'denied')!
    forward.steps = [{ entity: { kind: denied.target.kind, id: denied.target.id }, before: tuple, after: null,
      evidence: 'The new TCP connection is denied by its visible subnet/NIC filtering; no response connection is established.' }]
    reply.steps = []
  }
  return { id, forward, reply, nsg: { forward: permission, reply: response }, ...(returnVariants.length ? { returnVariants } : {}) }
}

export function evaluateFirewallProxy(topology: InventoryTopology, request: Extract<ApplicationRequest, { kind: 'firewall-proxy' }>, service: ApplicationService): ApplicationResult {
  const config = service.firewallProxy, selected: ApplicationReference = { kind: 'service', id: service.id }
  const references = [selected, ...service.references, ...(request.client.kind === 'workload' ? [request.client] : [])]
  const policy: Extract<ApplicationDecision, { kind: 'firewall-policy' }> = { id: 'firewall-policy', kind: 'firewall-policy', outcome: 'not-assessed',
    reasons: [], references, provenance: 'declared-configuration', evidence: { applianceId: config?.applianceId ?? null, policyId: config?.policyId ?? null,
      groupId: null, collectionId: null, ruleId: null, ruleType: null, action: null, mode: request.mode, host: request.host, port: request.port, dnsBindingId: null, backend: null } }
  const decisions: ApplicationDecision[] = [policy, ...(['client-to-proxy', 'proxy-to-backend'] as const).map((leg): ApplicationDecision => ({
    id: leg, kind: 'network-leg', outcome: 'not-assessed', reasons: [], references, provenance: 'declared-configuration',
    evidence: { leg, source: leg === 'client-to-proxy' ? request.client : selected, target: leg === 'client-to-proxy' ? selected : null,
      before: null, after: null, packetEvidence: null },
  })), { id: 'response-assumption', kind: 'response-assumption', outcome: 'not-assessed', reasons: [], references,
    provenance: 'declared-configuration', evidence: { conditional: true, owner: selected, httpAvailability: 'not-assessed', tlsAvailability: 'not-assessed' } }]
  const result: ApplicationResult = { version: 1, kind: 'firewall-proxy', configuration: 'not-assessed', availability: 'not-assessed',
    decisions, connections: [], uncertainties: [], limitations: [
      'Original native-v2 Standard/Premium Firewall policy and one declared DNS-bound private workload. Explicit HTTP/HTTPS CONNECT or natively intercepted HTTP/non-inspected HTTPS only; no live DNS, TLS, authentication, health or application availability is verified.',
      'Inheritance, DNAT composition, threat intelligence, IDPS, TLS inspection, public upstreams, extra routers and Private Link composition are not qualified. Transparent requests require native interception by the original Firewall.',
      'Firewall upstream source addresses are uncertain within AzureFirewallSubnet; the VIP and ephemeral port are representative, not a serving-instance allocation. Every usable return address is checked within the bounded /24-/26 subnet slice.',
    ] }
  const finish = (reason: string) => {
    for (const decision of decisions) if (!decision.reasons.length) decision.reasons = [reason]
    result.uncertainties = decisions.filter((decision) => decision.outcome === 'not-assessed').map(({ id, reasons, references }) => ({ decisionId: id, reasons, references }))
    return result
  }
  if (topology.version !== 2 || service.kind !== 'azure-firewall' || !config || service.owner?.kind !== 'vnet'
    || request.client.kind !== 'workload' || service.unsupportedFeatures.length
    || config.configuration !== 'complete' || config.parentPolicy !== 'none' || config.dnat !== 'none'
    || config.threatIntelligence !== 'off' || config.idps !== 'off' || config.tlsInspection !== 'off'
    || config.provisioningState !== 'succeeded' || topology.inventory?.capture?.configurationComplete === false
    || topology.inventory?.routerDnatPolicies?.some((entry) => entry.owner.kind === 'appliance' && entry.owner.id === config.applianceId)) {
    return finish('Complete original supported Firewall proxy configuration and policy evidence are required; unknown or unsupported controls cannot pass.')
  }
  const owner = service.owner, vnet = topology.vnets.find((entry) => entry.id === owner.id)!
  const firewall = vnet.appliances.find((entry) => entry.id === config.applianceId)!
  const subnet = vnet.subnets.find((entry) => entry.id === firewall.subnetId)!, range = cidr(subnet.prefix)!
  if (range.length < 24 || range.length > 26) return finish('Firewall instance-address return coverage is bounded to AzureFirewallSubnet /24 through /26; other sizes remain not assessed.')
  if (request.mode === 'explicit' && (!config.explicitProxy.enabled || config.explicitProxy.httpPort !== request.proxyPort)) {
    policy.outcome = 'violated'
    return finish('The original Firewall policy must enable explicit proxy and its single HTTP port must match the client proxy setting for both HTTP and HTTPS CONNECT.')
  }
  const binding = config.dnsBindings.find((entry) => entry.host === request.host)
  const endpoints = namedEndpoints(topology)
  const source = request.client
  const client = endpoints.find(({ workload, nic, config: ip }) => workload.id === source.workloadId && nic.id === source.nicId && ip.id === source.ipConfigurationId)
  const backend = binding && endpoints.find(({ workload, nic, config: ip }) => workload.id === binding.backend.workloadId && nic.id === binding.backend.nicId && ip.id === binding.backend.ipConfigurationId)
  if (!binding || !client || !backend
    || !ownsInventoryAddress(topology, client.nic.owner, client.config.subnetId, client.config.privateIp)
    || !ownsInventoryAddress(topology, backend.nic.owner, backend.config.subnetId, backend.config.privateIp)) {
    return finish('An explicit canonical Firewall DNS binding and original client/backend workload allocations are required; no DNS answer or address owner is inferred.')
  }
  const appliance: ApplicationReference = { kind: 'appliance', owner, id: firewall.id }
  const target: ApplicationReference = { kind: 'workload', ...binding.backend }
  references.push(appliance, { kind: 'subnet', owner, id: subnet.id }, target)
  policy.evidence.dnsBindingId = binding.id; policy.evidence.backend = target
  const clientIp = client.config.privateIp!, backendIp = backend.config.privateIp!
  const ordered = [...config.collections].sort((a, b) => Number(a.type === 'application') - Number(b.type === 'application')
    || a.groupPriority - b.groupPriority || a.priority - b.priority)
  for (const collection of ordered) {
    const rule = collection.type === 'network' ? collection.rules.find((rule) => rule.protocol !== 'udp'
      && rule.sourcePrefixes.some((prefix) => contains(prefix, ipv4(clientIp)!))
      && rule.destinationPrefixes.some((prefix) => contains(prefix, ipv4(request.mode === 'transparent' ? request.destinationAddress : backendIp)!))
      && rule.destinationPorts.some((port) => port === '*' || port === request.port))
      : collection.rules.find((rule) => rule.protocol === request.scheme && rule.port === request.port
        && rule.sourcePrefixes.some((prefix) => contains(prefix, ipv4(clientIp)!))
        && rule.targetFqdns.some((host) => host === '*' || host === request.host))
    if (!rule) continue
    Object.assign(policy.evidence, { groupId: collection.groupId, collectionId: collection.id, ruleId: rule.id, ruleType: collection.type, action: collection.action })
    if (collection.type === 'network') {
      if (request.mode === 'transparent' && collection.action === 'deny') policy.outcome = 'violated'
      return finish('A network rule takes precedence. It cannot be relabeled as an application-rule proxy or granted application-rule SNAT by this provider.')
    }
    policy.outcome = collection.action === 'allow' ? 'satisfied' : 'violated'
    break
  }
  if (policy.outcome !== 'satisfied') return finish(policy.outcome === 'violated' ? 'The first matching original application collection denies this request.'
    : 'No declared application rule selected this request. Built-in infrastructure rules are not inventoried, so unmatched requests remain not assessed.')
  if (request.mode === 'transparent' && request.scheme === 'https' && backendIp !== request.destinationAddress) {
    policy.outcome = 'not-assessed'
    return finish('Non-inspected HTTPS matches declared SNI but retains the original destination. A different Firewall DNS answer cannot substitute a new upstream address.')
  }
  policy.reasons = ['Declared original policy selection only: network rules precede application rules, then group priority, collection priority and original rule order. DNS is declared, not queried.']
  const simulation = simulateAzNet(topology)
  const gateway: Point = { owner, subnetId: subnet.id, appliance: firewall }
  const clientPoint: Point = { owner: client.nic.owner, subnetId: client.config.subnetId, endpoint: source }
  const backendPoint: Point = { owner: backend.nic.owner, subnetId: backend.config.subnetId, endpoint: { kind: 'workload', ...binding.backend } }
  for (const id of ['client-to-proxy', 'proxy-to-backend'] as const) {
    const first = id === 'client-to-proxy'
    const tuple: FiveTuple & { protocol: 'tcp' } = { protocol: 'tcp', sourceAddress: first ? clientIp : firewall.privateIp,
      destinationAddress: first ? request.mode === 'transparent' ? request.destinationAddress : firewall.privateIp : backendIp,
      sourcePort: first ? request.sourcePort : 49152,
      destinationPort: first && request.mode === 'explicit' ? request.proxyPort : request.port }
    const value = connection(topology, simulation, id, tuple, first ? clientPoint : gateway, first ? gateway : backendPoint,
      firewall.id, first ? undefined : { sourceAddressPrefixes: [subnet.prefix], sourcePorts: [1024, 65535] },
      first && request.mode === 'transparent' ? firewall.id : undefined)
    result.connections!.push(value)
    const decision = decisions.find((entry) => entry.kind === 'network-leg' && entry.evidence.leg === id)!
    decision.outcome = value.nsg.forward.outcome === 'denied' || value.forward.routing === 'unreachable' || value.reply.routing === 'unreachable' ? 'violated'
      : value.nsg.forward.outcome === 'allowed' && value.forward.routing === 'reachable' && value.reply.routing === 'reachable' ? 'satisfied' : 'not-assessed'
    decision.provenance = 'native-packet-evidence'
    if (decision.kind === 'network-leg') decision.evidence = { ...decision.evidence, source: first ? source : appliance, target: first ? appliance : target,
      before: tuple, after: tuple, packetEvidence: { section: 'application-connections', connectionId: id } }
    decision.reasons = ['Original workload and Firewall appliance contexts independently trace this connection and its conditional response. Network-rule private SNAT exclusions do not suppress application-proxy source translation.']
    if (decision.outcome !== 'satisfied') return finish('Independent native routes, all possible instance return addresses and visible filtering must permit each proxy connection.')
  }
  decisions.at(-1)!.outcome = 'satisfied'
  return finish('Two independently routed conditional TCP responses are associated by the declared Firewall proxy, not by an end-to-end NAT inverse or a live TLS/application session.')
}
