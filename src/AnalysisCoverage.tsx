import { useState } from 'react'
import type { DiagnosticsReport } from './diagnostics'
import { t } from './i18n'
import type { ObjectSelection, Topology } from './model'
import { topologyObject } from './model'

export function AnalysisCoverage({ report, topology, initiallyOpen = false }: {
  report: DiagnosticsReport; topology: Topology; initiallyOpen?: boolean
}) {
  const [visibleCount, setVisibleCount] = useState(50)
  const notes = report.findings.filter((finding) => finding.severity === 'unknown')
  const name = (node?: ObjectSelection) => node ? topologyObject(topology, node)?.name ?? node.id : ''
  const budgetLabels: Record<string, string> = { maxCells: 'Address cells', maxProbes: 'Uncached path traces', maxFindings: 'Findings', maxFailureCases: 'Routing failure scenarios', maxMillis: 'Elapsed time' }
  if (report.complete && !report.limitations.length && !notes.length) return null
  return <details className="analysis-coverage" open={initiallyOpen}>
    <summary>{t('Analysis coverage and model limitations')}</summary>
    <p>{t('These are unassessed cases, not detected routing faults. Incomplete coverage does not establish that the network is healthy.')}</p>
    <p>{t('Missing prefix assignments can be corrected in the topology. Unsupported simulation features are application limitations; rerunning an unchanged model will not resolve them.')}</p>
    {report.budget && <p>{t('Limits: {0} address cells · {1} uncached path traces · {2} findings · {3} seconds', report.budget.maxCells, report.budget.maxProbes, report.budget.maxFindings, report.budget.maxMillis / 1000)}</p>}
    {report.budget && <p>{t('Optional route-recomputation limit: {0} failure scenarios', report.budget.maxFailureCases)}</p>}
    {report.limitsReached?.map((key) => <p key={key}>{t('Reached limit: {0}', t(budgetLabels[key] ?? key))}</p>)}
    {report.limitations.map((limitation) => <p key={limitation}>{t(limitation)}</p>)}
    {notes.slice(0, visibleCount).map((finding) => <article className="coverage-note" key={finding.id}>
      <strong>{t(finding.title)}</strong><p>{t(finding.detail)}</p>
      <p>{finding.source ? `${name(finding.source)} ${finding.sourceAddress ?? ''} → ${name(finding.target)} ${finding.destinationAddress ?? ''}`
        : finding.related.map(name).join(', ')} {finding.prefix}</p>
      <details><summary>{t('Evidence and investigation')}</summary>
        <ul>{finding.evidence.map((evidence, index) => <li key={index}><code>{t(evidence.code)}</code> {evidence.prefix} {evidence.connectionId}</li>)}</ul>
      </details>
    </article>)}
    {notes.length > visibleCount && <button onClick={() => setVisibleCount((count) => count + 50)}>{t('Show more coverage notes ({0} remaining)', notes.length - visibleCount)}</button>}
  </details>
}
