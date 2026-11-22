import type { AzDiagnosticFinding } from './diagnostics'
import { coexistenceChecks, type AzNetTopology } from './model'

export function basicGatewayFix(topology: AzNetTopology, finding: AzDiagnosticFinding) {
  if (finding.category !== 'gateway-coexistence' || finding.severity !== 'error') return undefined
  const vnet = topology.vnets.find((vnet) => vnet.id === finding.vnetId)
  if (!vnet?.gateways.some((gateway) => gateway.enabled && gateway.kind === 'Vpn') ||
    !vnet.gateways.some((gateway) => gateway.enabled && gateway.kind === 'ExpressRoute')) return undefined
  const gateway = vnet.gateways.find((gateway) => gateway.enabled &&
    finding.id === `coexistence:${vnet.id}:sku:${gateway.id}` && gateway.sku?.trim().toLowerCase() === 'basic')
  if (!gateway) return undefined
  return {
    gateway,
    sku: gateway.kind === 'Vpn' ? gateway.vpnNat?.sku ?? 'VpnGw1AZ' : 'ErGw1AZ',
  }
}

export function coexistenceFindings(topology: AzNetTopology): AzDiagnosticFinding[] {
  const remediation = {
    gateway: 'Use supported non-Basic SKUs and RouteBased VPN. Connection traffic selectors are separate; changing this model does not reconfigure Azure.',
    generation: 'Use Generation1 for VpnGw1/AZ, Generation2 for VpnGw4/5/AZ; either for VpnGw2/3/AZ.',
    subnet: 'Use IPv4 GatewaySubnet /27 or shorter.',
    udr: 'Remove gateway-range/default UDRs; verify native BGP endpoints for more-specific overlaps. Sessions are not assessed.',
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
        `Gateway "${gateway.name}" SKU is unknown; coexistence compatibility is not established.`,
        'Record the actual SKU; verify current product support. Basic is unsupported.')
      else if (gateway.sku.trim().toLowerCase() !== 'basic' && !(gateway.kind === 'Vpn' ? /^(VpnGw[1-5](AZ)?|Standard|HighPerformance)$/ : /^(ErGw[1-3]AZ|ErGwScale|Standard|HighPerformance|UltraPerformance)$/i).test(gateway.sku))
        add(`sku:${gateway.id}`, 'warning', `Gateway "${gateway.name}" SKU "${gateway.sku}" has unassessed coexistence support.`,
          'Verify current product support; unfamiliar non-Basic SKUs are not certified.')
      if (gateway.kind === 'Vpn' && gateway.vpnType === undefined) add(`type:${gateway.id}`, 'warning',
        `VPN gateway "${gateway.name}" routing type is unknown; coexistence requires RouteBased.`,
        'Record RouteBased; connection traffic selectors are a separate setting.')
    }
    add('scope', 'info',
      'Equal-prefix Azure routes prefer ER; more-specific VPN routes still win. Return-path symmetry is not inferred.',
      'Configure site ER local preference explicitly. VPN backup covers private, not Microsoft, peering; its Internet underlay must be independent of ER (not assessed). ER-to-VPN transit requires same-VNet ARS branch-to-branch, active/active VPN ASN 65515. ARS does not provide ER-to-ER transit; use Global Reach.')
    return findings
  })]
}
