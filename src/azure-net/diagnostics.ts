import { cidr, contains, ipv4 } from '../validation'
import {
  checkErLocationAzureRegionAccess,
  findApplianceByIp,
  firstUsableIp,
  getActivePeeringBetween,
  lookupSubnetEffectiveRoute,
  traceAzNetPair,
  type AzEndpointRef,
  type AzSimulationResult,
} from './engine'
import type { AzNetTopology } from './model'
import { azEndpointKey, getAzNetEndpoints, type AzEndpointOption } from './endpoints'

export type AzDiagnosticSeverity = 'error' | 'warning' | 'info'

export type AzDiagnosticCategory =
  | 'gateway-subnet-missing-udr'
  | 'gateway-subnet-bgp-disabled'
  | 'bgp-routes-suppressed'
  | 'bgp-lpm-bypasses-udr'
  | 'peering-lpm-bypasses-udr'
  | 'expressroute-msee-hairpin'
  | 'er-sku-regional-mismatch'
  | 'subnet-default-outbound-disabled'
  | 'subnet-internet-bypasses-firewall'
  | 'ars-default-route-self-loop'
  | 'udr-vng-vnet-transit'
  | 'peering-forwarded-traffic-blocked'
  | 'vnra-peering-access-disabled'
  | 'peering-non-transitive-next-hop'
  | 'remote-gateway-transit-mismatch'
  | 'peering-use-remote-gateways-conflict'
  | 'spoke-onprem-gateway-transit-disabled'
  | 'private-endpoint-udr-bypass'
  | 'gateway-prefix-summary'
  | 'ars-configuration'
  | 'appliance-ip-forwarding-disabled'
  | 'asymmetric-firewall-bypass'
  | 'connectivity-failure'
  | 'scale-limit'

export interface AzDiagnosticFinding {
  id: string
  severity: AzDiagnosticSeverity
  category: AzDiagnosticCategory
  title: string
  summary: string
  remediation: string
  vnetId?: string
  subnetId?: string
  peeringId?: string
  applianceId?: string
  erLocationId?: string
  erLinkId?: string
  sampleFlow?: {
    source: AzEndpointRef
    sourceIp: string
    destination: AzEndpointRef
    destinationIp: string
  }
  sourceKey?: string
  destinationKey?: string
  causeKey?: string
  causeTitle?: string
  occurrences?: AzDiagnosticFinding[]
}

export function groupAzNetFindings(findings: AzDiagnosticFinding[]): AzDiagnosticFinding[] {
  const groups = new Map<string, AzDiagnosticFinding[]>()
  for (const finding of findings) {
    const category = finding.category === 'gateway-subnet-missing-udr' ? 'asymmetric-firewall-bypass' : finding.category
    const key = finding.causeKey ? `${category}:${finding.causeKey}` : finding.id
    groups.set(key, [...(groups.get(key) ?? []), ...(finding.occurrences ?? [finding])])
  }
  return [...groups].map<AzDiagnosticFinding>(([key, entries]) => {
    const members = [...new Map(entries.map((entry) => [entry.id, entry])).values()]
    const first = members.find((entry) => entry.category === 'asymmetric-firewall-bypass') ?? members[0]
    return {
      ...first,
      id: first.causeKey ? `cause:${key}` : first.id,
      title: first.causeTitle ?? first.title,
      severity: members.some((entry) => entry.severity === 'error') ? 'error'
        : members.some((entry) => entry.severity === 'warning') ? 'warning' : 'info',
      remediation: members.find((entry) => entry.category === 'gateway-subnet-missing-udr')?.remediation ?? first.remediation,
      occurrences: members,
    }
  })
}

export function azFindingImpact(findings: AzDiagnosticFinding[], endpoints: AzEndpointOption[]) {
  const pairs = new Set<string>(), workloads = new Set<string>(), sites = new Set<string>(), prefixes = new Set<string>()
  for (const finding of findings.flatMap((entry) => entry.occurrences ?? [entry])) {
    const flow = finding.sampleFlow
    if (!flow) continue
    const keys = [finding.sourceKey, finding.destinationKey]
    const refs = [flow.source, flow.destination]
    const ips = [flow.sourceIp, flow.destinationIp]
    const endpointKeys = refs.map((ref, index) => {
      const endpoint = endpoints.find((entry) => keys[index] ? entry.key === keys[index]
        : azEndpointKey(entry.ref) === azEndpointKey(ref) && contains(entry.prefix, ipv4(ips[index]) ?? -1))
      if (ref.kind === 'subnet') workloads.add(azEndpointKey(ref))
      if (ref.kind === 'site') sites.add(ref.siteId)
      if (endpoint) prefixes.add(endpoint.prefix)
      return endpoint?.key ?? `${azEndpointKey(ref)}:${ips[index]}`
    })
    pairs.add(endpointKeys.sort().join('|'))
  }
  return { pairs: pairs.size, workloads: workloads.size, sites: sites.size, prefixes: prefixes.size }
}

export function azFindingFlows(findings: AzDiagnosticFinding[]): AzDiagnosticFinding[] {
  return [...new Map(findings.flatMap((finding) => finding.occurrences ?? [finding])
    .filter((finding) => finding.sampleFlow)
    .map((finding) => {
      const flow = finding.sampleFlow!
      return [JSON.stringify([
        `${azEndpointKey(flow.source)}:${flow.sourceIp}`,
        `${azEndpointKey(flow.destination)}:${flow.destinationIp}`,
      ].sort()), finding] as const
    })).values()]
}

export function runAzNetDiagnostics(
  topology: AzNetTopology,
  simulation: AzSimulationResult,
  options: { includePairAnalysis?: boolean } = {},
): AzDiagnosticFinding[] {
  const findings: AzDiagnosticFinding[] = []

  // 1. Check GatewaySubnet BGP Propagation Disabled + Missing Spoke UDRs (Asymmetric Firewall Bypass)
  for (const vnet of topology.vnets) {
    const gwSubnet = vnet.subnets.find((s) => s.name === 'GatewaySubnet')
    const hasEnabledGw = vnet.gateways.some((g) => g.enabled)
    const summaries = (vnet.summarizedGatewayPrefixes ?? []).filter((prefix) => typeof prefix === 'string' && cidr(prefix))
    if (summaries.length) {
      const uncovered = vnet.prefixes.filter((prefix) => {
        const parsed = cidr(prefix)
        return parsed && !summaries.some((summary) => cidr(summary)!.length <= parsed.length && contains(summary, parsed.network))
      })
      if (!gwSubnet || !hasEnabledGw || uncovered.length) findings.push({
        id: `gateway-summary:${vnet.id}`,
        severity: 'info',
        category: 'gateway-prefix-summary',
        title: `Advertised gateway prefixes on ${vnet.name}`,
        summary: !gwSubnet || !hasEnabledGw
          ? 'Stored only: this VNet needs GatewaySubnet and an enabled ER/VPN gateway before its summaries take effect. A remote hub ignores this VNet setting.'
          : `Gateway VNet address spaces ${uncovered.join(', ')} are not fully covered and remain individually advertised alongside the configured summaries.`,
        remediation: 'Including the gateway VNet address spaces is recommended. Summaries are advertisements only; real forwarding routes and gateway-transit permissions are still required.',
        vnetId: vnet.id,
      })
    }
    if (gwSubnet && hasEnabledGw) {
      const rt = gwSubnet.routeTableId
        ? topology.udrTables.find((t) => t.id === gwSubnet.routeTableId)
        : undefined
      if (rt?.disableBgpRoutePropagation) {
        findings.push({
          id: `gw-bgp-disabled:${vnet.id}`,
          severity: 'error',
          category: 'gateway-subnet-bgp-disabled',
          title: `GatewaySubnet disables BGP route propagation in ${vnet.name}`,
          summary: `Route table "${rt.name}" attached to ${vnet.name}/GatewaySubnet sets disableBgpRoutePropagation=true. Azure Virtual Network Gateways require BGP route propagation to remain enabled on GatewaySubnet.`,
          remediation: `Set disableBgpRoutePropagation=false on "${rt.name}" and never attach a 0.0.0.0/0 UDR to GatewaySubnet.`,
          vnetId: vnet.id,
          subnetId: gwSubnet.id,
        })
      }

      // Check if Hub has a stateful firewall/NVA and peered spokes use it for egress, but GatewaySubnet lacks a return UDR for a spoke
      const hubFirewall = vnet.appliances.find(
        (a) => a.inspectsTraffic || a.kind === 'azure-firewall',
      )
      if (hubFirewall) {
        const gwTable = simulation.subnetTables[gwSubnet.id]
        const missingSpokes: { spokeName: string; prefix: string; sampleFlow: NonNullable<AzDiagnosticFinding['sampleFlow']> }[] = []

        for (const spoke of topology.vnets) {
          if (spoke.id === vnet.id) continue
          const rel = getActivePeeringBetween(topology, vnet.id, spoke.id)
          if (!rel) continue
          // Does spoke send on-prem traffic through this hub firewall?
          const spokeWorkloadSubnet = spoke.subnets.find(
            (s) => s.name !== 'GatewaySubnet' && s.name !== 'AzureFirewallSubnet' && s.name !== 'RouteServerSubnet',
          )
          if (!spokeWorkloadSubnet) continue
          const spokeRt = spokeWorkloadSubnet.routeTableId
            ? topology.udrTables.find((t) => t.id === spokeWorkloadSubnet.routeTableId)
            : undefined
          const steersViaHubFw = spokeRt?.routes.some(
            (r) => r.enabled && r.nextHopType === 'VirtualAppliance' && r.nextHopIp === hubFirewall.privateIp,
          )
          if (!steersViaHubFw) continue

          for (const prefix of spoke.prefixes) {
            const testIp = firstUsableIp(prefix)
            const gwRoute = gwTable ? lookupSubnetEffectiveRoute(gwTable, testIp) : undefined
            if (gwRoute && gwRoute.nextHopType === 'VNetPeering') {
              const source: AzEndpointRef = { kind: 'subnet', vnetId: spoke.id, subnetId: spokeWorkloadSubnet.id }
              for (const site of topology.sites) {
                const sitePrefix = site.prefixes[0]
                if (!sitePrefix) continue
                const destination: AzEndpointRef = { kind: 'site', siteId: site.id }
                const sourceIp = firstUsableIp(spokeWorkloadSubnet.prefix)
                const destinationIp = firstUsableIp(sitePrefix)
                const pair = traceAzNetPair(topology, simulation, source, sourceIp, destination, destinationIp)
                if (pair.forward.status === 'delivered' && pair.reverse.status === 'delivered' &&
                  pair.forward.traversedApplianceIds.includes(hubFirewall.id) &&
                  !pair.reverse.traversedApplianceIds.includes(hubFirewall.id)) {
                  missingSpokes.push({ spokeName: spoke.name, prefix,
                    sampleFlow: { source, sourceIp, destination, destinationIp } })
                  break
                }
              }
            }
          }
        }

        if (missingSpokes.length > 0) {
          const first = missingSpokes[0]
          findings.push({
            id: `gw-missing-udr:${vnet.id}`,
            severity: 'error',
            category: 'gateway-subnet-missing-udr',
            title: `Asymmetric Firewall Bypass on ${vnet.name}/GatewaySubnet`,
            summary: `Spoke→On-Premises traffic traverses stateful ${hubFirewall.name} (${hubFirewall.privateIp}), but return traffic arriving at ${vnet.name}/GatewaySubnet for ${missingSpokes.map((m) => `${m.spokeName} (${m.prefix})`).join(', ')} matches the System VNetPeering route directly to the spoke—bypassing ${hubFirewall.name} and causing TCP state drops.${rt?.disablePeeringRoutePropagation ? ' No active covering UDR suppresses these peering routes; the configured peering-suppression setting alone does not provide an inspection path.' : ''}`,
            remediation: `Add a UDR on ${rt ? `"${rt.name}"` : `${vnet.name}/GatewaySubnet`} for ${missingSpokes.map((m) => m.prefix).join(', ')} with NextHop = VirtualAppliance (${hubFirewall.privateIp}).`,
            vnetId: vnet.id,
            subnetId: gwSubnet.id,
            applianceId: hubFirewall.id,
            sampleFlow: first.sampleFlow,
            causeKey: JSON.stringify(['inspection-return', [gwSubnet.id], [hubFirewall.id]]),
            causeTitle: `Asymmetric stateful inspection at ${vnet.name}/GatewaySubnet`,
          })
        }
      }
    }
  }

  // Suppression is configuration information, not evidence of failed required connectivity.
  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      if (subnet.name === 'GatewaySubnet') continue
      const table = simulation.subnetTables[subnet.id]
      if (!table || !table.bgpPropagationDisabled || table.suppressedBgpRoutes.length === 0) continue

      const uncoveredPrefixes: string[] = []
      for (const suppressed of table.suppressedBgpRoutes) {
        const testIp = firstUsableIp(suppressed.prefix)
        const activeMatch = lookupSubnetEffectiveRoute(table, testIp)
        if (!activeMatch || activeMatch.nextHopType === 'Internet' || activeMatch.nextHopType === 'None') {
          if (!uncoveredPrefixes.includes(suppressed.prefix)) {
            uncoveredPrefixes.push(suppressed.prefix)
          }
        }
      }

      if (uncoveredPrefixes.length > 0) {
        findings.push({
          id: `bgp-suppressed:${subnet.id}`,
          severity: 'info',
          category: 'bgp-routes-suppressed',
          title: `Gateway routes suppressed on ${vnet.name}/${subnet.name}`,
          summary: `Route table "${table.udrTableName}" suppresses BGP routes by configuration. Prefixes ${uncoveredPrefixes.slice(0, 4).join(', ')} have no active private next hop. This can be intentional isolation; suppression alone is not a fault.`,
          remediation: `Analyze the expected endpoint pairs to verify connectivity. If access is required, enable propagation or configure a valid replacement route.`,
          vnetId: vnet.id,
          subnetId: subnet.id,
        })
      }
    }
  }

  // 3. Check VNet Peering Flags (`allowVirtualNetworkAccess`, `allowForwardedTraffic`, Remote Gateway mismatch)
  for (const peering of topology.vnetPeerings) {
    if (!peering.enabled) continue
    const vnetA = topology.vnets.find((v) => v.id === peering.vnetAId)
    const vnetB = topology.vnets.find((v) => v.id === peering.vnetBId)
    if (!vnetA || !vnetB) continue

    const hasVnra =
      vnetA.appliances.some((a) => a.kind === 'vnra') ||
      vnetB.appliances.some((a) => a.kind === 'vnra')

    if (!peering.aToB.allowVirtualNetworkAccess || !peering.bToA.allowVirtualNetworkAccess) {
      findings.push({
        id: `peering-access:${peering.id}`,
        severity: 'error',
        category: 'vnra-peering-access-disabled',
        title: hasVnra
          ? `Managed VNRA transit blocked by allowVirtualNetworkAccess=false on "${peering.name}"`
          : `VNet Peering "${peering.name}" has allowVirtualNetworkAccess disabled`,
        summary: `Peering between "${vnetA.name}" and "${vnetB.name}" disables allowVirtualNetworkAccess (${!peering.aToB.allowVirtualNetworkAccess ? `${vnetA.name}→${vnetB.name}` : `${vnetB.name}→${vnetA.name}`}). ${hasVnra ? 'Managed VNRA appliances require allowVirtualNetworkAccess=true on both peering directions or hardware forwarding drops all packets.' : 'System peering routes are removed and cross-VNet traffic is dropped.'}`,
        remediation: `Enable allowVirtualNetworkAccess=true on both directions of peering "${peering.name}".`,
        peeringId: peering.id,
        vnetId: !peering.aToB.allowVirtualNetworkAccess ? vnetA.id : vnetB.id,
      })
    }

    // Check if spoke UDR points to an appliance in the peer VNet (or hub appliance forwards to spoke) while allowForwardedTraffic is false
    for (const [hubVnet, spokeVnet, hubSendFlags, spokeReceiveFlags] of [
      [vnetA, vnetB, peering.aToB, peering.bToA],
      [vnetB, vnetA, peering.bToA, peering.aToB],
    ] as const) {
      if (hubVnet.appliances.length > 0 && !spokeReceiveFlags.allowForwardedTraffic) {
        const maskedByArsGatewayTransit =
          hubSendFlags.allowGatewayTransit &&
          spokeReceiveFlags.useRemoteGateways &&
          Boolean(hubVnet.routeServer?.enabled)
        findings.push({
          id: `peering-fwd:${peering.id}:${spokeVnet.id}`,
          severity: maskedByArsGatewayTransit ? 'info' : 'error',
          category: 'peering-forwarded-traffic-blocked',
          title: maskedByArsGatewayTransit
            ? `allowForwardedTraffic=false on "${spokeVnet.name}" (currently masked by ARS + useRemoteGateways=true)`
            : `allowForwardedTraffic=false on "${spokeVnet.name}" blocks transit from "${hubVnet.name}"`,
          summary: maskedByArsGatewayTransit
            ? `"${hubVnet.name}" hosts transit appliance(s) (${hubVnet.appliances.map((a) => a.name).join(', ')}), and "${spokeVnet.name}" has allowForwardedTraffic=false on peering "${peering.name}". In Azure SDN, active Azure Route Server BGP peering + useRemoteGateways=true currently permits this transit, but disabling useRemoteGateways or ARS will immediately drop all NVA-forwarded packets.`
            : `"${hubVnet.name}" hosts transit appliance(s) (${hubVnet.appliances.map((a) => a.name).join(', ')}), but "${spokeVnet.name}" has allowForwardedTraffic=false on peering "${peering.name}". Packets forwarded by the hub appliance into "${spokeVnet.name}" will be dropped at the VNet boundary.`,
          remediation: `Set allowForwardedTraffic=true on the "${spokeVnet.name}" side of peering "${peering.name}".`,
          peeringId: peering.id,
          vnetId: spokeVnet.id,
        })
      }
    }

    // Check Remote Gateway Transit mismatch
    if (
      (peering.aToB.useRemoteGateways && !peering.bToA.allowGatewayTransit) ||
      (peering.bToA.useRemoteGateways && !peering.aToB.allowGatewayTransit)
    ) {
      findings.push({
        id: `peering-gw-transit:${peering.id}`,
        severity: 'warning',
        category: 'remote-gateway-transit-mismatch',
        title: `Gateway Transit flag mismatch on peering "${peering.name}"`,
        summary: `One VNet sets useRemoteGateways=true while the peer VNet has allowGatewayTransit=false on "${peering.name}". BGP routes from the hub's gateways or Azure Route Server will not propagate across the peering.`,
        remediation: `Enable allowGatewayTransit=true on the hub VNet side and useRemoteGateways=true on the spoke VNet side of "${peering.name}".`,
        peeringId: peering.id,
      })
    }

    // Check Gateway/ARS vs. VNet Peering compatibility rules & spoke-to-onprem connectivity (#48)
    for (const [sideVnet, peerVnet, sideFlags, peerFlags] of [
      [vnetA, vnetB, peering.aToB, peering.bToA],
      [vnetB, vnetA, peering.bToA, peering.aToB],
    ] as const) {
      const sideHasGwOrArs =
        sideVnet.gateways.some((g) => g.enabled) || Boolean(sideVnet.routeServer?.enabled)
      const peerHasGwOrArs =
        peerVnet.gateways.some((g) => g.enabled) || Boolean(peerVnet.routeServer?.enabled)

      if (sideFlags.useRemoteGateways && sideHasGwOrArs) {
        findings.push({
          id: `peering-urg-conflict:${peering.id}:${sideVnet.id}`,
          severity: 'error',
          category: 'peering-use-remote-gateways-conflict',
          title: `Incompatible useRemoteGateways=true on "${sideVnet.name}" (already has local Gateway/ARS)`,
          summary: `VNet "${sideVnet.name}" enables useRemoteGateways=true on peering "${peering.name}" while also hosting its own Virtual Network Gateway or Azure Route Server. Azure prohibits enabling useRemoteGateways on a VNet that has a local gateway or Route Server; remote gateway routes are blocked.`,
          remediation: `Disable useRemoteGateways on "${sideVnet.name}" for peering "${peering.name}" or remove the local Gateway/Route Server from "${sideVnet.name}".`,
          peeringId: peering.id,
          vnetId: sideVnet.id,
        })
      }

      if (sideFlags.allowGatewayTransit && !sideHasGwOrArs) {
        findings.push({
          id: `peering-agt-no-gw:${peering.id}:${sideVnet.id}`,
          severity: 'warning',
          category: 'peering-use-remote-gateways-conflict',
          title: `allowGatewayTransit=true on "${sideVnet.name}" without a Gateway or Route Server`,
          summary: `VNet "${sideVnet.name}" sets allowGatewayTransit=true on peering "${peering.name}", but "${sideVnet.name}" has no enabled VPN/ExpressRoute Gateway or Azure Route Server to share with "${peerVnet.name}".`,
          remediation: `Deploy an ExpressRoute/VPN Gateway or Azure Route Server in "${sideVnet.name}", or disable allowGatewayTransit on "${peering.name}".`,
          peeringId: peering.id,
          vnetId: sideVnet.id,
        })
      }

      // Check if sideVnet is a hub with active BGP S2S VPN / ExpressRoute / ARS connectivity to on-premises,
      // and peerVnet is a spoke without its own on-prem connectivity, but gateway transit is disabled.
      const hubHasBgpOnPrem =
        topology.vpnConnections.some(
          (c) =>
            c.enabled &&
            c.bgpEnabled &&
            c.targetKind === 'vnet-gateway' &&
            sideVnet.gateways.some((g) => g.id === c.targetId && g.enabled),
        ) ||
        topology.erLinks.some(
          (l) =>
            l.enabled &&
            l.targetKind === 'vnet-gateway' &&
            sideVnet.gateways.some((g) => g.id === l.targetId && g.enabled),
        ) ||
        Boolean(sideVnet.routeServer?.enabled && sideVnet.routeServer.branchToBranchTraffic)

      const spokeHasOwnOnPrem =
        peerHasGwOrArs || Boolean(peerVnet.vwanHubAttachment?.enabled)

      if (
        hubHasBgpOnPrem &&
        !spokeHasOwnOnPrem &&
        (!sideFlags.allowGatewayTransit || !peerFlags.useRemoteGateways)
      ) {
        const firstSite = topology.sites[0]
        const spokeSubnet = peerVnet.subnets[0]
        findings.push({
          id: `spoke-onprem-no-transit:${peering.id}:${peerVnet.id}`,
          severity: 'info',
          category: 'spoke-onprem-gateway-transit-disabled',
          title: `Gateway routes are not shared with "${peerVnet.name}" via "${sideVnet.name}"`,
          summary: `Peering "${peering.name}" has ${!sideFlags.allowGatewayTransit && !peerFlags.useRemoteGateways ? 'both allowGatewayTransit and useRemoteGateways disabled' : !sideFlags.allowGatewayTransit ? `allowGatewayTransit=false on "${sideVnet.name}"` : `useRemoteGateways=false on "${peerVnet.name}"`}. This disables gateway route exchange on this peering, but alternate paths or intentional isolation may make this valid.`,
          remediation: `Analyze expected spoke/on-premises connectivity before changing these flags. If this peering must provide gateway transit, enable allowGatewayTransit on the hub and useRemoteGateways on the spoke.`,
          peeringId: peering.id,
          vnetId: peerVnet.id,
          sampleFlow:
            firstSite && spokeSubnet
              ? {
                  source: { kind: 'subnet', vnetId: peerVnet.id, subnetId: spokeSubnet.id },
                  sourceIp: firstUsableIp(spokeSubnet.prefix),
                  destination: { kind: 'site', siteId: firstSite.id },
                  destinationIp: firstUsableIp(firstSite.prefixes[0] ?? '172.16.1.0/24'),
                }
              : undefined,
        })
      }
    }
  }

  // 3b. Check ExpressRoute SKU Regional Compatibility (#44)
  for (const link of topology.erLinks) {
    if (!link.enabled) continue
    const loc = topology.erLocations.find((l) => l.id === link.locationId)
    if (!loc) continue
    if (link.targetKind === 'vnet-gateway') {
      const ownerVnet = topology.vnets.find((v) =>
        v.gateways.some((g) => g.id === link.targetId && g.enabled && g.kind === 'ExpressRoute'),
      )
      const gw = ownerVnet?.gateways.find((g) => g.id === link.targetId)
      if (!ownerVnet || !gw) continue
      const compat = checkErLocationAzureRegionAccess(loc, ownerVnet.region)
      if (!compat.allowed) {
        findings.push({
          id: `er-sku-mismatch:${link.id}`,
          severity: 'error',
          category: 'er-sku-regional-mismatch',
          title: `ExpressRoute ${compat.sku} SKU on "${loc.name}" cannot reach ${ownerVnet.name} (${ownerVnet.region})`,
          summary: `${compat.reason} Link "${link.name}" to gateway "${gw.name}" in VNet "${ownerVnet.name}" (${ownerVnet.region}) cannot exchange BGP routes or forward traffic.`,
          remediation: `Upgrade ExpressRoute circuit "${loc.name}" SKU from ${compat.sku} to ${compat.sku === 'Local' ? 'Standard (same geopolitical region) or Premium (global)' : 'Premium'}, or move "${ownerVnet.name}" to an eligible Azure region (${(compat.peeringEntry?.localAzureRegions ?? []).join(', ') || compat.peeringGeopoliticalRegion || 'same geopolitical region'}).`,
          vnetId: ownerVnet.id,
          erLocationId: loc.id,
          erLinkId: link.id,
        })
      }
    } else if (link.targetKind === 'vwan-hub') {
      const hub = topology.vwanHubs.find((h) => h.id === link.targetId)
      if (!hub) continue
      const compat = checkErLocationAzureRegionAccess(loc, hub.region)
      if (!compat.allowed) {
        findings.push({
          id: `er-sku-mismatch:${link.id}`,
          severity: 'error',
          category: 'er-sku-regional-mismatch',
          title: `ExpressRoute ${compat.sku} SKU on "${loc.name}" cannot reach Virtual WAN Hub "${hub.name}" (${hub.region})`,
          summary: `${compat.reason} Link "${link.name}" to Virtual WAN Hub "${hub.name}" (${hub.region}) cannot exchange BGP routes or forward traffic.`,
          remediation: `Upgrade ExpressRoute circuit "${loc.name}" SKU from ${compat.sku} to ${compat.sku === 'Local' ? 'Standard (same geopolitical region) or Premium (global)' : 'Premium'}.`,
          erLocationId: loc.id,
          erLinkId: link.id,
        })
      }
    }
  }

  // 4. Check Non-Transitive UDR Next-Hop (UDR points to an appliance IP 2+ peering hops away)
  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      if (!subnet.routeTableId) continue
      const rt = topology.udrTables.find((t) => t.id === subnet.routeTableId)
      if (!rt) continue
      for (const udr of rt.routes) {
        if (!udr.enabled || udr.nextHopType !== 'VirtualAppliance' || !udr.nextHopIp) continue
        const target = findApplianceByIp(topology, udr.nextHopIp)
        if (target && target.vnet.id !== vnet.id) {
          const directPeering = getActivePeeringBetween(topology, vnet.id, target.vnet.id)
          if (!directPeering) {
            findings.push({
              id: `non-transitive-udr:${subnet.id}:${udr.id}`,
              severity: 'error',
              category: 'peering-non-transitive-next-hop',
              title: `Non-transitive UDR next hop in ${vnet.name}/${subnet.name}`,
              summary: `UDR "${udr.name}" (${udr.prefix}) in "${rt.name}" points to VirtualAppliance ${udr.nextHopIp} (${target.appliance.name} in "${target.vnet.name}"), which is not directly peered with "${vnet.name}". VNet peering is non-transitive.`,
              remediation: `Point the UDR in "${vnet.name}" to an NVA/Firewall/VNRA in its directly peered hub VNet, and chain a second UDR in that hub VNet toward "${target.vnet.name}".`,
              vnetId: vnet.id,
              subnetId: subnet.id,
            })
          }
        }
      }
    }
  }

  // 5. Check Private Endpoint `/32` System Route overriding Broader Firewall UDR
  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      const peList = subnet.privateEndpoints ?? []
      if (!peList.length) continue
      for (const pe of peList) {
        const peIpNum = ipv4(pe.ipAddress)
        if (peIpNum === undefined) continue

        const bypassedSubnets: string[] = []
        for (const srcVnet of topology.vnets) {
          const connected =
            srcVnet.id === vnet.id || Boolean(getActivePeeringBetween(topology, srcVnet.id, vnet.id))
          if (!connected) continue
          for (const srcSub of srcVnet.subnets) {
            if (srcSub.id === subnet.id || !srcSub.routeTableId) continue
            const table = simulation.subnetTables[srcSub.id]
            if (!table || lookupSubnetEffectiveRoute(table, pe.ipAddress)?.nextHopType !== 'InterfaceEndpoint') continue
            const rt = topology.udrTables.find((t) => t.id === srcSub.routeTableId)
            const coveringUdr = rt?.routes.find(
              (r) =>
                r.enabled &&
                r.nextHopType === 'VirtualAppliance' &&
                cidr(r.prefix) &&
                contains(r.prefix, peIpNum),
            )
            if (coveringUdr) {
              bypassedSubnets.push(`${srcVnet.name}/${srcSub.name}`)
            }
          }
        }

        if (bypassedSubnets.length > 0) {
          findings.push({
            id: `pe-bypass:${pe.id}`,
            severity: 'info',
            category: 'private-endpoint-udr-bypass',
            title: `Private Endpoint ${pe.name} (${pe.ipAddress}/32) bypasses Firewall UDRs`,
            summary: `The /32 InterfaceEndpoint system route for ${pe.name} (${pe.ipAddress}/32) remains active in ${bypassedSubnets.slice(0, 3).join(', ')}. Route-table network policies on ${vnet.name}/${subnet.name} and an active covering UDR at least as specific as the PE-hosting VNet address space are both required to override it. NSG-only policies, default routes and overly broad UDRs do not satisfy these requirements.`,
            remediation: `If inspection is required, enable private endpoint route-table policies ('RouteTableEnabled', or 'Enabled' to retain NSG policies) on ${vnet.name}/${subnet.name} and add an active matching UDR toward the firewall/NVA. A ${pe.ipAddress}/32 UDR satisfies the prefix requirement; 0.0.0.0/0 does not.`,
            vnetId: vnet.id,
            subnetId: subnet.id,
          })
        }
      }
    }
  }

  // 6. Check Azure Route Server & Appliance Configuration
  for (const vnet of topology.vnets) {
    for (const app of vnet.appliances) {
      if (!app.enableIpForwarding) {
        findings.push({
          id: `app-ipfwd:${app.id}`,
          severity: 'error',
          category: 'appliance-ip-forwarding-disabled',
          title: `IP Forwarding is disabled on ${app.name} (${vnet.name})`,
          summary: `Appliance "${app.name}" (${app.privateIp}) has enableIpForwarding=false. Azure's SDN fabric drops any packet destined to an IP not owned by the NIC unless IP forwarding is enabled.`,
          remediation: `Enable IP Forwarding (enableIpForwarding=true) on ${app.name}.`,
          vnetId: vnet.id,
          subnetId: app.subnetId,
          applianceId: app.id,
        })
      }
    }

    const ars = vnet.routeServer
    if (ars && ars.enabled) {
      if (!ars.branchToBranchTraffic && vnet.gateways.some((g) => g.enabled)) {
        findings.push({
          id: `ars-b2b-off:${ars.id}`,
          severity: 'info',
          category: 'ars-configuration',
          title: `Azure Route Server "${ars.name}" has Branch-to-Branch disabled alongside a VNet Gateway`,
          summary: `"${vnet.name}" hosts both Azure Route Server "${ars.name}" and Virtual Network Gateway(s) (${vnet.gateways.map((g) => g.name).join(', ')}), but branchToBranchTraffic=false. ARS will not exchange routes between BGP NVAs and ExpressRoute/VPN gateways.`,
          remediation: `Enable branchToBranchTraffic=true on "${ars.name}" so NVA SD-WAN branches and ExpressRoute/VPN branches exchange routes.`,
          vnetId: vnet.id,
          subnetId: ars.subnetId,
        })
      }

      // Check if an NVA advertises 0.0.0.0/0 to ARS and blackholes its own subnet's Internet route
      for (const appId of ars.peerApplianceIds) {
        const app = vnet.appliances.find((a) => a.id === appId)
        if (!app || !app.bgpEnabled || !(app.advertisedPrefixes ?? []).includes('0.0.0.0/0')) continue
        const appSubnet = vnet.subnets.find((s) => s.id === app.subnetId)
        const appSubTable = simulation.subnetTables[app.subnetId]
        const defaultWinner = appSubTable ? lookupSubnetEffectiveRoute(appSubTable, '8.8.8.8') : undefined
        if (
          defaultWinner &&
          defaultWinner.prefix === '0.0.0.0/0' &&
          (defaultWinner.nextHopResourceId === app.id || defaultWinner.nextHopIp === app.privateIp)
        ) {
          const sampleSpokeSub = topology.vnets
            .filter((v) => v.id !== vnet.id)
            .flatMap((v) => v.subnets.map((s) => ({ vnetId: v.id, subnet: s })))
            .find(
              (x) =>
                x.subnet.name !== 'GatewaySubnet' &&
                x.subnet.name !== 'RouteServerSubnet' &&
                x.subnet.name !== 'AzureFirewallSubnet',
            )
          findings.push({
            id: `ars-default-self-loop:${app.id}`,
            severity: 'error',
            category: 'ars-default-route-self-loop',
            title: `NVA "${app.name}" blackholes its own Internet egress via ARS 0.0.0.0/0 injection`,
            summary: `"${app.name}" (${app.privateIp}) advertises 0.0.0.0/0 to Azure Route Server "${ars.name}". ARS injects 0.0.0.0/0 → ${app.privateIp} into every subnet of "${vnet.name}" — including "${appSubnet?.name ?? app.subnetId}" — overriding the System 0.0.0.0/0 → Internet route and looping outbound Internet traffic back to ${app.name}.`,
            remediation: `Attach a Route Table to "${vnet.name}/${appSubnet?.name ?? app.subnetId}" with a UDR 0.0.0.0/0 → Internet (or set disableBgpRoutePropagation=true on the NVA subnet).`,
            vnetId: vnet.id,
            subnetId: app.subnetId,
            applianceId: app.id,
            ...(sampleSpokeSub
              ? {
                  sampleFlow: {
                    source: { kind: 'subnet', vnetId: sampleSpokeSub.vnetId, subnetId: sampleSpokeSub.subnet.id },
                    sourceIp: firstUsableIp(sampleSpokeSub.subnet.prefix),
                    destination: { kind: 'subnet', vnetId: vnet.id, subnetId: app.subnetId },
                    destinationIp: '8.8.8.8',
                  },
                }
              : {}),
          })
        }
      }
    }

    // Check subnets for (a) More-Specific BGP Routes (/24) bypassing Summary Firewall UDRs (/16)
    // and (b) UDRs using NextHopType=VirtualNetworkGateway for peered Azure VNet destinations
    for (const sub of vnet.subnets) {
      if (
        sub.name === 'GatewaySubnet' ||
        sub.name === 'RouteServerSubnet' ||
        sub.name === 'AzureFirewallSubnet'
      ) {
        continue
      }
      const rt = sub.routeTableId
        ? topology.udrTables.find((t) => t.id === sub.routeTableId)
        : undefined
      if (!rt) continue
      const subTable = simulation.subnetTables[sub.id]

      for (const udr of rt.routes) {
        if (!udr.enabled) continue
        const udrCidr = cidr(udr.prefix)
        if (!udrCidr) continue

        // (a) Check if udr points to VirtualNetworkGateway for another Azure VNet's address space
        if (udr.nextHopType === 'VirtualNetworkGateway') {
          const targetVnet = topology.vnets.find(
            (other) =>
              other.id !== vnet.id &&
              other.prefixes.some((vp) => {
                const vpIp = ipv4(firstUsableIp(vp))
                return vp === udr.prefix || (vpIp !== undefined && contains(udr.prefix, vpIp))
              }),
          )
          if (targetVnet) {
            const dstSub = targetVnet.subnets[0]
            findings.push({
              id: `udr-vng-vnet:${sub.id}:${udr.id}`,
              severity: 'error',
              category: 'udr-vng-vnet-transit',
              title: `UDR "${udr.name}" in ${vnet.name}/${sub.name} uses VirtualNetworkGateway for VNet-to-VNet transit`,
              summary: `Route table "${rt.name}" steers ${udr.prefix} (${targetVnet.name}) to NextHopType=VirtualNetworkGateway. Standalone Azure VPN and ExpressRoute Gateways do not transit traffic between peered spoke VNets and will drop the packet.`,
              remediation: `Change UDR "${udr.name}" (${udr.prefix}) to NextHopType=VirtualAppliance pointing to the Hub NVA/Azure Firewall IP.`,
              vnetId: vnet.id,
              subnetId: sub.id,
              ...(dstSub
                ? {
                    sampleFlow: {
                      source: { kind: 'subnet', vnetId: vnet.id, subnetId: sub.id },
                      sourceIp: firstUsableIp(sub.prefix),
                      destination: { kind: 'subnet', vnetId: targetVnet.id, subnetId: dstSub.id },
                      destinationIp: firstUsableIp(dstSub.prefix),
                    },
                  }
                : {}),
            })
          }
        }

        // (b) Check if a summary VirtualAppliance UDR (e.g. /16) is bypassed by a more-specific BGP route (/24)
        if (
          udr.nextHopType === 'VirtualAppliance' &&
          udr.prefix !== '0.0.0.0/0' &&
          !rt.disableBgpRoutePropagation &&
          subTable
        ) {
          const bypassingBgp = subTable.routes.filter((r) => {
            if (!r.active) return false
            if (r.source !== 'VirtualNetworkGateway' && r.source !== 'RouteServer') return false
            if (r.nextHopIp && r.nextHopIp === udr.nextHopIp) return false
            const rCidr = cidr(r.prefix)
            if (!rCidr || rCidr.length <= udrCidr.length) return false
            const sampleIp = ipv4(firstUsableIp(r.prefix))
            return sampleIp !== undefined && contains(udr.prefix, sampleIp)
          })
          if (bypassingBgp.length > 0) {
            const firstBypass = bypassingBgp[0]
            const sampleDstIp = firstUsableIp(firstBypass.prefix)
            const matchingSite = topology.sites.find((s) =>
              s.prefixes.some((sp) => {
                const ipNum = ipv4(sampleDstIp)
                return ipNum !== undefined && cidr(sp) && contains(sp, ipNum)
              }),
            )
            findings.push({
              id: `bgp-lpm-bypass:${sub.id}:${udr.id}`,
              severity: 'info',
              category: 'bgp-lpm-bypasses-udr',
              title: `More-specific BGP route ${firstBypass.prefix} bypasses summary Firewall UDR ${udr.prefix} in ${vnet.name}/${sub.name}`,
              summary: `Route table "${rt.name}" defines summary UDR ${udr.prefix} → ${udr.nextHopIp}, but disableBgpRoutePropagation=false allows learned BGP route ${firstBypass.prefix} (${firstBypass.nextHopType}) to win by Longest Prefix Match, bypassing the firewall/NVA.`,
              remediation: `Set disableBgpRoutePropagation=true on "${rt.name}" or add a specific ${firstBypass.prefix} → ${udr.nextHopIp} UDR.`,
              vnetId: vnet.id,
              subnetId: sub.id,
              ...(matchingSite
                ? {
                    sampleFlow: {
                      source: { kind: 'subnet', vnetId: vnet.id, subnetId: sub.id },
                      sourceIp: firstUsableIp(sub.prefix),
                      destination: { kind: 'site', siteId: matchingSite.id },
                      destinationIp: sampleDstIp,
                    },
                  }
                : {}),
            })
          }
        }
      }
    }
  }

  // 8b. VNet Peering LPM bypasses broad NVA/Firewall summary UDR (disablePeeringRoutePropagation=false)
  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      if (
        subnet.name === 'GatewaySubnet' ||
        subnet.name === 'RouteServerSubnet' ||
        subnet.name === 'AzureFirewallSubnet'
      ) {
        continue
      }
      const table = simulation.subnetTables[subnet.id]
      if (!table) continue

      const broadApplianceUdrs = table.routes.filter(
        (r) => r.active && r.source === 'User' && r.nextHopType === 'VirtualAppliance',
      )
      if (!broadApplianceUdrs.length) continue

      const activePeeringRoutes = table.routes.filter(
        (r) => r.active && r.source === 'System' && r.nextHopType === 'VNetPeering',
      )
      for (const peerRoute of activePeeringRoutes) {
        const peerCidr = cidr(peerRoute.prefix)
        if (!peerCidr) continue
        const peerIp = firstUsableIp(peerRoute.prefix)
        const peerIpNum = ipv4(peerIp)
        if (peerIpNum === undefined) continue

        const bypassedUdr = broadApplianceUdrs.find((u) => {
          const uCidr = cidr(u.prefix)
          return (
            uCidr &&
            uCidr.length < peerCidr.length &&
            contains(u.prefix, peerIpNum) &&
            !table.routes.some(
              (other) =>
                other.active &&
                other.source === 'User' &&
                cidr(other.prefix)?.length === peerCidr.length &&
                other.prefix === peerRoute.prefix,
            )
          )
        })
        if (bypassedUdr) {
          const targetApp = bypassedUdr.nextHopIp ? findApplianceByIp(topology, bypassedUdr.nextHopIp) : undefined
          if (targetApp && targetApp.vnet.id === peerRoute.nextHopResourceId) continue

          const peerVnet = topology.vnets.find((v) => v.id === peerRoute.nextHopResourceId)
          const peerWorkloadSubnet = peerVnet?.subnets.find(
            (s) =>
              s.name !== 'GatewaySubnet' &&
              s.name !== 'RouteServerSubnet' &&
              s.name !== 'AzureFirewallSubnet',
          )
          findings.push({
            id: `diag:peering-lpm-bypass:${vnet.id}:${subnet.id}:${peerRoute.prefix}`,
            severity: 'info',
            category: 'peering-lpm-bypasses-udr',
            title: `Direct VNet Peering route ${peerRoute.prefix} in ${vnet.name}/${subnet.name} bypasses summary UDR ${bypassedUdr.prefix}`,
            summary: `Subnet ${vnet.name}/${subnet.name} has a summary UDR ${bypassedUdr.prefix} → VirtualAppliance (${bypassedUdr.nextHopIp ?? 'NVA'}), but also has an active direct VNetPeering system route for ${peerRoute.prefix} (${peerRoute.nextHopName ?? 'Peered VNet'}). Longest Prefix Match (LPM) causes traffic to ${peerRoute.prefix} to take the direct VNet peering and bypass the NVA/Firewall.`,
            remediation: `Configure disablePeeringRoutePropagation (Preview) with an active UDR covering ${peerRoute.prefix} on "${table.udrTableName ?? subnet.routeTableId}", remove the direct spoke-to-spoke peering, or add a matching ${peerRoute.prefix} UDR.`,
            vnetId: vnet.id,
            subnetId: subnet.id,
            sampleFlow: peerWorkloadSubnet
              ? {
                  source: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id },
                  sourceIp: firstUsableIp(subnet.prefix),
                  destination: { kind: 'subnet', vnetId: peerVnet!.id, subnetId: peerWorkloadSubnet.id },
                  destinationIp: firstUsableIp(peerWorkloadSubnet.prefix),
                }
              : undefined,
          })
        }
      }
    }
  }

  // 8c. ExpressRoute MSEE Hairpin (two VNets linked to the same ExpressRoute Location without direct VNet Peering)
  for (const loc of topology.erLocations) {
    const vnetLinks = topology.erLinks.filter(
      (l) => l.enabled && l.locationId === loc.id && l.targetKind === 'vnet-gateway',
    )
    if (vnetLinks.length < 2) continue

    for (let i = 0; i < vnetLinks.length; i++) {
      for (let j = i + 1; j < vnetLinks.length; j++) {
        const vnetA = topology.vnets.find((v) => v.gateways.some((g) => g.id === vnetLinks[i].targetId))
        const vnetB = topology.vnets.find((v) => v.gateways.some((g) => g.id === vnetLinks[j].targetId))
        if (!vnetA || !vnetB || vnetA.id === vnetB.id) continue

        const hasActivePeering = Boolean(getActivePeeringBetween(topology, vnetA.id, vnetB.id))
        if (hasActivePeering) continue

        const subA = vnetA.subnets.find(
          (s) => s.name !== 'GatewaySubnet' && s.name !== 'RouteServerSubnet' && s.name !== 'AzureFirewallSubnet',
        )
        const subB = vnetB.subnets.find(
          (s) => s.name !== 'GatewaySubnet' && s.name !== 'RouteServerSubnet' && s.name !== 'AzureFirewallSubnet',
        )
        if (!subA || !subB) continue

        const tableA = simulation.subnetTables[subA.id]
        const destIpB = firstUsableIp(subB.prefix)
        const matchedRouteA = tableA ? lookupSubnetEffectiveRoute(tableA, destIpB) : undefined
        if (matchedRouteA && matchedRouteA.nextHopType === 'VirtualNetworkGateway') {
          findings.push({
            id: `diag:er-msee-hairpin:${loc.id}:${vnetA.id}:${vnetB.id}`,
            severity: 'info',
            category: 'expressroute-msee-hairpin',
            title: `ExpressRoute MSEE Hairpin between ${vnetA.name} and ${vnetB.name} via ${loc.name}`,
            summary: `VNets ${vnetA.name} and ${vnetB.name} are both linked to ExpressRoute location ${loc.name} without direct VNet Peering. Traffic from ${vnetA.name}/${subA.name} to ${vnetB.name}/${subB.name} (${destIpB}) matches BGP route ${matchedRouteA.prefix} → VirtualNetworkGateway and hairpins through the physical ExpressRoute MSEE routers at ${loc.name}, adding latency and consuming ExpressRoute gateway bandwidth.`,
            remediation: `Create a direct VNet Peering between ${vnetA.name} and ${vnetB.name} so VNet-to-VNet traffic stays on the Azure backbone instead of hairpinning at ${loc.name}.`,
            vnetId: vnetA.id,
            subnetId: subA.id,
            sampleFlow: {
              source: { kind: 'subnet', vnetId: vnetA.id, subnetId: subA.id },
              sourceIp: firstUsableIp(subA.prefix),
              destination: { kind: 'subnet', vnetId: vnetB.id, subnetId: subB.id },
              destinationIp: destIpB,
            },
          })
        }
      }
    }
  }

  // 8d. Subnet defaultOutboundAccess=false without explicit 0.0.0.0/0 NVA/Firewall UDR, and Internet bypass of Hub Firewall
  const hubFirewalls = topology.vnets.flatMap((v) =>
    v.appliances.filter((a) => a.kind === 'azure-firewall').map((a) => ({ vnet: v, app: a })),
  )
  for (const vnet of topology.vnets) {
    for (const subnet of vnet.subnets) {
      if (
        subnet.name === 'GatewaySubnet' ||
        subnet.name === 'RouteServerSubnet' ||
        subnet.name === 'AzureFirewallSubnet'
      ) {
        continue
      }
      const table = simulation.subnetTables[subnet.id]
      if (!table) continue

      const internetRoute = lookupSubnetEffectiveRoute(table, '20.50.60.70')
      if (subnet.defaultOutboundAccess === false && internetRoute?.nextHopType === 'Internet') {
        findings.push({
          id: `diag:no-outbound-access:${vnet.id}:${subnet.id}`,
          severity: 'info',
          category: 'subnet-default-outbound-disabled',
          title: `Private Subnet ${vnet.name}/${subnet.name} (defaultOutboundAccess=false) has no explicit Internet egress path`,
          summary: `Subnet ${vnet.name}/${subnet.name} has defaultOutboundAccess=false (Azure's secure-by-default setting retiring implicit outbound SNAT IPs), and its effective route for 0.0.0.0/0 still resolves to System → Internet without a NAT Gateway, Public IP, or 0.0.0.0/0 → VirtualAppliance UDR. Outbound Internet flows will be dropped.`,
          remediation: `Associate a Route Table with a 0.0.0.0/0 → VirtualAppliance (Azure Firewall/NVA) UDR, attach a NAT Gateway, or enable defaultOutboundAccess if direct Internet breakout is intended.`,
          vnetId: vnet.id,
          subnetId: subnet.id,
          sampleFlow: {
            source: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id },
            sourceIp: firstUsableIp(subnet.prefix),
            destination: { kind: 'internet', ip: '20.50.60.70' },
            destinationIp: '20.50.60.70',
          },
        })
      } else if (
        subnet.defaultOutboundAccess !== false &&
        internetRoute?.nextHopType === 'Internet' &&
        hubFirewalls.length > 0 &&
        !vnet.appliances.some((a) => a.kind === 'azure-firewall')
      ) {
        const fw = hubFirewalls[0]
        if (getActivePeeringBetween(topology, vnet.id, fw.vnet.id)) {
          findings.push({
            id: `diag:internet-bypasses-fw:${vnet.id}:${subnet.id}`,
            severity: 'info',
            category: 'subnet-internet-bypasses-firewall',
            title: `Subnet ${vnet.name}/${subnet.name} breaks out directly to Internet, bypassing ${fw.app.name}`,
            summary: `Subnet ${vnet.name}/${subnet.name} is peered with hub ${fw.vnet.name} (which hosts ${fw.app.name} at ${fw.app.privateIp}), but has no 0.0.0.0/0 UDR or BGP default route. Outbound Internet traffic matches System 0.0.0.0/0 → Internet directly instead of being inspected by ${fw.app.name}.`,
            remediation: `Add a 0.0.0.0/0 → VirtualAppliance (${fw.app.privateIp}) UDR on ${vnet.name}/${subnet.name} if central Internet egress inspection is required.`,
            vnetId: vnet.id,
            subnetId: subnet.id,
            sampleFlow: {
              source: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id },
              sourceIp: firstUsableIp(subnet.prefix),
              destination: { kind: 'internet', ip: '20.50.60.70' },
              destinationIp: '20.50.60.70',
            },
          })
        }
      }
    }
  }

  if (options.includePairAnalysis !== false) {
    const analysis = analyzeAzNetConnectivity(topology, simulation, { scope: 'all' })
    findings.push(...analysis.findings.filter((f) =>
      f.category === 'asymmetric-firewall-bypass' &&
      !findings.some((existing) => existing.category === 'gateway-subnet-missing-udr' &&
        existing.sampleFlow?.source.kind === 'subnet' &&
        f.sampleFlow?.source.kind === 'subnet' &&
        existing.sampleFlow.source.vnetId === f.sampleFlow.source.vnetId),
    ))
    if (!analysis.complete) {
      findings.push({
        id: 'pair-analysis-limit',
        severity: 'info',
        category: 'scale-limit',
        title: 'Stateful symmetry analysis is incomplete',
        summary: `Checked ${analysis.checked} of ${analysis.total} representative pairs.`,
        remediation: 'Use selected-pair analysis to inspect the remaining expected flows.',
      })
    }
  }

  return findings
}

export type AzConnectivityScope =
  | { scope: 'all' | 'onprem' | 'landscape' }
  | { scope: 'pair'; sourceKey: string; destinationKey: string }

export const AZ_NET_PAIR_LIMIT = 200

export interface AzConnectivityReport {
  findings: AzDiagnosticFinding[]
  checked: number
  total: number
  complete: boolean
  limitsReached: string[]
  continuation: { status: 'paused' | 'complete' | 'cancelled' | 'capacity' | 'unavailable'; remainingPairs: number }
}

export function analyzeAzNetConnectivity(
  topology: AzNetTopology,
  simulation: AzSimulationResult,
  scope: AzConnectivityScope,
  limit = AZ_NET_PAIR_LIMIT,
): AzConnectivityReport {
  return createAzNetConnectivityAnalysis(topology, simulation, scope).advance({ maxPairs: limit })
}

export function createAzNetConnectivityAnalysis(
  input: AzNetTopology, inputSimulation: AzSimulationResult, inputScope: AzConnectivityScope,
) {
  const { topology, simulation, scope } = structuredClone({ topology: input, simulation: inputSimulation, scope: inputScope })
  const endpoints = getAzNetEndpoints(topology)
  const workloads = endpoints.filter((e) => e.group === 'workload')
  const sites = endpoints.filter((e) => e.group === 'site')
  const findings: AzDiagnosticFinding[] = []
  let total = 0
  let checked = 0

  const check = (a: AzEndpointOption, b: AzEndpointOption) => {
    checked++
    const pair = traceAzNetPair(topology, simulation, a.ref, a.defaultIp, b.ref, b.defaultIp)
    const failed = pair.forward.status !== 'delivered' || pair.reverse.status !== 'delivered'
    if (!failed && pair.symmetricInspection) return
    const vnetId = a.ref.kind === 'subnet' ? a.ref.vnetId : b.ref.kind === 'subnet' ? b.ref.vnetId : undefined
    const siteIp = a.group === 'site' ? ipv4(a.defaultIp) : b.group === 'site' ? ipv4(b.defaultIp) : undefined
    const transitCandidates = siteIp === undefined ? [] : topology.vnetPeerings.filter((p) => {
      if (!p.enabled || (p.vnetAId !== vnetId && p.vnetBId !== vnetId)) return false
      const local = p.vnetAId === vnetId ? p.aToB : p.bToA
      const remote = p.vnetAId === vnetId ? p.bToA : p.aToB
      if (local.useRemoteGateways && remote.allowGatewayTransit) return false
      const hub = topology.vnets.find((v) => v.id === (p.vnetAId === vnetId ? p.vnetBId : p.vnetAId))
      const routes = hub?.gateways.filter((g) => g.enabled).flatMap((g) => simulation.gatewayRibs[g.id] ?? []) ?? []
      if (hub?.routeServer?.enabled) routes.push(...simulation.routeServerRibs[hub.routeServer.id] ?? [])
      return routes.some((r) => r.preferred && cidr(r.prefix) && contains(r.prefix, siteIp))
    })
    const transit = transitCandidates.length === 1 ? transitCandidates[0] : undefined
    const failures = [
      pair.forward.status !== 'delivered' ? `Forward (${a.defaultIp} → ${b.defaultIp}): ${pair.forward.summaryReason}` : '',
      pair.reverse.status !== 'delivered' ? `Return (${b.defaultIp} → ${a.defaultIp}): ${pair.reverse.summaryReason}` : '',
    ].filter(Boolean)
    const unsuppressedPeeringSubnets = new Set(!failed ? [...pair.forward.hops, ...pair.reverse.hops]
      .filter((hop) => hop.matchedRoute?.nextHopType === 'VNetPeering' && hop.subnetId &&
        simulation.subnetTables[hop.subnetId]?.peeringPropagationDisabled)
      .map((hop) => hop.subnetId!) : [])
    const suppressionExplanation = [...unsuppressedPeeringSubnets].map((id) => {
      const table = simulation.subnetTables[id]
      return `No active covering UDR to suppress VNet peering routes in ${table.vnetName}/${table.subnetName} (${table.udrTableName}); the configured peering-suppression setting alone does not steer traffic through inspection.`
    }).join(' ')
    const bypassAppliances = [...new Set([...pair.forward.traversedApplianceIds, ...pair.reverse.traversedApplianceIds])]
      .filter((id) => pair.forward.traversedApplianceIds.includes(id) !== pair.reverse.traversedApplianceIds.includes(id)).sort()
    const bypassSubnets = [...new Set([...pair.forward.hops, ...pair.reverse.hops]
      .filter((hop) => hop.matchedRoute?.nextHopType === 'VNetPeering' && hop.subnetId)
      .map((hop) => hop.subnetId!))].sort()
    const failuresAt = [
      { trace: pair.forward, destination: b }, { trace: pair.reverse, destination: a },
    ].filter(({ trace }) => trace.status !== 'delivered').map(({ trace, destination }) => {
      const hop = trace.hops.at(-1)
      const route = hop?.matchedRoute ?? [...trace.hops].reverse().find((entry) => entry.matchedRoute)?.matchedRoute
      return [trace.status, hop?.nodeKind, hop?.nodeId, hop?.subnetId, hop?.edgeId,
        route?.id, route?.source === 'User' ? route.prefix : destination.prefix]
    }).map((cause) => JSON.stringify(cause)).sort()
    const causeKey = failed ? JSON.stringify(['failed-routing', [...new Set(failuresAt)]])
      : bypassSubnets.length ? JSON.stringify(['inspection-return', bypassSubnets, bypassAppliances])
        : JSON.stringify(['inspection-path', bypassAppliances, a.key, b.key])
    const causeTable = !failed && bypassSubnets.length === 1 ? simulation.subnetTables[bypassSubnets[0]] : undefined
    findings.push({
      id: `flow:${a.key}:${b.key}`,
      severity: failed ? 'error' : 'warning',
      category: failed ? 'connectivity-failure' : 'asymmetric-firewall-bypass',
      title: `${failed ? 'Connectivity failure' : 'Asymmetric stateful inspection'}: ${a.label} ↔ ${b.label}`,
      summary: failed
        ? failures.join(' ') + (transit && (a.group === 'site' || b.group === 'site')
          ? ` Peering "${transit.name}" does not exchange gateway routes (useRemoteGateways / allowGatewayTransit); check both spoke route learning and on-premises return-prefix advertisements.`
          : '')
        : `Both directions deliver packets but only one traverses ${pair.asymmetricBypassApplianceNames.join(', ')}. Stateful inspection can drop return traffic.${suppressionExplanation ? ` ${suppressionExplanation}` : ''}`,
      remediation: failed
        ? 'Open Trace Flow to inspect the failed hop and matched route in each direction. Restore the required routes, gateway transit/advertisements, peering access, or appliance forwarding; verify any alternate path in both directions.'
        : 'Steer both directions through the same stateful inspection appliances.',
      vnetId: causeTable?.vnetId ?? vnetId,
      subnetId: causeTable?.subnetId ?? (a.ref.kind === 'subnet' ? a.ref.subnetId : b.ref.kind === 'subnet' ? b.ref.subnetId : undefined),
      applianceId: !failed && bypassAppliances.length === 1 ? bypassAppliances[0] : undefined,
      peeringId: failed && (a.group === 'site' || b.group === 'site') ? transit?.id : undefined,
      sourceKey: a.key,
      destinationKey: b.key,
      causeKey,
      causeTitle: failed ? `Connectivity failure at ${[...new Set([pair.forward, pair.reverse]
        .filter((trace) => trace.status !== 'delivered').map((trace) => trace.hops.at(-1)?.nodeName ?? 'the requested endpoint'))].join(', ')}`
        : causeTable ? `Asymmetric stateful inspection at ${causeTable.vnetName}/${causeTable.subnetName}`
          : `Asymmetric stateful inspection through ${pair.asymmetricBypassApplianceNames.join(', ')}`,
      sampleFlow: { source: a.ref, sourceIp: a.defaultIp, destination: b.ref, destinationIp: b.defaultIp },
    })
  }

  const includeWorkloadPairs = scope.scope !== 'onprem'
  const siteCounts = new Map<string, number>()
  for (const site of sites) {
    const key = azEndpointKey(site.ref)
    siteCounts.set(key, (siteCounts.get(key) ?? 0) + 1)
  }
  const sitePairCount = scope.scope === 'landscape'
    ? (sites.length * (sites.length - 1) - [...siteCounts.values()].reduce((sum, count) => sum + count * (count - 1), 0)) / 2
    : 0
  total = scope.scope === 'pair' ? 1 : workloads.length * sites.length +
    (includeWorkloadPairs ? workloads.length * (workloads.length - 1) / 2 : 0) + sitePairCount
  function* pairs(): Generator<[AzEndpointOption, AzEndpointOption]> {
    if (scope.scope === 'pair') {
      const a = endpoints.find((e) => e.key === scope.sourceKey)
      const b = endpoints.find((e) => e.key === scope.destinationKey)
      if (a && b && azEndpointKey(a.ref) !== azEndpointKey(b.ref) && a.group !== 'internet' && b.group !== 'internet') yield [a, b]
      return
    }
    for (let i = 0; i < workloads.length; i++) {
      if (includeWorkloadPairs) {
        for (let j = i + 1; j < workloads.length; j++) yield [workloads[i], workloads[j]]
      }
      for (const site of sites) yield [workloads[i], site]
    }
    if (sitePairCount > 0) {
      for (let i = 0; i < sites.length; i++) {
        for (let j = i + 1; j < sites.length; j++) {
          if (azEndpointKey(sites[i].ref) !== azEndpointKey(sites[j].ref)) yield [sites[i], sites[j]]
        }
      }
    }
  }
  const iterator = pairs()
  let pending = iterator.next()
  let cancelled = false
  const snapshot = (limitsReached: string[] = []): AzConnectivityReport => ({
    findings: structuredClone(findings), checked, total, complete: checked === total && !cancelled,
    limitsReached,
    continuation: {
      status: cancelled ? 'cancelled' : limitsReached.includes('maxStoredFindings') ? 'capacity'
        : !pending.done ? 'paused' : checked === total ? 'complete' : 'unavailable',
      remainingPairs: total - checked,
    },
  })
  return {
    advance(options: { maxPairs?: number; maxMillis?: number } = {}): AzConnectivityReport {
      const maxPairs = options.maxPairs ?? AZ_NET_PAIR_LIMIT, maxMillis = options.maxMillis ?? 5000
      if (!Number.isSafeInteger(maxPairs) || maxPairs < 0 || !Number.isSafeInteger(maxMillis) || maxMillis < 0 || maxMillis > 60000) {
        throw new Error('Invalid connectivity analysis budget.')
      }
      if (cancelled) return snapshot()
      const started = Date.now(), initial = checked, batch = Math.min(AZ_NET_PAIR_LIMIT, maxPairs)
      while (!pending.done) {
        const reached = [
          ...(checked - initial >= batch ? ['maxPairs'] : []),
          ...(Date.now() - started >= maxMillis ? ['maxMillis'] : []),
          ...(findings.length >= 10000 ? ['maxStoredFindings'] : []),
        ]
        if (reached.length) return snapshot(reached)
        check(...pending.value)
        pending = iterator.next()
      }
      return snapshot()
    },
    cancel(): AzConnectivityReport {
      if (!pending.done) {
        cancelled = true
        pending = iterator.return(undefined)
      }
      return snapshot()
    },
  }
}
