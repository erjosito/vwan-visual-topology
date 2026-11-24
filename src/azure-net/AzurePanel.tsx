import { lazy, Suspense } from 'react'
import { t } from '../i18n'
import { AzureCaptureTools } from '../AzureCaptureTools'
import type { AzNetTopology } from './model'
import type { AzSimulationResult } from './engine'
import { importAzNetCapture, compareAzNetWithObservations } from './azure-import'
import type { AzCapturedObservations, AzNetComparisonReport } from './azure-import'

const AzBicepExport = lazy(() => import('./AzBicepExport').then((module) => ({ default: module.AzBicepExport })))
const GatewayBgpNeighborsPanel = lazy(() => import('./GatewayBgpNeighborsPanel'))
const CapturedArsRoutesPanel = lazy(() => import('./CapturedArsRoutesPanel'))

export function AzurePanel({ topology, simulation, observations, comparison, notices, stale, onCaptured, onComparison, onImportFile, onCompareFile }: {
  topology: AzNetTopology; simulation: AzSimulationResult
  observations: AzCapturedObservations | null; comparison: AzNetComparisonReport | null
  notices: string[]; stale: boolean
  onCaptured: (observations: AzCapturedObservations | null, comparison: AzNetComparisonReport | null, warnings: string[]) => void
  onComparison: (comparison: AzNetComparisonReport) => void; onImportFile: () => void; onCompareFile: () => void
}) {
  return <>
    <p>{t('Offline files work on web and Windows. Local Azure reads require the Windows desktop app. No deployment or deletion is performed.')}</p>
    <p className="notice">{t('Comparison assesses captured NIC routes, not configuration drift or end-to-end network health. Missing, partial and unsupported evidence is not a successful match. The current design is preserved.')}</p>
    <AzureCaptureTools mode="full" onCapture={async (file, current) => {
      if (!current()) return
      const raw = JSON.parse(file.content) as Record<string, unknown>
      if (raw.kind !== 'azure-network-capture') throw new Error(t('Expected an Azure network capture. The current design is unchanged.'))
      const imported = importAzNetCapture(raw)
      const report = imported.observations ? compareAzNetWithObservations(topology, simulation, imported.observations) : null
      onCaptured(imported.observations ?? null, report, [...imported.warnings, ...(!imported.observations ? [t('No route observations were captured. Routing remains unassessed.')] : [])])
    }} />
    {observations && <p className="azure-resource-id">{t('Captured')}: {observations.capturedAt || t('Unknown')} · {observations.subscriptionId || t('Unknown')} · {observations.resourceGroup} · {t('collector')}: {observations.collectorVersion || t('Unknown')}</p>}
    {(observations?.vngBgpPeerStatus || observations?.vngLearnedRoutes || observations?.vngAdvertisedRoutes || observations?.vngBgpEndpoints) && <Suspense fallback={null}><GatewayBgpNeighborsPanel observations={observations} /></Suspense>}
    {(observations?.arsLearnedRoutes || observations?.arsAdvertisedRoutes) && <Suspense fallback={null}><CapturedArsRoutesPanel observations={observations!} /></Suspense>}
    <div className="aznet-card" data-testid="aznet-azure-capture-card">
      <h3>1. Azure Live Capture &amp; Effective-Route Comparison</h3>
      <p>{t('Capture a resource group using the reviewable, read-only PowerShell collector. Effective routes can require additional permissions. Importing as a new design is separate from comparison.')}</p>
      <pre className="azure-code">{'pwsh ./scripts/collect-azure-network.ps1 -ResourceGroupName <rg> -IncludeEffectiveRoutes -OutputFile azure-network-capture.json'}</pre>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <a className="aznet-btn" href="/scripts/collect-azure-network.ps1" download="collect-azure-network.ps1">⬇ Download Collector Script (.ps1)</a>
        <button type="button" className="aznet-btn aznet-btn-primary" onClick={onImportFile}>{t('Import Azure as a new design')}</button>
        <button type="button" className="aznet-btn" onClick={onCompareFile}>🔍 Compare Capture Against Current Topology</button>
      </div>
      {notices.length > 0 && <div className="notice"><strong>{t('Import Notices:')}</strong><ul>{notices.map((notice, index) => <li key={index}>{notice}</li>)}</ul></div>}
      {comparison && stale && <p className="notice" role="status">{t('The design changed. Compare again; previous results are stale.')} <button onClick={() => {
        if (observations) onComparison(compareAzNetWithObservations(topology, simulation, observations))
      }}>{t('Compare captured fields')}</button></p>}
      {comparison && !stale && <div data-testid="aznet-comparison-report">
        <strong>NIC Effective Route Comparison ({comparison.totalMatchedRoutes} matched, {comparison.totalMismatchedRoutes} mismatched{comparison.totalUnknownRoutes > 0 && `, ${comparison.totalUnknownRoutes} unassessed`})</strong>
        {comparison.subnetComparisons.map((nic) => <div key={nic.nicName} className="notice" style={{ borderColor: nic.coverage === 'complete' && nic.mismatchCount === 0 ? 'var(--success)' : 'var(--border)' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span><strong>{nic.nicName}</strong> · {nic.vnetName}/{nic.subnetName} {nic.proxyForGatewaySubnet && <span className="aznet-badge info">GatewaySubnet Proxy</span>}</span>
            <span className={`aznet-badge ${nic.coverage !== 'complete' ? 'info' : nic.mismatchCount === 0 ? 'ok' : 'error'}`}>
              {nic.coverage !== 'complete' ? `COVERAGE ${nic.coverage.toUpperCase()} (${nic.matchedCount} matched)` : nic.mismatchCount === 0 ? `MATCHED (${nic.matchedCount})` : `${nic.mismatchCount} DIFF`}
            </span>
          </div>
          <div className="table-scroll"><table className="aznet-route-table">
            <thead><tr><th>Status</th><th>Prefix</th><th>Azure Observed</th><th>Simulator Predicted</th></tr></thead>
            <tbody>{nic.rows.map((row, index) => <tr key={index}>
              <td><span className={`aznet-badge ${row.assessment === 'unknown' ? 'info' : row.matched ? 'ok' : 'error'}`}>{row.assessment === 'unknown' ? 'unassessed' : row.matched ? 'match' : 'diff'}</span></td>
              <td><code>{row.prefix}</code></td>
              <td>{`${row.azureSource} → ${row.azureNextHopType}${row.azureNextHopIp ? ` (${row.azureNextHopIp})` : ''} [${row.azureState}]`}</td>
              <td>{`${row.simSource} → ${row.simNextHopType}${row.simNextHopIp ? ` (${row.simNextHopIp})` : ''} [${row.simState}]`}</td>
            </tr>)}</tbody>
          </table></div>
        </div>)}
      </div>}
    </div>
    <Suspense fallback={<p role="status">{t('Loading workspace…')}</p>}><AzBicepExport topology={topology} /></Suspense>
  </>
}
