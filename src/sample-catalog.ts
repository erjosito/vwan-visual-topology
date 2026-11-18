export type SampleTrackId = 'foundations-selection' | 'security-inspection' | 'hybrid-bgp'
  | 'multi-region-coexistence' | 'routing-traps-diagnostics'
export type SampleDifficulty = 'foundational' | 'intermediate' | 'advanced'

export interface SampleGalleryEntry {
  id: string
  aliases?: readonly string[]
  title: string
  summary: string
  category: 'flagship' | 'validation'
  track: SampleTrackId
  difficulty: SampleDifficulty
  disposition: 'kept' | 'reframed'
  purpose: string
  prerequisites: string
  concepts: readonly string[]
  capabilities: readonly string[]
  limitations: readonly string[]
  suggestedExperiment: string
  curriculum?: { lessonId: string; title: string }
  file?: string
  fullHybridOnly?: boolean
}

export const SAMPLE_TRACKS: readonly { id: SampleTrackId; label: string; description: string }[] = [
  { id: 'foundations-selection', label: 'Route selection foundations', description: 'Compare prefix lengths, route sources and next-hop types.' },
  { id: 'hybrid-bgp', label: 'Hybrid BGP and branch transit', description: 'Compare transport preferences, route propagation and NVA transit.' },
  { id: 'security-inspection', label: 'Inspection and return paths', description: 'Keep outbound and return traffic on the intended inspection path.' },
  { id: 'multi-region-coexistence', label: 'Multi-region and coexistence', description: 'Explore regional transit and mixed network architectures.' },
  { id: 'routing-traps-diagnostics', label: 'Routing traps and diagnostics', description: 'Investigate intentional faults rather than copy a production template.' },
]

export const DIFFICULTY_LABELS: Record<SampleDifficulty, string> = {
  foundational: 'Foundational', intermediate: 'Intermediate', advanced: 'Advanced',
}

const vwanCapabilities = ['Hub effective routes', 'Forward and return paths', 'Route maps']
const azCapabilities = ['Subnet effective routes', 'BGP tables', 'Path and symmetry tracing']
const routingLimits = 'Routing model only: no live Azure deployment, latency measurement or firewall rule evaluation.'
const peeringPrerequisites = 'VNet peering and user-defined routes (UDRs).'
const bgpPrerequisites = 'BGP AS paths, gateways and route propagation.'
const wanPrerequisites = 'Virtual WAN hubs, spoke connections and BGP.'
const gatewayLesson = { lessonId: 'gateway-return', title: 'Incident: the branch cannot reply' }
const prefixLesson = { lessonId: 'prefix-outage', title: 'Incident: only one workload is down' }
const wanLesson = { lessonId: 'secured-wan', title: 'Incident: the secured WAN path' }
const overrideLesson = { lessonId: 'route-override', title: 'Checkpoint: a route overrides peering' }
const hybridLesson = { lessonId: 'hybrid-incident', title: 'Capstone: two faults, one hybrid network' }

export const VWAN_SAMPLE_GALLERY: readonly SampleGalleryEntry[] = [
  {
    id: 'hub-routing-preferences', aliases: ['hrp', 'vwan-hrp', 'routing-preferences'],
    title: 'Hub Routing Preferences (ExpressRoute vs VPN vs AS Path)',
    summary: 'Three hubs compare ExpressRoute, VPN and AS-path preferences for one dual-homed branch.',
    category: 'flagship', track: 'hybrid-bgp', difficulty: 'foundational', disposition: 'kept',
    purpose: 'Start here to explain why identical prefixes can select different transports.',
    prerequisites: bgpPrerequisites, concepts: ['Hub routing preference', 'AS-path length'],
    capabilities: vwanCapabilities, limitations: [routingLimits, 'Preference compares equal prefixes; longest-prefix match still comes first.'],
    suggestedExperiment: 'Inspect the same branch prefix in all three hub BGP tables, then change a hub preference.',
    file: '/docs/samples/hub-routing-preferences.json',
  },
  {
    id: 'secured-hub-routing-intent', aliases: ['routing-intent', 'secured-vwan-hub'],
    title: 'Secured Virtual Hub with Private & Internet Routing Intent',
    summary: 'Compare a secured West Europe hub with an unsecured North Europe hub.',
    category: 'flagship', track: 'security-inspection', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Explain how private and Internet routing intent change inspection waypoints.',
    prerequisites: wanPrerequisites, concepts: ['Routing intent', 'Firewall onward routes'],
    capabilities: vwanCapabilities, limitations: [routingLimits],
    suggestedExperiment: 'Compare hub and firewall routes, then trace a spoke-to-branch flow in each region.',
    curriculum: wanLesson, file: '/docs/samples/secured-hub-routing-intent.json',
  },
  {
    id: 'spoke-bgp-nva-transit', aliases: ['bgp-nva-spoke', 'spoke-nva'],
    title: 'Spoke BGP NVA Transit & Indirect Spoke/Branch Reachability',
    summary: 'A spoke NVA advertises downstream VNet and SD-WAN branch prefixes to the virtual hub.',
    category: 'flagship', track: 'hybrid-bgp', difficulty: 'advanced', disposition: 'kept',
    purpose: 'Distinguish appliance-provided transit from native peering reachability.',
    prerequisites: wanPrerequisites, concepts: ['Spoke BGP NVA', 'Non-transitive peering'],
    capabilities: vwanCapabilities, limitations: [routingLimits, 'Downstream reachability depends on NVA forwarding; VNet peering is not transitive.'],
    suggestedExperiment: 'Inspect NVA advertisements and trace a regular spoke to a downstream prefix.',
    file: '/docs/samples/spoke-bgp-nva-transit.json',
  },
  {
    id: 'default-example', aliases: ['default', 'dual-hub-vwan', 'enterprise-vwan'],
    title: 'Dual-hub Virtual WAN transport reference',
    summary: 'Two regional hubs combine ExpressRoute, VPN, SD-WAN, route maps and spokes.',
    category: 'flagship', track: 'multi-region-coexistence', difficulty: 'intermediate', disposition: 'reframed',
    purpose: 'Explore a broad transport reference after the focused routing-preference example.',
    prerequisites: wanPrerequisites, concepts: ['Inter-hub transit', 'Route maps'],
    capabilities: vwanCapabilities, limitations: [routingLimits, 'A broad reference, not a minimal first exercise or the startup workspace.'],
    suggestedExperiment: 'Inspect a remote branch route and compare its path before and after a route-map edit.',
    curriculum: wanLesson,
  },
  {
    id: 'three-hub-all-features-asymmetric', aliases: ['three-hub-showcase', 'vwan-asymmetric'],
    title: 'Three-hub diagnostic stress case',
    summary: 'Three regional hubs intentionally combine asymmetric inspection and route-map findings.',
    category: 'validation', track: 'routing-traps-diagnostics', difficulty: 'advanced', disposition: 'reframed',
    purpose: 'Investigate interacting routing faults instead of treating an all-features showcase as a clean template.',
    prerequisites: wanPrerequisites, concepts: ['Asymmetric inspection', 'Route maps'],
    capabilities: vwanCapabilities, limitations: [routingLimits, 'Intentional faults; diagnostic coverage can be bounded or unassessed.'],
    suggestedExperiment: 'Run Check routing, inspect a finding and compare its forward and return paths.',
    curriculum: hybridLesson, file: '/docs/samples/three-hub-all-features-asymmetric.json',
  },
]

export const AZURE_NET_SAMPLE_GALLERY: readonly SampleGalleryEntry[] = [
  {
    id: 'subnet-peering', title: 'Selected subnet peering',
    summary: 'Two VNets connect selected subnets while other subnets remain outside the forwarding scope.',
    category: 'validation', track: 'foundations-selection', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Distinguish preview effective-route visibility from permission to cross a subnet peering.',
    prerequisites: 'VNet and subnet address spaces.', concepts: ['Subnet peering', 'Route visibility versus forwarding'],
    capabilities: ['Subnet effective routes', 'Path and symmetry tracing'],
    limitations: ['Direct IPv4 subnet routing only; transit, private endpoints, delegated subnets and live Azure enablement are not assessed.'],
    suggestedExperiment: 'Trace Participating A and Unselected A to Participating B, then edit the participating subnet sets.',
  },
  {
    id: 'hub-spoke-firewall-udr', aliases: ['hub-spoke-firewall', 'azfw-hub-spoke'],
    title: 'Hub-and-Spoke + AzFW + GatewaySubnet UDR',
    summary: 'Classic hub-and-spoke inspection with spoke UDRs, gateway return routes and a private endpoint.',
    category: 'flagship', track: 'security-inspection', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Follow how spoke and gateway route tables cooperate to keep inspection symmetric.',
    prerequisites: peeringPrerequisites, concepts: ['GatewaySubnet UDR', 'Asymmetric inspection'],
    capabilities: azCapabilities, limitations: [routingLimits],
    suggestedExperiment: 'Compare spoke and GatewaySubnet routes, then trace a spoke-to-branch flow both ways.',
    curriculum: gatewayLesson,
  },
  {
    id: 'ars-sdwan-nva-coexistence', aliases: ['ars-sdwan', 'route-server-sdwan'],
    title: 'Azure Route Server + SD-WAN BGP NVA + ER/VPN B2B',
    summary: 'A hub Route Server exchanges routes with an SD-WAN NVA and ExpressRoute/VPN gateways.',
    category: 'flagship', track: 'hybrid-bgp', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Explore branch transit and spoke route propagation across different BGP peers.',
    prerequisites: bgpPrerequisites, concepts: ['Azure Route Server', 'Branch-to-branch transit'],
    capabilities: azCapabilities, limitations: [routingLimits, 'No measured convergence, appliance HA or ECMP traffic distribution.'],
    suggestedExperiment: 'Inspect Route Server routes and toggle branch-to-branch transit before tracing again.',
  },
  {
    id: 'dual-hub-vnra-global-peering', aliases: ['dual-hub-vnra', 'global-peering-udr'],
    title: 'Dual-Region Managed VNRA + Chained Global Peering UDRs',
    summary: 'Regional hub appliances provide transit across global peering using chained UDRs.',
    category: 'flagship', track: 'multi-region-coexistence', difficulty: 'advanced', disposition: 'kept',
    purpose: 'Distinguish direct peering routes from explicitly configured multi-region appliance transit.',
    prerequisites: peeringPrerequisites, concepts: ['Global VNet peering', 'Chained UDRs'],
    capabilities: azCapabilities, limitations: [routingLimits, 'This design uses appliance transit; it is not a statement that global peering forbids gateway transit.'],
    suggestedExperiment: 'Trace an inter-region spoke pair and inspect each appliance next hop and return route.',
  },
  {
    id: 'hybrid-vwan-and-hub-spoke', aliases: ['hybrid-coexistence', 'vwan-hub-spoke-coexistence'],
    title: 'Hybrid Virtual WAN Secured Hub + Classic Hub-and-Spoke',
    summary: 'A secured virtual hub and classic hub-and-spoke network share an ExpressRoute location.',
    category: 'flagship', track: 'multi-region-coexistence', difficulty: 'advanced', disposition: 'kept',
    purpose: 'Inspect routing across coexisting Virtual WAN and classic VNet architectures.',
    prerequisites: wanPrerequisites, concepts: ['Virtual WAN coexistence', 'Shared ExpressRoute location'],
    capabilities: azCapabilities, limitations: [routingLimits, 'Full Hybrid mode only; location-level routing is not a physical circuit or Global Reach simulation.'],
    suggestedExperiment: 'Trace between a classic spoke and a Virtual WAN spoke, then inspect location and hub routes.',
    curriculum: hybridLesson, fullHybridOnly: true,
  },
  {
    id: 'enterprise-vnet-all-features-showcase', aliases: ['enterprise-showcase', 'all-features-vnet'],
    title: 'Multi-region VNet diagnostic stress case',
    summary: 'A dense multi-region fixture combines firewall, Route Server, SD-WAN and private endpoint routing.',
    category: 'validation', track: 'routing-traps-diagnostics', difficulty: 'advanced', disposition: 'reframed',
    purpose: 'Investigate interacting routing faults instead of treating an all-features showcase as a clean template.',
    prerequisites: bgpPrerequisites, concepts: ['Asymmetric inspection', 'Private endpoint routes'],
    capabilities: azCapabilities, limitations: [routingLimits, 'Intentional faults; diagnostic coverage can be bounded or unassessed.'],
    suggestedExperiment: 'Run Advanced checks, inspect a finding and verify the relevant subnet routes.',
    curriculum: hybridLesson,
  },
  {
    id: 'uc1-hub-spoke-nva-ars-baseline', aliases: ['uc1', 'uc1-baseline'],
    title: 'UC1 · Hub & Spoke + NVA + Route Server Baseline',
    summary: 'Focused Route Server and NVA baseline for comparison with fault-injection cases.',
    category: 'validation', track: 'security-inspection', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Use a small control case to compare learned routes and inspection symmetry.',
    prerequisites: bgpPrerequisites, concepts: ['Azure Route Server', 'Gateway transit'],
    capabilities: azCapabilities, limitations: [routingLimits, 'A focused regression fixture, not the broader SD-WAN coexistence reference.'],
    suggestedExperiment: 'Inspect spoke routes and trace the baseline forward and return paths before making an edit.',
    curriculum: gatewayLesson,
  },
  {
    id: 'uc2-gateway-subnet-missing-udr-asymmetry', aliases: ['uc2', 'uc2-missing-udr'],
    title: 'UC2 · GatewaySubnet Missing Return UDR Asymmetry',
    summary: 'A missing gateway return UDR lets inbound traffic bypass the intended inspection path.',
    category: 'validation', track: 'security-inspection', difficulty: 'foundational', disposition: 'kept',
    purpose: 'Isolate why an outbound inspection route alone does not ensure a symmetric return path.',
    prerequisites: peeringPrerequisites, concepts: ['GatewaySubnet UDR', 'Asymmetric inspection'],
    capabilities: azCapabilities, limitations: [routingLimits, 'Outbound spoke routing is already configured; focus on the gateway return path.'],
    suggestedExperiment: 'Trace the asymmetric pair, add the missing GatewaySubnet return UDR and trace again.',
    curriculum: gatewayLesson,
  },
  {
    id: 'uc3-bgp-propagation-and-peering-gates', aliases: ['uc3', 'uc3-peering-gates'],
    title: 'UC3 · BGP Route Propagation & Peering Gates',
    summary: 'Compare BGP propagation settings and peering gateway/forwarding flags.',
    category: 'validation', track: 'hybrid-bgp', difficulty: 'foundational', disposition: 'kept',
    purpose: 'Separate route availability from forwarding permission.',
    prerequisites: peeringPrerequisites, concepts: ['BGP propagation', 'Gateway transit', 'Forwarded traffic'],
    capabilities: azCapabilities, limitations: [routingLimits, 'A forwarding gate can block a flow without removing its effective route.'],
    suggestedExperiment: 'Toggle propagation and peering flags separately; compare both effective routes and traces.',
  },
  {
    id: 'uc4-private-endpoint-udr-override', aliases: ['uc4', 'uc4-private-endpoint'],
    title: 'UC4 · Private Endpoint /32 System Route vs RouteTableEnabled',
    summary: 'Compare private endpoint system routes with subnet route-table policy overrides.',
    category: 'validation', track: 'foundations-selection', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Inspect the special policy conditions for overriding private endpoint routes.',
    prerequisites: peeringPrerequisites, concepts: ['Private endpoint routes', 'Longest-prefix match'],
    capabilities: azCapabilities, limitations: [routingLimits, 'Routing only: no private DNS resolution, service authorization or application availability.'],
    suggestedExperiment: 'Test the endpoint IP in effective routes, toggle its subnet route-table policy and compare the selected next hop.',
    curriculum: prefixLesson,
  },
  {
    id: 'uc5-ars-branch-to-branch-and-bgp-selection', aliases: ['uc5', 'uc5-ars-selection'],
    title: 'UC5 · ARS Branch-to-Branch & Hub Routing Preference',
    summary: 'Focused Route Server transport preference and branch-to-branch selection cases.',
    category: 'validation', track: 'hybrid-bgp', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Compare Route Server selection with the separate Virtual WAN hub-preference reference.',
    prerequisites: bgpPrerequisites, concepts: ['Azure Route Server', 'AS-path length', 'Branch-to-branch transit'],
    capabilities: azCapabilities, limitations: [routingLimits, 'Route Server selection is not a Virtual WAN virtual hub route table.'],
    suggestedExperiment: 'Change Route Server preference, inspect the winning BGP route and test branch transit.',
  },
  {
    id: 'uc6-ars-default-route-self-blackhole', aliases: ['uc6', 'uc6-self-loop'],
    title: 'UC6 · ARS 0.0.0.0/0 NVA Self-Loop Blackhole Trap',
    summary: 'An NVA learns its own advertised default route back on its forwarding subnet.',
    category: 'validation', track: 'routing-traps-diagnostics', difficulty: 'intermediate', disposition: 'kept',
    purpose: 'Explain how route propagation can send an appliance next hop back to itself.',
    prerequisites: bgpPrerequisites, concepts: ['BGP propagation', 'Default-route self-loop'],
    capabilities: azCapabilities, limitations: [routingLimits, 'A default-route self-loop fixture, not a simulation of every appliance forwarding implementation.'],
    suggestedExperiment: 'Inspect the NVA subnet default route, disable BGP propagation there and verify the next hop again.',
    curriculum: overrideLesson,
  },
  {
    id: 'uc7-bgp-lpm-bypasses-summary-udr', aliases: ['uc7', 'uc7-lpm-bypass'],
    title: 'UC7 · BGP /16 LPM Bypassing /8 Summary UDR',
    summary: 'A more-specific BGP route bypasses a broad inspection UDR.',
    category: 'validation', track: 'foundations-selection', difficulty: 'foundational', disposition: 'kept',
    purpose: 'Explain why route-source priority does not override longest-prefix match.',
    prerequisites: 'IPv4 prefixes and basic UDRs.', concepts: ['Longest-prefix match', 'BGP propagation'],
    capabilities: azCapabilities, limitations: [routingLimits, 'Unequal prefix lengths; do not generalize this result to equal-prefix selection.'],
    suggestedExperiment: 'Test an address inside the /16, add a matching inspection UDR and compare the route and path.',
    curriculum: prefixLesson,
  },
  {
    id: 'uc8-udr-next-hop-types-and-vng-transit-trap', aliases: ['uc8', 'uc8-next-hop-types'],
    title: 'UC8 · All 5 UDR Next-Hop Types & VNG Transit Trap',
    summary: 'Compare appliance, local, Internet, blackhole and virtual network gateway next hops.',
    category: 'validation', track: 'foundations-selection', difficulty: 'foundational', disposition: 'kept',
    purpose: 'Start with concrete destination lookups before studying larger transit designs.',
    prerequisites: 'IPv4 prefixes and basic UDRs.', concepts: ['UDR next-hop types', 'Gateway transit'],
    capabilities: azCapabilities, limitations: [routingLimits, 'An intentional None route is a configured blackhole, not an unexplained routing failure.'],
    suggestedExperiment: 'Test a destination in each UDR prefix and compare a deliberate blackhole with a missing gateway-transit path.',
    curriculum: overrideLesson,
  },
  {
    id: 'uc9-expressroute-hairpin-two-vnets', aliases: ['uc9', 'uc9-er-hairpin'],
    title: 'UC9 · Cross-VNet Transit via Shared ExpressRoute Location',
    summary: 'Two unpeered VNets exchange routes through a shared modeled ExpressRoute location.',
    category: 'validation', track: 'multi-region-coexistence', difficulty: 'advanced', disposition: 'kept',
    purpose: 'Distinguish modeled location-level transit from direct VNet peering.',
    prerequisites: bgpPrerequisites, concepts: ['Shared ExpressRoute location', 'Non-transitive peering'],
    capabilities: azCapabilities, limitations: [routingLimits, 'Location-level abstraction only; no physical circuit isolation, Global Reach or measured hairpin cost.'],
    suggestedExperiment: 'Trace between the two VNets and inspect the shared ExpressRoute location BGP table.',
  },
]

const sampleAliases = new Map([...VWAN_SAMPLE_GALLERY, ...AZURE_NET_SAMPLE_GALLERY]
  .flatMap((entry) => [entry.id, ...entry.aliases ?? []].map((id) => [id, entry.id] as const)))

export function resolveSampleIdAlias(requestedId: string): string {
  const normalized = requestedId.trim().toLowerCase()
  return sampleAliases.get(normalized) ?? requestedId.trim()
}
