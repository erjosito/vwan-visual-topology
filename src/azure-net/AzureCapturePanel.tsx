import type { AzNetComparisonReport } from './azure-import'

export default function AzureCapturePanel({ notices, comparison, onImport, onCompare }: {
  notices: string[]; comparison: AzNetComparisonReport | null
  onImport: () => void; onCompare: () => void
}) {
  return <div className="aznet-card" data-testid="aznet-azure-capture-card">
    <h3>1. Azure Live Capture &amp; Effective-Route Comparison</h3>
    <p style={{ margin: '0 0 8px 0', fontSize: 12, color: 'var(--text)' }}>
      Capture a live Azure resource group (VNets, Subnets, Peerings, UDRs, Route
      Server, Gateways, and NIC Effective Routes — including a proxy subnet sharing{' '}
      <code>GatewaySubnet</code>&apos;s route table) using the read-only PowerShell
      collector:
    </p>
    <pre style={{ margin: '0 0 8px 0', padding: 8, background: 'var(--surface-muted)', color: 'var(--text-muted)', borderRadius: 6, fontSize: 11, overflowX: 'auto' }}>
      {'pwsh ./scripts/collect-azure-network.ps1 -ResourceGroupName <rg> -IncludeEffectiveRoutes -OutputFile azure-network-capture.json'}
    </pre>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <a className="aznet-btn" href="/scripts/collect-azure-network.ps1" download="collect-azure-network.ps1" style={{ textDecoration: 'none' }}>⬇ Download Collector Script (.ps1)</a>
      <button type="button" className="aznet-btn aznet-btn-primary" onClick={onImport}>⬆ Import Capture as Topology + Compare</button>
      <button type="button" className="aznet-btn" onClick={onCompare}>🔍 Compare Capture Against Current Topology</button>
    </div>
    {notices.length > 0 && <div style={{ marginTop: 8, padding: 8, background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)', fontSize: 11.5 }}>
      <strong>Import Notices:</strong>
      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul>
    </div>}
    {comparison && <div style={{ marginTop: 10 }} data-testid="aznet-comparison-report">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <strong>NIC Effective Route Comparison ({comparison.totalMatchedRoutes} matched, {comparison.totalMismatchedRoutes} mismatched{comparison.totalUnknownRoutes > 0 && `, ${comparison.totalUnknownRoutes} unassessed`})</strong>
      </div>
      {comparison.subnetComparisons.map((nic) => <div key={nic.nicName} style={{ marginBottom: 8, padding: 8, background: 'var(--surface)', borderRadius: 6, border: `1px solid ${nic.coverage === 'complete' && nic.mismatchCount === 0 ? 'var(--success)' : 'var(--border)'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: 12 }}>
          <span><strong>{nic.nicName}</strong> · {nic.vnetName}/{nic.subnetName}{' '}{nic.proxyForGatewaySubnet && <span className="aznet-badge info">GatewaySubnet Proxy</span>}</span>
          <span className={`aznet-badge ${nic.coverage !== 'complete' ? 'info' : nic.mismatchCount === 0 ? 'ok' : 'error'}`}>
            {nic.coverage !== 'complete' ? `COVERAGE ${nic.coverage.toUpperCase()} (${nic.matchedCount} matched)` : nic.mismatchCount === 0 ? `MATCHED (${nic.matchedCount})` : `${nic.mismatchCount} DIFF`}
          </span>
        </div>
        <table className="aznet-route-table">
          <thead><tr><th>Status</th><th>Prefix</th><th>Azure Observed</th><th>Simulator Predicted</th></tr></thead>
          <tbody>{nic.rows.map((row, index) => <tr key={index}>
            <td><span className={`aznet-badge ${row.assessment === 'unknown' ? 'info' : row.matched ? 'ok' : 'error'}`}>{row.assessment === 'unknown' ? 'unassessed' : row.matched ? 'match' : 'diff'}</span></td>
            <td><code>{row.prefix}</code></td>
            <td>{`${row.azureSource} → ${row.azureNextHopType}${row.azureNextHopIp ? ` (${row.azureNextHopIp})` : ''} [${row.azureState}]`}</td>
            <td>{`${row.simSource} → ${row.simNextHopType}${row.simNextHopIp ? ` (${row.simNextHopIp})` : ''} [${row.simState}]`}</td>
          </tr>)}</tbody>
        </table>
      </div>)}
    </div>}
  </div>
}
