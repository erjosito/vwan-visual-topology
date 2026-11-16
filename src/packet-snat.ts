import { namedEndpoints, natGatewayForSubnet, type InventoryTopology, type RouterSnatOwner } from './inventory'
import { cidr, contains, formatIpv4, ipv4 } from './validation'
import { simulate, type Simulation } from './routing'
import { traceNodePath } from './paths'
import { simulateAzNet, traceAzNetFlow, type AzFlowTrace, type AzSimulationResult } from './azure-net/engine'
import type { FiveTuple, PacketLeg, PacketRequest, PacketResult, PacketStep } from './packet-flow'

const privateRanges = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10']
const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple, sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
  sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
const port = (tuple: FiveTuple) => 1024 + (tuple.sourcePort * 31 + tuple.destinationPort) % 64512
const matches = (prefixes: string[], address: string) => prefixes.some((prefix) => contains(prefix.includes('/') ? prefix : `${prefix}/32`, ipv4(address)!))
function responseSteps(topology: InventoryTopology, trace: AzFlowTrace, tuple: FiveTuple, owner: RouterSnatOwner) {
  const unknown = trace.hops.findIndex((hop) => hop.nodeKind === 'appliance' && (owner.kind !== 'appliance' || hop.nodeId !== owner.id)
    || hop.nodeKind === 'vwan-hub' && (owner.kind !== 'hub' || hop.nodeId !== owner.id) && topology.version === 2
      && topology.vwanHubs.find((hub) => hub.id === hop.nodeId)?.routingIntent.private)
  return { unknown: unknown >= 0, steps: (unknown >= 0 ? trace.hops.slice(0, unknown + 1) : trace.hops).map((hop, index): PacketStep => ({
    entity: { kind: hop.nodeKind, id: hop.nodeId }, before: tuple, after: index === unknown ? null : tuple, evidence: hop.detail,
    ...(hop.matchedRoute ? { routeId: hop.matchedRoute.id } : {}), ...(hop.edgeId ? { edgeId: hop.edgeId } : {}),
  })) }
}

export function applyRouterSnat(topology: InventoryTopology, request: PacketRequest, forward: PacketLeg, reply: PacketLeg,
  simulation?: Simulation | AzSimulationResult): Pick<PacketResult, 'translation' | 'egress'> | undefined {
  if (request.source.kind !== 'workload' || !forward.native || !forward.tuple) return
  const owners: RouterSnatOwner[] = Array.isArray(forward.native)
    ? [...new Set(forward.native.flatMap((path) => path.firewalls ?? []))].map((id) => ({ kind: 'hub', id }))
    : [
      ...forward.native.traversedApplianceIds.map((id): RouterSnatOwner => ({ kind: 'appliance', id })),
      ...[...new Set(forward.native.hops.filter((hop) => hop.nodeKind === 'vwan-hub'
        && (hop.action === 'inspect-firewall' || request.target.kind === 'external'
          && topology.version === 2 && topology.vwanHubs.find((hub) => hub.id === hop.nodeId)?.routingIntent.internet)).map((hop) => hop.nodeId))]
        .map((id): RouterSnatOwner => ({ kind: 'hub', id })),
    ]
  if (!owners.length) return
  const unknown = (reason: string): Pick<PacketResult, 'translation' | 'egress'> => {
    forward.reasons.push(reason)
    return { translation: 'not-assessed', ...(request.target.kind === 'external' ? { egress: 'not-assessed' as const } : {}) }
  }
  if (forward.routing !== 'reachable') return unknown('Translation cannot bypass a missing route, forced-tunnel limitation or forwarding loop.')
  if (owners.length !== 1) return unknown('Multiple router translation stages are not modeled. Original routing evidence is preserved.')
  if (!Array.isArray(forward.native) && forward.native.hops.some((hop) => hop.nodeKind === 'vnet-gateway')) {
    return unknown('Gateway/forced-tunnel translation is not assessed; subnet NAT Gateway does not override the selected route.')
  }
  const owner = owners[0], policy = topology.inventory?.routerSnatPolicies?.find((policy) => policy.owner.kind === owner.kind && policy.owner.id === owner.id)
  if (!policy) return unknown('The selected router has no explicit SNAT declaration. Forwarding or IP forwarding alone does not establish NAT behavior.')
  const vnet = topology.version === 2 && owner.kind === 'appliance' ? topology.vnets.find((vnet) => vnet.appliances.some((device) => device.id === owner.id)) : undefined
  const appliance = vnet?.appliances.find((device) => device.id === owner.id)
  const gateway = request.target.kind === 'external' && vnet && appliance
    ? natGatewayForSubnet(topology, { kind: 'vnet', id: vnet.id }, appliance.subnetId) : undefined
  const original = forward.tuple
  if (request.target.kind === 'external' && appliance && vnet
    && vnet.subnets.find((subnet) => subnet.id === appliance.subnetId)?.internetEgressStatus === 'unknown' && !gateway) {
    return unknown('Captured router-subnet NAT association is unknown; a declared router public pool does not resolve its outbound precedence.')
  }
  if (gateway && policy.kind === 'firewall-network-rules' && policy.zoneRedundant !== false) {
    return unknown('Standard NAT Gateway integration requires an explicitly declared non-zone-redundant Firewall. Unknown or StandardV2/zone-redundant configurations are not assessed.')
  }
  const excluded = policy.kind === 'firewall-network-rules'
    ? matches((policy.privateRanges ?? ['IANAPrivateRanges']).flatMap((range) => range === 'IANAPrivateRanges' ? privateRanges : [range]), original.destinationAddress)
    : !matches(policy.sourcePrefixes, original.sourceAddress) || !matches(policy.destinationPrefixes, original.destinationAddress)
      || policy.protocol !== 'any' && policy.protocol !== original.protocol
  if (excluded) {
    if (gateway && policy.kind === 'firewall-network-rules') return unknown('Custom Firewall no-SNAT exclusions combined with NAT Gateway are not assessed.')
    forward.reasons.push(policy.kind === 'firewall-network-rules'
      ? 'The configured Firewall network-rule private/shared range excludes this destination from SNAT; custom ranges replace the defaults.'
      : 'The explicitly declared NVA SNAT rule does not match this tuple. No guest translation was assumed.')
    if (request.target.kind !== 'external') return { translation: 'none' }
    forward.routing = 'unreachable'
    forward.steps.push({ entity: { kind: owner.kind, id: owner.id }, before: original, after: null,
      evidence: 'No modeled public outbound mapping for the preserved forwarded source.' })
    reply.routing = 'not-assessed'
    return { translation: 'none', egress: 'blocked' }
  }
  const source = request.source
  const endpoint = namedEndpoints(topology).find(({ workload, nic, config }) => workload.id === source.workloadId
    && nic.id === source.nicId && config.id === source.ipConfigurationId)
  if (!endpoint) return unknown('Original source NIC ownership is unavailable.')
  const translations: PacketStep[] = []
  let translated = original
  const translate = (address: string, entity: PacketStep['entity'], evidence: string, preservePort = false) => {
    const next = { ...translated, sourceAddress: address, sourcePort: preservePort ? translated.sourcePort : port(translated) }
    translations.push({ entity, before: translated, after: next, evidence,
      uncertainty: { ...(policy.kind === 'firewall-network-rules' && address === appliance?.privateIp
        ? { sourceAddressPrefixes: vnet!.subnets.filter((subnet) => subnet.id === appliance.subnetId).map((subnet) => subnet.prefix) } : {}),
      sourcePorts: [0, 65535] } }); translated = next
  }
  if (request.target.kind !== 'external' || gateway || policy.kind === 'nva-snat') {
    if (!appliance?.privateIp) return unknown('The original router private interface is unknown; a private translated tuple was not invented.')
    translate(appliance.privateIp, { kind: 'appliance', id: owner.id }, policy.kind === 'firewall-network-rules'
      ? 'Firewall private SNAT/handoff uses the configured private interface as an illustrative representative, not a prediction of backend-instance allocation. No intermediate Firewall public NAT is applied.'
      : 'Explicit NVA guest SNAT to its original private interface; IP forwarding alone never supplies this rule. Ports are illustrative.')
  }
  if (request.target.kind === 'external') {
    let address: string | undefined
    let entity: PacketStep['entity']
    if (gateway) {
      address = topology.inventory?.publicIps.find((ip) => ip.id === gateway.publicIpIds[0])?.address
      if (!gateway.publicIpIds.length) {
        const prefix = topology.inventory?.publicIpPrefixes?.find((prefix) => prefix.id === gateway.publicIpPrefixIds?.[0])?.prefix
        if (prefix) address = formatIpv4(cidr(prefix)!.network)
      }
      entity = { kind: 'nat-gateway', id: gateway.id }
    } else {
      const ip = topology.inventory?.publicIps.find((ip) => ip.id === policy.publicIpIds[0])
      address = ip?.address
      entity = policy.kind === 'firewall-network-rules' ? { kind: owner.kind, id: owner.id } : { kind: 'public-ip', id: ip?.id ?? owner.id }
    }
    if (!address) return unknown('The selected router outbound public allocation is unknown. No public tuple or inverse response mapping was invented.')
    if (gateway && appliance?.kind === 'azure-firewall'
      && vnet!.subnets.find((subnet) => subnet.id === appliance.subnetId)?.name !== 'AzureFirewallSubnet') {
      return unknown('Classic Firewall + NAT Gateway requires the original AzureFirewallSubnet association.')
    }
    translate(address, entity, gateway
      ? 'NAT Gateway maps the router private handoff to its ultimate public egress IP. Pool address and port selection are illustrative, not Azure allocation/capacity predictions.'
      : 'Configured router public egress mapping. Pool address and port selection are illustrative; application-rule proxy behavior is not modeled.',
    policy.kind === 'nva-snat' && !gateway)
  }
  const routerIndex = forward.steps.findLastIndex((step) => step.entity.kind === owner.kind && step.entity.id === owner.id
    || owner.kind === 'hub' && step.entity.kind === 'vwan-hub' && step.entity.id === owner.id)
  if (routerIndex < 0) return unknown('The original translation waypoint is absent from the selected route.')
  forward.steps = forward.steps.map((step, index) => index > routerIndex ? { ...step, before: translated, after: translated,
    uncertainty: translations.at(-1)?.uncertainty }
    : step.after === null ? { ...step, after: step.before } : step)
  forward.steps.splice(routerIndex + 1, 0, ...translations)
  const back = topology.version === 1
    ? traceNodePath(topology, simulation as Simulation ?? simulate(topology), { kind: 'hub', id: owner.id }, original.sourceAddress)
    : traceAzNetFlow(topology, simulation as AzSimulationResult ?? simulateAzNet(topology),
      vnet && appliance ? { kind: 'subnet', vnetId: vnet.id, subnetId: appliance.subnetId } : { kind: 'vwanHub', hubId: owner.id },
      original.sourceAddress, appliance ? { sourceAddress: appliance.privateIp, sourceApplianceId: appliance.id } : undefined)
  let returnStatus: PacketLeg['routing'] = Array.isArray(back)
    ? !back.length || back.some((path) => path.status === 'unknown' || path.traceComplete === false) ? 'not-assessed'
      : back.every((path) => path.status === 'delivered' && path.termination === 'owner' && path.terminalKind === 'spoke'
        && path.siteId === endpoint.nic.owner.id) ? 'reachable' : 'unreachable'
    : back.status === 'not-assessed' ? 'not-assessed' : back.status === 'delivered'
      && back.hops.some((hop) => hop.action === 'delivered' && hop.vnetId === endpoint.nic.owner.id && hop.subnetId === endpoint.config.subnetId) ? 'reachable' : 'unreachable'
  const backSteps = Array.isArray(back) ? back.flatMap((path) => {
    const unknown = path.hubs.findIndex((id) => id !== owner.id && path.firewalls?.includes(id))
    return (unknown >= 0 ? path.hubs.slice(0, unknown + 1) : path.hubs).map((id, index): PacketStep => ({ entity: { kind: 'hub', id },
      before: reverse(original), after: index === unknown ? null : reverse(original), evidence: index === unknown
        ? 'Multiple router translation stages are not modeled. Original routing evidence is preserved.' : path.steps.join(' ') }))
  }) : responseSteps(topology, back, reverse(original), owner).steps
  if (!Array.isArray(back) && responseSteps(topology, back, reverse(original), owner).unknown) returnStatus = 'not-assessed'
  if (Array.isArray(back) && back.some((path) => path.firewalls?.some((id) => id !== owner.id))) returnStatus = 'not-assessed'
  let reachesTranslator: PacketLeg['routing'] = 'reachable'
  const responseRouting: PacketStep[] = []
  let responseNative: PacketLeg['native']
  if (request.target.kind === 'workload') {
    const target = request.target
    const peer = namedEndpoints(topology).find(({ workload, nic, config }) => workload.id === target.workloadId
      && nic.id === target.nicId && config.id === target.ipConfigurationId)
    if (topology.version !== 2 || !peer || !vnet || !appliance) reachesTranslator = 'not-assessed'
    else {
      const inbound = traceAzNetFlow(topology, simulation as AzSimulationResult ?? simulateAzNet(topology),
        { kind: 'subnet', vnetId: peer.nic.owner.id, subnetId: peer.config.subnetId }, translated.sourceAddress,
        { sourceAddress: original.destinationAddress })
      responseNative = inbound
      reachesTranslator = inbound.status === 'not-assessed' ? 'not-assessed' : inbound.status === 'delivered'
        && inbound.hops.some((hop) => hop.action === 'delivered' && hop.vnetId === vnet.id && hop.subnetId === appliance.subnetId) ? 'reachable' : 'unreachable'
      const evidence = responseSteps(topology, inbound, reverse(translated), owner)
      if (evidence.unknown) reachesTranslator = 'not-assessed'
      responseRouting.push(...evidence.steps)
    }
  }
  reply.tuple = reverse(translated)
  reply.native = reachesTranslator === 'reachable' ? back : responseNative
  reply.session = 'conditional-response'
  reply.routing = reachesTranslator === 'unreachable' || returnStatus === 'unreachable' ? 'unreachable'
    : reachesTranslator === 'not-assessed' || returnStatus === 'not-assessed' ? 'not-assessed' : 'reachable'
  reply.reasons = ['Conditional response only: reverse the modeled mappings at their original owner, then independently evaluate the router return route. Live session state, security and application delivery remain unassessed.']
  reply.steps = reachesTranslator !== 'reachable' ? responseRouting : [...responseRouting, ...translations.toReversed().map((step) => ({
    entity: step.entity, before: reverse(step.after!), after: reverse(step.before), evidence: 'Inverse translation for this exact conditional response, not an unsolicited reverse initiation.',
  })), ...backSteps]
  return { translation: 'snat', ...(request.target.kind === 'external' ? { egress: 'configured' as const } : {}) }
}
