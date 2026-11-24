import type { HubFirewallPolicy, Topology } from '../model'
import type { PathNode } from '../paths'
import type { AzNetTopology } from '../azure-net/model'
import type { AzEndpointRef, AzSimulationResult } from '../azure-net/engine'
import type { Simulation } from '../routing'
import type { PacketRequest, PacketResult } from '../packet-flow'
import type { WorkloadIpReference } from '../inventory'
import type { VpnNatPacketRequest, VpnNatPacketResult } from '../vpn-nat-packet'
import { VPN_NAT_CAPABILITIES } from '../vpn-nat'
import { workspaceCapabilities, workspaceCapabilityLimits } from '../workspace-capabilities'
import { flowExportLimits } from '../flow-export-options'
import { applicationCapabilities } from '../application-inventory'
import type { ApplicationRequest, ApplicationResult } from '../application'
import type { BgpInspection } from '../bgp-neighbors'
import type { RoutingEvidenceEnvelope, RoutingLimitation } from '../routing-evidence'

export const contractVersion = 1 as const
export const latestContractVersion = 2 as const
export const supportedContractVersions = [contractVersion, latestContractVersion] as const
export const platformModes = ['vwan', 'hub-spoke', 'full'] as const
export const platformOperations = ['validate', 'simulate', 'evaluate', 'application'] as const
export const engineVersion = '2026.11.24.1'
export type PlatformMode = typeof platformModes[number]
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
  applianceChain?: { forward: string[]; reverse: string[] }
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
  contractVersion: typeof supportedContractVersions[number]
  engineVersion?: string
  document: PlatformDocument
  operation: typeof platformOperations[number]
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
  coverage?: RoutingEvidenceEnvelope
}
export type PlatformResult = {
  contractVersion: 1 | 2
  engineVersion: string
  revision: string
  status: 'complete' | 'invalid' | 'not assessed'
  document?: PlatformDocument
  simulation?: Simulation | AzSimulationResult
  bgpNeighbors?: BgpInspection
  assessments: Assessment[]
  errors: { code: string; message: string }[]
  limitations: string[]
  routingLimitations?: RoutingLimitation[]
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
  contractVersion: latestContractVersion, supportedContractVersions, engineVersion,
  modes: platformModes,
  topologyVersions: { vwan: 1, 'hub-spoke': 2, full: 2 },
  operations: platformOperations,
  application: applicationCapabilities,
  bgpNeighbors: {
    evidence: 'bgpNeighbors', version: 1, provenance: 'simulation',
    scope: 'Stable original resource, modeled speaker, relationship and directional session identities. Select exactly one local resource/instance before reading neighbors.',
    routes: 'Logical relationship candidates and distinct-prefix counts, not measured per-instance advertisements/counters. Received post-policy, advertised candidates and peer-received post-policy scopes remain distinct.',
    supported: ['both documented ARS speakers per configured NVA', 'explicit standalone VPN active/active or single-active perspective', 'logical site relationships'],
    unknown: ['managed ER/VWAN and gateway/ARS internal endpoint/session mappings', 'unspecified legacy VPN speaker multiplicity', 'physical Azure instance IDs', 'actual BGP establishment/FSM/uptime/counters', 'per-instance route divergence and failures'],
  },
  routingEvidence: {
    evidence: 'routingLimitations and assessments[].coverage', modes: ['hub-spoke', 'full'],
    scope: 'Exact owned subnet/hub route assertions, original owner IDs, operation-specific limitations and admitted document revision.',
    completeness: 'Unclassified warnings and nonconvergence fail closed. Qualified component scopes conservatively include configured relationships, including disabled ones. Complete evaluation means requested assertions were assessed, not that the whole topology or live Azure is certified.',
    unchanged: ['native directional flow/packet completeness gates', 'Firewall ownership', 'prose/severity/acknowledgement do not authorize grading'],
  },
  rendering: {
    formats: ['gif', 'svg', 'png'], durationsMs: [1500, 2000], ...flowExportLimits,
    source: 'Existing flow assessment handle and exact assessmentId; independent per-leg trace evidence and topology revision.',
    view: 'Shared logical forwarding scene; expanded Firewall hops, direction colors and stopped/unknown states. Not a screenshot of the interactive canvas.',
    artifacts: 'Process-local, expiring, bounded base64 byte chunks. No arbitrary paths, URLs, uploads or file writes.',
    limits: { maxConcurrent: 1, maxRetained: 4, maxMillis: 30000, lifetimeSeconds: 600 },
  },
  mixedRouting: ['native hub tables/association/propagation', 'shared VWAN HRP selection', 'hub-owned and site-owned route maps',
    'integrated SD-WAN and original spoke NVA BGP peers', 'static VPN and converged mixed ER exports',
    'site inbound local preference', 'WAN branch export/default/learning controls'],
  gatewayCoexistence: {
    modes: ['hub-spoke', 'full'], scope: 'Standalone ER/private-peering and S2S VPN gateways in one VNet; not Virtual WAN managed gateway controls.',
    configuration: 'Optional gateway sku, vpnType (RouteBased/PolicyBased) and vpnGatewayGeneration (Generation1/Generation2); omitted capture/legacy fields remain unknown. Basic, PolicyBased and GatewaySubnet /28 or longer are unsupported for coexistence.',
    routing: 'No-ARS equal-prefix ER preference, longest-prefix match and steady-state withdrawal/restoration. Same-VNet ARS branch-to-branch exchanges NVA/gateway and opposite-kind ER/VPN gateway routes; VPN requires explicit active/active and ASN 65515, but does not require VPN BGP enablement. Static VPN site prefixes can be exchanged.',
    unknown: ['live establishment/convergence/failover timing', 'Microsoft-peering failover', 'VPN Internet underlay reachability',
      'SKU regional availability/capacity and deployment readiness', 'IPsec traffic-selector enforcement', 'unknown gateway prerequisites'],
    boundaries: 'Azure outbound ER preference does not set site return policy. Configure site inbound local preference explicitly. ARS does not provide ER circuit-to-circuit transit; use Global Reach.',
  },
  subnetPeering: {
    modes: ['hub-spoke', 'full'], topologyVersion: 2,
    field: 'vnetPeerings[].scope: {type:whole-vnet} or {type:subnets,subnetAIds:originalIds[],subnetBIds:originalIds[]}; omitted scope preserves legacy whole-VNet peering.',
    scope: 'Direct IPv4 owned-subnet forwarding. Current documented preview exposes remote participating-subnet routes even in unselected local subnets; forwarding still requires participation on both ends. Not NSG enforcement or peering-route suppression.',
    constraints: 'One link per VNet pair; 1-200 unique owned subnet IDs per side; at most 1,000 remote participating subnets per VNet; participating address spaces must be unique across peerings.',
    export: 'Mirrored peerCompleteVnets=false/localSubnetNames/remoteSubnetNames on API 2024-05-01. Type changes require Azure deletion/recreation; membership edits require update/sync. Capture requires matching explicit scopes on both directions.',
    excluded: ['IPv6', 'gateway/ARS/VWAN/appliance transit composition', 'private endpoints', 'delegated-subnet over-advertisement',
      'verified subscription allowlisting or VM SKU readiness', 'AVNM connected-group orchestration', 'live Azure enablement'],
  },
  nvaBgp: {
    modes: ['hub-spoke', 'full'], evidence: 'simulation.nvaBgpPeers[originalApplianceId][]',
    scope: 'Original ARS/VNet and NVA/VNet identities, per-peer received candidates, explicit availability, supported outbound policy scope and receiving-AS loop rejection.',
    selection: 'selectedByArs is the exporting ARS selection, not an NVA best path. Distinct same-prefix candidates from different peers are retained.',
    reflection: 'Different-VNet NVA reflection requires exporting ARS branchToBranchTraffic. Disabling it preserves peer availability, ARS inbound learning, local NIC programming and connected VNet advertisements. Same-VNet flag behavior is not assessed; legacy prefix eligibility is retained.',
    attributes: 'Received different-VNet BGP-NVA candidates prepend ARS ASN 65515 after outbound policy. sourceRoute retains the separate ARS-learned source identity/path/next hop before outbound policy. Wire next-hop IP is explicitly not-assessed: the model has no managed endpoint bindings. Same-VNet and gateway-source wire AS paths are omitted as not-assessed. Captured native endpoint/path/next-hop observations remain separate, never assigned to modeled roles.',
    policyProjection: 'routeServerOutbound is a source-side policy/SDN projection, not receiver wire attributes. VNet-scoped SDN propagation and NVA BGP eligibility are distinct.',
    gatewaySummaries: 'When the exporting VNet configures summarizedGatewayPrefixes, each peer carries gatewaySummaryAssessment.status=not-assessed with original configuration/prerequisite identities. Received candidates cannot establish presence or absence of those summaries. Gateway-to-on-premises documentation does not qualify ARS-to-NVA behavior.',
    excluded: ['NVA best-path selection or forwarding from received candidates', 'unmodeled gateway summaries', 'ARS neighbor IPs',
      'native per-instance sessions and counters', 'live adjacency', 'vendor-specific per-neighbor configuration'],
  },
  orderedApplianceChains: {
    modes: ['hub-spoke', 'full'], field: 'applianceChain', expectation: 'allow',
    scope: 'Explicit forward and reverse ordered subsequences of complete delivered original-appliance traces; 1-16 distinct IDs per leg.',
    excluded: ['unknown owners', 'legacy waypoint combinations', 'HA health/orchestration', 'vendor internals', 'live security rules or sessions'],
  },
  haPorts: {
    modes: ['hub-spoke', 'full'], topologyVersion: 2,
    scope: 'One internal Standard LB/frontend/pool and floating HA-ports rule; original single-NIC/single-IP NVA backends; one UDR steering boundary per leg toward an owned destination.',
    declaration: 'inventory.loadBalancers[].rules[].haPortsForwarding: preserve-tuple; HA ports true, Floating IP true, protocol all and ports 0.',
    selection: 'Declared health and independent probe NSGs; unknown eligibility fails closed. Stable original-ID selection, not Azure hashing. Forwarding-disabled backends are not silently replaced.',
    evidence: 'Native hops[].haPorts; packet.haPorts forward/reply original frontend/rule/pool/backend identities, probe evidence and independently checked symmetry.',
    excluded: ['nonfloating HA ports', 'direct frontend destination/ordinary DNAT', 'multiple LB/frontend/pool or multi-NIC/multi-IP backend layouts',
      'additional backend NAT policies', 'Internet egress', 'live probes/convergence', 'guest OS readiness', 'session replication/continuity'],
  },
  staticHubFirewall: {
    scope: 'Single hub, declared original hub.firewall ID/name, CIDR/ResourceId routes to that ID only. With routing intent, only defaultRouteTable Firewall statics are supported.',
    forwarding: 'Longest prefix, then static over learned for equal prefixes; independent local-connection Firewall onward and return lookups.',
    assertions: 'flow firewallPolicy: {hubId, forward: required|bypassed, reverse: required|bypassed}, with expectation allow.',
    excluded: ['multi-hub static inspection', 'static branch-to-branch inspection', 'arbitrary IP/resource next hops and spoke NVAs',
      'routing intent with custom tables or VNet-connection hub next hops', 'unobserved capture reconstruction', 'Firewall policy, sessions, packet/application delivery'],
  },
  workspace: { capabilities: workspaceCapabilities, limitations: workspaceCapabilityLimits },
  vpnOverEr: {
    modes: ['hub-spoke', 'full'], topologyVersion: 2,
    scope: 'Classic active/standby RouteBased VPN with explicit Standard public-IP capability, owned private endpoints and selected same-circuit ER links.',
    routing: 'Declared independent outer ER routing context; all private overlays withdrawn for endpoint lookup. Inner workloads retain normal routing and site policies; direct ER fallback is not IPsec.',
    evidence: 'simulation.vpnUnderlays[connectionId]; assessments[].evidence.forward/reverse.vpnProtection and named outer contexts in VPN trace hops.',
    excluded: ['static VPN overlay', 'active/active endpoint ownership', 'VPN NAT composition', 'Virtual WAN/NVA/SD-WAN private overlay',
      'actual on-prem underlay context configuration', 'IKE/IPsec SAs, crypto correctness, packet delivery, MTU/MSS, throughput and convergence'],
  },
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
      'no Basic/Gateway/global LB, general HA ports/Floating IP/DSR OS support beyond the explicit haPorts slice, private-backend hairpin, live health/session migration or extra ingress translation stages'] },
  requirements: ['flow: owned IPv4 endpoints, allow/deny, return path, modeled inspection', 'route: exact-prefix presence/absence in owned subnet tables or explicit hub table scope, subject to complete modeled coverage',
    'packet: bound original IPv4 endpoints/backend, configured routing/filtering/translation and conditional response or proven initiation blocker; not runtime delivery/health certification'],
  outcomes: ['satisfied', 'violated', 'not assessed'],
  limits: platformLimits,
  privacy: 'Local deterministic computation. No HTTP listener, files, Azure credentials or cloud calls. An external AI may receive tool inputs/results.',
  excluded: ['elapsed Azure convergence/history', 'guest/firewall rules and live dynamic NAT/session enforcement', 'application or packet delivery', 'unobserved imported controls', 'identity and verified badges'],
}
