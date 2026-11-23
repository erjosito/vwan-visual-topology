import { basicGatewayFix } from './basic-gateway-fix'
import type { AzDiagnosticFinding } from './diagnostics'
import type { AzNetTopology } from './model'

export default function GatewayCoexistenceAutoFix({ topology, finding, commit }: {
  topology: AzNetTopology
  finding: AzDiagnosticFinding
  commit: (update: (draft: AzNetTopology) => void) => void
}) {
  if (!basicGatewayFix(topology, finding)) return null
  return <button type="button" className="aznet-btn aznet-btn-fix" data-testid="aznet-autofix-gateway-coexistence"
    onClick={() => commit((draft) => {
      const fix = basicGatewayFix(draft, finding)
      if (!fix) return
      fix.gateway.sku = fix.sku
      if (fix.sku === 'VpnGw1AZ') fix.gateway.vpnGatewayGeneration = 'Generation1'
      else if (/^VpnGw[45](AZ)?$/.test(fix.sku)) fix.gateway.vpnGatewayGeneration = 'Generation2'
    })}>⚡ Auto-Fix</button>
}
