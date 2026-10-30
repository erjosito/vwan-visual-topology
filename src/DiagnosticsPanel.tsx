import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CanvasOverlay } from './CanvasOverlay'
import { localizeDiagnostic, t } from './i18n'
import { routingRevision, validateDiagnosticsProfile } from './diagnostics'
import type { DiagnosticIntent, DiagnosticsFinding, DiagnosticsProfile, DiagnosticsReport, ExportConstraint } from './diagnostics'
import type { PathNode } from './paths'
import { nodePrefixes } from './paths'
import type { ObjectSelection, Topology } from './model'
import { topologyObject } from './model'

const storageKey = 'vwan-visual-topology:diagnostics:v1'
const emptyProfile = (): DiagnosticsProfile => ({ version: 1, intents: [], failureAnalysis: false })
const key = (node: ObjectSelection) => `${node.kind}:${node.id}`
const severities = { error: 'Error', warning: 'Warning', info: 'Information', unknown: 'Not assessed' } as const
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function DiagnosticsPanel({ topology, onFinding, onInspect, onClearHighlight, onProfileChange, onClose }: {
  topology: Topology; onFinding: (finding: DiagnosticsFinding) => void
  onInspect: (node: ObjectSelection) => void; onClearHighlight: () => void; onClose: () => void
  onProfileChange?: () => void
}) {
  const nodes = [
    ...topology.spokes.map((node) => ({ kind: 'spoke' as const, id: node.id, name: node.name })),
    ...topology.sites.map((node) => ({ kind: 'site' as const, id: node.id, name: node.name })),
    ...topology.hubs.map((node) => ({ kind: 'hub' as const, id: node.id, name: node.name })),
  ]
  const [initial] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      return { profile: saved ? validateDiagnosticsProfile(JSON.parse(saved)) : emptyProfile(), error: '' }
    } catch { return { profile: emptyProfile(), error: 'The saved analysis profile could not be loaded. Its stored contents have not been overwritten.' } }
  })
  const [profile, setProfile] = useState(initial.profile)
  const [error, setError] = useState(initial.error)
  const [source, setSource] = useState(nodes[0] ? key(nodes[0]) : '')
  const [target, setTarget] = useState(nodes[1] ? key(nodes[1]) : '')
  const [sourcePrefix, setSourcePrefix] = useState(nodes[0] ? nodePrefixes(topology, nodes[0])[0] ?? '' : '')
  const [destinationPrefix, setDestinationPrefix] = useState(nodes[1] ? nodePrefixes(topology, nodes[1])[0] ?? '' : '')
  const [expectation, setExpectation] = useState<'allow' | 'deny'>('allow')
  const [firewall, setFirewall] = useState('')
  const [constraintRouter, setConstraintRouter] = useState(topology.hubs[0] ? `hub:${topology.hubs[0].id}` : '')
  const [constraintConnection, setConstraintConnection] = useState('')
  const [constraintDirection, setConstraintDirection] = useState<'inbound' | 'outbound'>('outbound')
  const [constraintPrefix, setConstraintPrefix] = useState('')
  const [constraintExpectation, setConstraintExpectation] = useState<'present' | 'absent'>('present')
  const [report, setReport] = useState<DiagnosticsReport>()
  const [reportProfile, setReportProfile] = useState('')
  const [runScope, setRunScope] = useState<{ revision: string; profileRevision: string }>()
  const [severity, setSeverity] = useState('')
  const [category, setCategory] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')
  const [filter, setFilter] = useState('')
  const importer = useRef<HTMLInputElement>(null)
  const importRequest = useRef(0)
  const worker = useRef<Worker | undefined>(undefined)
  const revision = routingRevision(topology)
  const profileRevision = JSON.stringify(profile)
  const running = runScope?.revision === revision && runScope.profileRevision === profileRevision
  useEffect(() => {
    worker.current?.terminate(); worker.current = undefined
    return () => { worker.current?.terminate(); worker.current = undefined }
  }, [revision, profileRevision])
  const change = (next: DiagnosticsProfile) => {
    try {
      const valid = validateDiagnosticsProfile(next)
      onProfileChange?.()
      importRequest.current++
      onClearHighlight()
      setProfile(valid); setReport(undefined); setError('')
      try { localStorage.setItem(storageKey, JSON.stringify(valid)) }
      catch { setError('Browser storage is unavailable or full. Export the analysis profile to preserve it.') }
    } catch { setError('Invalid analysis profile. Use canonical IPv4 addresses or network prefixes and valid flow requirements.') }
  }
  const addIntent = (event: FormEvent) => {
    event.preventDefault()
    const from = nodes.find((node) => key(node) === source), to = nodes.find((node) => key(node) === target)
    if (!from || !to) { setError('Select existing source and destination nodes.'); return }
    const intent: DiagnosticIntent = {
      id: crypto.randomUUID(), source: { kind: from.kind, id: from.id }, target: { kind: to.kind, id: to.id },
      sourcePrefix, destinationPrefix, expectation, ...(firewall ? { requiredFirewallHubId: firewall } : {}),
    }
    change({ ...profile, intents: [...profile.intents, intent] })
  }
  const owner = nodes.find((node) => key(node) === constraintRouter && node.kind !== 'spoke')
  const attachments = owner ? [
    ...topology.connections.filter((connection) => owner.kind === 'hub' ? connection.hubId === owner.id : connection.siteId === owner.id),
    ...(topology.erLinks ?? []).filter((link) => owner.kind === 'hub' ? link.hubId === owner.id : link.siteId === owner.id),
    ...topology.siteLinks.filter((link) => owner.kind === 'site' && (link.a === owner.id || link.b === owner.id)),
  ] : []
  const addConstraint = (event: FormEvent) => {
    event.preventDefault()
    if (!owner || owner.kind === 'spoke' || !attachments.some((link) => link.id === constraintConnection)) return
    const constraint: ExportConstraint = {
      id: crypto.randomUUID(), router: { kind: owner.kind, id: owner.id }, connectionId: constraintConnection,
      direction: constraintDirection, prefix: constraintPrefix, expectation: constraintExpectation,
    }
    change({ ...profile, exportConstraints: [...(profile.exportConstraints ?? []), constraint] })
  }
  const run = () => {
    worker.current?.terminate()
    onClearHighlight()
    try {
      const next = new Worker(new URL('./diagnostics-worker.ts', import.meta.url), { type: 'module' })
      worker.current = next; setRunScope({ revision, profileRevision }); setReport(undefined); setError('')
      next.onmessage = ({ data }: MessageEvent<{ report?: DiagnosticsReport; error?: string }>) => {
        if (worker.current !== next) return
        if (data.report) { setReport(data.report); setReportProfile(profileRevision) }
        else setError(data.error ?? 'Diagnostics could not be completed. Review the analysis profile and model limitations.')
        next.terminate(); worker.current = undefined; setRunScope(undefined)
      }
      next.onerror = () => {
        if (worker.current !== next) return
        setError('Diagnostics could not be completed. Review the analysis profile and model limitations.')
        next.terminate(); worker.current = undefined; setRunScope(undefined)
      }
      next.postMessage({ topology, profile })
    } catch { setRunScope(undefined); setError('Diagnostics could not be completed. Review the analysis profile and model limitations.') }
  }
  const currentReport = report?.revision === revision && reportProfile === profileRevision ? report : undefined
  const name = (node?: PathNode) => node ? topologyObject(topology, node)?.name ?? node.id : ''
  const visible = currentReport?.findings.filter((finding) =>
    (!severity || finding.severity === severity) && (!category || finding.rule === category)
    && (!nodeFilter || [finding.source, finding.target, ...finding.related].some((node) => node && key(node) === nodeFilter))
    && (!filter || [finding.prefix, finding.sourceAddress, finding.destinationAddress, name(finding.source), name(finding.target), t(finding.title), t(finding.detail)]
      .some((value) => value?.toLocaleLowerCase().includes(filter.toLocaleLowerCase())))) ?? []
  const categories = [...new Map(currentReport?.findings.map((finding) => [finding.rule, finding.title]) ?? []).entries()]
  return <CanvasOverlay title={t('Routing diagnostics')} className="diagnostics-panel" onClose={onClose}>
    <p className="muted">{t('Offline, intent-aware routing checks. Declare expected communication; asymmetric transit alone is not an error. Actual hosts, firewall rules, NAT and traffic hashes are not verified.')}</p>
    <details open><summary>{t('Flow requirements')}</summary>
      <form className="analysis-form" onSubmit={addIntent}>
        <div className="form-grid">
          <label className="field"><span>{t('Source node')}</span><select aria-label={t('Diagnostic source')} value={source} onChange={(event) => {
            setSource(event.target.value); const node = nodes.find((node) => key(node) === event.target.value)
            setSourcePrefix(node ? nodePrefixes(topology, node)[0] ?? '' : '')
          }}><option value="">{t('Select source')}</option>{nodes.map((node) => <option key={key(node)} value={key(node)}>{node.name} ({t(node.kind)})</option>)}</select></label>
          <label className="field"><span>{t('Destination node')}</span><select aria-label={t('Diagnostic destination')} value={target} onChange={(event) => {
            setTarget(event.target.value); const node = nodes.find((node) => key(node) === event.target.value)
            setDestinationPrefix(node ? nodePrefixes(topology, node)[0] ?? '' : '')
          }}><option value="">{t('Select destination')}</option>{nodes.map((node) => <option key={key(node)} value={key(node)}>{node.name} ({t(node.kind)})</option>)}</select></label>
          <label className="field"><span>{t('Source IPv4 address or prefix')}</span><input aria-label={t('Source IPv4 address or prefix')} value={sourcePrefix} onChange={(event) => setSourcePrefix(event.target.value)} required /></label>
          <label className="field"><span>{t('Destination IPv4 address or prefix')}</span><input aria-label={t('Destination IPv4 address or prefix')} value={destinationPrefix} onChange={(event) => setDestinationPrefix(event.target.value)} required /></label>
          <label className="field"><span>{t('Expected communication')}</span><select aria-label={t('Expected communication')} value={expectation} onChange={(event) => setExpectation(event.target.value as 'allow' | 'deny')}><option value="allow">{t('Bidirectional reachability')}</option><option value="deny">{t('No forward reachability')}</option></select></label>
          <label className="field"><span>{t('Required firewall waypoint')}</span><select aria-label={t('Required firewall waypoint')} value={firewall} onChange={(event) => setFirewall(event.target.value)}><option value="">{t('No inspection requirement')}</option>{topology.hubs.map((hub) => <option key={hub.id} value={hub.id}>{hub.name}</option>)}</select></label>
        </div><button disabled={!source || !target || profile.intents.length >= 100}>{t('Add flow requirement')}</button>
      </form>
      <ul className="analysis-requirements">{profile.intents.map((intent) => <li key={intent.id}>
        <span>{name(intent.source)} · {intent.sourcePrefix} → {name(intent.target)} · {intent.destinationPrefix} · {t(intent.expectation === 'allow' ? 'Bidirectional reachability' : 'No forward reachability')}{intent.requiredFirewallHubId ? ` · ${t('Required firewall waypoint')}: ${topology.hubs.find((hub) => hub.id === intent.requiredFirewallHubId)?.name ?? intent.requiredFirewallHubId}` : ''}</span>
        <button aria-label={t('Remove flow requirement {0}', intent.sourcePrefix + ' → ' + intent.destinationPrefix)} onClick={() => change({ ...profile, intents: profile.intents.filter((entry) => entry.id !== intent.id) })}>{t('Remove')}</button>
      </li>)}</ul>
    </details>
    <details><summary>{t('Neighbor route requirements')}</summary>
      <form className="analysis-form" onSubmit={addConstraint}><div className="form-grid">
        <label className="field"><span>{t('Router')}</span><select aria-label={t('Route requirement router')} value={constraintRouter} onChange={(event) => { setConstraintRouter(event.target.value); setConstraintConnection('') }}><option value="">{t('Select router')}</option>{nodes.filter((node) => node.kind !== 'spoke').map((node) => <option key={key(node)} value={key(node)}>{node.name}</option>)}</select></label>
        <label className="field"><span>{t('Connection')}</span><select aria-label={t('Route requirement connection')} value={constraintConnection} onChange={(event) => setConstraintConnection(event.target.value)} required><option value="">{t('Select connection')}</option>{attachments.map((link) => <option key={link.id} value={link.id}>{link.name}</option>)}</select></label>
        <label className="field"><span>{t('Direction')}</span><select aria-label={t('Route requirement direction')} value={constraintDirection} onChange={(event) => setConstraintDirection(event.target.value as 'inbound' | 'outbound')}><option value="inbound">{t('Inbound')}</option><option value="outbound">{t('Outbound')}</option></select></label>
        <label className="field"><span>{t('Prefix')}</span><input aria-label={t('Route requirement prefix')} value={constraintPrefix} onChange={(event) => setConstraintPrefix(event.target.value)} required /></label>
        <label className="field"><span>{t('Expected route')}</span><select aria-label={t('Expected route')} value={constraintExpectation} onChange={(event) => setConstraintExpectation(event.target.value as 'present' | 'absent')}><option value="present">{t('Must be present')}</option><option value="absent">{t('Must be absent')}</option></select></label>
      </div><button disabled={!constraintConnection || (profile.exportConstraints?.length ?? 0) >= 100}>{t('Add route requirement')}</button></form>
      <ul className="analysis-requirements">{profile.exportConstraints?.map((constraint) => <li key={constraint.id}><span>{name(constraint.router)} · {constraint.connectionId} · {t(constraint.direction === 'inbound' ? 'Inbound' : 'Outbound')} · {constraint.prefix} · {t(constraint.expectation === 'present' ? 'Must be present' : 'Must be absent')}</span><button aria-label={t('Remove route requirement {0}', constraint.prefix)} onClick={() => change({ ...profile, exportConstraints: profile.exportConstraints?.filter((entry) => entry.id !== constraint.id) })}>{t('Remove')}</button></li>)}</ul>
    </details>
    <label className="checkbox-field"><input type="checkbox" checked={profile.failureAnalysis} onChange={(event) => change({ ...profile, failureAnalysis: event.target.checked })} />{t('Check single-link failures on a model copy (bounded; no Azure changes)')}</label>
    <div className="row dialog-actions"><button onClick={() => download(profile, 'vwan-analysis-profile.json')}>{t('Export analysis profile')}</button><button onClick={() => importer.current?.click()}>{t('Import analysis profile')}</button><button disabled={running || (!profile.intents.length && !profile.exportConstraints?.length)} className="primary" onClick={run}>{t('Run diagnostics')}</button>{running && <button onClick={() => { worker.current?.terminate(); worker.current = undefined; setRunScope(undefined) }}>{t('Cancel analysis')}</button>}</div>
    <input ref={importer} hidden type="file" accept=".json,application/json" aria-label={t('Import analysis profile file')} onChange={async (event) => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      const request = ++importRequest.current
      try {
        if (file.size > 256_000) throw new Error('size')
        const next = validateDiagnosticsProfile(JSON.parse(await file.text()))
        if (request === importRequest.current) change(next)
      } catch { if (request === importRequest.current) setError('Invalid analysis profile. Use canonical IPv4 addresses or network prefixes and valid flow requirements.') }
    }} />
    {error && <p className="notice error" role="alert">{t(error)}</p>}
    {running && <p role="status">{t('Analyzing routing in a local worker. You can cancel or continue editing the topology.')}</p>}
    {report && !currentReport && <p className="notice" role="status">{t('The routing configuration changed. Run diagnostics again; previous results are stale.')}</p>}
    {currentReport && <section aria-label={t('Diagnostic results')}>
      <p className={currentReport.complete ? 'notice analysis-complete' : 'notice'} role="status">{t(currentReport.complete ? 'Analysis completed within the requested model scope.' : 'Analysis is partial or some cases could not be assessed.')}
        {' '}{t('{0} probes · {1} address cells · {2} failure cases', currentReport.probes, currentReport.cells, currentReport.failureCases)}
        {' '}{Object.entries(severities).map(([value, label]) => `${t(label)}: ${currentReport.findings.filter((finding) => finding.severity === value).length}`).join(' · ')}</p>
      {currentReport.limitations.map((limitation) => <p className="notice" key={limitation}>{t(limitation)}</p>)}
      <div className="form-grid">
        <label className="field"><span>{t('Severity')}</span><select aria-label={t('Diagnostic severity')} value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="">{t('All severities')}</option>{Object.entries(severities).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label>
        <label className="field"><span>{t('Diagnostic category')}</span><select aria-label={t('Diagnostic category')} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{t('All categories')}</option>{categories.map(([rule, title]) => <option key={rule} value={rule}>{t(title)}</option>)}</select></label>
        <label className="field"><span>{t('Node')}</span><select aria-label={t('Diagnostic node filter')} value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)}><option value="">{t('All nodes')}</option>{nodes.map((node) => <option key={key(node)} value={key(node)}>{node.name}</option>)}</select></label>
        <label className="field"><span>{t('Filter by prefix or endpoint')}</span><input aria-label={t('Filter by prefix or endpoint')} value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      </div>
      <p className="muted">{t('Forward and return paths use different destination colors. Symmetric ECMP candidates do not prove symmetric traffic hashing.')}</p>
      <div className="flow-results">{visible.map((finding) => <article key={finding.id} className={`diagnostic-finding ${finding.severity}`}>
        <div className="row"><span className="diagnostic-severity">{t(severities[finding.severity])}</span><button className="finding-title" onClick={() => onFinding(finding)}>{t(finding.title)}</button></div>
        <p>{t(finding.detail)}</p>
        {finding.source && <p>{name(finding.source)} · {finding.sourceAddress ?? finding.prefix} → {name(finding.target)} · {finding.destinationAddress ?? finding.prefix}</p>}
        <small>{t(finding.confidence === 'modeled' ? 'Modeled result' : finding.confidence === 'risk' ? 'Potential risk' : 'Unknown')}</small>
        <details><summary>{t('Evidence and investigation')}</summary>
          <ul>{finding.evidence.map((evidence, index) => <li key={index}><code>{evidence.code}</code> · {evidence.nodeId ? topologyObject(topology, finding.related.find((node) => node.id === evidence.nodeId) ?? { kind: 'hub', id: evidence.nodeId })?.name ?? evidence.nodeId : ''} {evidence.prefix} {evidence.connectionId}</li>)}</ul>
          <div className="row">{finding.related.filter((node) => ['hub', 'site', 'erLocation'].includes(node.kind) && topologyObject(topology, node)).slice(0, 4).map((node) => <button key={key(node)} onClick={() => onInspect(node)}>{t('Inspect routes: {0}', topologyObject(topology, node)?.name)}</button>)}</div>
          {([['Forward', finding.forward], ['Return', finding.reverse]] as const).map(([direction, paths]) => <div key={direction}><h4>{t(direction)}</h4>{paths.map((path, index) => <details key={index}><summary>{t(path.status === 'delivered' ? 'Reachable' : path.status === 'loop' ? 'Forwarding loop' : 'No route')} · {index + 1}</summary><ol>{path.steps.map((step, index) => <li key={index}>{localizeDiagnostic(step)}</li>)}</ol></details>)}</div>)}
        </details>
      </article>)}</div>
      {!visible.length && <p className="empty">{t('No findings match these filters. Review the assessed scope and limitations before drawing conclusions.')}</p>}
      <button onClick={() => download({ kind: 'vwan-routing-diagnostics', version: 1, profile, report: currentReport }, 'vwan-diagnostics-report.json')}>{t('Export diagnostic report')}</button>
    </section>}
    <p className="muted">{t('Profiles and reports are local downloads containing addresses, object IDs and modeled route details. Nothing is sent to Azure or feedback.')}</p>
  </CanvasOverlay>
}
