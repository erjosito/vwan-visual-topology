import { useState } from 'react'
import './packet-messages-ja'
import { t } from './i18n'
import { guidanceAnchor } from './learning/guidance'
import type { InventoryTopology } from './inventory'
import type { Simulation } from './routing'
import type { AzSimulationResult } from './azure-net/engine'
import { packetEndpointOptions, tracePacket, type FiveTuple, type PacketEndpoint, type PacketResult } from './packet-flow'

const tupleText = (tuple: FiveTuple) => `${tuple.protocol.toUpperCase()} ${tuple.sourceAddress}:${tuple.sourcePort} -> ${tuple.destinationAddress}:${tuple.destinationPort}`

export function PacketFlowPanel({ topology, simulation, onHighlight, guidanceVnetId }: {
  topology: InventoryTopology; simulation: Simulation | AzSimulationResult; onHighlight?: (id: string) => void; guidanceVnetId?: string
}) {
  const options = packetEndpointOptions(topology, t('Address unknown'))
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [externalAddress, setExternalAddress] = useState('')
  const [protocol, setProtocol] = useState<'tcp' | 'udp'>('tcp')
  const [sourcePort, setSourcePort] = useState('49152')
  const [destinationPort, setDestinationPort] = useState('443')
  const [search, setSearch] = useState('')
  const [submitted, setSubmitted] = useState<{ key: string; result: PacketResult }>()
  const [error, setError] = useState('')
  const currentKey = JSON.stringify([topology, source, target, externalAddress, protocol, sourcePort, destinationPort])
  const result = submitted?.key === currentKey ? submitted.result : undefined
  const visible = options.filter((option) => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).slice(0, 100)
  const lbOptions = (topology.inventory?.loadBalancers ?? []).flatMap((lb) => lb.frontends.filter((frontend) => frontend.kind === 'private')
    .map((frontend) => ({ key: JSON.stringify(['lb', lb.id, frontend.id]), ref: { kind: 'load-balancer' as const, loadBalancerId: lb.id, frontendId: frontend.id },
      label: `${t('Internal LB frontend')}: ${lb.name} / ${frontend.name} (${frontend.kind === 'private' ? frontend.privateIp ?? t('Address unknown') : ''})` })))
  const visibleLbs = lbOptions.filter((option) => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).slice(0, 100)
  const resolve = (key: string): PacketEndpoint | undefined => key === 'external'
    ? { kind: 'external', address: externalAddress } : key.startsWith('public:')
      ? { kind: 'public-ip', publicIpId: key.slice('public:'.length) } : lbOptions.find((option) => option.key === key)?.ref ?? options.find((option) => option.key === key)?.ref
  const select = (kind: 'source' | 'target', value: string, change: (value: string) => void) => <label>
    {t(kind === 'source' ? 'Packet source' : 'Packet destination')}
    <select value={value} onChange={(event) => change(event.target.value)} aria-label={t(kind === 'source' ? 'Packet source' : 'Packet destination')}>
      <option value="">{t('Select an IP configuration')}</option>
      <option value="external">{t('Explicit Internet endpoint')}</option>
      {kind === 'target' && topology.inventory?.publicIps.map((ip) => <option key={ip.id} value={`public:${ip.id}`}>
        {t('Public ingress frontend')}: {ip.name} ({ip.address ?? t('Address unknown')})
      </option>)}
      {kind === 'target' && lbOptions.find((option) => option.key === value) && !visibleLbs.some((option) => option.key === value)
        && <option value={value}>{lbOptions.find((option) => option.key === value)!.label}</option>}
      {kind === 'target' && visibleLbs.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      {value && !visible.some((option) => option.key === value) && options.find((option) => option.key === value) && <option value={value}>{options.find((option) => option.key === value)!.label}</option>}
      {visible.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>
  </label>
  return <section className="packet-panel" aria-label={t('Workload packet probe')} data-testid="packet-flow-panel">
    <h3>{t('Workload packet probe')}</h3>
    <p>{t('Forward/reply routing with explicit Internet egress, public ingress and private-tuple NSGs where supported. Inverse translations are conditional responses, not new reverse initiations; listeners and application delivery remain unassessed.')}</p>
    <form data-learning-anchor={guidanceVnetId ? guidanceAnchor('packet-probe', guidanceVnetId) : undefined} onSubmit={(event) => {
      event.preventDefault()
      try {
        const from = resolve(source), to = resolve(target)
        if (!from || !to) throw new Error(t('Select both packet endpoints.'))
        setSubmitted({ key: currentKey, result: tracePacket(topology, {
          source: from, target: to, protocol, sourcePort: Number(sourcePort), destinationPort: Number(destinationPort),
        }, simulation) })
        setError('')
      } catch (error) { setError(error instanceof Error ? error.message : t('Packet probe failed.')) }
    }}>
      <label>{t('Search workload endpoints')}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <p>{t('Showing up to 100 matching IP configurations. Search to narrow the list.')}</p>
      {select('source', source, setSource)}{select('target', target, setTarget)}
      {(source === 'external' || target === 'external') && <label>{t('External IPv4 address')}<input required value={externalAddress} onChange={(event) => setExternalAddress(event.target.value)} /></label>}
      <label>{t('Protocol')}<select aria-label={t('Protocol')} value={protocol} onChange={(event) => setProtocol(event.target.value as 'tcp' | 'udp')}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
      <label>{t('Source port')}<input type="number" min="1" max="65535" required value={sourcePort} onChange={(event) => setSourcePort(event.target.value)} /></label>
      <label>{t('Destination port')}<input type="number" min="1" max="65535" required value={destinationPort} onChange={(event) => setDestinationPort(event.target.value)} /></label>
      <button type="submit">{t('Trace packet routing')}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {submitted && !result && <p role="status">{t('The topology or probe changed. Run the probe again for current evidence.')}</p>}
    {result && <div data-testid="packet-flow-result">
      {result.haPorts && <section data-testid="packet-ha-ports-result" aria-label={t('HA ports steering')}>
        <h4>{t('HA ports steering')}: {t(result.haPorts.symmetry)}</h4>
        <p>{t('Original packet addresses and ports are preserved. Backend selection is illustrative; return routing is checked independently. This is not live failover or session continuity.')}</p>
        {(['forward', 'reply'] as const).map((direction) => <div key={direction}>
          <strong>{t(direction === 'forward' ? 'Forward routing' : 'Reply routing')}</strong>
          {result.haPorts![direction].map((assessment, index) => <article key={index}>
            <code>{assessment.loadBalancerId} · {assessment.frontendId} · {assessment.ruleId} · {assessment.poolId}</code>
            <p>{t(assessment.reason)}</p>
            <p>{t('Known eligible backends')}: {assessment.eligible.length}</p>
            {assessment.selected && <p>{t('Illustrative backend')}: <code>{assessment.selected.workloadId} · {assessment.selected.nicId} · {assessment.selected.ipConfigurationId}</code>{' '}
              {onHighlight && <button type="button" onClick={() => onHighlight(assessment.selected!.workloadId)}>{t('Highlight original backend')}</button>}
            </p>}
            <details><summary>{t('Independent probe checks')} ({assessment.probes.length})</summary>
              {assessment.probes.map((probe) => <p key={JSON.stringify(probe.target)}><code>{probe.target.workloadId}</code> · {t(probe.declared)} · {t(probe.eligibility)}
                {probe.checks.map((check, index) => <span key={index}> · <code>{check.nsgId ?? check.target.id} · {check.ruleId}</code>: {t(check.outcome)}</span>)}
              </p>)}
            </details>
          </article>)}
        </div>)}
      </section>}
      {result.ingress && <p><strong>{t(result.loadBalancer ? 'Load Balancer ingress' : 'Public ingress')}: {t(result.ingress)}</strong></p>}
      {result.loadBalancer && <section data-testid="packet-lb-result" aria-label={t('Load Balancer selection')}>
        <h4>{t('Load Balancer selection')}: <code>{result.loadBalancer.id} · {result.loadBalancer.ruleId}</code></h4>
        <p>{t('Illustrative new-flow selection, not an observed Azure hash or session. Unknown health stays unknown; client data rules are evaluated separately.')}</p>
        <p>{t('Known eligible backends')}: {result.loadBalancer.eligible.length}</p>
        {result.loadBalancer.selected && <p>{t('Illustrative backend')}: <code>{result.loadBalancer.selected.workloadId} · {result.loadBalancer.selected.nicId} · {result.loadBalancer.selected.ipConfigurationId}</code></p>}
        <details><summary>{t('Independent probe checks')} ({result.loadBalancer.probes.length})</summary>
          {result.loadBalancer.probes.slice(0, 100).map((probe) => <article key={JSON.stringify(probe.target)}>
            <code>{probe.target.workloadId} · {probe.target.nicId}</code>
            <p>{t('Declared backend health (unverified)')}: {t(probe.declared)} · {t(probe.eligibility)}</p>
            {probe.checks.map((check, index) => <p key={index}><code>{check.nsgId ?? 'NSG —'} · {check.ruleId ?? check.target.id}</code> · {t(check.outcome)}: {t(check.reason)}</p>)}
          </article>)}
        </details>
      </section>}
      {result.ingress && result.forward.steps.filter((step) => step.entity.kind === 'workload').map((step) => <p key={step.entity.id}>
        {t('Translated destination')}: <code>{step.entity.id}</code>{' '}
        {onHighlight && <button type="button" onClick={() => onHighlight(step.entity.id)}>{t('Highlight original backend')}</button>}
      </p>)}
      {[result.forward, result.reply].map((leg) => <section key={leg.direction} aria-label={t(leg.direction === 'forward' ? 'Forward routing' : 'Reply routing')}>
        <h4>{t(leg.direction === 'forward' ? 'Forward routing' : 'Reply routing')}: {t(leg.routing)}</h4>
        {leg.tuple && <code>{leg.tuple.protocol.toUpperCase()} {leg.tuple.sourceAddress}:{leg.tuple.sourcePort} → {leg.tuple.destinationAddress}:{leg.tuple.destinationPort}</code>}
        {leg.session && <p><strong>{t('Conditional response, not a new Internet initiation')}</strong></p>}
        {leg.reasons.map((reason) => <p key={reason}>{t(reason)}</p>)}
        <details><summary>{t('Routing evidence')} ({leg.steps.length})</summary>
          <ol>{leg.steps.slice(0, 100).map((step, index) => <li key={index}><code>{step.entity.kind}: {step.entity.id}</code>{' '}{t(step.evidence)}
            {step.tableId && <> · {t('Hub routing table')}: <code>{step.tableId}</code></>}
            {step.before && step.after && tupleText(step.before) !== tupleText(step.after) && <div data-testid="packet-step-tuples">
              <p>{t('Before translation')}: <code>{tupleText(step.before)}</code></p>
              <p>{t('After translation')}: <code>{tupleText(step.after)}</code></p>
            </div>}
            {step.after === null && <strong> {t('Post-boundary tuple unknown')}</strong>}
          </li>)}</ol>
          {leg.steps.length > 100 && <p>{t('Only the first 100 steps are displayed.')}</p>}
        </details>
      </section>)}
      {result.nsg && <section aria-label={t('NSG filtering')} data-testid="packet-nsg-result">
        <h4>{t('NSG filtering')}: {t(result.nsg.forward.outcome)}</h4>
        <p>{t('NSG filtering is separate from effective routes, NAT and application delivery. Each probe assesses a new initiation; edited topology/probes never reuse live or earlier session state.')}</p>
        {(['forward', 'reply'] as const).map((direction) => <details key={direction}>
          <summary>{t(direction === 'forward' ? 'New-flow NSG checks' : 'Response NSG checks')}: {t(result.nsg![direction].outcome)}</summary>
          {result.nsg![direction].conditionalResponse && <p>{t('Conditional response uses the allowed flow record, not newly initiated reverse rules. No live session is observed.')}</p>}
          <ol>{result.nsg![direction].checks.slice(0, 100).map((check, index) => <li key={index}>
            <code>{check.owner.id} · {check.target.kind}: {check.target.id} · {check.direction} · {check.nsgId ?? 'NSG —'}</code>
            <p><code>{tupleText(check.tuple)}</code></p>
            {check.ruleId && <p><code>{check.priority} · {check.ruleId}</code></p>}
            <p>{t(check.outcome)}: {t(check.reason)}</p>
            {check.uncertainty && <p>{t('Illustrative translated fields are not compared as exact addresses or ports.')}</p>}
          </li>)}</ol>
        </details>)}
      </section>}
      <p><strong>{t(result.security === 'denied' ? 'NSG denies this new flow; effective routes are retained.'
        : result.translation === 'dnat' || result.translation === 'snat-dnat' ? 'Explicit ingress translation assessed; listener and application delivery remain unassessed.'
        : result.translation === 'snat' ? 'Illustrative SNAT configured; delivery and security readiness: not assessed'
        : result.translation === 'none' ? 'Configured SNAT does not apply; delivery and security readiness: not assessed'
          : 'Delivery, security and translation readiness: not assessed')}</strong></p>
    </div>}
  </section>
}
