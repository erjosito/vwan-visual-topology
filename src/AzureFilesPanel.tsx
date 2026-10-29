import { useState } from 'react'
import type { Topology } from './model'
import { CanvasOverlay } from './CanvasOverlay'
import { bicepDefaults, generateBicep, hubExportBlocker } from './bicep-export'
import type { BicepExport, BicepSettings } from './bicep-export'
import collectorUrl from './collect-azure-vwan.ps1?url'

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'main.bicep'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AzureFilesPanel({ topology, pendingImport, onImportFile, onConfirmImport, onCancelImport, onClose }: {
  topology: Topology; pendingImport?: Topology; onImportFile: () => void
  onConfirmImport: () => void; onCancelImport: () => void; onClose: () => void
}) {
  const [settings, setSettings] = useState(() => bicepDefaults(topology))
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ topology: Topology; settings: BicepSettings; result: BicepExport }>()
  const change = (next: BicepSettings) => { setSettings(next); setPreview(undefined); setAcknowledged(false); setError('') }
  const currentPreview = preview?.topology === topology && preview.settings === settings ? preview.result : undefined
  const report = pendingImport?.azureImport ?? topology.azureImport
  return <CanvasOverlay title="Azure files" className="azure-files" onClose={onClose}>
    <p className="muted">Offline files only. No Azure sign-in, credentials, API calls or deployment from this app.</p>
    {pendingImport ? <>
      <h3>Review Azure capture</h3>
      <p><strong>{pendingImport.name}</strong> · {pendingImport.hubs.length} hubs · {pendingImport.spokes.length} IPv4 spokes. Confirming replaces the current workspace. Export its JSON first if needed.</p>
    </> : <>
      <h3>Import from Azure</h3>
      <p>Run the reviewable, read-only collector with PowerShell 7 and an already signed-in Azure CLI, locally or in Cloud Shell PowerShell. It reads one Standard WAN in public Azure, with no secrets or effective-route queries.</p>
      <p><a className="button-link" href={collectorUrl} download="collect-azure-vwan.ps1">Download Azure collector</a> <button onClick={onImportFile}>Import Azure capture</button></p>
      <pre className="azure-code">./collect-azure-vwan.ps1 -VirtualWanId '/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Network/virtualWans/WAN' -OutputFile ./vwan-capture.json</pre>
      <p className="muted">Cross-subscription VNet reads require explicit -AllowCrossSubscriptionVnets. Only referenced VNets are read. Permission failures and unsupported configurations remain visible in the capture preview.</p>
    </>}
    {report && <section aria-label="Azure import report"><h3>Structure-only import report</h3><p>Captured {report.capturedAt} · collector {report.collectorVersion}</p><p className="azure-resource-id">{report.wanId}</p>
      <div className="table-scroll"><table><thead><tr><th>Hub</th><th>Infrastructure prefix</th><th>Capture status</th></tr></thead><tbody>{report.hubs.map((source) => <tr key={source.hubId}><td title={source.resourceId}>{(pendingImport ?? topology).hubs.find((hub) => hub.id === source.hubId)?.name ?? source.hubId}</td><td>{source.addressPrefix}</td><td>{source.limitations.length ? 'Partial / unsupported routing' : 'Captured structure only'}</td></tr>)}</tbody></table></div>
      {report.warnings.map((warning, index) => <p className="notice" key={index}>{warning}</p>)}</section>}
    {pendingImport ? <>
      <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />I understand this is a structure-only import, not verified Azure routing.</label>
      <div className="dialog-actions"><button onClick={onCancelImport}>Cancel Azure import</button><button className="primary" disabled={!acknowledged} onClick={onConfirmImport}>Replace workspace with Azure capture</button></div>
    </> : <>
      <h3>Export Bicep starter</h3>
      <p>One new Standard WAN and selected unsecured hubs only. Infrastructure CIDRs are separate from destination prefixes. No VNet connections, gateways, sites or firewall resources are deployed.</p>
      <div className="form-grid"><label className="field"><span>WAN deployment name</span><input aria-label="WAN deployment name" value={settings.wanName} onChange={(e) => change({ ...settings, wanName: e.target.value })} /></label><label className="field"><span>WAN Azure location</span><input aria-label="WAN Azure location" value={settings.location} placeholder="westeurope" onChange={(e) => change({ ...settings, location: e.target.value })} /></label></div>
      {topology.hubs.map((hub) => {
        const entry = settings.hubs.find((entry) => entry.hubId === hub.id)
        if (!entry) return <p className="notice" key={hub.id}>Workspace changed. Close and reopen Azure files to include {hub.name}.</p>
        const edit = (values: Partial<typeof entry>) => change({ ...settings, hubs: settings.hubs.map((item) => item.hubId === hub.id ? { ...item, ...values } : item) })
        const blocker = hubExportBlocker(topology, hub.id)
        return <fieldset key={hub.id}><legend>{hub.name}</legend>
          <label className="checkbox-field"><input aria-label={`Export ${hub.name}`} type="checkbox" checked={entry.selected} onChange={(e) => edit({ selected: e.target.checked })} />Include this hub</label>
          {blocker && <p className="notice">{blocker}</p>}
          {entry.selected && <div className="form-grid"><label className="field"><span>Deployment name</span><input aria-label={`Deployment name for ${hub.name}`} value={entry.name} onChange={(e) => edit({ name: e.target.value })} /></label><label className="field"><span>Canonical Azure location</span><input aria-label={`Azure location for ${hub.name}`} value={entry.location} onChange={(e) => edit({ location: e.target.value })} /></label><label className="field"><span>Hub infrastructure CIDR</span><input aria-label={`Infrastructure CIDR for ${hub.name}`} placeholder="Explicit unused /23 recommended" value={entry.addressPrefix} onChange={(e) => edit({ addressPrefix: e.target.value })} /></label></div>}
        </fieldset>
      })}
      <p className="muted">Minimum router capacity: 2 routing infrastructure units (editable in Bicep). Region availability, quotas and Azure permissions are not checked offline. Deployment incurs Azure charges.</p>
      <button onClick={() => {
        try { const result = generateBicep(topology, settings); setPreview({ topology, settings, result }); setAcknowledged(false); setError('') }
        catch (error) { setPreview(undefined); setError(error instanceof Error ? error.message : 'Bicep export failed.') }
      }}>Review Bicep export</button>
      {error && <p className="notice error" role="alert">{error}</p>}
      {currentPreview && <section aria-label="Bicep export preview"><h3>{currentPreview.resourceCount} resources · new deployment</h3>{currentPreview.warnings.map((warning) => <p className="notice" key={warning}>{warning}</p>)}<details><summary>Generated Bicep</summary><pre className="azure-code">{currentPreview.text}</pre></details>
        <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />I reviewed the resources, exclusions and deployment costs.</label>
        <button className="primary" disabled={!acknowledged} onClick={() => download(currentPreview.text)}>Download main.bicep</button>
      </section>}
      {preview && !currentPreview && <p className="notice">Workspace changed. Review the export again before downloading.</p>}
    </>}
  </CanvasOverlay>
}
