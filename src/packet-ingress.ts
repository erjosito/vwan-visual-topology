import { inventoryOwners, namedEndpoints, type InventoryOwner, type InventoryTopology, type NamedEndpoint } from './inventory'
import { cidr, contains, ipv4 } from './validation'
import { simulate, type Simulation } from './routing'
import { traceNodePath } from './paths'
import { simulateAzNet, traceAzNetFlow, type AzSimulationResult } from './azure-net/engine'
import { completePacketNsg, type TupleUncertainty } from './packet-security'
import type { FiveTuple, PacketLeg, PacketRequest, PacketResult, WorkloadEndpoint } from './packet-flow'

const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple, sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
  sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
const ref = (entry: NamedEndpoint): WorkloadEndpoint => ({ kind: 'workload', workloadId: entry.workload.id,
  nicId: entry.nic.id, ipConfigurationId: entry.config.id })
const endpointValid = (topology: InventoryTopology, entry: NamedEndpoint) => !!entry.config.privateIp
  && inventoryOwners(topology).filter((owner) => owner.prefixes.some((prefix) => contains(prefix, ipv4(entry.config.privateIp!)!))).length === 1
const hasOtherRouter = (leg: PacketLeg, ownerId?: string) => Array.isArray(leg.native)
  ? leg.native.some((path) => path.firewalls?.some((id) => id !== ownerId) || path.sourceNvaSpokeId || path.nvaSpokeId)
  : leg.native?.hops.some((hop) => hop.nodeKind === 'appliance' && hop.nodeId !== ownerId
    || hop.nodeKind === 'vnet-gateway' || hop.nodeKind === 'vwan-hub')

function route(topology: InventoryTopology, simulation: Simulation | AzSimulationResult, owner: InventoryOwner,
  subnetId: string, tuple: FiveTuple, direction: PacketLeg['direction'], target?: { owner: InventoryOwner; subnetId: string },
  deviceId?: string, deviceAddress?: string, conditionalMapping = false): PacketLeg {
  if (topology.version === 1) {
    const native = traceNodePath(topology, simulation as Simulation, { kind: 'spoke', id: owner.id }, tuple.destinationAddress)
    const complete = native.length && native.every((path) => path.traceComplete !== false && path.status !== 'unknown')
    const reachable = complete && native.every((path) => path.status === 'delivered' && (target
      ? path.termination === 'owner' && path.terminalKind === 'spoke' && path.siteId === target.owner.id : path.termination === 'internet'))
    return { direction, tuple, native, routing: !complete ? 'not-assessed' : reachable ? 'reachable' : 'unreachable',
      reasons: ['Native VWAN return routing does not infer an unmodeled direct NIC Internet route.'],
      steps: native.flatMap((path) => path.hubs.map((id) => ({ entity: { kind: 'hub', id }, before: tuple, after: tuple, evidence: path.steps.join(' ') }))) }
  }
  const native = traceAzNetFlow(topology, simulation as AzSimulationResult, { kind: 'subnet', vnetId: owner.id, subnetId },
    tuple.destinationAddress, { sourceAddress: deviceAddress ?? tuple.sourceAddress, ...(deviceId ? { sourceApplianceId: deviceId } : {}) })
  const terminal = native.hops.at(-1)
  const owned = native.hops.some((hop) => hop.action === 'delivered' && (target
    ? hop.vnetId === target.owner.id && hop.subnetId === target.subnetId
    : hop.matchedRoute?.nextHopType === 'Internet' || hop.nodeKind === 'internet'))
  // Existing-flow inverse NAT supplies a mapping, not an independent outbound rule.
  const mappedResponse = conditionalMapping && native.status === 'dropped-no-outbound-access'
    && terminal?.vnetId === owner.id && terminal.subnetId === subnetId && terminal.matchedRoute?.nextHopType === 'Internet'
  return { direction, tuple, native, routing: native.status === 'not-assessed' ? 'not-assessed'
    : native.status === 'delivered' && owned || mappedResponse ? 'reachable' : 'unreachable',
  reasons: [mappedResponse ? 'The selected Internet route uses only this established response mapping; unsolicited outbound permission is not inferred.' : native.summaryReason],
  steps: native.hops.map((hop) => ({ entity: { kind: hop.nodeKind, id: hop.nodeId }, before: tuple, after: tuple, evidence: hop.detail,
    ...(hop.edgeId ? { edgeId: hop.edgeId } : {}), ...(hop.matchedRoute ? { routeId: hop.matchedRoute.id } : {}),
    ...(hop.hubTableId ? { tableId: hop.hubTableId } : {}) })) }
}

export { route as traceInventoryPacketLeg }

export function tracePublicIngress(topology: InventoryTopology, request: PacketRequest, simulation?: Simulation | AzSimulationResult): PacketResult {
  const result: PacketResult = { source: request.source, target: request.target,
    forward: { direction: 'forward', routing: 'not-assessed', steps: [], reasons: [] },
    reply: { direction: 'reply', routing: 'not-assessed', steps: [], reasons: [] },
    ingress: 'not-assessed', translation: 'not-assessed', security: 'not-assessed', delivery: 'not-assessed',
    limitations: ['IPv4 TCP/UDP public ingress and one explicitly declared translation owner only. No listener, guest policy or application delivery is inferred.',
      'Firewall private DNAT, forced tunneling, multiple translating services, secured-hub private interfaces and live session state are not assessed.'] }
  const stop = (reason: string, blocked = false) => {
    result.ingress = blocked ? 'blocked' : 'not-assessed'
    result.forward.routing = blocked ? 'unreachable' : 'not-assessed'
    result.forward.reasons.push(reason)
    result.forward.steps = []
    if (result.forward.tuple) result.forward.steps.push({ entity: { kind: 'public-ip', id: request.target.kind === 'public-ip' ? request.target.publicIpId : '' },
      before: result.forward.tuple, after: null, evidence: reason })
    return result
  }
  if (request.source.kind !== 'external' || request.target.kind !== 'public-ip') return stop('Public ingress requires an explicit Internet source and original public-IP destination.')
  const source = request.source, frontendId = request.target.publicIpId
  const frontend = topology.inventory?.publicIps.find((ip) => ip.id === frontendId)
  if (!frontend) return stop('The selected public-IP identity has no original owner or allocation.', true)
  if (frontend.sku !== 'Standard' || frontend.allocation !== 'Static') return stop('Only explicitly declared Standard static IPv4 public frontends are assessed.')
  if (!frontend.address) return stop('The frontend public allocation is unknown; no mapping is invented.')
  const connected = [...inventoryOwners(topology).flatMap((owner) => owner.prefixes), ...topology.sites.flatMap((site) => site.prefixes),
    ...(topology.inventory?.publicIps.flatMap((ip) => ip.address ? [`${ip.address}/32`] : []) ?? []),
    ...(topology.inventory?.publicIpPrefixes?.flatMap((prefix) => prefix.prefix ? [prefix.prefix] : []) ?? []),
    ...(topology.version === 2 ? topology.vnets.flatMap((vnet) => vnet.appliances.flatMap((device) => device.advertisedPrefixes ?? [])) : [])]
  if (connected.some((prefix) => contains(prefix, ipv4(source.address)!))) return stop('A connected source cannot be classified as Internet.')
  const original: FiveTuple = { sourceAddress: source.address, destinationAddress: frontend.address,
    protocol: request.protocol, sourcePort: request.sourcePort, destinationPort: request.destinationPort }
  result.forward.tuple = original
  const policies = topology.inventory?.routerDnatPolicies?.filter((policy) => policy.publicIpIds.includes(frontendId)) ?? []
  const direct = namedEndpoints(topology).filter((entry) => entry.config.publicIpId === frontendId && !entry.workload.backingDeviceId)
  if (policies.length + direct.length > 1) return stop('The frontend has ambiguous service or NIC ownership; no backend is selected.')
  let endpoint: NamedEndpoint | undefined = direct[0]
  let mapped = original
  let uncertainty: TupleUncertainty | undefined
  let deviceId: string | undefined
  let deviceAddress: string | undefined
  let deviceOwner: InventoryOwner | undefined
  let deviceSubnetId: string | undefined
  let deviceSubnetPrefix: string | undefined
  const policy = policies[0]
  if (!policy && !endpoint) {
    const gateway = topology.inventory?.natGateways?.some((gateway) => gateway.publicIpIds.includes(frontendId))
    return stop(gateway ? 'NAT Gateway supports response traffic, not unsolicited public ingress.'
      : 'The frontend has no supported VM association or explicit DNAT service. A SNAT pool does not publish a listener.', true)
  }
  if (policy) {
    if (policy.rulesStatus === 'unknown') return stop('Captured DNAT rules are unknown; no matching permission or target is inferred.')
    const rule = [...policy.rules].sort((a, b) => a.priority - b.priority).find((rule) => rule.publicIpId === frontendId
      && rule.protocol === request.protocol && rule.frontendPort === request.destinationPort
      && rule.sourcePrefixes.some((prefix) => contains(prefix, ipv4(source.address)!)))
    if (!rule) return stop('No declared DNAT rule matches this frontend, source prefix, protocol and port.', true)
    endpoint = namedEndpoints(topology).find((entry) => entry.workload.id === rule.target.workloadId
      && entry.nic.id === rule.target.nicId && entry.config.id === rule.target.ipConfigurationId)
    if (policy.owner.kind !== 'appliance' || topology.version !== 2) return stop('The original secured-hub private translation interface is not modeled.')
    const vnet = topology.vnets.find((vnet) => vnet.appliances.some((device) => device.id === policy.owner.id))
    const device = vnet?.appliances.find((device) => device.id === policy.owner.id)
    const subnet = vnet?.subnets.find((subnet) => subnet.id === device?.subnetId)
    if (!device?.privateIp || !subnet) return stop('The original translation interface or subnet is unknown.')
    if (device.kind !== (policy.kind === 'firewall-dnat' ? 'azure-firewall' : 'nva-vm')) return stop('The declared DNAT service does not match its original device.')
    if (!device.enableIpForwarding) return stop('The original DNAT appliance has IP forwarding disabled.', true)
    if (policy.kind === 'firewall-dnat' && subnet.name !== 'AzureFirewallSubnet') return stop('Firewall public DNAT requires its original AzureFirewallSubnet.')
    if (!endpoint || !endpointValid(topology, endpoint)) return stop('The DNAT target has missing, unknown or ambiguous original NIC addressing.')
    deviceId = device.id; deviceAddress = device.privateIp; deviceSubnetId = subnet.id
    deviceOwner = { kind: 'vnet', id: vnet!.id }; deviceSubnetPrefix = subnet.prefix
    mapped = { ...original, destinationAddress: endpoint.config.privateIp!, destinationPort: rule.translatedPort,
      sourceAddress: policy.kind === 'firewall-dnat' || policy.sourceTranslation === 'interface' ? device.privateIp : original.sourceAddress }
    if (policy.kind === 'firewall-dnat') uncertainty = { sourceAddressPrefixes: [subnet.prefix] }
    const pre = policy.kind === 'nva-dnat' ? { ...original, destinationAddress: device.privateIp } : original
    const nativeSimulation = simulation ?? simulateAzNet(topology)
    result.forward = route(topology, nativeSimulation, deviceOwner, subnet.id, mapped, 'forward',
      { owner: endpoint.nic.owner, subnetId: endpoint.config.subnetId }, device.id, device.privateIp)
    result.forward.tuple = original
    if (hasOtherRouter(result.forward, device.id)) return stop('Downstream gateways or additional translation stages are unassessed; DNAT does not bypass them.')
    const index = result.forward.steps.findIndex((step) => step.entity.kind === 'appliance' && step.entity.id === device.id)
    if (index < 0) return stop('The original DNAT waypoint is absent from native forwarding evidence.')
    result.forward.steps = result.forward.steps.map((step, position) => position < index ? { ...step, before: pre, after: pre }
      : { ...step, ...(uncertainty ? { uncertainty } : {}) })
    result.forward.steps.splice(index, 0, { entity: { kind: 'appliance', id: device.id }, before: pre, after: pre,
      evidence: 'The original ingress interface is evaluated before guest translation; packet evidence stops here if its subnet/NIC NSG denies the new flow.' },
    { entity: { kind: 'appliance', id: device.id }, before: pre, after: mapped, routeId: rule.id,
      ...(uncertainty ? { uncertainty } : {}), evidence: policy.kind === 'firewall-dnat'
        ? 'The matching Firewall public DNAT rule translates the backend destination and source to an illustrative AzureFirewallSubnet address, preserving the client source port.'
        : 'The explicit NVA guest DNAT rule translates its original frontend interface to the selected backend; source translation follows only the declared guest behavior.' })
    result.forward.steps.unshift({ entity: { kind: 'public-ip', id: frontendId }, before: original, after: pre,
      evidence: policy.kind === 'nva-dnat' ? 'Public-IP platform mapping reaches the original NVA private interface before guest DNAT and NIC/subnet filtering.'
        : 'The selected public IP belongs to the explicitly configured Firewall frontend.' })
  } else {
    if (!endpoint || !endpointValid(topology, endpoint)) return stop('The public VM association has unknown or ambiguous original NIC addressing.')
    mapped = { ...original, destinationAddress: endpoint.config.privateIp! }
    result.forward = { direction: 'forward', tuple: original, routing: 'reachable', reasons: [],
      steps: [{ entity: { kind: 'public-ip', id: frontendId }, before: original, after: mapped,
        evidence: 'Standard public-IP platform destination mapping reaches the original VM private NIC address. NSGs see this private destination and the Internet client source.' }] }
  }
  const target = ref(endpoint!), nativeSimulation = simulation ?? (topology.version === 1 ? simulate(topology) : simulateAzNet(topology))
  if (result.forward.routing === 'reachable') result.forward.steps.push({ entity: { kind: 'workload', id: endpoint!.workload.id },
    before: mapped, after: mapped, ...(uncertainty ? { uncertainty } : {}),
    evidence: `Translated destination targets original NIC ${endpoint!.nic.id}, IP configuration ${endpoint!.config.id}; listener and workload delivery remain unassessed.` })
  const response = reverse(mapped)
  if (!policy) {
    result.reply = route(topology, nativeSimulation, endpoint!.nic.owner, endpoint!.config.subnetId, response, 'reply', undefined, undefined, undefined, true)
    if (hasOtherRouter(result.reply)) {
      result.reply.routing = 'unreachable'
      result.reply.reasons.push('The VM response bypasses its required instance public-IP mapping through another router; ingress/return symmetry is not established.')
    } else if (result.reply.routing === 'reachable') result.reply.steps.push({ entity: { kind: 'public-ip', id: frontendId },
      before: response, after: reverse(original), evidence: 'Conditional response reverses this VM ingress mapping. NAT Gateway precedence for new outbound flows does not replace the existing public-IP response owner.' })
  } else if (mapped.sourceAddress !== original.sourceAddress) {
    result.reply = route(topology, nativeSimulation, endpoint!.nic.owner, endpoint!.config.subnetId, response, 'reply',
      { owner: deviceOwner!, subnetId: deviceSubnetId! })
    if (uncertainty) result.reply.steps = result.reply.steps.map((step) => ({
      ...step, uncertainty: { destinationAddressPrefixes: uncertainty.sourceAddressPrefixes },
    }))
    if (hasOtherRouter(result.reply, deviceId)) {
      result.reply.routing = 'not-assessed'
      result.reply.reasons.push('The backend response crosses another router; exact inverse translation is not inferred.')
    }
    if (uncertainty && topology.version === 2) {
      const table = (nativeSimulation as AzSimulationResult).subnetTables[endpoint!.config.subnetId]
      const domain = cidr(deviceSubnetPrefix!)!
      if (!table || table.routes.some((route) => {
        const range = cidr(route.prefix)
        return range && range.length > domain.length && contains(deviceSubnetPrefix!, range.network)
      })) {
        result.reply.routing = 'not-assessed'
        result.reply.reasons.push('More-specific return routes can distinguish illustrative Firewall instance addresses; one exact allocation is not inferred.')
      }
    }
    if (result.reply.routing === 'reachable') {
      const outbound = route(topology, nativeSimulation, deviceOwner!, deviceSubnetId!, reverse(original), 'reply',
        undefined, deviceId, deviceAddress, true)
      if (hasOtherRouter(outbound, deviceId)) outbound.routing = 'not-assessed'
      result.reply.steps.push({ entity: { kind: 'appliance', id: deviceId! }, before: response, after: reverse(original),
        evidence: 'The backend response reaches the original translation owner and reverses the configured source/destination mapping for this flow only.' }, ...outbound.steps)
      result.reply.routing = outbound.routing
      result.reply.reasons.push(...outbound.reasons)
    }
  } else {
    result.reply = route(topology, nativeSimulation, endpoint!.nic.owner, endpoint!.config.subnetId, response, 'reply', undefined, undefined, undefined, true)
    const index = result.reply.steps.findIndex((step) => step.entity.kind === 'appliance' && step.entity.id === deviceId)
    if (index < 0) {
      result.reply.routing = result.reply.routing === 'not-assessed' ? 'not-assessed' : 'unreachable'
      result.reply.reasons.push('The preserved-client response does not route through its original DNAT owner; inverse translation cannot be applied.')
    } else if (hasOtherRouter(result.reply, deviceId)) result.reply.routing = 'not-assessed'
    else {
      result.reply.steps = result.reply.steps.map((step, position) => position > index ? { ...step, before: reverse(original), after: reverse(original) } : step)
      result.reply.steps.splice(index + 1, 0, { entity: { kind: 'appliance', id: deviceId! }, before: response, after: reverse(original),
        evidence: 'The preserved-client response follows the required original DNAT owner before reversing the backend mapping.' })
    }
  }
  if (result.reply.routing === 'reachable') result.reply.session = 'conditional-response'
  else result.reply.steps.push({ entity: { kind: policy ? 'appliance' : 'public-ip', id: deviceId ?? frontendId },
    before: response, after: null, evidence: 'A complete reachable response through the original translation owner is not established.' })
  result.nsg = completePacketNsg(topology, target, result.forward, result.reply, { outcome: 'allowed', checks: [] },
    nativeSimulation, mapped.sourceAddress !== original.sourceAddress ? 'snat' : 'none', !policy,
    policy?.kind === 'nva-dnat' ? deviceId : undefined)
  result.security = result.nsg.forward.outcome === 'denied' ? 'denied' : 'not-assessed'
  result.ingress = result.nsg.forward.outcome === 'denied' || result.forward.routing === 'unreachable' ? 'blocked'
    : result.forward.routing === 'reachable' && result.nsg.forward.outcome === 'allowed' ? 'configured' : 'not-assessed'
  const dnat = result.forward.steps.some((step) => step.after && (step.before.destinationAddress !== step.after.destinationAddress
    || step.before.destinationPort !== step.after.destinationPort))
  const snat = result.forward.steps.some((step) => step.after && (step.before.sourceAddress !== step.after.sourceAddress
    || step.before.sourcePort !== step.after.sourcePort))
  result.translation = dnat ? snat ? 'snat-dnat' : 'dnat' : snat ? 'snat' : 'not-assessed'
  return result
}
