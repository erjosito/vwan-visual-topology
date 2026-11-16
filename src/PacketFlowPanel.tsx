import { useState } from 'react'
import './packet-messages-ja'
import { t } from './i18n'
import type { InventoryTopology } from './inventory'
import type { Simulation } from './routing'
import type { AzSimulationResult } from './azure-net/engine'
import { packetEndpointOptions, tracePacket, type FiveTuple, type PacketEndpoint, type PacketResult } from './packet-flow'

const tupleText = (tuple: FiveTuple) => `${tuple.protocol.toUpperCase()} ${tuple.sourceAddress}:${tuple.sourcePort} -> ${tuple.destinationAddress}:${tuple.destinationPort}`

export function PacketFlowPanel({ topology, simulation }: { topology: InventoryTopology; simulation: Simulation | AzSimulationResult }) {
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
  const resolve = (key: string): PacketEndpoint | undefined => key === 'external'
    ? { kind: 'external', address: externalAddress } : options.find((option) => option.key === key)?.ref
  const select = (kind: 'source' | 'target', value: string, change: (value: string) => void) => <label>
    {t(kind === 'source' ? 'Packet source' : 'Packet destination')}
    <select value={value} onChange={(event) => change(event.target.value)} aria-label={t(kind === 'source' ? 'Packet source' : 'Packet destination')}>
      <option value="">{t('Select an IP configuration')}</option>
      <option value="external">{t('Explicit Internet endpoint')}</option>
      {value && !visible.some((option) => option.key === value) && options.find((option) => option.key === value) && <option value={value}>{options.find((option) => option.key === value)!.label}</option>}
      {visible.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>
  </label>
  return <section className="packet-panel" aria-label={t('Workload packet probe')} data-testid="packet-flow-panel">
    <h3>{t('Workload packet probe')}</h3>
    <p>{t('Forward and reply routing, with explicit Internet egress where supported. Responses after SNAT are conditional; policy, listeners and application delivery are not assessed.')}</p>
    <form onSubmit={(event) => {
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
      <p><strong>{t(result.translation === 'snat' ? 'Illustrative SNAT configured; delivery and security readiness: not assessed'
        : result.translation === 'none' ? 'Configured SNAT does not apply; delivery and security readiness: not assessed'
          : 'Delivery, security and translation readiness: not assessed')}</strong></p>
    </div>}
  </section>
}
