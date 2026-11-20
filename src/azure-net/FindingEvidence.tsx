import { t } from '../i18n'
import './inspection-messages-ja'
import { azFindingFlows, type AzDiagnosticFinding } from './diagnostics'
import type { InspectionEvidence } from './inspection-evidence'

function Direction({ label, evidence }: { label: string; evidence: InspectionEvidence['forward'] }) {
  return <section aria-label={label} data-testid={`aznet-inspection-${label === t('Forward') ? 'forward' : 'reverse'}`}>
    <p><strong>{label}: {evidence.from} ({evidence.sourceIp}) → {evidence.to} ({evidence.destinationIp})</strong></p>
    <p>{t('Modeled path')}: {evidence.path.join(' → ')}</p>
    <p>{t('Inspection')}: {evidence.inspected.length ? evidence.inspected.join(', ') : t('None')}.
      {' '}{evidence.bypassed.length > 0 && t('Bypasses {0}. Stateful inspection may drop traffic because both directions do not traverse the same appliance.', evidence.bypassed.join(', '))}</p>
    {evidence.routes.map((route, index) => <p key={index} data-testid="aznet-inspection-route">
      {route.vnetName}/{route.subnetName}: <code>{route.prefix}</code> · {route.source} → {route.nextHop}
      {' '}({t('Route table')}: {route.routeTable ?? t('No associated route table')})
    </p>)}
  </section>
}

export default function FindingEvidence({ finding, onTrace, onConfigure }: {
  finding: AzDiagnosticFinding; onTrace: (finding: AzDiagnosticFinding) => void
  onConfigure: (vnetId: string, subnetId: string) => void
}) {
  const inspection = finding.inspection
  const flows = azFindingFlows([finding])
  return <>
    {inspection && <div data-testid="aznet-inspection-evidence">
      <p><strong>{t('Representative pair: directional inspection and route evidence')}</strong></p>
      <Direction label={t('Forward')} evidence={inspection.forward} />
      <Direction label={t('Return')} evidence={inspection.reverse} />
      <p>{t('Divergence evidence: compare the selected subnet routes above. Paths represent sampled addresses, not exhaustive ECMP, live delivery or firewall policy/session validation.')}</p>
      {inspection.repairs.length ? inspection.repairs.map((repair, index) => <div key={index} data-testid="aznet-inspection-repair">
        <p>{t('Bypass route decision: {0}.', `${repair.vnetName}/${repair.subnetName}`)}</p>
        <p><strong>{t('Proposed, unverified repair')} · {t(repair.direction === 'forward' ? 'Forward' : 'Return')}</strong></p>
        <p>{repair.tableName
          ? t('{0}: {1} a {2} UDR in route table {3}.', `${repair.vnetName}/${repair.subnetName}`, t(repair.replacing ? 'Change' : 'Add'), repair.prefix, repair.tableName)
          : t('{0}: create a same-region route table, associate it with this subnet and add a {1} UDR.', `${repair.vnetName}/${repair.subnetName}`, repair.prefix)}
          {' '}{t('Next hop: VirtualAppliance {0} ({1}).', repair.nextHopIp, repair.applianceName)}</p>
        <p>{t('This steers the destination prefix toward the appliance missing from this direction. The proposed path has not been retraced.')}</p>
        <p>{t('This table affects {0} associated subnets. Keep required gateway/BGP routes; recheck both directions and other affected flows before adopting the change.', repair.sharedSubnets)}</p>
        <button type="button" className="aznet-btn" onClick={() => onConfigure(repair.vnetId, repair.subnetId)}>
          {t('Configure {0}', `${repair.vnetName}/${repair.subnetName}`)}
        </button>
      </div>) : <p>{t('No safe subnet UDR proposal established. Inspect the directional routes and design the required service chain; do not assume a default route is a repair.')}</p>}
    </div>}
    <div style={{ fontSize: 11.5, color: 'var(--info)', background: 'var(--surface-muted)', padding: '6px 8px', borderRadius: 5 }}>
      <strong>{t('Remediation:')}</strong> {finding.remediation}
    </div>
    {finding.occurrences?.some((entry) => entry.sampleFlow) && <details data-testid="aznet-affected-flows">
      <summary>{t('Affected flows and directional evidence')}</summary>
      {flows.map((entry) => <div key={entry.id}>
        <p>{entry.sampleFlow!.sourceIp} ↔ {entry.sampleFlow!.destinationIp}: {entry.summary}</p>
        {entry.inspection && <>
          <Direction label={t('Forward')} evidence={entry.inspection.forward} />
          <Direction label={t('Return')} evidence={entry.inspection.reverse} />
        </>}
        <button type="button" className="aznet-btn" onClick={() => onTrace(entry)}>{t('Trace affected flow')}</button>
      </div>)}
    </details>}
  </>
}
