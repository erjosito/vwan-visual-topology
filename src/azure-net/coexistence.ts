import type { AzDiagnosticFinding } from './diagnostics'
import type { AzNetTopology } from './model'
import { coexistenceChecks } from './coexistence-validation'

export function coexistenceFindings(topology: AzNetTopology): AzDiagnosticFinding[] {
  const remediation = {
    gateway: 'Use a supported non-Basic gateway SKU and RouteBased VPN. Policy-based traffic selectors on a connection do not make a RouteBased gateway PolicyBased. Changing the simulator does not reconfigure Azure.',
    generation: 'VpnGw1/AZ requires Generation1; VpnGw4/5/AZ requires Generation2. VpnGw2/3/AZ supports either generation.',
    subnet: 'Provide GatewaySubnet with an IPv4 /27 or shorter prefix; /28 and longer cannot accommodate coexistence.',
    udr: 'Remove the GatewaySubnet-range/default UDR. For a more-specific overlapping UDR, verify native gateway BGP endpoint reachability; endpoint sessions are not assessed.',
  }
  const errors = coexistenceChecks(topology).map(({ code, ...finding }): AzDiagnosticFinding => ({
    ...finding, category: 'gateway-coexistence', title: `ER/VPN coexistence in ${topology.vnets.find((vnet) => vnet.id === finding.vnetId)!.name}`,
    remediation: remediation[code],
  }))
  return [...errors, ...topology.vnets.flatMap((vnet) => {
    const gateways = vnet.gateways.filter((gateway) => gateway.enabled)
    if (!gateways.some((gateway) => gateway.kind === 'Vpn') ||
      !gateways.some((gateway) => gateway.kind === 'ExpressRoute')) return []
    const findings: AzDiagnosticFinding[] = []
    const add = (key: string, severity: AzDiagnosticFinding['severity'], summary: string, remediation: string, subnetId?: string) =>
      findings.push({
        id: `coexistence:${vnet.id}:${key}`, category: 'gateway-coexistence', severity,
        title: `ER/VPN coexistence in ${vnet.name}`, summary, remediation, vnetId: vnet.id, subnetId,
      })
    for (const gateway of gateways) {
      if (!gateway.sku?.trim()) add(`sku:${gateway.id}`, 'warning',
        `Gateway "${gateway.name}" has an unspecified SKU. Coexistence compatibility is not established by simulated routes.`,
        'Record the actual gateway SKU. Basic is unsupported; verify other SKUs against current product documentation.')
      else if (gateway.sku.trim().toLowerCase() !== 'basic' && !(gateway.kind === 'Vpn' ? /^(VpnGw[1-5](AZ)?|Standard|HighPerformance)$/ : /^(ErGw[1-3]AZ|ErGwScale|Standard|HighPerformance|UltraPerformance)$/i).test(gateway.sku))
        add(`sku:${gateway.id}`, 'warning', `Gateway "${gateway.name}" declares SKU "${gateway.sku}" whose coexistence support is not assessed.`,
          'Check current gateway product documentation. The model preserves unfamiliar SKUs rather than treating every non-Basic name as supported.')
      if (gateway.kind === 'Vpn' && gateway.vpnType === undefined) add(`type:${gateway.id}`, 'warning',
        `VPN gateway "${gateway.name}" has ${gateway.vpnType ?? 'unspecified'} routing type. Coexistence requires RouteBased.`,
        'Record or configure RouteBased. Policy-based traffic selectors on an individual connection do not make a RouteBased gateway PolicyBased.')
    }
    add('scope', 'info',
      'Equal-prefix Azure outbound routes prefer ER; longest-prefix match still permits more-specific VPN routes. This does not configure on-premises return preference or prove symmetry.',
      'Explicitly prefer ER on the site router, for example with inbound local preference. VPN backup covers ER private peering, not Microsoft-peering services. Keep the VPN public-IP underlay Internet-reachable independently of ER; this underlay is not modeled. ER-only and VPN-only sites are not transit-connected by coexistence alone: use same-VNet ARS with branch-to-branch and supported active/active VPN ASN 65515. ARS does not provide ER circuit-to-circuit transit; use Global Reach.')
    return findings
  })]
}
