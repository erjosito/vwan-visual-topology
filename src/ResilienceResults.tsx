import { failureLabel, type FailureDomain } from './failures'
import { groupResilienceGaps, type ResilienceReport } from './failure-analysis'

export default function ResilienceResults({ report, focusEndpoint, onSimulate }: {
  report: ResilienceReport
  focusEndpoint?: string
  onSimulate: (fault: FailureDomain) => void
}) {
  const findings = groupResilienceGaps(report.gaps)
  return <div data-testid="resilience-results" data-root-count={findings.length} data-affected-cases={report.gaps.length} role="status">
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
  </div>
}
