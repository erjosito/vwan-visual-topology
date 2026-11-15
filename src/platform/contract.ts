import type { Topology } from '../model'
import type { PathNode } from '../paths'
import type { AzNetTopology } from '../azure-net/model'
import type { AzEndpointRef } from '../azure-net/engine'
import type { PacketRequest, PacketResult } from '../packet-flow'
import { workspaceCapabilities, workspaceCapabilityLimits } from '../workspace-capabilities'

export const contractVersion = 1 as const
export const engineVersion = '2026.11.15.3'
export type PlatformMode = 'vwan' | 'hub-spoke' | 'full'
export type PlatformDocument =
  | { mode: 'vwan'; topology: Topology }
  | { mode: 'hub-spoke' | 'full'; topology: AzNetTopology }
export type Endpoint = PathNode | AzEndpointRef
export type FlowRequirement = {
  id: string
  kind: 'flow'
  source: Endpoint
  target: Endpoint
  sourceAddress: string
  destinationAddress: string
  expectation: 'allow' | 'deny'
  requiredFirewallHubId?: string
  requiredApplianceId?: string
}
export type RouteRequirement = {
  id: string
  kind: 'route'
  table: string
  hubTableId?: string
  prefix: string
  expectation: 'present' | 'absent'
}
export type Requirement = FlowRequirement | RouteRequirement
export type PlatformRequest = {
  contractVersion: 1
  engineVersion?: string
  document: PlatformDocument
  operation: 'validate' | 'simulate' | 'evaluate'
  locale?: 'en' | 'ja'
  requirements?: Requirement[]
  budget?: { maxMillis?: number; maxOutputBytes?: number }
  packet?: PacketRequest
}
export type Assessment = {
  id: string
  outcome: 'satisfied' | 'violated' | 'not assessed'
  evidence: unknown
  reasons: string[]
}
export type PlatformResult = {
  contractVersion: 1
  engineVersion: string
  revision: string
  status: 'complete' | 'invalid' | 'not assessed'
  document?: PlatformDocument
  simulation?: unknown
  assessments: Assessment[]
  errors: { code: string; message: string }[]
  limitations: string[]
  packet?: PacketResult
}

export const platformLimits = {
  maxInputBytes: 4_000_000,
  maxOutputBytes: 8_000_000,
  maxMillis: 15_000,
  maxRequirements: 64,
  maxArrayItems: 4096,
  maxNodes: 512,
  maxConcurrency: 2,
}

export const capabilities = {
  contractVersion, engineVersion,
  modes: ['vwan', 'hub-spoke', 'full'],
  topologyVersions: { vwan: 1, 'hub-spoke': 2, full: 2 },
  operations: ['validate', 'simulate', 'evaluate'],
  mixedRouting: ['native hub tables/association/propagation', 'shared VWAN HRP selection', 'hub-owned and site-owned route maps',
    'integrated SD-WAN and original spoke NVA BGP peers', 'static VPN and converged mixed ER exports',
    'site inbound local preference', 'WAN branch export/default/learning controls'],
  workspace: { capabilities: workspaceCapabilities, limitations: workspaceCapabilityLimits },
  inventory: ['optional original workload/NIC/IP-configuration/public-IP identities', 'explicit detailed subnets on VWAN spokes; no inferred VMs or addresses'],
  packet: { operation: 'simulate', addressFamily: 'IPv4', protocols: ['tcp', 'udp'], ports: '1-65535',
    endpoints: ['owned workload/NIC/IP-configuration tuple', 'explicit external public address'],
    outcomes: ['reachable', 'unreachable', 'not-assessed'], readiness: 'delivery/security/NAT not assessed' },
  requirements: ['flow: owned IPv4 endpoints, allow/deny, return path, modeled inspection', 'route: exact-prefix presence/absence in owned subnet tables or explicit hub table scope, subject to complete modeled coverage'],
  outcomes: ['satisfied', 'violated', 'not assessed'],
  limits: platformLimits,
  privacy: 'Local deterministic computation. No HTTP listener, files, Azure credentials or cloud calls. An external AI may receive tool inputs/results.',
  excluded: ['elapsed Azure convergence/history', 'firewall rules/NAT/session enforcement', 'application or packet delivery', 'unobserved imported controls', 'identity and verified badges'],
}
