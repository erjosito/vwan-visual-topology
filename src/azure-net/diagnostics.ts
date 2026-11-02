import { cidr, contains, ipv4 } from '../validation'
import {
  findApplianceByIp,
  firstUsableIp,
  getActivePeeringBetween,
  lookupSubnetEffectiveRoute,
  traceAzNetPair,
  type AzEndpointRef,
  type AzSimulationResult,
} from './engine'
import type { AzNetTopology } from './model'

export type AzDiagnosticSeverity = 'error' | 'warning' | 'info'

export type AzDiagnosticCategory =
  | 'gateway-subnet-missing-udr'
  | 'gateway-subnet-bgp-disabled'
  | 'bgp-propagation-blackhole'
  | 'peering-forwarded-traffic-blocked'
  | 'vnra-peering-access-disabled'
  | 'peering-non-transitive-next-hop'
  | 'remote-gateway-transit-mismatch'
  | 'private-endpoint-udr-bypass'
  | 'ars-configuration'
  | 'appliance-ip-forwarding-disabled'
  | 'asymmetric-firewall-bypass'
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
  sampleFlow?: {
    source: AzEndpointRef
    sourceIp: string
    destination: AzEndpointRef
    destinationIp: string
  }
}

export function runAzNetDiagnostics(
  topology: AzNetTopology,
  simulation: AzSimulationResult,
): AzDiagnosticFinding[] {
  const findings: AzDiagnosticFinding[] = []

  // 1. Check GatewaySubnet BGP Propagation Disabled + Missing Spoke UDRs (Asymmetric Firewall Bypass)
  for (const vnet of topology.vnets) {
    const gwSubnet = vnet.subnets.find((s) => s.name === 'GatewaySubnet')
    const hasEnabledGw = vnet.gateways.some((g) => g.enabled)
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
        const missingSpokes: { spokeName: string; prefix: string; spokeVnetId: string; spokeSubnetId: string }[] = []

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
              missingSpokes.push({
                spokeName: spoke.name,
                prefix,
                spokeVnetId: spoke.id,
                spokeSubnetId: spokeWorkloadSubnet.id,
              })
            }
          }
        }

        if (missingSpokes.length > 0) {
          const first = missingSpokes[0]
          const firstSite = topology.sites[0]
          findings.push({
            id: `gw-missing-udr:${vnet.id}`,
            severity: 'error',
            category: 'gateway-subnet-missing-udr',
            title: `Asymmetric Firewall Bypass on ${vnet.name}/GatewaySubnet`,
            summary: `Spoke→On-Premises traffic traverses stateful ${hubFirewall.name} (${hubFirewall.privateIp}), but return traffic arriving at ${vnet.name}/GatewaySubnet for ${missingSpokes.map((m) => `${m.spokeName} (${m.prefix})`).join(', ')} matches the System VNetPeering route directly to the spoke—bypassing ${hubFirewall.name} and causing TCP state drops.`,
            remediation: `Add a UDR on ${rt ? `"${rt.name}"` : `${vnet.name}/GatewaySubnet`} for ${missingSpokes.map((m) => m.prefix).join(', ')} with NextHop = VirtualAppliance (${hubFirewall.privateIp}).`,
            vnetId: vnet.id,
            subnetId: gwSubnet.id,
            applianceId: hubFirewall.id,
            sampleFlow: firstSite
              ? {
                  source: { kind: 'subnet', vnetId: first.spokeVnetId, subnetId: first.spokeSubnetId },
                  sourceIp: firstUsableIp(first.prefix),
                  destination: { kind: 'site', siteId: firstSite.id },
                  destinationIp: firstUsableIp(firstSite.prefixes[0] ?? '172.16.1.0/24'),
                }
              : undefined,
          })
        }
      }
    }
  }

  // 2. Check BGP Propagation Blackhole on Subnets
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
        const firstSite = topology.sites[0]
        findings.push({
          id: `bgp-blackhole:${subnet.id}`,
          severity: 'error',
          category: 'bgp-propagation-blackhole',
          title: `BGP Route Propagation disabled without covering UDR on ${vnet.name}/${subnet.name}`,
          summary: `Route table "${table.udrTableName}" sets disableBgpRoutePropagation=true, suppressing ${table.suppressedBgpRoutes.length} BGP route(s) (${uncoveredPrefixes.slice(0, 4).join(', ')}) without a replacement UDR. Traffic to those private prefixes falls back to System 0.0.0.0/0 → Internet and fails.`,
          remediation: `Either re-enable BGP route propagation on "${table.udrTableName}" or add an explicit UDR (e.g., 0.0.0.0/0 or ${uncoveredPrefixes[0]} → VirtualAppliance) to steer traffic through your NVA/Firewall.`,
          vnetId: vnet.id,
          subnetId: subnet.id,
          sampleFlow: firstSite
            ? {
                source: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id },
                sourceIp: firstUsableIp(subnet.prefix),
                destination: { kind: 'site', siteId: firstSite.id },
                destinationIp: firstUsableIp(uncoveredPrefixes[0]),
              }
            : undefined,
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
    for (const [hubVnet, spokeVnet, spokeReceiveFlags] of [
      [vnetA, vnetB, peering.bToA],
      [vnetB, vnetA, peering.aToB],
    ] as const) {
      if (hubVnet.appliances.length > 0 && !spokeReceiveFlags.allowForwardedTraffic) {
        findings.push({
          id: `peering-fwd:${peering.id}:${spokeVnet.id}`,
          severity: 'error',
          category: 'peering-forwarded-traffic-blocked',
          title: `allowForwardedTraffic=false on "${spokeVnet.name}" blocks transit from "${hubVnet.name}"`,
          summary: `"${hubVnet.name}" hosts transit appliance(s) (${hubVnet.appliances.map((a) => a.name).join(', ')}), but "${spokeVnet.name}" has allowForwardedTraffic=false on peering "${peering.name}". Packets forwarded by the hub appliance into "${spokeVnet.name}" will be dropped at the VNet boundary.`,
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
      const policy = subnet.privateEndpointNetworkPolicies ?? 'Disabled'
      if (policy !== 'Disabled') continue

      // Check if peered spokes or this VNet have a broader UDR (e.g. 10.0.0.0/8 or 0.0.0.0/0 -> Firewall) that covers the PE IP
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
            const rt = topology.udrTables.find((t) => t.id === srcSub.routeTableId)
            const coveringUdr = rt?.routes.find(
              (r) =>
                r.enabled &&
                r.nextHopType === 'VirtualAppliance' &&
                cidr(r.prefix) &&
                cidr(r.prefix)!.length < 32 &&
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
            title: `Private Endpoint ${pe.name} (${pe.ipAddress}/32) bypasses broader Firewall UDRs`,
            summary: `Azure injects a /32 InterfaceEndpoint system route for ${pe.name} (${pe.ipAddress}/32) across "${vnet.name}" and its peered VNets. By Longest Prefix Match, traffic from ${bypassedSubnets.slice(0, 3).join(', ')} goes directly to the Private Endpoint instead of the broader VirtualAppliance UDR.`,
            remediation: `This is standard Azure behavior (avoids hairpinning PaaS traffic through the firewall). If you must force inspection of traffic to ${pe.ipAddress}, set privateEndpointNetworkPolicies='RouteTableEnabled' on ${vnet.name}/${subnet.name} and add a /32 UDR.`,
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
          severity: 'warning',
          category: 'ars-configuration',
          title: `Azure Route Server "${ars.name}" has Branch-to-Branch disabled alongside a VNet Gateway`,
          summary: `"${vnet.name}" hosts both Azure Route Server "${ars.name}" and Virtual Network Gateway(s) (${vnet.gateways.map((g) => g.name).join(', ')}), but branchToBranchTraffic=false. ARS will not exchange routes between BGP NVAs and ExpressRoute/VPN gateways.`,
          remediation: `Enable branchToBranchTraffic=true on "${ars.name}" so NVA SD-WAN branches and ExpressRoute/VPN branches exchange routes.`,
          vnetId: vnet.id,
          subnetId: ars.subnetId,
        })
      }
    }
  }

  // 7. Check Pairwise Stateful Symmetry across Workload Subnets for any subtle bypass not already caught
  const workloadEndpoints: { ref: AzEndpointRef; ip: string; vnetId: string }[] = []
  for (const vnet of topology.vnets) {
    for (const sub of vnet.subnets) {
      if (
        sub.name === 'GatewaySubnet' ||
        sub.name === 'AzureFirewallSubnet' ||
        sub.name === 'RouteServerSubnet' ||
        sub.name === 'VirtualNetworkApplianceSubnet'
      ) {
        continue
      }
      workloadEndpoints.push({
        ref: { kind: 'subnet', vnetId: vnet.id, subnetId: sub.id },
        ip: firstUsableIp(sub.prefix),
        vnetId: vnet.id,
      })
    }
  }

  const alreadyHasGwBypass = new Set(
    findings.filter((f) => f.category === 'gateway-subnet-missing-udr').map((f) => f.vnetId),
  )

  for (let i = 0; i < workloadEndpoints.length; i++) {
    for (let j = i + 1; j < workloadEndpoints.length; j++) {
      const a = workloadEndpoints[i]
      const b = workloadEndpoints[j]
      if (a.vnetId === b.vnetId) continue
      const pair = traceAzNetPair(topology, simulation, a.ref, a.ip, b.ref, b.ip)
      if (
        pair.forward.status === 'delivered' &&
        pair.reverse.status === 'delivered' &&
        !pair.symmetricInspection
      ) {
        const key = `asym:${a.vnetId}:${b.vnetId}`
        if (!findings.some((f) => f.id === key) && !alreadyHasGwBypass.has(a.vnetId) && !alreadyHasGwBypass.has(b.vnetId)) {
          findings.push({
            id: key,
            severity: 'warning',
            category: 'asymmetric-firewall-bypass',
            title: `Asymmetric stateful inspection between ${a.ip} and ${b.ip}`,
            summary: `Forward and reverse paths between ${a.ip} and ${b.ip} do not traverse the same stateful appliance(s): ${pair.asymmetricBypassApplianceNames.join(', ')}. Stateful firewalls will drop return packets without matching session state.`,
            remediation: `Ensure both directions of the UDR tables steer traffic symmetrically through the same stateful firewall/NVA.`,
            vnetId: a.vnetId,
            sampleFlow: {
              source: a.ref,
              sourceIp: a.ip,
              destination: b.ref,
              destinationIp: b.ip,
            },
          })
        }
      }
    }
  }

  return findings
}
