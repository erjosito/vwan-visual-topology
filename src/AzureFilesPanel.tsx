import { t, localizeDiagnostic } from './i18n'
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
  return <CanvasOverlay title={t("Azure files")} className="azure-files" onClose={onClose}>
    <p className="muted">{t("Offline files only. No Azure sign-in, credentials, API calls or deployment from this app.")}</p>
    {pendingImport ? <>
      <h3>{t("Review Azure capture")}</h3>
      <p><strong>{pendingImport.name}</strong> · {t('{0} hubs · {1} IPv4 spokes. Confirming replaces the current workspace. Export its JSON first if needed.', pendingImport.hubs.length, pendingImport.spokes.length)}</p>
    </> : <>
      <h3>{t("Import from Azure")}</h3>
      <p>{t("Run the reviewable, read-only collector with PowerShell 7 and an already signed-in Azure CLI, locally or in Cloud Shell PowerShell. It reads one Standard WAN in public Azure, with no secrets or effective-route queries.")}</p>
      <p><a className="button-link" href={collectorUrl} download="collect-azure-vwan.ps1">{t("Download Azure collector")}</a> <button onClick={onImportFile}>{t("Import Azure capture")}</button></p>
      <pre className="azure-code">./collect-azure-vwan.ps1 -VirtualWanId '/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Network/virtualWans/WAN' -OutputFile ./vwan-capture.json</pre>
      <p className="muted">{t("Cross-subscription VNet reads require explicit -AllowCrossSubscriptionVnets. Only referenced VNets are read. Permission failures and unsupported configurations remain visible in the capture preview.")}</p>
    </>}
    {report && <section aria-label={t("Azure import report")}><h3>{t("Structure-only import report")}</h3><p>{t("Captured")} {report.capturedAt}  {t("· collector")} {report.collectorVersion}</p><p className="azure-resource-id">{report.wanId}</p>
      <div className="table-scroll"><table><thead><tr><th>{t("Hub")}</th><th>{t("Infrastructure prefix")}</th><th>{t("Capture status")}</th></tr></thead><tbody>{report.hubs.map((source) => <tr key={source.hubId}><td title={source.resourceId}>{(pendingImport ?? topology).hubs.find((hub) => hub.id === source.hubId)?.name ?? source.hubId}</td><td>{source.addressPrefix}</td><td>{source.limitations.length ? t("Partial / unsupported routing") : t("Captured structure only")}</td></tr>)}</tbody></table></div>
      {report.warnings.map((warning, index) => <p className="notice" key={index}>{localizeDiagnostic(warning)}</p>)}</section>}
    {pendingImport ? <>
      <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />{t("I understand this is a structure-only import, not verified Azure routing.")}</label>
      <div className="dialog-actions"><button onClick={onCancelImport}>{t("Cancel Azure import")}</button><button className="primary" disabled={!acknowledged} onClick={onConfirmImport}>{t("Replace workspace with Azure capture")}</button></div>
    </> : <>
      <h3>{t("Export Bicep starter")}</h3>
      <p>{t("One new Standard WAN and selected unsecured hubs only. Infrastructure CIDRs are separate from destination prefixes. No VNet connections, gateways, sites or firewall resources are deployed.")}</p>
      <div className="form-grid"><label className="field"><span>{t("WAN deployment name")}</span><input aria-label={t("WAN deployment name")} value={settings.wanName} onChange={(e) => change({ ...settings, wanName: e.target.value })} /></label><label className="field"><span>{t("WAN Azure location")}</span><input aria-label={t("WAN Azure location")} value={settings.location} placeholder="westeurope" onChange={(e) => change({ ...settings, location: e.target.value })} /></label></div>
      {topology.hubs.map((hub) => {
        const entry = settings.hubs.find((entry) => entry.hubId === hub.id)
        if (!entry) return <p className="notice" key={hub.id}>{t("Workspace changed. Close and reopen Azure files to include")} {hub.name}.</p>
        const edit = (values: Partial<typeof entry>) => change({ ...settings, hubs: settings.hubs.map((item) => item.hubId === hub.id ? { ...item, ...values } : item) })
        const blocker = hubExportBlocker(topology, hub.id)
        return <fieldset key={hub.id}><legend>{hub.name}</legend>
          <label className="checkbox-field"><input aria-label={t("Export {0}", hub.name)} type="checkbox" checked={entry.selected} onChange={(e) => edit({ selected: e.target.checked })} />{t("Include this hub")}</label>
          {blocker && <p className="notice">{localizeDiagnostic(blocker)}</p>}
          {entry.selected && <div className="form-grid"><label className="field"><span>{t("Deployment name")}</span><input aria-label={t("Deployment name for {0}", hub.name)} value={entry.name} onChange={(e) => edit({ name: e.target.value })} /></label><label className="field"><span>{t("Canonical Azure location")}</span><input aria-label={t("Azure location for {0}", hub.name)} value={entry.location} onChange={(e) => edit({ location: e.target.value })} /></label><label className="field"><span>{t("Hub infrastructure CIDR")}</span><input aria-label={t("Infrastructure CIDR for {0}", hub.name)} placeholder={t("Explicit unused /23 recommended")} value={entry.addressPrefix} onChange={(e) => edit({ addressPrefix: e.target.value })} /></label></div>}
        </fieldset>
      })}
      <p className="muted">{t("Minimum router capacity: 2 routing infrastructure units (editable in Bicep). Region availability, quotas and Azure permissions are not checked offline. Deployment incurs Azure charges.")}</p>
      <button onClick={() => {
        try { const result = generateBicep(topology, settings); setPreview({ topology, settings, result }); setAcknowledged(false); setError('') }
        catch (error) { setPreview(undefined); setError(error instanceof Error ? error.message : 'Bicep export failed.') }
      }}>{t("Review Bicep export")}</button>
      {error && <p className="notice error" role="alert">{localizeDiagnostic(error)}</p>}
      {currentPreview && <section aria-label={t("Bicep export preview")}><h3>{currentPreview.resourceCount}  {t("resources · new deployment")}</h3>{currentPreview.warnings.map((warning) => <p className="notice" key={warning}>{localizeDiagnostic(warning)}</p>)}<details><summary>{t("Generated Bicep")}</summary><pre className="azure-code">{currentPreview.text}</pre></details>
        <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />{t("I reviewed the resources, exclusions and deployment costs.")}</label>
        <button className="primary" disabled={!acknowledged} onClick={() => download(currentPreview.text)}>{t("Download main.bicep")}</button>
      </section>}
      {preview && !currentPreview && <p className="notice">{t("Workspace changed. Review the export again before downloading.")}</p>}
    </>}
  </CanvasOverlay>
}
