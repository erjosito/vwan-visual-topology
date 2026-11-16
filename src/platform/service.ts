import { cidr, ipv4, contains, validateTopology } from '../validation'
import { simulate } from '../routing'
import { analyzeRouting, validateDiagnosticsProfile } from '../diagnostics'
import { parseAzNetTopology } from '../azure-net/admission'
import { validateAzNetTopology } from '../azure-net/model'
import { simulateAzNet, traceAzNetPair } from '../azure-net/engine'
import { getAzNetEndpoints, azEndpointKey } from '../azure-net/endpoints'
import { contractVersion, engineVersion, platformLimits } from './contract'
import type { Assessment, FlowRequirement, PlatformDocument, PlatformRequest, PlatformResult, Requirement } from './contract'
import type { AzEndpointRef } from '../azure-net/engine'
import { tracePacket, validatePacketRequest } from '../packet-flow'

export function admitJson(input: unknown): string {
  let items = 0
  const visit = (value: unknown, depth: number) => {
    if (++items > 100_000 || depth > 32) throw new Error('JSON depth/item limit exceeded.')
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Finite JSON numbers required.')
    if (typeof value === 'string' && (value.length > platformLimits.maxInputBytes || value.includes('\0'))) throw new Error('Invalid JSON string.')
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return
    if (Array.isArray(value)) {
      if (value.length > platformLimits.maxArrayItems) throw new Error('JSON array limit exceeded.')
      if (Object.keys(value).length !== value.length) throw new Error('Dense plain JSON arrays required.')
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !('value' in descriptor)) throw new Error('Unsafe JSON array accessor.')
        visit(descriptor.value, depth + 1)
      }
    } else if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptor)) throw new Error('Unsafe JSON key or accessor.')
        visit(descriptor.value, depth + 1)
      }
    } else throw new Error('Plain JSON data required.')
  }
  visit(input, 0)
  const text = JSON.stringify(input)
  if (new TextEncoder().encode(text).length > platformLimits.maxInputBytes) throw new Error('Input byte limit exceeded.')
  return text
}

export function revisionOf(value: unknown): string {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return `v1-${(hash >>> 0).toString(16)}`
}

export function validateRequest(input: unknown): PlatformRequest {
  const request = JSON.parse(admitJson(input)) as PlatformRequest
  const keys = (value: object, allowed: string[]) => {
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error('Unknown contract field; requirements must not be silently omitted.')
  }
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Request object required.')
  keys(request, ['contractVersion', 'engineVersion', 'document', 'operation', 'locale', 'requirements', 'budget', 'packet'])
  if (request.contractVersion !== contractVersion || (request.engineVersion !== undefined && request.engineVersion !== engineVersion)) throw new Error('Unsupported contract or engine version.')
  if (!['validate', 'simulate', 'evaluate'].includes(request.operation)) throw new Error('Unknown operation.')
  if (request.packet !== undefined) {
    if (request.operation !== 'simulate') throw new Error('Packet tracing requires the simulate operation.')
    validatePacketRequest(request.packet)
  }
  if (!request.document || !['vwan', 'hub-spoke', 'full'].includes(request.document.mode)) throw new Error('Explicit supported mode required.')
  keys(request.document, ['mode', 'topology'])
  if (request.locale !== undefined && !['en', 'ja'].includes(request.locale)) throw new Error('Unsupported locale.')
  if (request.budget !== undefined && (!request.budget || typeof request.budget !== 'object' || Array.isArray(request.budget))) throw new Error('Budget object required.')
  for (const [key, ceiling] of Object.entries({ maxMillis: platformLimits.maxMillis, maxOutputBytes: platformLimits.maxOutputBytes })) {
    const value = request.budget?.[key as 'maxMillis' | 'maxOutputBytes']
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > ceiling)) throw new Error(`Invalid ${key} budget.`)
  }
  if (request.budget && Object.keys(request.budget).some((key) => !['maxMillis', 'maxOutputBytes'].includes(key))) throw new Error('Unknown budget.')
  if (request.operation === 'evaluate' && (!Array.isArray(request.requirements) || !request.requirements.length)) throw new Error('Evaluation requires explicit requirements.')
  if (request.requirements && (!Array.isArray(request.requirements) || request.requirements.length > platformLimits.maxRequirements)) throw new Error('Requirement limit exceeded.')
  const ids = new Set<string>()
  for (const requirement of request.requirements ?? []) {
    if (!requirement || typeof requirement.id !== 'string' || !requirement.id || requirement.id.length > 120 || ids.has(requirement.id)) throw new Error('Unique requirement IDs required.')
    ids.add(requirement.id)
    if (!['flow', 'route'].includes(requirement.kind)) throw new Error('Unsupported requirement kind.')
    keys(requirement, requirement.kind === 'flow'
      ? ['id', 'kind', 'source', 'target', 'sourceAddress', 'destinationAddress', 'expectation', 'requiredFirewallHubId', 'requiredApplianceId']
      : ['id', 'kind', 'table', 'hubTableId', 'prefix', 'expectation'])
    if (requirement.expectation !== (requirement.kind === 'flow' ? 'allow' : 'present') && requirement.expectation !== (requirement.kind === 'flow' ? 'deny' : 'absent')) throw new Error('Invalid expectation.')
    if (requirement.kind === 'route') {
      if (!cidr(requirement.prefix) || typeof requirement.table !== 'string' || !requirement.table || (requirement.hubTableId !== undefined && (typeof requirement.hubTableId !== 'string' || !requirement.hubTableId))) throw new Error('Route requirement needs an exact IPv4 prefix and table ID.')
    } else {
      if (ipv4(requirement.sourceAddress) === undefined || ipv4(requirement.destinationAddress) === undefined) throw new Error('Flow requirement needs IPv4 addresses.')
      if (!requirement.source || !requirement.target) throw new Error('Flow endpoints required.')
      for (const endpoint of [requirement.source, requirement.target]) {
        if (request.document.mode === 'vwan') {
          keys(endpoint, ['kind', 'id'])
          if (!['spoke', 'site', 'hub'].includes(endpoint.kind) || !('id' in endpoint) || typeof endpoint.id !== 'string') throw new Error('Invalid VWAN endpoint.')
        } else {
          if (endpoint.kind === 'subnet') {
            keys(endpoint, ['kind', 'vnetId', 'subnetId'])
            if (typeof endpoint.vnetId !== 'string' || typeof endpoint.subnetId !== 'string') throw new Error('Invalid subnet endpoint.')
          } else if (endpoint.kind === 'site' && 'siteId' in endpoint) {
            keys(endpoint, ['kind', 'siteId'])
            if (typeof endpoint.siteId !== 'string') throw new Error('Invalid site endpoint.')
          } else throw new Error('Only owned subnet/site endpoints are supported for Azure-network assertions.')
        }
      }
      if ([requirement.requiredFirewallHubId, requirement.requiredApplianceId].some((id) => id !== undefined && (typeof id !== 'string' || !id))) throw new Error('Invalid inspection waypoint.')
    }
  }
  return request
}

function normalize(document: PlatformDocument): PlatformDocument {
  const checkNodes = (count: number, inventory?: { workloads: unknown[]; nics: unknown[]; publicIps: unknown[]; natGateways?: unknown[]; publicIpPrefixes?: unknown[];
    networkSecurityGroups?: unknown[]; loadBalancers?: unknown[] }) => {
    if (count + (inventory ? inventory.workloads.length + inventory.nics.length + inventory.publicIps.length
      + (inventory.natGateways?.length ?? 0) + (inventory.publicIpPrefixes?.length ?? 0)
      + (inventory.networkSecurityGroups?.length ?? 0) + (inventory.loadBalancers?.length ?? 0) : 0) > platformLimits.maxNodes) throw new Error('Topology node limit exceeded.')
  }
  if (document.mode === 'vwan') {
    const topology = validateTopology(document.topology)
    checkNodes(topology.hubs.length + topology.spokes.length + topology.sites.length, topology.inventory)
    return { mode: 'vwan', topology }
  }
  const topology = parseAzNetTopology(document.topology)
  const errors = validateAzNetTopology(topology)
  if (errors.length) throw new Error(errors.slice(0, 20).join('\n'))
  checkNodes(topology.vnets.length + topology.sites.length + topology.vwanHubs.length, topology.inventory)
  return { mode: document.mode, topology }
}

const unknown = (requirement: Requirement, reason: string, evidence: unknown = null): Assessment =>
  ({ id: requirement.id, outcome: 'not assessed', reasons: [reason], evidence })

function vwanFlow(document: Extract<PlatformDocument, { mode: 'vwan' }>, requirement: FlowRequirement): Assessment {
  if (requirement.requiredApplianceId) return unknown(requirement, 'Use a VWAN firewall hub ID, not an appliance ID.')
  const profile = validateDiagnosticsProfile({
    version: 1, failureAnalysis: false, intents: [{
      id: requirement.id, source: requirement.source, target: requirement.target,
      sourcePrefix: `${requirement.sourceAddress}/32`, destinationPrefix: `${requirement.destinationAddress}/32`,
      expectation: requirement.expectation,
      ...(requirement.requiredFirewallHubId ? { requiredFirewallHubId: requirement.requiredFirewallHubId } : {}),
    }],
  })
  const report = analyzeRouting(document.topology, profile, { maxCells: 100, maxProbes: 200, maxFindings: 100, maxMillis: 2000 })
  const unknownFindings = report.findings.filter((finding) => finding.confidence === 'unknown')
  if (!report.complete || unknownFindings.length) return unknown(requirement, 'Incomplete ownership, scope or analysis; no passing assessment.', report)
  const success = report.findings.some((finding) => finding.rule === (requirement.expectation === 'allow' ? 'reachable' : 'denied'))
  const violation = report.findings.some((finding) => finding.severity === 'error')
  return { id: requirement.id, outcome: violation ? 'violated' : success ? 'satisfied' : 'not assessed', evidence: report, reasons: report.limitations }
}

export function executePlatform(input: unknown): PlatformResult {
  const result: PlatformResult = { contractVersion, engineVersion, revision: '', status: 'complete', assessments: [], errors: [], limitations: [] }
  try {
    const request = validateRequest(input)
    const document = normalize(request.document)
    result.revision = revisionOf(document)
    result.document = document
    if (request.operation === 'validate') return result
    if (document.mode === 'vwan') {
      const simulation = simulate(document.topology)
      result.simulation = simulation
      if (request.packet) result.packet = tracePacket(document.topology, request.packet, simulation)
      result.limitations = simulation.warnings
      if (!simulation.converged) result.status = 'not assessed'
      for (const requirement of request.requirements ?? []) {
        if (requirement.kind === 'flow') result.assessments.push(vwanFlow(document, requirement))
        else {
          const tableId = requirement.hubTableId ?? 'defaultRouteTable'
          const table = simulation.hubTables?.[requirement.table]?.[tableId]
          const coverage = simulation.hubTableCoverage?.[requirement.table]?.[tableId]
          if (!table || !coverage?.complete || !simulation.converged) result.assessments.push(unknown(requirement, 'Missing or incompletely modeled table.'))
          else {
            const routes = table.filter((row) => row.prefix === requirement.prefix && row.selected.length)
            result.assessments.push({ id: requirement.id, outcome: (!!routes.length === (requirement.expectation === 'present')) ? 'satisfied' : 'violated', evidence: routes, reasons: [] })
          }
        }
      }
    } else {
      const simulation = simulateAzNet(document.topology)
      result.simulation = simulation
      if (simulation.controlPlaneComplete === false) result.status = 'not assessed'
      if (request.packet) result.packet = tracePacket(document.topology, request.packet, simulation)
      result.limitations = simulation.warnings
      const endpoints = getAzNetEndpoints(document.topology).filter((endpoint) => ['workload', 'site'].includes(endpoint.group))
      for (const requirement of request.requirements ?? []) {
        if (requirement.kind === 'route') {
          if (requirement.hubTableId !== undefined) {
            const hub = document.topology.vwanHubs.find((hub) => hub.id === requirement.table)
            const table = hub ? simulation.vwanHubTables[hub.id]?.[requirement.hubTableId] : undefined
            const coverage = hub ? simulation.vwanHubTableCoverage[hub.id]?.[requirement.hubTableId] : undefined
            if (!table || !coverage?.complete || simulation.warnings.length) {
              result.assessments.push(unknown(requirement, 'An owned mixed hub table with complete modeled routing scope is required.'))
            } else {
              const routes = table.filter((route) => route.prefix === requirement.prefix && route.preferred)
              result.assessments.push({ id: requirement.id, outcome: (!!routes.length === (requirement.expectation === 'present')) ? 'satisfied' : 'violated', evidence: routes, reasons: [] })
            }
            continue
          }
          const table = simulation.subnetTables[requirement.table]
          if (!table || simulation.warnings.length) result.assessments.push(unknown(requirement, 'Missing table or model warnings prevent certification.'))
          else {
            const routes = table.routes.filter((route) => route.prefix === requirement.prefix && route.active)
            result.assessments.push({ id: requirement.id, outcome: (!!routes.length === (requirement.expectation === 'present')) ? 'satisfied' : 'violated', evidence: routes, reasons: [] })
          }
          continue
        }
        const source = requirement.source as AzEndpointRef, target = requirement.target as AzEndpointRef
        const owners = (address: string) => endpoints.filter((endpoint) => contains(endpoint.prefix, ipv4(address)!))
        const sourceOwners = owners(requirement.sourceAddress), targetOwners = owners(requirement.destinationAddress)
        if (sourceOwners.length !== 1 || targetOwners.length !== 1
          || azEndpointKey(sourceOwners[0].ref) !== azEndpointKey(source) || azEndpointKey(targetOwners[0].ref) !== azEndpointKey(target)
          || simulation.warnings.length || requirement.requiredFirewallHubId) {
          result.assessments.push(unknown(requirement, 'Ambiguous/missing owned endpoint or unsupported model coverage.'))
          continue
        }
        const pair = traceAzNetPair(document.topology, simulation, source, requirement.sourceAddress, target, requirement.destinationAddress)
        if ([pair.forward, pair.reverse].some((trace) => trace.status === 'not-assessed')) {
          result.assessments.push(unknown(requirement, 'Incomplete mixed hub routing coverage prevents reachability or isolation certification.', pair))
          continue
        }
        const reachable = pair.forward.status === 'delivered' && pair.reverse.status === 'delivered'
        const waypoint = !requirement.requiredApplianceId || [pair.forward, pair.reverse].every((trace) => trace.traversedApplianceIds.includes(requirement.requiredApplianceId!))
        const satisfied = requirement.expectation === 'allow' ? reachable && waypoint : pair.forward.status !== 'delivered'
        result.assessments.push({ id: requirement.id, outcome: satisfied ? 'satisfied' : 'violated', evidence: pair, reasons: [] })
      }
    }
    if (result.assessments.some((assessment) => assessment.outcome === 'not assessed')) result.status = 'not assessed'
  } catch (error) {
    result.status = 'invalid'
    result.errors = [{ code: 'INVALID_REQUEST_OR_TOPOLOGY', message: error instanceof Error ? error.message : 'Invalid request.' }]
    result.simulation = undefined
    result.document = undefined
    result.assessments = []
  }
  return result
}
