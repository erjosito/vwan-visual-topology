import { useMemo } from 'react'
import type { AzNetTopology } from './model'
import { generateAzNetBicep } from './bicep-export'

export function AzBicepExport({ topology }: { topology: AzNetTopology }) {
  const exported = useMemo(() => generateAzNetBicep(topology), [topology])
  return <div className="aznet-card" data-testid="aznet-bicep-export-card">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
      <h3 style={{ margin: 0 }}>2. Deployable Azure Bicep Template ({exported.resourceCount} resources)</h3>
      <button type="button" className="aznet-btn aznet-btn-primary" data-testid="aznet-download-bicep-btn" disabled={!exported.text} onClick={() => {
        const url = URL.createObjectURL(new Blob([exported.text], { type: 'text/plain' }))
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = `${topology.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'azure-net-topology'}.bicep`
        anchor.click(); URL.revokeObjectURL(url)
      }}>⬇ Download .bicep</button>
    </div>
    {!!exported.warnings.length && <div style={{ marginBottom: 8, padding: 8, background: 'var(--surface-muted)',
      border: '1px solid var(--warning)', borderRadius: 6, fontSize: 11.5, color: 'var(--warning)' }}>
      <strong>Deployment Notes:</strong>
      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>{exported.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </div>}
    <pre data-testid="aznet-bicep-code" style={{ maxHeight: 360, overflow: 'auto', padding: 10,
      background: 'var(--surface-muted)', color: 'var(--text-muted)', borderRadius: 6, fontSize: 11, margin: 0 }}>
      {exported.text || '// Fix topology validation errors to generate Bicep'}
    </pre>
  </div>
}
