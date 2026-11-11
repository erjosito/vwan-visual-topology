import { useState } from 'react'
import { failureKey, failureLabel, type FailureDomain } from './failures'
import type { ResilienceReport } from './failure-analysis'
import './failures.css'

export function FailurePanel({ faults, unassessed, onRestore, onRestoreAll, analyze, onSimulate, revision, onReport, focusEndpoint }: {
  faults: FailureDomain[]; unassessed: string[]; onRestore: (fault: FailureDomain) => void; onRestoreAll: () => void
  analyze: () => ResilienceReport; onSimulate: (fault: FailureDomain) => void; revision: string
  onReport?: (report: ResilienceReport) => void; focusEndpoint?: string
}) {
  const [result, setResult] = useState<{ revision: string; report: ResilienceReport }>()
  const report = result?.revision === revision ? result.report : undefined
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
      {report && <div data-testid="resilience-results" role="status">
        <strong>{report.gaps.length} N-1 resilience gaps — {report.complete ? 'checked model scope complete' : 'coverage incomplete; N-1 resilience not established'}</strong>
        <p>Baseline: checked {report.baselineChecked}/{report.totalPairs} pairs; {report.baselineWorking} working, {report.baselineFaults} baseline connectivity faults, {report.baselineUnknown} unassessed.
          {' '}Failures: {report.checkedScenarios}/{report.totalScenarios} scenarios; {report.checkedCases}/{report.totalCases} baseline-working pair/scenario cases.
          {' '}{report.endpointUnavailable} unavailable-endpoint cases (service recovery unassessed), {report.unknownCases} unassessed routing cases.</p>
        {report.gaps.map((gap) => <details key={`${gap.pairId}:${failureKey(gap.fault)}`} open={focusEndpoint && gap.endpointIds.includes(focusEndpoint) ? true : undefined}>
          <summary>△ Resilience gap: {gap.name} — loss of {failureLabel(gap.fault)}</summary>
          <p>These endpoints survive this fault, but no usable independently routed alternate with symmetric stateful inspection survives.
            {' '}{gap.remediation} This is not an availability guarantee.</p>
          <button onClick={() => onSimulate(gap.fault)}>Simulate loss of {failureLabel(gap.fault)}</button>
          <details><summary>Baseline forward / return evidence</summary><pre>{gap.baseline.forward.join('\n')}{'\nRETURN\n'}{gap.baseline.reverse.join('\n')}</pre></details>
          <details><summary>Failure forward / return evidence</summary><pre>{gap.failed.forward.join('\n')}{'\nRETURN\n'}{gap.failed.reverse.join('\n')}</pre></details>
        </details>)}
        <ul>{report.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul>
      </div>}
    </details>
  </section>
}
