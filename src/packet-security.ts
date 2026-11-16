import { cidr, contains, formatIpv4, ipv4 } from './validation'
import { inventoryOwners, namedEndpoints, nsgAssociation, publicIpv4, type InventoryOwner, type InventoryTopology, type NetworkSecurityGroup, type NetworkSecurityRule, type NsgAssociation } from './inventory'
import { attachmentHubRouting } from './hub-routing'
import type { Simulation } from './routing'
import type { AzSimulationResult } from './azure-net/engine'
import type { FiveTuple, PacketEndpoint, PacketLeg } from './packet-flow'

export interface TupleUncertainty {
  sourceAddressPrefixes?: string[]
  sourcePorts?: [number, number]
  destinationAddressPrefixes?: string[]
  destinationPorts?: [number, number]
}
export interface NsgContext {
  virtualNetworkPrefixes: string[]
  virtualNetworkComplete: boolean
  purpose?: 'data' | 'health-probe'
  uncertainty?: TupleUncertainty
  standardPublicIngress?: boolean
}
export interface NsgCheck {
  owner: InventoryOwner
  target: NsgAssociation['target'] | { kind: 'interface-unknown'; id: string }
  direction: 'inbound' | 'outbound'
  tuple: FiveTuple
  uncertainty?: TupleUncertainty
  nsgId?: string
  ruleId?: string
  priority?: number
  waypointId?: string
  outcome: 'allowed' | 'denied' | 'not-assessed'
  reason: string
}
export interface NsgAssessment {
  outcome: NsgCheck['outcome']
  checks: NsgCheck[]
  conditionalResponse?: boolean
}
type Match = boolean | undefined
const all = (values: Match[]): Match => values.includes(false) ? false : values.includes(undefined) ? undefined : true
const any = (values: Match[]): Match => values.includes(true) ? true : values.includes(undefined) ? undefined : false

export function defaultNsgRules(direction: NetworkSecurityRule['direction']): NetworkSecurityRule[] {
  const rule = (id: string, priority: number, action: NetworkSecurityRule['action'], sources: string[], destinations: string[]): NetworkSecurityRule =>
    ({ id, name: id, priority, action, direction, protocol: 'any', sources, destinations, sourcePorts: ['*'], destinationPorts: ['*'] })
  return [
    rule(direction === 'inbound' ? 'AllowVNetInBound' : 'AllowVnetOutBound', 65000, 'allow', ['VirtualNetwork'], ['VirtualNetwork']),
    direction === 'inbound'
      ? rule('AllowAzureLoadBalancerInBound', 65001, 'allow', ['AzureLoadBalancer'], ['*'])
      : rule('AllowInternetOutBound', 65001, 'allow', ['*'], ['Internet']),
    rule(direction === 'inbound' ? 'DenyAllInbound' : 'DenyAllOutBound', 65500, 'deny', ['*'], ['*']),
  ]
}

function addressMatch(selectors: string[], address: string, context: NsgContext, source: boolean): Match {
  const domains = context.uncertainty?.[source ? 'sourceAddressPrefixes' : 'destinationAddressPrefixes'] ?? [`${address}/32`]
  const againstPrefixes = (prefixes: string[]): Match => {
    const results = domains.map((domain): Match => {
      const range = cidr(domain)
      if (!range) return undefined
      if (prefixes.some((prefix) => cidr(prefix)!.length <= range.length && contains(prefix, range.network))) return true
      if (prefixes.some((prefix) => contains(domain, cidr(prefix)!.network))) return undefined
      return false
    })
    return results.every((value) => value === true) ? true : results.every((value) => value === false) ? false : undefined
  }
  const literal = selectors.filter((selector) => cidr(selector) || ipv4(selector) !== undefined)
    .map((selector) => selector.includes('/') ? selector : `${selector}/32`)
  if (literal.length === selectors.length) return againstPrefixes(literal)
  return any(selectors.map((selector): Match => {
    if (selector === '*' || selector.toLowerCase() === 'any') return true
    if (selector === 'VirtualNetwork') {
      const match = againstPrefixes(context.virtualNetworkPrefixes)
      return match === false && !context.virtualNetworkComplete ? undefined : match
    }
    if (selector === 'AzureLoadBalancer') {
      return context.purpose === 'health-probe' ? againstPrefixes(['168.63.129.16/32']) : false
    }
    if (selector === 'Internet') {
      const local = againstPrefixes(context.virtualNetworkPrefixes)
      if (local === true) return false
      if (local === undefined || !context.virtualNetworkComplete) return undefined
      const states = domains.map((prefix): Match => {
        const range = cidr(prefix)
        if (!range) return undefined
        if (range.length === 32) return publicIpv4(formatIpv4(range.network)) && range.network !== ipv4('168.63.129.16')
        const privateMatch = againstPrefixes(['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
          '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/3'])
        return privateMatch === true ? false : undefined
      })
      return states.every((value) => value === true) ? true : states.every((value) => value === false) ? false : undefined
    }
    return undefined
  }))
}

function portMatch(selectors: string[], port: number, uncertain?: [number, number]): Match {
  const [low, high] = uncertain ?? [port, port]
  const ranges = selectors.map((selector): [number, number] => {
    if (selector === '*') return [0, 65535]
    const [start, end = start] = selector.split('-').map(Number)
    return [start, end]
  }).sort((a, b) => a[0] - b[0])
  let covered = low
  for (const [start, end] of ranges) {
    if (start <= covered && end >= covered) covered = end + 1
    if (covered > high) return true
  }
  return ranges.some(([start, end]) => start <= high && end >= low) ? undefined : false
}

export function assessNsg(group: NetworkSecurityGroup, direction: NetworkSecurityRule['direction'], tuple: FiveTuple, context: NsgContext) {
  if (group.rulesStatus === 'unknown') return { outcome: 'not-assessed' as const, reason: 'Captured NSG rules are incomplete. No permission is inferred.' }
  const rules = [...group.rules.filter((rule) => rule.direction === direction).sort((a, b) => a.priority - b.priority), ...defaultNsgRules(direction)]
  for (const rule of rules) {
    const match = all([
      rule.protocol === 'any' ? true : rule.protocol === 'tcp' || rule.protocol === 'udp' ? rule.protocol === tuple.protocol : undefined,
      addressMatch(rule.sources, tuple.sourceAddress, context, true),
      addressMatch(rule.destinations, tuple.destinationAddress, context, false),
      portMatch(rule.sourcePorts, tuple.sourcePort, context.uncertainty?.sourcePorts),
      portMatch(rule.destinationPorts, tuple.destinationPort, context.uncertainty?.destinationPorts),
    ])
    if (match === false) continue
    return { ruleId: rule.id, priority: rule.priority,
      outcome: match === undefined ? 'not-assessed' as const : rule.action === 'allow' ? 'allowed' as const : 'denied' as const,
      reason: match === undefined ? 'An unresolved selector or illustrative translated field can affect the first matching NSG rule.'
        : rule.action === 'allow' ? 'The first matching NSG rule allows this tuple.' : 'The first matching NSG rule denies this tuple.' }
  }
  return { outcome: 'not-assessed' as const, reason: 'NSG rule coverage is incomplete.' }
}

export function assessNsgPoint(topology: InventoryTopology, owner: InventoryOwner, target: NsgAssociation['target'],
  direction: NetworkSecurityRule['direction'], tuple: FiveTuple, context: NsgContext): NsgCheck {
  const binding = nsgAssociation(topology, owner, target)
  const group = topology.inventory?.networkSecurityGroups?.find((group) => group.id === binding?.nsgId)
  return { owner, target, direction, tuple, ...(context.uncertainty ? { uncertainty: context.uncertainty } : {}),
    ...(binding?.nsgId ? { nsgId: binding.nsgId } : {}),
    ...(binding?.status === 'unknown' || binding && !group
      ? { outcome: 'not-assessed' as const, reason: 'Captured NSG association is incomplete or unsupported.' }
      : group ? assessNsg(group, direction, tuple, context)
        : { outcome: 'allowed' as const, reason: 'No NSG is associated at this enforcement point; this does not supply routing, SNAT or a listener.' }) }
}

export function assessEndpointNsg(topology: InventoryTopology, owner: InventoryOwner, nicId: string, subnetId: string,
  direction: NetworkSecurityRule['direction'], tuple: FiveTuple, context: NsgContext) {
  const targets: NsgAssociation['target'][] = [{ kind: 'subnet', id: subnetId }, { kind: 'nic', id: nicId }]
  if (direction === 'outbound') targets.reverse()
  const checks = targets.map((target) => assessNsgPoint(topology, owner, target, direction, tuple, context))
  if (direction === 'inbound' && context.standardPublicIngress && checks.every((check) => !check.nsgId && check.outcome === 'allowed')) {
    checks.push({ owner, target: { kind: 'nic', id: nicId }, direction, tuple, outcome: 'denied',
      reason: 'Standard public VM/Load Balancer ingress requires an associated NSG permission; absence is not an inbound allow.' })
  }
  return { checks, outcome: checks.some((check) => check.outcome === 'denied') ? 'denied' as const
    : checks.some((check) => check.outcome === 'not-assessed') ? 'not-assessed' as const : 'allowed' as const }
}

export function nsgScope(topology: InventoryTopology, owner: InventoryOwner, subnetId: string, simulation: Simulation | AzSimulationResult): NsgContext {
  const prefixes = inventoryOwners(topology).find((entry) => entry.kind === owner.kind && entry.id === owner.id)?.prefixes ?? []
  if (topology.version === 2) {
    const native = simulation as AzSimulationResult, table = native.subnetTables[subnetId]
    const routes = [...(table?.routes ?? []), ...(table?.suppressedBgpRoutes ?? []), ...(table?.suppressedPeeringRoutes ?? [])]
      .filter((route) => route.source !== 'System' || route.nextHopType === 'VnetLocal' || route.nextHopType === 'VNetPeering')
    return { virtualNetworkPrefixes: [...new Set([...prefixes, ...routes.map((route) => route.prefix)])].filter((prefix) => !!cidr(prefix)),
      virtualNetworkComplete: !!table && native.controlPlaneComplete === true }
  }
  const spoke = topology.spokes.find((spoke) => spoke.id === owner.id), native = simulation as Simulation
  const config = attachmentHubRouting(topology, owner.id), tableId = config.associatedTableId
  const rows = spoke?.hubId && tableId ? native.hubTables?.[spoke.hubId]?.[tableId] ?? [] : []
  return { virtualNetworkPrefixes: [...new Set([...prefixes, ...rows.filter((row) => row.prefix !== '0.0.0.0/0'
    || row.selected.some((candidate) => candidate.transport !== 'Internet' && candidate.transport !== 'Firewall')).map((row) => row.prefix)])]
    .filter((prefix) => !!cidr(prefix)),
  virtualNetworkComplete: native.converged && (!spoke?.hubId || config.status === 'configured'
    && !!tableId && native.hubTableCoverage?.[spoke.hubId]?.[tableId]?.complete === true) }
}

export function endpointNsg(topology: InventoryTopology, endpoint: PacketEndpoint, direction: NsgCheck['direction'],
  tuple: FiveTuple, simulation: Simulation | AzSimulationResult, uncertainty?: TupleUncertainty, standardPublicIngress = false): NsgAssessment {
  if (endpoint.kind !== 'workload') return { outcome: 'not-assessed', checks: [] }
  const original = namedEndpoints(topology).find(({ workload, nic, config }) => workload.id === endpoint.workloadId
    && nic.id === endpoint.nicId && config.id === endpoint.ipConfigurationId)
  if (!original) return { outcome: 'not-assessed', checks: [] }
  return assessEndpointNsg(topology, original.nic.owner, original.nic.id, original.config.subnetId, direction, tuple,
    { ...nsgScope(topology, original.nic.owner, original.config.subnetId, simulation), standardPublicIngress, ...(uncertainty ? { uncertainty } : {}) })
}

function transitNsg(topology: InventoryTopology, forward: PacketLeg, simulation: Simulation | AzSimulationResult,
  translation: 'snat' | 'none' | 'not-assessed', publicIngressApplianceId?: string): NsgCheck[] {
  if (!forward.tuple || !forward.native) return []
  const checks: NsgCheck[] = []
  const assess = (owner: InventoryOwner, deviceId: string, subnetId: string, before: FiveTuple, after: FiveTuple,
    uncertainty?: TupleUncertainty, inboundUncertainty?: TupleUncertainty, interfaceAddress?: string) => {
    const start = checks.length
    const endpoint = namedEndpoints(topology).find(({ workload, nic, config }) => workload.backingDeviceId === deviceId
      && nic.owner.kind === owner.kind && nic.owner.id === owner.id && config.subnetId === subnetId
      && !!interfaceAddress && config.privateIp === interfaceAddress)
    for (const direction of ['inbound', 'outbound'] as const) {
      const tuple = direction === 'inbound' ? before : after
      const comparedUncertainty = direction === 'outbound' ? uncertainty : inboundUncertainty
      const context = { ...nsgScope(topology, owner, subnetId, simulation),
        standardPublicIngress: direction === 'inbound' && deviceId === publicIngressApplianceId,
        ...(comparedUncertainty ? { uncertainty: comparedUncertainty } : {}) }
      if (endpoint) checks.push(...assessEndpointNsg(topology, owner, endpoint.nic.id, subnetId, direction, tuple, context).checks)
      else {
        checks.push(assessNsgPoint(topology, owner, { kind: 'subnet', id: subnetId }, direction, tuple, context))
        checks.push({ owner, target: { kind: 'interface-unknown', id: deviceId }, direction, tuple, outcome: 'not-assessed',
          reason: 'The original NVA backing NIC is not modeled; its NIC filtering is not assessed.' })
      }
      if (checks.some((check) => check.outcome === 'denied')) break
    }
    for (const check of checks.slice(start)) check.waypointId = deviceId
  }
  if (topology.version === 2) {
    const seen = new Set<string>()
    for (const [index, step] of forward.steps.entries()) {
      if (step.entity.kind !== 'appliance' || seen.has(step.entity.id)) continue
      seen.add(step.entity.id)
      const vnet = topology.vnets.find((vnet) => vnet.appliances.some((device) => device.id === step.entity.id))
      const device = vnet?.appliances.find((device) => device.id === step.entity.id)
      if (!vnet || device?.kind !== 'nva-vm') continue
      const mapped = forward.steps[index + 1]
      const local = mapped?.entity.kind === 'appliance' && mapped.entity.id === device.id && mapped.after ? mapped : step
      const unknown = translation === 'not-assessed' ? { sourceAddressPrefixes: ['0.0.0.0/0'], sourcePorts: [0, 65535] as [number, number] } : local.uncertainty
      const priorRouter = forward.steps.slice(0, index).some((step) => step.entity.kind === 'appliance')
      assess({ kind: 'vnet', id: vnet.id }, device.id, device.subnetId, step.before, local.after ?? step.before, unknown,
        step.uncertainty ?? (priorRouter && translation === 'not-assessed'
          ? { sourceAddressPrefixes: ['0.0.0.0/0'], sourcePorts: [0, 65535] } : undefined), device.privateIp)
      if (checks.some((check) => check.outcome === 'denied')) break
    }
  } else if (Array.isArray(forward.native)) {
    const ids = [...new Set(forward.native.flatMap((path) => [path.sourceNvaSpokeId, path.nvaSpokeId]).filter((id): id is string => !!id))]
    const choices = new Set(forward.native.map((path) => JSON.stringify([path.sourceNvaSpokeId, path.nvaSpokeId])))
    if (ids.length && choices.size > 1) return [{ owner: { kind: 'spoke', id: ids[0] },
      target: { kind: 'interface-unknown', id: ids[0] }, direction: 'inbound', tuple: forward.tuple,
      outcome: 'not-assessed', reason: 'Native route alternatives use different NVA filtering points; one selected packet path is not inferred.' }]
    for (const id of ids) {
      const connections = topology.connections.filter((connection) => connection.transport === 'SpokeNVA' && connection.spokeId === id)
      const connection = connections.length === 1 ? connections[0] : undefined
      const subnet = topology.spokes.find((spoke) => spoke.id === id)?.subnets?.find((subnet) => connection?.peerIp && contains(subnet.prefix, ipv4(connection.peerIp)!))
      if (!connection || !subnet) {
        checks.push({ owner: { kind: 'spoke', id }, target: { kind: 'interface-unknown', id }, direction: 'inbound', tuple: forward.tuple,
          outcome: 'not-assessed', reason: 'The original NVA interface/subnet is unknown; no filtering point is invented.' })
        continue
      }
      assess({ kind: 'spoke', id }, connection.siteId, subnet.id, forward.tuple, forward.tuple,
        { sourceAddressPrefixes: ['0.0.0.0/0'], sourcePorts: [0, 65535] }, undefined, connection.peerIp)
      if (checks.some((check) => check.outcome === 'denied')) break
    }
  }
  return checks
}

export function completePacketNsg(topology: InventoryTopology, target: PacketEndpoint, forward: PacketLeg, reply: PacketLeg,
  source: NsgAssessment, simulation: Simulation | AzSimulationResult, translation: 'snat' | 'none' | 'not-assessed',
  standardPublicIngress = false, publicIngressApplianceId?: string) {
  const checks = [...source.checks]
  const unknownRouter = Array.isArray(forward.native)
    ? forward.native.some((path) => path.firewalls?.length || path.sourceNvaSpokeId || path.nvaSpokeId)
    : forward.native?.hops.some((hop) => hop.nodeKind === 'appliance' || hop.nodeKind === 'vnet-gateway'
      || hop.nodeKind === 'vwan-hub' && hop.action === 'inspect-firewall')
  if (source.outcome !== 'denied') checks.push(...transitNsg(topology, forward, simulation, translation, publicIngressApplianceId))
  if (!checks.some((check) => check.outcome === 'denied') && forward.routing === 'reachable' && target.kind === 'workload' && forward.tuple) {
    const last = forward.steps.at(-1)
    const translated = forward.steps.some((step) => step.after && step.before.sourceAddress !== step.after.sourceAddress)
    const uncertainty = last?.uncertainty ?? (translation !== 'none' && !translated && unknownRouter
      ? { sourceAddressPrefixes: ['0.0.0.0/0'], sourcePorts: [0, 65535] as [number, number] } : undefined)
    checks.push(...endpointNsg(topology, target, 'inbound', last?.after ?? forward.tuple, simulation, uncertainty, standardPublicIngress).checks)
  }
  const outcome = checks.some((check) => check.outcome === 'denied') ? 'denied' as const
    : source.outcome === 'not-assessed' || checks.some((check) => check.outcome === 'not-assessed')
      || target.kind === 'workload' && forward.routing !== 'reachable' ? 'not-assessed' as const : 'allowed' as const
  const established = outcome === 'allowed' && forward.routing === 'reachable'
    && !reply.steps.some((step) => step.after === null)
    && (reply.session === 'conditional-response' || target.kind === 'workload' && (!unknownRouter || translation === 'none'))
  const response: NsgAssessment = established ? { outcome: 'allowed', conditionalResponse: true, checks: checks.toReversed().map((check) => ({
    ...check, direction: check.direction === 'inbound' ? 'outbound' : 'inbound',
    tuple: { ...check.tuple, sourceAddress: check.tuple.destinationAddress, destinationAddress: check.tuple.sourceAddress,
      sourcePort: check.tuple.destinationPort, destinationPort: check.tuple.sourcePort },
    uncertainty: check.uncertainty ? { destinationAddressPrefixes: check.uncertainty.sourceAddressPrefixes,
      destinationPorts: check.uncertainty.sourcePorts, sourceAddressPrefixes: check.uncertainty.destinationAddressPrefixes,
      sourcePorts: check.uncertainty.destinationPorts } : undefined,
    ruleId: undefined, priority: undefined, outcome: 'allowed',
    reason: 'Conditional response to this NSG-allowed new flow; reverse-initiation rules are not evaluated. No live session is observed.',
  })) } : { outcome: 'not-assessed', checks: [] }
  if (established) reply.session = 'conditional-response'
  if (outcome === 'denied') {
    const denied = checks.find((check) => check.outcome === 'denied')!
    const sourceDenied = source.outcome === 'denied'
    let index = forward.steps.findIndex((step) => step.entity.id === denied.waypointId || step.entity.id === denied.target.id)
    if (denied.waypointId && denied.direction === 'outbound') {
      while (index >= 0 && forward.steps[index + 1]?.entity.id === denied.waypointId) index++
    }
    forward.steps = sourceDenied || denied.waypointId && index < 0 ? forward.steps.slice(0, 1)
      : index >= 0 ? forward.steps.slice(0, index + 1) : forward.steps.slice(0, -1)
    forward.steps.push({ entity: { kind: denied.target.kind, id: denied.target.id }, before: denied.tuple, after: null, evidence: denied.reason })
    delete reply.session
    reply.steps = []
    reply.reasons.push('The new flow is NSG-denied; no established response permission is inferred.')
  }
  return { forward: { outcome, checks }, reply: response }
}
