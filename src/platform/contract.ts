import type { HubFirewallPolicy, Topology } from '../model'
import type { PathNode } from '../paths'
import type { AzNetTopology } from '../azure-net/model'
import type { AzEndpointRef } from '../azure-net/engine'
import type { PacketRequest, PacketResult } from '../packet-flow'
import type { WorkloadIpReference } from '../inventory'
import type { VpnNatPacketRequest, VpnNatPacketResult } from '../vpn-nat-packet'
import { VPN_NAT_CAPABILITIES } from '../vpn-nat'
import { workspaceCapabilities, workspaceCapabilityLimits } from '../workspace-capabilities'
import { applicationCapabilities } from '../application-inventory'
import type { ApplicationRequest, ApplicationResult } from '../application'

export const contractVersion = 1 as const
export const latestContractVersion = 2 as const
export const engineVersion = '2026.11.16.12'
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
  firewallPolicy?: HubFirewallPolicy
}
export type RouteRequirement = {
  id: string
  kind: 'route'
  table: string
  hubTableId?: string
  prefix: string
  expectation: 'present' | 'absent'
}
export type PacketRequirement = {
  id: string
  kind: 'packet'
  packet: PacketRequest
  sourceAddress: string
  destinationAddress: string
  expectation: 'configured' | 'blocked'
  requiredBackend?: WorkloadIpReference & { address: string }
}
export type Requirement = FlowRequirement | RouteRequirement | PacketRequirement
export type PlatformRequest = {
  contractVersion: 1 | 2
  engineVersion?: string
  document: PlatformDocument
  operation: 'validate' | 'simulate' | 'evaluate' | 'application'
  locale?: 'en' | 'ja'
  requirements?: Requirement[]
  budget?: { maxMillis?: number; maxOutputBytes?: number }
  packet?: PacketRequest
  vpnPacket?: VpnNatPacketRequest
  application?: ApplicationRequest
}
export type Assessment = {
  id: string
  outcome: 'satisfied' | 'violated' | 'not assessed'
  evidence: unknown
  reasons: string[]
}
export type PlatformResult = {
  contractVersion: 1 | 2
  engineVersion: string
  revision: string
  status: 'complete' | 'invalid' | 'not assessed'
  document?: PlatformDocument
  simulation?: unknown
  assessments: Assessment[]
  errors: { code: string; message: string }[]
  limitations: string[]
  packet?: PacketResult
  vpnPacket?: VpnNatPacketResult
  application?: ApplicationResult
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
  contractVersion: latestContractVersion, supportedContractVersions: [contractVersion, latestContractVersion], engineVersion,
  modes: ['vwan', 'hub-spoke', 'full'],
  topologyVersions: { vwan: 1, 'hub-spoke': 2, full: 2 },
  operations: ['validate', 'simulate', 'evaluate', 'application'],
  application: applicationCapabilities,
  mixedRouting: ['native hub tables/association/propagation', 'shared VWAN HRP selection', 'hub-owned and site-owned route maps',
    'integrated SD-WAN and original spoke NVA BGP peers', 'static VPN and converged mixed ER exports',
    'site inbound local preference', 'WAN branch export/default/learning controls'],
  staticHubFirewall: {
    scope: 'Single hub, declared original hub.firewall ID/name, routing intent disabled, CIDR/ResourceId routes to that ID only.',
    forwarding: 'Longest prefix, then static over learned for equal prefixes; independent local-connection Firewall onward and return lookups.',
    assertions: 'flow firewallPolicy: {hubId, forward: required|bypassed, reverse: required|bypassed}, with expectation allow.',
    excluded: ['multi-hub static inspection', 'static branch-to-branch inspection', 'arbitrary IP/resource next hops and spoke NVAs',
      'routing intent combined with hub statics', 'unobserved capture reconstruction', 'Firewall policy, sessions, packet/application delivery'],
  },
  workspace: { capabilities: workspaceCapabilities, limitations: workspaceCapabilityLimits },
  vpnNat: { operation: 'simulate', requestField: 'vpnPacket', modes: ['hub-spoke', 'full'], providers: VPN_NAT_CAPABILITIES,
    endpoints: 'One original connectionId, ingress/egress initiation and explicit IPv4 TCP/UDP tuple. Replies are assessed only within that forward request.',
    outcomes: 'Native routing and per-leg translation only; security/application delivery not assessed.' },
  inventory: ['optional original workload/NIC/IP-configuration/public-IP identities', 'explicit detailed subnets on VWAN spokes; no inferred VMs or addresses',
    'optional original subnet/NIC NSG associations and bounded rule declarations',
    'regional Standard Load Balancer frontends, original NIC pools, probes/declared health, ordinary/inbound-NAT/outbound rules and explicit IPv4 primary association'],
  packet: { operation: 'simulate', addressFamily: 'IPv4', protocols: ['tcp', 'udp'], ports: '1-65535',
    endpoints: ['owned workload/NIC/IP-configuration tuple', 'explicit external public address', 'original Standard static public-IP ingress frontend',
      'destination-only original Load Balancer/frontend identity'],
    outcomes: ['reachable', 'unreachable', 'not-assessed'], readiness: 'NSG denial assessed separately; delivery and guest/firewall readiness not assessed',
    nsg: ['ordered subnet/NIC new-flow intersection and first-priority/default-rule evidence',
      'original NVA backing subnet/NIC checks at private pre/post-guest-SNAT tuples',
      'scoped VirtualNetwork/Internet and explicit AzureLoadBalancer probe context',
      'conditional responses, not persistent/live sessions or new reverse initiations',
      'unknown capture/dynamic selectors/illustrative domains remain unassessed'],
    translation: ['explicit direct Standard NAT Gateway and instance public IP', 'declared single-router Firewall network-rule/NVA guest SNAT',
      'classic non-zone-redundant Firewall private handoff to Standard NAT Gateway', 'conditional inverse translation and independently checked router return routes',
      'Standard public VM private-destination mapping', 'explicit single original Firewall/NVA public DNAT with private-tuple filters and response-owner routing',
      'ordinary Standard LB frontend/backend mapping, specific inbound NAT, independent probe/data filtering and illustrative known-eligible selection',
      'public LB explicit/implicit rule SNAT after route selection; below NAT Gateway/instance public IP and distinct from existing ingress response ownership'],
    translationLimits: ['illustrative allocation/ports only', 'unsolicited ingress requires an explicitly selected supported frontend and permission',
      'NAT Gateway cannot publish ingress', 'unknown/multiple router NAT, secured-hub private DNAT interfaces and forced-tunnel translation unassessed',
      'no StandardV2/IPv6/NAT64/application-rule proxy/capacity/timer predictions',
      'no Basic/Gateway/global LB, HA ports/Floating IP/DSR OS support, private-backend hairpin, live health/session migration or extra ingress translation stages'] },
  requirements: ['flow: owned IPv4 endpoints, allow/deny, return path, modeled inspection', 'route: exact-prefix presence/absence in owned subnet tables or explicit hub table scope, subject to complete modeled coverage',
    'packet: bound original IPv4 endpoints/backend, configured routing/filtering/translation and conditional response or proven initiation blocker; not runtime delivery/health certification'],
  outcomes: ['satisfied', 'violated', 'not assessed'],
  limits: platformLimits,
  privacy: 'Local deterministic computation. No HTTP listener, files, Azure credentials or cloud calls. An external AI may receive tool inputs/results.',
  excluded: ['elapsed Azure convergence/history', 'guest/firewall rules and live dynamic NAT/session enforcement', 'application or packet delivery', 'unobserved imported controls', 'identity and verified badges'],
}
