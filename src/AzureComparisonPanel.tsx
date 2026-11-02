import { useEffect, useRef, useState } from 'react'
import { CanvasOverlay } from './CanvasOverlay'
import { localizeDiagnostic, t } from './i18n'
import type { ObjectSelection, Topology } from './model'
import { routingRevision } from './diagnostics'
import { armKey, parseAzureObservation } from './azure-observation'
import type { AzureObservation } from './azure-observation'
import { compareAzure, comparisonHopChoices, comparisonProfileKey, comparisonStatuses, defaultComparisonProfile } from './azure-comparison'
import type { ComparisonProfile, ComparisonReport, ComparisonRow } from './azure-comparison'
import collectorUrl from './collect-azure-vwan.ps1?url'

export interface ComparisonSession { observation: AzureObservation; profile: ComparisonProfile; report?: ComparisonReport }
export function AzureComparisonPanel({ topology, session, onSession, onSelect, onClose }: {
  topology: Topology; session?: ComparisonSession; onSession: (session?: ComparisonSession) => void
  onSelect: (selection?: ObjectSelection) => void; onClose: () => void
}) {
  const [error, setError] = useState('')
  const [view, setView] = useState('differences')
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState('')
  const input = useRef<HTMLInputElement>(null), request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  const observation = session?.observation, profile = session?.profile
  const currentReport = session?.report?.revision === routingRevision(topology)
    && session.report.profileKey === comparisonProfileKey(session.profile) ? session.report : undefined
  const change = (profile: ComparisonProfile) => {
    if (!session) return
    if (comparisonProfileKey(profile) === comparisonProfileKey(session.profile)) return
    request.current++; onSession({ ...session, profile, report: undefined }); setError('')
  }
  const bind = (kind: 'hubs' | 'spokes', resourceId: string, value: string) => {
    if (!profile) return
    const mappings = { ...profile[kind] }
    if (value) mappings[armKey(resourceId)] = value
    else delete mappings[armKey(resourceId)]
    change({ ...profile, [kind]: mappings })
  }
  const choices = comparisonHopChoices(topology)
  const rawHops = [...new Map(observation?.tables.flatMap((table) => table.routes.flatMap((row) => row.nextHops))
    .map((hop) => [armKey(hop), hop]) ?? []).values()]
  const unresolvedHops = rawHops.filter((hop) => !profile?.hubs[armKey(hop)] && !profile?.spokes[armKey(hop)])
  const visible = currentReport?.rows.filter((row) => (view !== 'differences' || row.status !== 'match')
    && (!status || row.status === status) && (!filter || [row.prefix, row.hubResourceId, t(row.detail)].some((value) => value.toLocaleLowerCase().includes(filter.toLocaleLowerCase())))) ?? []
  const snapshot = observation?.tables.filter((table) => !profile?.hubResourceId || armKey(table.hubResourceId) === armKey(profile.hubResourceId))
    .flatMap((table) => table.routes.map((row) => ({ table, row }))).filter(({ row }) => !filter || row.addressPrefixes.some((prefix) => prefix.includes(filter))) ?? []
  const exportReport = () => {
    if (!session || !currentReport) return
    try {
      const observedRows = [...new Set(currentReport.rows.flatMap((row) => row.observed))]
      const indexes = new Map(observedRows.map((row, index) => [row, index]))
      const rows = currentReport.rows.map(({ observed, ...row }) => ({ ...row, observedRowIds: observed.map((row) => indexes.get(row)) }))
      const text = JSON.stringify({ kind: 'azure-vwan-comparison-report', version: 1,
        capture: { wanId: session.observation.wanId, startedAt: session.observation.startedAt, completedAt: session.observation.completedAt,
          collectorVersion: session.observation.collectorVersion, context: session.observation.context,
          tables: session.observation.tables.map(({ routes: _routes, ...metadata }) => metadata) },
        profile: session.profile, report: { ...currentReport, rows, observedRows } }, null, 2)
      if (new TextEncoder().encode(text).length > 16_000_000) throw new Error('size')
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'vwan-azure-comparison.json'; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError('The comparison report exceeds the 16 MB export limit. Reduce the selected prefix scope.') }
  }
  const showRow = (row: ComparisonRow) => <article key={row.id} className={`comparison-finding ${row.status}`}>
    <div className="row"><strong>{t(comparisonStatuses[row.status])}</strong><button onClick={() => onSelect(row.related.at(-1))} disabled={!row.related.length}>{row.prefix || t('Observation context')}</button></div>
    <p>{t(row.detail)}</p>
    <details><summary>{t('Comparison evidence')}</summary><p className="azure-resource-id">{row.hubResourceId}</p>
      {row.area === 'structure' ? row.configuration && <div className="table-scroll"><table><thead><tr><th>{t('Compared field')}</th><th>{t('Designed value')}</th><th>{t('Azure snapshot value')}</th></tr></thead><tbody>{row.configuration.map((field) => <tr key={field.label}><th>{t(field.label)}</th><td><code>{field.designed === null ? t('Unknown') : typeof field.designed === 'boolean' ? t(field.designed ? 'enabled' : 'disabled') : JSON.stringify(field.designed)}</code></td><td><code>{field.observed === null ? t('Unknown') : typeof field.observed === 'boolean' ? t(field.observed ? 'enabled' : 'disabled') : JSON.stringify(field.observed)}</code></td></tr>)}</tbody></table></div> : <>
        <h4>{t('Designed selected routes')}</h4>{row.designed.length ? <ul>{row.designed.map((tuple, index) => <li key={index}><code>{tuple.hop}</code> · {t('AS path')}: <code>{tuple.asPath || '—'}</code></li>)}</ul> : <p>{t('No selected exact-prefix route in the design.')}</p>}
        <h4>{t('Azure snapshot rows')}</h4><pre className="azure-code">{JSON.stringify(row.observed, null, 2)}</pre>
      </>}
    </details>
  </article>
  return <CanvasOverlay title={t('Compare with Azure capture')} className="azure-comparison" onClose={onClose}>
    <p className="muted">{t('Attach an offline observation without replacing the design. This browser never reads your Azure CLI credentials or calls Azure.')}</p>
    <p><a className="button-link" href={collectorUrl} download="collect-azure-vwan.ps1">{t('Download Azure collector')}</a> <a className="button-link" href="https://github.com/erjosito/vwan-visual-topology-feedback/blob/main/scripts/collect-azure-vwan.ps1" target="_blank" rel="noopener noreferrer">{t('View script on GitHub')}</a> <button onClick={() => input.current?.click()}>{t('Load comparison capture')}</button></p>
    <pre className="azure-code">{`Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/erjosito/vwan-visual-topology-feedback/main/scripts/collect-azure-vwan.ps1' -OutFile ./collect-azure-vwan.ps1\n./collect-azure-vwan.ps1 -VirtualWanId '/subscriptions/SUB/resourceGroups/RG/providers/Microsoft.Network/virtualWans/WAN' -IncludeEffectiveRoutes -OutputFile ./vwan-observation.json`}</pre>
    <p className="muted">{t('Run locally with PowerShell 7 and an already signed-in Azure CLI. Effective-route retrieval requires the virtualHubs/effectiveRoutes/action permission in addition to metadata reads; Reader alone may not suffice.')}</p>
    <p className="notice">{t('Captures and mappings stay in memory, separate from topology JSON, until this page is reloaded or the capture is removed. Local report exports contain addresses and Azure resource IDs. Nothing is sent to feedback.')}</p>
    <input ref={input} hidden type="file" accept=".json,application/json" aria-label={t('Azure comparison capture file')} onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      const id = ++request.current
      try {
        if (file.size > 8_000_000) throw new Error('size')
        const observation = parseAzureObservation(JSON.parse(await file.text()))
        if (id === request.current) { onSession({ observation, profile: defaultComparisonProfile(topology, observation) }); setError('') }
      } catch { if (id === request.current) setError('Invalid Azure observation capture or 8 MB size limit exceeded. The previous observation and design were preserved.') }
    }} />
    {error && <p className="notice error" role="alert">{t(error)}</p>}
    {session && observation && profile && <>
      <h3>{t('Observation scope and mappings')}</h3>
      <p className="azure-resource-id">{observation.wanId}</p><p>{t('Captured')}: {observation.startedAt} → {observation.completedAt} · {t('collector')}: {observation.collectorVersion}</p>
      <p>{t('Cloud')}: {observation.context.cloud} · {t('Tenant')}: {observation.context.tenantId ?? t('Unknown')} · Azure CLI: {observation.context.azureCliVersion ?? t('Unknown')}</p>
      <p className="notice">{t('Only unsecured Default table routes are comparable. Gateway mappings identify a gateway class and hub, not a particular branch connection. Missing or unsupported observations are not healthy results.')}</p>
      {!observation.inventoryComplete && <p className="notice">{t('Structural inventory is incomplete. Missing resources are not inferred.')}</p>}
      {observation.warnings.map((warning, index) => <p className="notice" key={index}>{localizeDiagnostic(warning)}</p>)}
      <details><summary>{t('Capture coverage and operation evidence')}</summary>
        {observation.tables.map((table) => <div key={table.resourceId}><p className="azure-resource-id">{table.resourceId}</p><p>{t('Capture status')}: <code>{table.status}</code> · {table.capturedAt} · <code>{table.apiVersion}</code></p>{table.warnings.map((warning, index) => <p className="notice" key={index}>{localizeDiagnostic(warning)}</p>)}</div>)}
        {observation.hubs.flatMap((hub) => hub.limitations.map((limitation, index) => <p className="notice" key={`${hub.resourceId}:${index}`}>{hub.name}: {localizeDiagnostic(limitation)}</p>))}
      </details>
      <details open><summary>{t('Review explicit resource mappings')}</summary>
        {observation.hubs.map((hub) => <fieldset key={hub.resourceId}><legend>{hub.name}</legend>
          <label className="field"><span>{t('Design hub for {0}', hub.name)}</span><select aria-label={t('Design hub for {0}', hub.name)} value={profile.hubs[armKey(hub.resourceId)] ?? ''} onChange={(event) => bind('hubs', hub.resourceId, event.target.value)}><option value="">{t('Unmapped')}</option>{topology.hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
          <small className="azure-resource-id">{hub.resourceId}</small>
          {hub.spokes.map((spoke) => <label className="field" key={spoke.resourceId}><span>{t('Design spoke for {0}', spoke.name)}</span><select aria-label={t('Design spoke for {0}', spoke.name)} value={profile.spokes[armKey(spoke.resourceId)] ?? ''} onChange={(event) => bind('spokes', spoke.resourceId, event.target.value)}><option value="">{t('Unmapped')}</option>{topology.spokes.map((spoke) => <option key={spoke.id} value={spoke.id}>{spoke.name}</option>)}</select><small className="azure-resource-id">{spoke.resourceId}</small></label>)}
        </fieldset>)}
        {unresolvedHops.slice(0, 200).map((hop) => <label className="field" key={hop}><span>{t('Next-hop mapping')}</span><small className="azure-resource-id">{hop}</small><select aria-label={t('Next-hop mapping for {0}', hop)} value={Object.hasOwn(profile.nextHops, armKey(hop)) ? JSON.stringify(profile.nextHops[armKey(hop)]) : ''} onChange={(event) => {
          const nextHops = event.target.value ? { ...profile.nextHops, [armKey(hop)]: JSON.parse(event.target.value) } : { ...profile.nextHops }
          if (!event.target.value) delete nextHops[armKey(hop)]
          change({ ...profile, nextHops })
        }}><option value="">{t('Unmapped')}</option>{choices.map(({ value, name }) => <option key={JSON.stringify(value)} value={JSON.stringify(value)}>{name}</option>)}</select></label>)}
        {unresolvedHops.length > 200 && <p className="notice">{t('Only the first 200 next-hop mapping controls are displayed. Unmapped identities remain unassessed.')}</p>}
      </details>
      <label className="field"><span>{t('Observed hub scope')}</span><select aria-label={t('Observed hub scope')} value={profile.hubResourceId} onChange={(event) => change({ ...profile, hubResourceId: event.target.value })}>{observation.hubs.map((hub) => <option key={hub.resourceId} value={hub.resourceId}>{hub.name}</option>)}</select></label>
      <label className="field"><span>{t('Exact expected IPv4 prefixes (optional, one per line)')}</span><textarea rows={3} value={profile.prefixes.join('\n')} onChange={(event) => change({ ...profile, prefixes: event.target.value.split('\n') })} onBlur={() => change({ ...profile, prefixes: profile.prefixes.map((prefix) => prefix.trim()).filter(Boolean) })} /></label>
      <label className="checkbox-field"><input type="checkbox" checked={profile.completeDesign} onChange={(event) => change({ ...profile, completeDesign: event.target.checked })} />{t('I have modeled all expected routes for these exact prefixes. A structure-only import is not a complete route baseline.')}</label>
      <label className="checkbox-field"><input type="checkbox" checked={profile.compareAsPaths} onChange={(event) => change({ ...profile, compareAsPaths: event.target.checked })} />{t('Also compare learned AS paths at this Default-table boundary (including provider and inter-hub ASNs).')}</label>
      <div className="row dialog-actions"><button className="primary" onClick={() => {
        try { const report = compareAzure(topology, observation, profile); onSession({ ...session, report }); setError('') }
        catch (error) { setError(error instanceof Error ? error.message : 'Comparison could not be completed.') }
      }}>{t('Compare captured fields')}</button><button onClick={() => { request.current++; onSession(undefined); onSelect(undefined); setError('') }}>{t('Remove comparison capture')}</button></div>
      {session.report && !currentReport && <p className="notice" role="status">{t('The design or mappings changed. Compare again; previous results are stale.')}</p>}
      {currentReport && <section aria-label={t('Azure comparison results')}>
        <p role="status">{t('{0} compared · {1} not compared', currentReport.compared, currentReport.notCompared)}</p>
        {currentReport.limitations.map((limitation) => <p className="notice" key={limitation}>{t(limitation)}</p>)}
        <div className="form-grid">
          <label className="field"><span>{t('Comparison view')}</span><select aria-label={t('Comparison view')} value={view} onChange={(event) => setView(event.target.value)}><option value="differences">{t('Differences')}</option><option value="designed">{t('Designed and compared fields')}</option><option value="snapshot">{t('Azure snapshot')}</option></select></label>
          <label className="field"><span>{t('Comparison status')}</span><select aria-label={t('Comparison status')} value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t('All statuses')}</option>{Object.entries(comparisonStatuses).map(([status, label]) => <option key={status} value={status}>{t(label)}</option>)}</select></label>
          <label className="field"><span>{t('Filter comparison prefixes')}</span><input aria-label={t('Filter comparison prefixes')} value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
        </div>
        {view === 'snapshot' ? snapshot.slice(0, 200).map(({ table, row }, index) => <article className="comparison-finding" key={index}><strong>{row.addressPrefixes.join(', ')}</strong><p>{t('Capture status')}: <code>{table.status}</code> · {table.capturedAt} · <code>{table.apiVersion}</code></p><pre className="azure-code">{JSON.stringify(row, null, 2)}</pre></article>) : visible.slice(0, 200).map(showRow)}
        {!(view === 'snapshot' ? snapshot : visible).length && <p>{t('No rows match this view. Review coverage and mappings; this is not a network-health certificate.')}</p>}
        {(view === 'snapshot' ? snapshot.length : visible.length) > 200 && <p className="notice">{t('Showing the first 200 matching rows. Filter the view or export the bounded report for all assessed rows.')}</p>}
        <button onClick={exportReport}>{t('Export local comparison report')}</button>
      </section>}
    </>}
  </CanvasOverlay>
}
