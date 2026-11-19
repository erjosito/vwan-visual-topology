import { lazy, Suspense, useState } from 'react'
import { failureKey, failureLabel, type FailureDomain } from './failures'
import type { ResilienceReport } from './failure-analysis'
import './failures.css'

const ResilienceResults = lazy(() => import('./ResilienceResults'))

export function FailurePanel({ faults, unassessed, onRestore, onRestoreAll, analyze, onSimulate, revision, onReport, focusEndpoint, presentReport }: {
  faults: FailureDomain[]; unassessed: string[]; onRestore: (fault: FailureDomain) => void; onRestoreAll: () => void
  analyze: () => ResilienceReport; onSimulate: (fault: FailureDomain) => void; revision: string
  onReport?: (report: ResilienceReport) => void; focusEndpoint?: string
  presentReport?: (report: ResilienceReport) => ResilienceReport
}) {
  const [result, setResult] = useState<{ revision: string; report: ResilienceReport }>()
  const rawReport = result?.revision === revision ? result.report : undefined
  const report = rawReport && presentReport ? presentReport(rawReport) : rawReport
  return <section className="failure-controls" aria-label="Offline failure and resilience analysis">
    {!!faults.length && <div role="status" className="active-faults" data-testid="active-faults">
      <strong>× Simulated offline outage — not a configuration change</strong>
      {faults.map((fault) => <button key={failureKey(fault)} onClick={() => onRestore(fault)}>Restore {failureLabel(fault)}</button>)}
      <button onClick={onRestoreAll}>Restore all simulated failures</button>
      <p>Session-only overlay. Save, export, share and reload use the intact baseline, never the failed scenario.</p>
      {!!unassessed.length && <p>⚠ Regional outage coverage is incomplete: {unassessed.join(' ')}</p>}
    </div>}
    <details open={focusEndpoint ? true : undefined}>
      <summary>Failure-domain resilience analysis (N-1)</summary>
      <p>Checks baseline-working required landscape flows against each single site, ER-location and Azure-region loss, separately from current simulated outages.</p>
      <button onClick={() => { const report = analyze(); setResult({ revision, report }); onReport?.(report) }}>Analyze N-1 resilience</button>
      {!!unassessed.length && <p role="status">Regional coverage unassessed: {unassessed.join(' ')}</p>}
      {report && <Suspense fallback={null}><ResilienceResults report={report} focusEndpoint={focusEndpoint} onSimulate={onSimulate} /></Suspense>}
    </details>
  </section>
}
