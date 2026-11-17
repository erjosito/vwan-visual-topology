import { namedEndpoints, workloadEndpointKey, type InventoryTopology } from '../inventory'
import { tracePacket, type PacketEndpoint } from '../packet-flow'
import type { AzSimulationResult } from '../azure-net/engine'
import type { Simulation } from '../routing'
import type { Assessment, PacketRequirement } from './contract'

export function assessPacket(topology: InventoryTopology, simulation: Simulation | AzSimulationResult, requirement: PacketRequirement): Assessment {
  const endpoints = namedEndpoints(topology)
  const workload = (target: Extract<PacketEndpoint, { kind: 'workload' }>) => endpoints.find(({ workload, nic, config }) =>
    workload.id === target.workloadId && nic.id === target.nicId && config.id === target.ipConfigurationId)
  const address = (target: PacketEndpoint): string | undefined => {
    if (target.kind === 'workload') return workload(target)?.config.privateIp
    if (target.kind === 'external') return target.address
    if (target.kind === 'public-ip') return topology.inventory?.publicIps.find((ip) => ip.id === target.publicIpId)?.address
    const frontend = topology.inventory?.loadBalancers?.find((lb) => lb.id === target.loadBalancerId)?.frontends.find((frontend) => frontend.id === target.frontendId)
    return frontend?.kind === 'private' ? frontend.privateIp : frontend?.kind === 'public'
      ? topology.inventory?.publicIps.find((ip) => ip.id === frontend.publicIpId)?.address : undefined
  }
  const unknown = (reason: string, evidence?: unknown): Assessment => ({ id: requirement.id, outcome: 'not assessed', evidence, reasons: [reason] })
  if (address(requirement.packet.source) !== requirement.sourceAddress || address(requirement.packet.target) !== requirement.destinationAddress) {
    return unknown('Original packet endpoint identity/address binding is missing or changed; no passing or isolation assessment.')
  }
  const required = requirement.requiredBackend
  const backend = required && workload({ kind: 'workload', workloadId: required.workloadId, nicId: required.nicId, ipConfigurationId: required.ipConfigurationId })
  if (required && backend?.config.privateIp !== required.address) return unknown('Original backend identity/address binding is missing or changed.')
  const packet = tracePacket(topology, requirement.packet, simulation)
  const assessment = (satisfied: boolean): Assessment => ({ id: requirement.id, outcome: satisfied ? 'satisfied' : 'violated', evidence: packet,
    reasons: ['This is a bounded configuration predicate, not observed connectivity, probe health, guest/listener readiness or a live session.'] })
  const blocked = packet.forward.routing === 'unreachable' || packet.nsg?.forward.outcome === 'denied'
    || packet.ingress === 'blocked' || packet.egress === 'blocked'
  if (blocked) return assessment(requirement.expectation === 'blocked')
  const forward = packet.forward.routing === 'reachable' && packet.nsg?.forward.outcome === 'allowed'
    && (requirement.packet.target.kind !== 'external' || packet.egress === 'configured')
    && (!['public-ip', 'load-balancer'].includes(requirement.packet.target.kind) || packet.ingress === 'configured')
  if (!forward) return unknown('Forward routing, filtering, mapping or eligible backend configuration is unknown; not a pass or proven blocker.', packet)
  if (requirement.expectation === 'blocked') return assessment(false)
  if (packet.haPorts?.symmetry === 'asymmetric') return assessment(false)
  if (packet.reply.routing === 'unreachable' || packet.nsg?.reply.outcome === 'denied') return assessment(false)
  if (packet.reply.routing !== 'reachable' || packet.nsg?.reply.outcome !== 'allowed') {
    return unknown('A supported symmetric response and its private-tuple filtering are not established.', packet)
  }
  if (required) {
    const selected = packet.loadBalancer?.selected ?? packet.haPorts?.forward[0]?.selected
    const matches = selected ? workloadEndpointKey({ kind: 'workload', ...selected }) === workloadEndpointKey({ kind: 'workload', ...required })
      : packet.forward.steps.some((step) => step.entity.kind === 'workload' && step.entity.id === required.workloadId
        && step.after?.destinationAddress === required.address)
    if (!matches) return assessment(false)
  }
  return assessment(true)
}
