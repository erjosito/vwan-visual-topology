import type { AzDiagnosticFinding } from './diagnostics'
import type { AzNetTopology } from './model'

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
