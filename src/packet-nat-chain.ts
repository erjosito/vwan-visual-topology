import { namedEndpoints, type InventoryTopology, type RouterSnatOwner } from './inventory'
import { cidr, contains, ipv4 } from './validation'
import { simulateAzNet, type AzSimulationResult } from './azure-net/engine'
import { traceInventoryPacketLeg } from './packet-ingress'
import type { FiveTuple, PacketLeg, PacketRequest, PacketResult, PacketStep } from './packet-flow'

const reverse = (tuple: FiveTuple): FiveTuple => ({ ...tuple,
  sourceAddress: tuple.destinationAddress, destinationAddress: tuple.sourceAddress,
  sourcePort: tuple.destinationPort, destinationPort: tuple.sourcePort })
const matches = (prefixes: string[], address: string) => prefixes.some((prefix) => contains(prefix, ipv4(address)!))

export function applyPrivateNvaSnatChain(topology: InventoryTopology, request: PacketRequest,
  forward: PacketLeg, reply: PacketLeg, owners: RouterSnatOwner[], simulation?: AzSimulationResult): Pick<PacketResult, 'translation'> | undefined {
  if (topology.version !== 2 || request.source.kind !== 'workload' || request.target.kind !== 'workload'
    || !forward.tuple || !forward.native || Array.isArray(forward.native)) return
  const stop = (reason: string): Pick<PacketResult, 'translation'> => {
    forward.reasons.push(reason)
    reply.routing = 'not-assessed'
    delete reply.session
    reply.steps = []
    reply.reasons = [reason]
    return { translation: 'not-assessed' }
  }
  if (owners.length > 4 || owners.some((owner) => owner.kind !== 'appliance')
    || forward.native.hops.some((hop) => ['vwan-hub', 'vnet-gateway', 'site', 'er-location'].includes(hop.nodeKind) || hop.haPorts)) {
    return stop('Composed private SNAT supports at most four original NVA interfaces, without managed hubs, gateways, VPN NAT or HA-ports steering.')
  }
  const endpoints = namedEndpoints(topology)
  const sourceRef = request.source, targetRef = request.target
  const source = endpoints.find(({ workload, nic, config }) => workload.id === sourceRef.workloadId
    && nic.id === sourceRef.nicId && config.id === sourceRef.ipConfigurationId)
  const target = endpoints.find(({ workload, nic, config }) => workload.id === targetRef.workloadId
    && nic.id === targetRef.nicId && config.id === targetRef.ipConfigurationId)
  if (!source || !target) return stop('Composed SNAT requires both original workload interfaces.')
  const stages = []
  for (const owner of owners) {
    const vnet = topology.vnets.find((vnet) => vnet.appliances.some((device) => device.id === owner.id))
    const device = vnet?.appliances.find((device) => device.id === owner.id)
    const policy = topology.inventory?.routerSnatPolicies?.find((policy) => policy.owner.kind === owner.kind && policy.owner.id === owner.id)
    if (!vnet || device?.kind !== 'nva-vm' || !device.privateIp || policy?.kind !== 'nva-snat') {
      return stop('Every composed private SNAT waypoint requires its original NVA interface and explicit guest SNAT policy. Other router compositions are not assessed.')
    }
    if (device.staticRoutes.some((route) => route.enabled && !cidr(route.prefix))) {
      return stop('An enabled NVA static route is invalid; composed translation cannot establish forwarding.')
    }
    stages.push({ vnet, device, policy })
  }
  const native = simulation ?? simulateAzNet(topology)
  const mappings: { stage: typeof stages[number]; step: PacketStep }[] = []
  let tuple = forward.tuple
  const steps: PacketStep[] = []
  const seen = new Set<string>()
  for (const step of forward.steps) {
    steps.push({ ...step, before: tuple, after: step.after === null ? null : tuple,
      ...(mappings.length ? { uncertainty: mappings.at(-1)!.step.uncertainty } : {}) })
    if (step.entity.kind !== 'appliance' || seen.has(step.entity.id)) continue
    seen.add(step.entity.id)
    const stage = stages.find((stage) => stage.device.id === step.entity.id)
    if (!stage) return stop('An undeclared translation waypoint interrupts the composed path.')
    const policy = stage.policy
    if (!matches(policy.sourcePrefixes, tuple.sourceAddress) || !matches(policy.destinationPrefixes, tuple.destinationAddress)
      || policy.protocol !== 'any' && policy.protocol !== tuple.protocol) continue
    const after = { ...tuple, sourceAddress: stage.device.privateIp!,
      sourcePort: 1024 + (tuple.sourcePort * 31 + tuple.destinationPort) % 64512 }
    const mapping: PacketStep = { entity: step.entity, before: tuple, after,
      uncertainty: { sourcePorts: [0, 65535] },
      evidence: 'Explicit original NVA guest SNAT policy matches the tuple at this boundary. Interface and port mapping are illustrative; later policies see this translated source.' }
    steps.push(mapping)
    mappings.push({ stage, step: mapping })
    tuple = after
  }
  if (!mappings.length) return stop('No declared composed SNAT policy matches this flow; a multi-router stateful return is not inferred.')
  if (seen.size !== stages.length) return stop('The selected native route does not contain every original translation waypoint.')
  forward.steps = steps
  reply.tuple = reverse(tuple)
  reply.steps = []
  reply.reasons = ['Conditional response only: each original translator is reached by an independent return route before its exact inverse mapping. No unsolicited reverse initiation or live session is inferred.']
  reply.session = 'conditional-response'
  reply.routing = 'reachable'
  let origin = { owner: target.nic.owner, subnetId: target.config.subnetId, deviceId: undefined as string | undefined, deviceAddress: undefined as string | undefined }
  const appendReturn = (destination: { owner: typeof source.nic.owner; subnetId: string }, response: FiveTuple,
    allowedDeviceId?: string): boolean => {
    const leg = traceInventoryPacketLeg(topology, native, origin.owner, origin.subnetId, response, 'reply', destination, origin.deviceId, origin.deviceAddress)
    const extraRouter = !Array.isArray(leg.native) && leg.native?.hops.find((hop) =>
      hop.nodeKind === 'appliance' && hop.nodeId !== origin.deviceId && hop.nodeId !== allowedDeviceId
      || ['vwan-hub', 'vnet-gateway', 'site', 'er-location'].includes(hop.nodeKind) || hop.haPorts)
    if (extraRouter) {
      leg.routing = 'not-assessed'
      leg.reasons.push('The conditional response crosses a different router before its required original translator; no inverse mapping is applied.')
      const index = leg.steps.findIndex((step) => step.entity.id === extraRouter.nodeId)
      leg.steps = leg.steps.slice(0, index + 1)
      if (leg.steps.length) leg.steps[leg.steps.length - 1].after = null
    }
    reply.steps.push(...leg.steps)
    if (leg.routing === 'reachable') return true
    reply.routing = leg.routing
    reply.reasons.push(...leg.reasons)
    delete reply.session
    return false
  }
  for (const { stage, step } of mappings.toReversed()) {
    if (!appendReturn({ owner: { kind: 'vnet', id: stage.vnet.id }, subnetId: stage.device.subnetId }, reverse(step.after!), stage.device.id)) {
      return { translation: 'snat' }
    }
    reply.steps.push({ entity: step.entity, before: reverse(step.after!), after: reverse(step.before),
      evidence: 'Inverse SNAT for this exact conditional response at its original NVA, only after independently reaching that interface.' })
    origin = { owner: { kind: 'vnet', id: stage.vnet.id }, subnetId: stage.device.subnetId,
      deviceId: stage.device.id, deviceAddress: stage.device.privateIp }
  }
  if (appendReturn({ owner: source.nic.owner, subnetId: source.config.subnetId }, reverse(forward.tuple))) {
    reply.steps.push({ entity: { kind: 'workload', id: source.workload.id }, before: reverse(forward.tuple), after: reverse(forward.tuple),
      evidence: `Conditional response reaches original NIC ${source.nic.id}, IP configuration ${source.config.id}.` })
  }
  return { translation: 'snat' }
}
