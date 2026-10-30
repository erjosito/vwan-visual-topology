import { useState } from 'react'
import { CanvasOverlay } from './CanvasOverlay'
import { localizeDiagnostic, t } from './i18n'
import type { DiagnosticsFinding, DiagnosticsReport } from './diagnostics'
import type { ObjectSelection, Topology } from './model'
import { topologyObject } from './model'

export function RoutingIssuesPanel({ topology, report, object, onFinding, onInspect, onClose }: {
  topology: Topology; report: DiagnosticsReport; object?: ObjectSelection
  onFinding: (finding: DiagnosticsFinding) => void; onInspect: (object: ObjectSelection) => void; onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const name = (node?: ObjectSelection) => node ? topologyObject(topology, node)?.name ?? node.id : ''
  const findings = report.findings.filter((finding) => finding.severity !== 'info'
    && (!object || [finding.source, finding.target, ...finding.related].some((node) => node?.kind === object.kind && node.id === object.id))
    && (!filter || [finding.prefix, finding.sourceAddress, finding.destinationAddress, name(finding.source), name(finding.target), t(finding.title), t(finding.detail)]
      .some((value) => value?.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))))
  const severity = { error: 'Error', warning: 'Warning', unknown: 'Not assessed', info: 'Information' } as const
  return <CanvasOverlay title={t('Routing issues')} className="routing-issues-panel" onClose={onClose}>
    {object && <h3>{name(object)}</h3>}
    <p className="muted">{t('Checks cover modeled connectivity between assigned networks and saved requirements. Intentional isolation may need an explicit requirement. Actual hosts, firewall rules and NAT are not verified.')}</p>
    {!report.complete && <p className="notice" role="status">{t('Routing check is incomplete. Some networks or scenarios could not be assessed.')}</p>}
    {report.limitations.map((limitation) => <p className="notice" key={limitation}>{t(limitation)}</p>)}
    <label className="field"><span>{t('Filter by prefix or endpoint')}</span><input aria-label={t('Filter routing issues')} value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleCount(50) }} /></label>
    <div className="flow-results">{findings.slice(0, visibleCount).map((finding) => <article key={finding.id} className={`diagnostic-finding ${finding.severity}`}>
      <div className="row"><span className="diagnostic-severity">{t(severity[finding.severity])}</span><strong>{t(finding.title)}</strong></div>
      <p>{t(finding.detail)}</p>
      {finding.source && <p>{name(finding.source)} · {finding.sourceAddress} → {name(finding.target)} · {finding.destinationAddress}</p>}
      {finding.prefix && <p><code>{finding.prefix}</code></p>}
      <small>{t(finding.confidence === 'modeled' ? 'Modeled result' : finding.confidence === 'risk' ? 'Potential risk' : 'Unknown')}</small>
      <div className="row">
        {!!(finding.forward.length || finding.reverse.length) && <button onClick={() => onFinding(finding)}>{t('Highlight issue paths')}</button>}
        {finding.related.filter((node) => ['hub', 'site', 'erLocation'].includes(node.kind) && topologyObject(topology, node)).slice(0, 3).map((node) =>
          <button key={`${node.kind}:${node.id}`} onClick={() => onInspect(node)}>{t('Inspect routes: {0}', name(node))}</button>)}
      </div>
      <details><summary>{t('Evidence and investigation')}</summary>
        <ul>{finding.evidence.map((evidence, index) => <li key={index}><code>{evidence.code}</code> {evidence.prefix} {evidence.connectionId}</li>)}</ul>
        {([['Forward', finding.forward], ['Return', finding.reverse]] as const).map(([direction, paths]) => <div key={direction}>
          <h4>{t(direction)}</h4>{paths.map((path, index) => <details key={index}><summary>{t(path.status === 'delivered' ? 'Reachable' : path.status === 'loop' ? 'Forwarding loop' : 'No route')} · {index + 1}</summary>
            <ol>{path.steps.map((step, index) => <li key={index}>{localizeDiagnostic(step)}</li>)}</ol>
          </details>)}
        </div>)}
      </details>
    </article>)}</div>
    {!findings.length && <p className="empty">{t(report.complete ? 'No routing issues found within the checked model scope.' : 'No matching issues. The incomplete check is not a clean bill of health.')}</p>}
    {findings.length > visibleCount && <button onClick={() => setVisibleCount((count) => count + 50)}>{t('Show more issues ({0} remaining)', findings.length - visibleCount)}</button>}
  </CanvasOverlay>
}
