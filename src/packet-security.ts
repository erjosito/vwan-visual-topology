import { cidr, contains, formatIpv4, ipv4 } from './validation'
import { nsgAssociation, publicIpv4, type InventoryOwner, type InventoryTopology, type NetworkSecurityGroup, type NetworkSecurityRule, type NsgAssociation } from './inventory'
import type { FiveTuple } from './packet-flow'

export interface TupleUncertainty {
  sourceAddressPrefixes?: string[]
  sourcePorts?: [number, number]
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
  target: NsgAssociation['target']
  direction: 'inbound' | 'outbound'
  tuple: FiveTuple
  uncertainty?: TupleUncertainty
  nsgId?: string
  ruleId?: string
  priority?: number
  outcome: 'allowed' | 'denied' | 'not-assessed'
  reason: string
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
  const domains = source && context.uncertainty?.sourceAddressPrefixes
    ? context.uncertainty.sourceAddressPrefixes : [`${address}/32`]
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
      portMatch(rule.destinationPorts, tuple.destinationPort),
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
