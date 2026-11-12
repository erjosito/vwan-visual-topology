import { useState } from 'react'
import { failureKey, failureLabel, type FailureDomain } from './failures'
import { groupResilienceGaps, type ResilienceReport } from './failure-analysis'
import './failures.css'

export function FailurePanel({ faults, unassessed, onRestore, onRestoreAll, analyze, onSimulate, revision, onReport, focusEndpoint, presentReport }: {
  faults: FailureDomain[]; unassessed: string[]; onRestore: (fault: FailureDomain) => void; onRestoreAll: () => void
  analyze: () => ResilienceReport; onSimulate: (fault: FailureDomain) => void; revision: string
  onReport?: (report: ResilienceReport) => void; focusEndpoint?: string
  presentReport?: (report: ResilienceReport) => ResilienceReport
}) {
  const [result, setResult] = useState<{ revision: string; report: ResilienceReport }>()
  const rawReport = result?.revision === revision ? result.report : undefined
  const report = rawReport && presentReport ? presentReport(rawReport) : rawReport
  const findings = groupResilienceGaps(report?.gaps ?? [])
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
      {report && <div data-testid="resilience-results" data-root-count={findings.length} data-affected-cases={report.gaps.length} role="status">
        <strong>{findings.length} N-1 resilience gaps ({report.gaps.length} affected flow/scenario cases) — {report.complete ? 'checked model scope complete' : 'coverage incomplete; N-1 resilience not established'}</strong>
        <p>Baseline: checked {report.baselineChecked}/{report.totalPairs} pairs; {report.baselineWorking} working, {report.baselineFaults} baseline connectivity faults, {report.baselineUnknown} unassessed.
          {' '}Failures: {report.checkedScenarios}/{report.totalScenarios} scenarios; {report.checkedCases}/{report.totalCases} baseline-working pair/scenario cases.
          {' '}{report.endpointUnavailable} unavailable-endpoint cases (service recovery unassessed), {report.unknownCases} unassessed routing cases.</p>
        {findings.map((finding) => <details key={finding.id} data-finding-id={finding.id} data-scenario-id={finding.scenarioId} data-failure-domain-id={finding.fault.id} data-failure-domain-kind={finding.fault.kind}
          data-affected-pairs={new Set(finding.occurrences.map((gap) => gap.pairId)).size} open={focusEndpoint && finding.endpointIds.includes(focusEndpoint) ? true : undefined}>
          <summary>△ Resilience gap: loss of {failureLabel(finding.fault)} — {finding.occurrences.length} affected flow pairs</summary>
          <p>These endpoints survive this fault, but no usable independently routed alternate with symmetric stateful inspection survives.
            {' '}One group per failed domain; pair-specific routing causes and repair guidance remain below. This is not an availability guarantee.</p>
          <button onClick={() => onSimulate(finding.fault)}>Simulate loss of {failureLabel(finding.fault)}</button>
          {finding.occurrences.map((gap) => <details key={gap.id} data-occurrence-id={gap.id} data-resilience-pair-id={gap.pairId}
            open={focusEndpoint && gap.endpointIds.includes(focusEndpoint) ? true : undefined}>
            <summary>Affected flow: {gap.name}</summary>
            <p>{gap.remediation}</p>
            <details><summary>Baseline forward / return evidence</summary><pre>{gap.baseline.forward.join('\n')}{'\nRETURN\n'}{gap.baseline.reverse.join('\n')}</pre></details>
            <details><summary>Failure forward / return evidence</summary><pre>{gap.failed.forward.join('\n')}{'\nRETURN\n'}{gap.failed.reverse.join('\n')}</pre></details>
          </details>)}
        </details>)}
        <ul>{report.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul>
      </div>}
    </details>
  </section>
}
