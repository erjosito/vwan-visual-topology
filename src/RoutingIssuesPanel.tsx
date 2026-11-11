import { useState } from 'react'
import { CanvasOverlay } from './CanvasOverlay'
import { AnalysisCoverage } from './AnalysisCoverage'
import { FindingFlows } from './FindingFlows'
import { localizeDiagnostic, t } from './i18n'
import type { DiagnosticsFinding, DiagnosticsReport } from './diagnostics'
import { describeEvidenceSource, summarizeCoverage } from './diagnostics'
import type { ObjectSelection, RouterSelection, Topology } from './model'
import { topologyObject } from './model'
import { isolationLinkName } from './resilience'

export function RoutingIssuesPanel({ topology, report, findingId, selectedFindingId, coverageOpen, onFinding, onShowAll, onInspect, onEditObject, onOpenStaticRouting, onAssignPrefixToSite, onClose }: {
  topology: Topology; report: DiagnosticsReport; findingId?: string; selectedFindingId?: string; coverageOpen?: boolean
  onFinding: (finding: DiagnosticsFinding) => void; onInspect: (object: ObjectSelection) => void
  onEditObject?: (object: ObjectSelection) => void
  onOpenStaticRouting?: (router: RouterSelection) => void
  onAssignPrefixToSite?: (siteId: string, prefixes: string[]) => void
  onClose: () => void
  onShowAll: () => void
}) {
  const [filter, setFilter] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const name = (node?: ObjectSelection) => node ? topologyObject(topology, node)?.name ?? node.id : ''
  const coverage = summarizeCoverage(report)
  const allActionable = report.findings.filter((finding) => finding.severity !== 'info' && finding.severity !== 'unknown')
  const findings = allActionable.filter((finding) => (!findingId || finding.id === findingId)
    && (!filter || (finding.occurrences ?? [finding]).some((entry) =>
      [entry.prefix, entry.sourceAddress, entry.destinationAddress, name(entry.source), name(entry.target), t(entry.title), t(entry.detail)]
        .some((value) => value?.toLocaleLowerCase().includes(filter.toLocaleLowerCase())))))
  const severity = { error: 'Error', warning: 'Warning', unknown: 'Not assessed', info: 'Information' } as const
  return <CanvasOverlay title={t('Routing issues')} className="routing-issues-panel" onClose={onClose}>
    {findingId && <div className="row"><span className="muted">{t('Showing selected issue ({0} of {1})', findings.length, allActionable.length)}</span><button onClick={onShowAll}>{t('Show all routing issues')}</button></div>}
    <p className="muted">{t('Checks cover modeled connectivity between assigned networks and saved requirements. Intentional isolation may need an explicit requirement. Actual hosts, firewall rules and NAT are not verified.')}</p>
    <AnalysisCoverage report={report} topology={topology} initiallyOpen={coverageOpen} onEditObject={onEditObject} onOpenStaticRouting={onOpenStaticRouting} onAssignPrefixToSite={onAssignPrefixToSite} />
    <label className="field"><span>{t('Filter by prefix or endpoint')}</span><input aria-label={t('Filter routing issues')} value={filter} onChange={(event) => { setFilter(event.target.value); setVisibleCount(50) }} /></label>
    <div className="flow-results">{findings.slice(0, visibleCount).map((finding) => <article key={finding.id} className={`diagnostic-finding ${finding.severity}`}>
      <div className="row"><span className="diagnostic-severity">{t(severity[finding.severity])}</span><button className="finding-title" aria-pressed={selectedFindingId === finding.id} onClick={() => onFinding(finding)}>{t(finding.title)}</button></div>
      <p>{t(finding.detail)}</p>
      <FindingFlows finding={finding} topology={topology} onFinding={onFinding} />
      {!finding.source && <p>{t('Affected objects: {0}', finding.related.map(name).join(', '))}</p>}
      {finding.isolation && <div className="isolation-groups"><p>{t('Link: {0}', isolationLinkName(topology, finding.isolation))}</p>
        {finding.isolation.groups.map((group, index) => <p key={index}><strong>{t('Separated group {0} ({1} nodes)', index + 1, group.length)}</strong>: {group.map(name).join(', ')}</p>)}
      </div>}
      {finding.source && <p>{name(finding.source)} · {finding.sourceAddress} → {name(finding.target)} · {finding.destinationAddress}</p>}
      {finding.prefix && <p><code>{finding.prefix}</code></p>}
      <small>{t(finding.confidence === 'modeled' ? 'Modeled result' : finding.confidence === 'risk' ? 'Potential risk' : 'Unknown')}</small>
      <div className="row">
        {!!(finding.forward.length || finding.reverse.length) && <button onClick={() => onFinding(finding)}>{t('Highlight issue paths')}</button>}
        {finding.related.filter((node) => ['hub', 'site', 'erLocation'].includes(node.kind) && topologyObject(topology, node)).slice(0, 3).map((node) =>
          <button key={`${node.kind}:${node.id}`} onClick={() => onInspect(node)}>{t('Inspect routes: {0}', name(node))}</button>)}
      </div>
      <details><summary>{t('Evidence and investigation')}</summary>
        <ul>{finding.evidence.map((evidence, index) => <li key={index}><code>{evidence.code}</code> {evidence.prefix} {describeEvidenceSource(topology, evidence)}</li>)}</ul>
        {([['Forward', finding.forward], ['Return', finding.reverse]] as const).map(([direction, paths]) => <div key={direction}>
          <h4>{t(direction)}</h4>{paths.map((path, index) => <details key={index}><summary>{t(path.status === 'delivered' ? 'Reachable' : path.status === 'loop' ? 'Forwarding loop' : 'No route')} · {index + 1}</summary>
            <ol>{path.steps.map((step, index) => <li key={index}>{localizeDiagnostic(step)}</li>)}</ol>
          </details>)}
        </div>)}
      </details>
    </article>)}</div>
    {!findings.length && <p className="empty">{t(coverage.scanIncomplete
      ? 'No matching issues. The incomplete check is not a clean bill of health.'
      : coverage.noCheckablePairs || (coverage.unassignedPrefixes.length > 0 && report.probes === 0)
        ? 'Advertised networks have no declared owner. Assign site or VNet prefixes to verify end-to-end reachability.'
        : 'No routing issues found within the checked model scope.')}</p>}
    {findings.length > visibleCount && <button onClick={() => setVisibleCount((count) => count + 50)}>{t('Show more issues ({0} remaining)', findings.length - visibleCount)}</button>}
  </CanvasOverlay>
}
