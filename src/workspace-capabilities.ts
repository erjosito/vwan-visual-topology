export const workspaceCapabilities = [
  { feature: 'Virtual hubs, routing preference and routing intent', vwan: true, classic: false, mixed: true },
  { feature: 'VNets, subnets, peerings and UDRs', vwan: false, classic: true, mixed: true },
  { feature: 'Classic gateways, Azure Route Server and appliances', vwan: false, classic: true, mixed: true },
  { feature: 'ExpressRoute, locations, SKU scope and Global Reach', vwan: true, classic: true, mixed: true },
  { feature: 'BGP and static VPN connections', vwan: true, classic: true, mixed: true },
  { feature: 'Bounded classic/VWAN VPN overlap NAT (Azure/Full Hybrid native provider)', vwan: false, classic: true, mixed: true },
  { feature: 'Integrated SD-WAN and spoke NVA BGP peering', vwan: true, classic: false, mixed: true },
  { feature: 'Default, custom and None hub tables; association and propagation', vwan: true, classic: false, mixed: true },
  { feature: 'Single-hub local Firewall static routing and selective bypass', vwan: true, classic: false, mixed: true },
  { feature: 'Case-sensitive inter-hub label propagation', vwan: true, classic: false, mixed: true },
  { feature: 'Hub-owned connection route maps', vwan: true, classic: false, mixed: true },
  { feature: 'Site policies and inbound local preference', vwan: true, classic: true, mixed: true },
  { feature: 'WAN branch-to-branch propagation controls', vwan: true, classic: false, mixed: true },
  { feature: 'Owned workloads, NICs and VNet detail', vwan: true, classic: true, mixed: true },
  { feature: 'Effective routes and independent forward/reply routing', vwan: true, classic: true, mixed: true },
  { feature: 'Diagnostics, failures, practice and capture comparison', vwan: true, classic: true, mixed: true },
  { feature: 'Native JSON, share URLs and bounded Bicep starters', vwan: true, classic: true, mixed: true },
] as const

export const workspaceCapabilityLimits = [
  'Supported means within the documented native model, not verified Azure packet delivery.',
  'Static hub Firewall routing requires one hub and a declared local Firewall. Arbitrary next hops, static branch-to-branch inspection and combinations with routing intent remain unassessed.',
  'Hub route maps are unsupported on integrated SD-WAN. Spoke NVA policies use the hosting VNet connection. Static VPN bypasses BGP policies.',
  'Incomplete or non-converged routing cannot certify reachability or isolation. Aggregate advertisements do not fill holes.',
  'Internet ingress, translator/session behavior, load balancers and NSGs require their separate bounded packet assessment; application delivery is not certified.',
  'Legacy designs retain their native provider and exact IDs. Automatic conversion, unified defaults and selector retirement are separate work.',
] as const
