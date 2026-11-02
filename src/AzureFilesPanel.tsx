import { t, localizeDiagnostic } from './i18n'
import { useState } from 'react'
import type { Topology } from './model'
import { CanvasOverlay } from './CanvasOverlay'
import { bicepDefaults, generateBicep, hubExportBlocker, spokeExportBlocker } from './bicep-export'
import type { BicepExport, BicepSettings, SpokeAttachmentDeployment } from './bicep-export'
import collectorUrl from './collect-azure-vwan.ps1?url'

function download(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = 'main.bicep'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AzureFilesPanel({ topology, pendingImport, onImportFile, onCompare, onConfirmImport, onCancelImport, onClose }: {
  topology: Topology; pendingImport?: Topology; onImportFile: () => void
  onCompare: () => void; onConfirmImport: () => void; onCancelImport: () => void; onClose: () => void
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
    <p><button onClick={onCompare}>{t('Compare with Azure capture')}</button></p>
    {pendingImport ? <>
      <h3>{t("Review Azure capture")}</h3>
      <p><strong>{pendingImport.name}</strong> · {t('{0} hubs · {1} IPv4 spokes. Confirming replaces the current workspace. Export its JSON first if needed.', pendingImport.hubs.length, pendingImport.spokes.length)}</p>
    </> : <>
      <h3>{t("Import from Azure")}</h3>
      <p>{t("Run the reviewable, read-only collector with PowerShell 7 and an already signed-in Azure CLI, locally or in Cloud Shell PowerShell. It reads one Standard WAN in public Azure, with no secrets or effective-route queries.")}</p>
      <p><a className="button-link" href={collectorUrl} download="collect-azure-vwan.ps1">{t("Download Azure collector")}</a> <a className="button-link" href="https://github.com/erjosito/vwan-visual-topology-feedback/blob/main/scripts/collect-azure-vwan.ps1" target="_blank" rel="noopener noreferrer">{t("View script on GitHub")}</a> <button onClick={onImportFile}>{t("Import Azure capture")}</button></p>
      <pre className="azure-code">{`Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/erjosito/vwan-visual-topology-feedback/main/scripts/collect-azure-vwan.ps1' -OutFile ./collect-azure-vwan.ps1\n./collect-azure-vwan.ps1 -VirtualWanId '/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Network/virtualWans/WAN' -OutputFile ./vwan-capture.json`}</pre>
      <p className="muted">{t("Cross-subscription VNet reads require explicit -AllowCrossSubscriptionVnets. Only referenced VNets are read. Permission failures and unsupported configurations remain visible in the capture preview.")}</p>
    </>}
    {report && <section aria-label={t("Azure import report")}><h3>{t("Structure-only import report")}</h3><p>{t("Captured")} {report.capturedAt}  {t("· collector")} {report.collectorVersion}</p><p className="azure-resource-id">{report.wanId}</p>
      <div className="table-scroll"><table><thead><tr><th>{t("Hub")}</th><th>{t("Infrastructure prefix")}</th><th>{t("Capture status")}</th></tr></thead><tbody>{report.hubs.map((source) => <tr key={source.hubId}><td title={source.resourceId}>{(pendingImport ?? topology).hubs.find((hub) => hub.id === source.hubId)?.name ?? source.hubId}</td><td>{source.addressPrefix}</td><td>{source.limitations.length ? t("Partial / unsupported routing") : t("Captured structure only")}</td></tr>)}</tbody></table></div>
      {report.tables !== undefined && <p className="muted">{t("Observed effective-route snapshots")}: {report.tables.map((table) => `${(pendingImport ?? topology).hubs.find((hub) => hub.id === table.hubId)?.name ?? table.hubId} (${table.status}, ${table.routes.length} routes)`).join(' · ') || t("none")}</p>}
      {report.warnings.map((warning, index) => <p className="notice" key={index}>{localizeDiagnostic(warning)}</p>)}</section>}
    {pendingImport ? <>
      <label className="checkbox-field"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />{t("I understand this is a structure-only import, not verified Azure routing.")}</label>
      <div className="dialog-actions"><button onClick={onCancelImport}>{t("Cancel Azure import")}</button><button className="primary" disabled={!acknowledged} onClick={onConfirmImport}>{t("Replace workspace with Azure capture")}</button></div>
    </> : <>
      <h3>{t("Export Bicep starter")}</h3>
      <p>{t("Creates one new Standard WAN, selected hubs, and optional AZFW_Hub firewalls, Routing Intent policies, and existing-VNet attachments. Infrastructure CIDRs are separate from destination prefixes. No VNets, gateways, sites, NVAs or firewall policies are created.")}</p>
      <div className="form-grid"><label className="field"><span>{t("WAN deployment name")}</span><input aria-label={t("WAN deployment name")} value={settings.wanName} onChange={(e) => change({ ...settings, wanName: e.target.value })} /></label><label className="field"><span>{t("WAN Azure location")}</span><input aria-label={t("WAN Azure location")} value={settings.location} placeholder="westeurope" onChange={(e) => change({ ...settings, location: e.target.value })} /></label></div>
      {topology.hubs.map((hub) => {
        const entry = settings.hubs.find((entry) => entry.hubId === hub.id)
        if (!entry) return <p className="notice" key={hub.id}>{t("Workspace changed. Close and reopen Azure files to include")} {hub.name}.</p>
        const edit = (values: Partial<typeof entry>) => change({ ...settings, hubs: settings.hubs.map((item) => item.hubId === hub.id ? { ...item, ...values } : item) })
        const blocker = hubExportBlocker(topology, hub.id, entry)
        const isSecured = hub.routingIntent.private || hub.routingIntent.internet
        const hubSpokes = topology.spokes.filter((spoke) => spoke.hubId === hub.id)
        return <fieldset key={hub.id}><legend>{hub.name}</legend>
          <label className="checkbox-field"><input aria-label={t("Export {0}", hub.name)} type="checkbox" checked={entry.selected} onChange={(e) => edit({ selected: e.target.checked })} />{t("Include this hub")}</label>
          {blocker && <p className="notice">{localizeDiagnostic(blocker)}</p>}
          {entry.selected && <>
            <div className="form-grid">
              <label className="field"><span>{t("Deployment name")}</span><input aria-label={t("Deployment name for {0}", hub.name)} value={entry.name} onChange={(e) => edit({ name: e.target.value })} /></label>
              <label className="field"><span>{t("Canonical Azure location")}</span><input aria-label={t("Azure location for {0}", hub.name)} value={entry.location} onChange={(e) => edit({ location: e.target.value })} /></label>
              <label className="field"><span>{t("Hub infrastructure CIDR")}</span><input aria-label={t("Infrastructure CIDR for {0}", hub.name)} placeholder={t("Explicit unused /23 recommended")} value={entry.addressPrefix} onChange={(e) => edit({ addressPrefix: e.target.value })} /></label>
              {isSecured && <>
                <label className="field"><span>{t("Hub firewall name (AZFW_Hub)")}</span><input aria-label={t("Firewall name for {0}", hub.name)} value={entry.firewallName ?? `${entry.name.slice(0, 42)}-fw`} onChange={(e) => edit({ firewallName: e.target.value })} /></label>
                <label className="field"><span>{t("Firewall tier")}</span><select aria-label={t("Firewall tier for {0}", hub.name)} value={entry.firewallTier ?? 'Standard'} onChange={(e) => edit({ firewallTier: e.target.value as 'Standard' | 'Premium' })}><option value="Standard">Standard</option><option value="Premium">Premium</option></select></label>
                <label className="field"><span>{t("Existing Firewall Policy ARM ID")}</span><input aria-label={t("Firewall Policy ID for {0}", hub.name)} placeholder="/subscriptions/.../Microsoft.Network/firewallPolicies/..." value={entry.firewallPolicyId ?? ''} onChange={(e) => edit({ firewallPolicyId: e.target.value })} /></label>
              </>}
            </div>
            {hubSpokes.map((spoke) => {
              const spokeEntry = (settings.spokes ?? []).find((item) => item.spokeId === spoke.id)
              if (!spokeEntry) return null
              const editSpoke = (values: Partial<SpokeAttachmentDeployment>) => change({
                ...settings,
                spokes: (settings.spokes ?? []).map((item) => item.spokeId === spoke.id ? { ...item, ...values } : item),
              })
              const spokeBlocker = spokeExportBlocker(topology, spoke.id)
              return <div key={spoke.id} className="spoke-export-row">
                <label className="checkbox-field"><input aria-label={t("Export spoke {0}", spoke.name)} type="checkbox" checked={spokeEntry.selected} onChange={(e) => editSpoke({ selected: e.target.checked })} />{t("Attach existing VNet for {0}", spoke.name)}</label>
                {spokeBlocker && <p className="notice">{localizeDiagnostic(spokeBlocker)}</p>}
                {spokeEntry.selected && <div className="form-grid">
                  <label className="field"><span>{t("Connection deployment name")}</span><input aria-label={t("Connection name for {0}", spoke.name)} value={spokeEntry.name} onChange={(e) => editSpoke({ name: e.target.value })} /></label>
                  <label className="field"><span>{t("Target existing VNet ARM ID")}</span><input aria-label={t("Target VNet ID for {0}", spoke.name)} placeholder="/subscriptions/.../Microsoft.Network/virtualNetworks/..." value={spokeEntry.existingVnetId} onChange={(e) => editSpoke({ existingVnetId: e.target.value })} /></label>
                  <label className="checkbox-field"><input aria-label={t("Enable Internet security for {0}", spoke.name)} type="checkbox" checked={spokeEntry.enableInternetSecurity} onChange={(e) => editSpoke({ enableInternetSecurity: e.target.checked })} />{t("Enable Internet security (propagate default route)")}</label>
                </div>}
              </div>
            })}
          </>}
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
