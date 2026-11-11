import { diagnosticImpact, type DiagnosticsFinding } from './diagnostics'
import { localizeDiagnostic, t } from './i18n'
import { topologyObject, type Topology } from './model'

export function FindingFlows({ finding, topology, onFinding }: {
  finding: DiagnosticsFinding
  topology: Topology
  onFinding: (finding: DiagnosticsFinding) => void
}) {
  const impact = diagnosticImpact(finding)
  const members = (finding.occurrences ?? [finding]).filter((entry) => entry.source && entry.target)
  const name = (entry: DiagnosticsFinding['source']) => entry ? topologyObject(topology, entry)?.name ?? entry.id : ''
  return <>
    <p data-testid="vwan-root-impact">{t('1 root-cause issue; {0} affected flow pairs, {1} workload VNets, {2} sites, {3} prefixes.', impact.pairs, impact.workloads, impact.sites, impact.prefixes)}</p>
    {!!members.length && <details data-testid="vwan-affected-flows">
      <summary>{t('Affected flows and directional evidence')}</summary>
      {members.map((entry, index) => <div key={`${entry.id}:${index}`}>
        <p>{name(entry.source)} · {entry.sourceAddress} ↔ {name(entry.target)} · {entry.destinationAddress}</p>
        <button onClick={() => onFinding({ ...entry, id: finding.id })}>{t('Highlight affected flow')}</button>
        {([['Forward', entry.forward], ['Return', entry.reverse]] as const).map(([direction, paths]) => <details key={direction}>
          <summary>{t(direction)} · {paths.map((path) => path.status).join(', ') || t('Not assessed')}</summary>
          {paths.map((path, pathIndex) => <ol key={pathIndex}>{path.steps.map((step, stepIndex) =>
            <li key={stepIndex}>{localizeDiagnostic(step)}</li>)}</ol>)}
        </details>)}
      </div>)}
    </details>}
  </>
}
