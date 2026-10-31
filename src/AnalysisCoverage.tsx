import { useState } from 'react'
import type { DiagnosticsReport } from './diagnostics'
import { describeEvidenceSource, summarizeCoverage } from './diagnostics'
import { t } from './i18n'
import type { ObjectSelection, RouterSelection, Topology } from './model'
import { topologyObject } from './model'

export function AnalysisCoverage({ report, topology, initiallyOpen = false, onEditObject, onOpenStaticRouting, onAssignPrefixToSite }: {
  report: DiagnosticsReport; topology: Topology; initiallyOpen?: boolean
  onEditObject?: (node: ObjectSelection) => void
  onOpenStaticRouting?: (router: RouterSelection) => void
  onAssignPrefixToSite?: (siteId: string, prefixes: string[]) => void
}) {
  const [visibleCount, setVisibleCount] = useState(50)
  const coverage = summarizeCoverage(report)
  const name = (node?: ObjectSelection) => node ? topologyObject(topology, node)?.name ?? node.id : ''
  const budgetLabels: Record<string, string> = { maxCells: 'Address cells', maxProbes: 'Uncached path traces', maxFindings: 'Findings', maxFailureCases: 'Routing failure scenarios', maxMillis: 'Elapsed time' }
  if (!coverage.hasNotes) return null
  return <details className="analysis-coverage" open={initiallyOpen}>
    <summary>{t('Analysis coverage and model limitations')}</summary>
    <p>{t('These are coverage notes, not detected routing faults. Missing prefix ownership can be updated in the topology; model scope boundaries describe features outside the current simulator.')}</p>
    {report.budget && <p>{t('Limits: {0} address cells · {1} uncached path traces · {2} findings · {3} seconds', report.budget.maxCells, report.budget.maxProbes, report.budget.maxFindings, report.budget.maxMillis / 1000)}</p>}
    {report.budget && <p>{t('Optional route-recomputation limit: {0} failure scenarios', report.budget.maxFailureCases)}</p>}
    {coverage.scanIncomplete && <section className="coverage-section">
      <h4>{t('Incomplete scan')}</h4>
      {report.limitsReached?.map((key) => <p key={key}>{t('Reached limit: {0}', t(budgetLabels[key] ?? key))}</p>)}
      {coverage.scanLimitations.map((limitation) => <p key={limitation}>{t(limitation)}</p>)}
      {coverage.otherUnknownFindings.slice(0, visibleCount).map((finding) => <article className="coverage-note" key={finding.id}>
        <strong>{t(finding.title)}</strong><p>{t(finding.detail)}</p>
        <p>{finding.source ? `${name(finding.source)} ${finding.sourceAddress ?? ''} → ${name(finding.target)} ${finding.destinationAddress ?? ''}`
          : finding.related.map(name).join(', ')} {finding.prefix}</p>
        <details><summary>{t('Evidence and investigation')}</summary>
          <ul>{finding.evidence.map((evidence, index) => <li key={index}><code>{t(evidence.code)}</code> {evidence.prefix} {describeEvidenceSource(topology, evidence)}</li>)}</ul>
        </details>
      </article>)}
      {coverage.otherUnknownFindings.length > visibleCount && <button onClick={() => setVisibleCount((count) => count + 50)}>{t('Show more coverage notes ({0} remaining)', coverage.otherUnknownFindings.length - visibleCount)}</button>}
    </section>}
    {(coverage.unassignedFindings.length > 0 || coverage.noCheckablePairs) && <section className="coverage-section">
      <h4>{t('Unassigned advertised prefixes')}</h4>
      <p className="muted">{t('These advertised or static prefixes are not contained in any site or VNet owned prefix list. Assign them to the owning site or VNet (or remove unused connection routes) to verify end-to-end reachability.')}</p>
      {coverage.noCheckablePairs && <p>{t('No network pairs could be checked. Add assigned networks to at least two endpoints.')}</p>}
      {coverage.unassignedFindings.map((finding) => {
        const owner = finding.related[0]
        const site = owner?.kind === 'site' ? topology.sites.find((item) => item.id === owner.id) : undefined
        const hasStaticRoutes = !!site && finding.evidence.some((evidence) =>
          site.vpnStaticRoutes?.some((route) => route.connectionId === evidence.connectionId && route.prefix === evidence.prefix))
        const unassignedSitePrefixes = site ? [...new Set(finding.evidence.map((e) => e.prefix).filter((p): p is string => typeof p === 'string' && !site.prefixes.includes(p)))] : []
        return <article className="coverage-note" key={finding.id}>
          <div className="row">
            <strong>{t(finding.title)}</strong>
            {site && onAssignPrefixToSite && unassignedSitePrefixes.map((prefix) => (
              <button key={`assign:${prefix}`} type="button" className="ghost" onClick={() => onAssignPrefixToSite(site.id, [prefix])}>{t('Assign {0} to {1}', prefix, site.name)}</button>
            ))}
            {site && onAssignPrefixToSite && unassignedSitePrefixes.length > 1 && (
              <button type="button" className="ghost" onClick={() => onAssignPrefixToSite(site.id, unassignedSitePrefixes)}>{t('Assign all ({0}) to {1}', unassignedSitePrefixes.length, site.name)}</button>
            )}
            {owner && onEditObject && <button type="button" className="ghost" onClick={() => onEditObject(owner)}>{t('Edit {0}', name(owner))}</button>}
            {site && hasStaticRoutes && onOpenStaticRouting && (
              <button type="button" className="ghost" onClick={() => onOpenStaticRouting({ kind: 'site', id: site.id })}>{t('Static routing: {0}', site.name)}</button>
            )}
          </div>
          <p>{t(finding.detail)}</p>
          <p>{finding.related.map(name).join(', ')} · <code>{finding.prefix}</code></p>
          <ul className="coverage-sources">
            {finding.evidence.map((evidence, index) => (
              <li key={index}><code>{evidence.prefix}</code> — {describeEvidenceSource(topology, evidence, owner?.id)}</li>
            ))}
          </ul>
          <details><summary>{t('Evidence and investigation')}</summary>
            <ul>{finding.evidence.map((evidence, index) => <li key={index}><code>{t(evidence.code)}</code> <code>{evidence.prefix}</code> — {describeEvidenceSource(topology, evidence, owner?.id)}</li>)}</ul>
            <p className="muted">{t('To resolve: either assign the prefix to the owning site or VNet, or open the connection advertisements / static routes above and remove the unused route.')}</p>
          </details>
        </article>
      })}
    </section>}
    {coverage.unsupportedGroups.length > 0 && <section className="coverage-section">
      <h4>{t('Model scope boundaries')}</h4>
      <p className="muted">{t('These endpoint pairs touch routing behaviors that are not modeled by the simulator. Rerunning an unchanged topology will not resolve them.')}</p>
      {coverage.unsupportedGroups.map((group) => <article className="coverage-note" key={group.code}>
        <strong>{t(group.limitation)}</strong>
        <p>{group.findings.length === 1
          ? t('1 endpoint pair skipped because this routing behavior is outside the current model.')
          : t('{0} endpoint pairs skipped because this routing behavior is outside the current model.', group.findings.length)}</p>
        <details><summary>{t('Affected endpoint pairs ({0})', group.findings.length)}</summary>
          <ul>{group.findings.slice(0, visibleCount).map((finding) => <li key={finding.id}>
            {finding.source ? `${name(finding.source)} ${finding.sourceAddress ?? ''} → ${name(finding.target)} ${finding.destinationAddress ?? ''}` : finding.related.map(name).join(', ')}
            {finding.prefix ? <> · <code>{finding.prefix}</code></> : null}
          </li>)}</ul>
          {group.findings.length > visibleCount && <button onClick={() => setVisibleCount((count) => count + 50)}>{t('Show more coverage notes ({0} remaining)', group.findings.length - visibleCount)}</button>}
        </details>
      </article>)}
    </section>}
  </details>
}
