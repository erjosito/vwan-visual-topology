import { namedEndpoints, workloadEndpointKey, type WorkloadIpReference } from './inventory'
import { assessEndpointNsg, nsgScope, type NsgCheck } from './packet-security'
import { contains, ipv4 } from './validation'
import type { AzNetTopology } from './azure-net/model'
import type { AzSimulationResult } from './azure-net/engine'

export interface HaPortsAssessment {
  loadBalancerId: string
  frontendId: string
  frontendAddress?: string
  frontendSubnetId?: string
  ruleId?: string
  poolId?: string
  eligible: WorkloadIpReference[]
  selected?: WorkloadIpReference
  applianceId?: string
  backendAddress?: string
  probes: { target: WorkloadIpReference; declared: 'healthy' | 'unhealthy' | 'unknown'; eligibility: 'eligible' | 'ineligible' | 'unknown'; checks: NsgCheck[] }[]
  status: 'selected' | 'blocked' | 'not-assessed'
  reason: string
}

const key = (target: WorkloadIpReference) => workloadEndpointKey({ kind: 'workload', ...target })

export function resolveHaPortsNextHop(topology: AzNetTopology, simulation: AzSimulationResult, address?: string): HaPortsAssessment | undefined {
  if (!address || ipv4(address) === undefined) return
  const candidates = (topology.inventory?.loadBalancers ?? []).flatMap((lb) => lb.frontends
    .filter((frontend) => frontend.kind === 'private' && (frontend.privateIp === address || !frontend.privateIp
      && topology.vnets.find((vnet) => vnet.id === lb.owner.id)?.subnets
        .some((subnet) => subnet.id === frontend.subnetId && contains(subnet.prefix, ipv4(address)!))))
    .map((frontend) => ({ lb, frontend })))
  if (!candidates.length) return
  const { lb, frontend } = candidates[0]
  const result: HaPortsAssessment = { loadBalancerId: lb.id, frontendId: frontend.id,
    frontendAddress: frontend.kind === 'private' ? frontend.privateIp : undefined,
    frontendSubnetId: frontend.kind === 'private' ? frontend.subnetId : undefined,
    eligible: [], probes: [], status: 'not-assessed', reason: '' }
  const stop = (reason: string, blocked = false) => {
    result.status = blocked ? 'blocked' : 'not-assessed'; result.reason = reason; return result
  }
  if (candidates.length !== 1 || topology.vnets.some((vnet) => vnet.appliances.some((device) => device.privateIp === address))
    || namedEndpoints(topology).some((entry) => entry.config.privateIp === address)) return stop('HA ports frontend ownership is ambiguous.')
  if (!result.frontendAddress || topology.inventory?.capture?.configurationComplete === false) return stop('HA ports frontend allocation or capture coverage is unknown.')
  const rules = lb.rules.filter((rule) => rule.frontendId === frontend.id)
  const rule = rules[0]
  if (lb.sku !== 'Standard' || lb.owner.kind !== 'vnet' || lb.frontends.length !== 1 || lb.pools.length !== 1
    || rules.length !== 1 || lb.rules.length !== 1 || lb.inboundNatRules.length || lb.outboundRules.length
    || lb.rulesStatus === 'unknown' || !rule?.haPorts || !rule.floatingIp || rule.protocol !== 'all'
    || rule.frontendPort !== 0 || rule.backendPort !== 0 || rule.haPortsForwarding !== 'preserve-tuple') {
    return stop('HA ports forwarding requires one internal Standard frontend/pool, one floating HA-ports rule and an explicit tuple-preserving NVA forwarding declaration.')
  }
  result.ruleId = rule.id; result.poolId = rule.poolId
  const vnet = topology.vnets.find((vnet) => vnet.id === lb.owner.id)
  if (frontend.kind !== 'private' || !vnet?.subnets.some((subnet) => subnet.id === frontend.subnetId && contains(subnet.prefix, ipv4(address)!))
    || topology.vnets.filter((vnet) => vnet.prefixes.some((prefix) => contains(prefix, ipv4(address)!))).length !== 1) {
    return stop('HA ports frontend subnet ownership is unknown or ambiguous.')
  }
  const pool = lb.pools.find((pool) => pool.id === rule.poolId), probe = lb.probes.find((probe) => probe.id === rule.probeId)
  if (!pool || pool.membersStatus === 'unknown' || !probe) return stop('HA ports original pool membership or probe ownership is unknown.')
  const endpoints = namedEndpoints(topology)
  for (const target of pool.members) {
    const entry = endpoints.find((entry) => key(target) === key({ workloadId: entry.workload.id, nicId: entry.nic.id, ipConfigurationId: entry.config.id }))
    const device = vnet.appliances.find((device) => device.id === entry?.workload.backingDeviceId)
    if (!entry || !device || device.kind !== 'nva-vm' || entry.workload.nicIds.length !== 1 || entry.nic.ipConfigurations.length !== 1
      || entry.nic.owner.kind !== 'vnet' || entry.nic.owner.id !== vnet.id || entry.config.subnetId !== device.subnetId
      || entry.config.privateIp !== device.privateIp || !entry.config.privateIp
      || endpoints.filter((other) => other.config.privateIp === entry.config.privateIp).length !== 1
      || topology.vnets.filter((network) => network.prefixes.some((prefix) => contains(prefix, ipv4(entry.config.privateIp!)!))).length !== 1
      || topology.inventory?.routerSnatPolicies?.some((policy) => policy.owner.id === device.id)
      || topology.inventory?.routerDnatPolicies?.some((policy) => policy.owner.id === device.id)) {
      return stop('HA ports needs original single-NIC/single-IP NVA backends with matching device ownership and no additional router NAT policy.')
    }
    if ((topology.inventory?.loadBalancers ?? []).some((other) => other.id !== lb.id
      && other.pools.some((pool) => pool.members.some((member) => member.workloadId === target.workloadId)))) {
      return stop('HA ports backend membership in multiple load balancers is outside this single-LB slice.')
    }
    const declared = probe.health.find((state) => key(state.target) === key(target))?.status ?? 'unknown'
    const permission = assessEndpointNsg(topology, entry.nic.owner, entry.nic.id, entry.config.subnetId, 'inbound',
      { sourceAddress: '168.63.129.16', destinationAddress: entry.config.privateIp, protocol: 'tcp', sourcePort: 49152, destinationPort: probe.port },
      { ...nsgScope(topology, entry.nic.owner, entry.config.subnetId, simulation), purpose: 'health-probe',
        uncertainty: { sourcePorts: [1, 65535] } })
    const eligibility = declared === 'unhealthy' || permission.outcome === 'denied' ? 'ineligible'
      : declared === 'healthy' && permission.outcome === 'allowed' ? 'eligible' : 'unknown'
    result.probes.push({ target, declared, eligibility, checks: permission.checks })
    if (eligibility === 'eligible') result.eligible.push(target)
  }
  if (result.probes.some((probe) => probe.eligibility === 'unknown')) return stop('HA ports backend eligibility is unknown; no passing selection is inferred.')
  if (!result.eligible.length) return stop('HA ports has no declared eligible probe-permitted backend for this new flow.', true)
  result.selected = [...result.eligible].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)[0]
  result.applianceId = endpoints.find((entry) => entry.workload.id === result.selected!.workloadId)!.workload.backingDeviceId
  result.backendAddress = endpoints.find((entry) => entry.workload.id === result.selected!.workloadId)!.config.privateIp
  result.status = 'selected'
  result.reason = `HA ports ${lb.name}: frontend ${frontend.id}, rule ${rule.id}, pool ${pool.id}, original NVA ${result.applianceId}. Tuple preserved; stable original-ID selection is illustrative, not Azure hashing or live health.`
  return result
}
