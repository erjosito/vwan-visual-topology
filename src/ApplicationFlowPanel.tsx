import { useEffect, useId, useRef, useState } from 'react'
import { applicationDecisionLabels, applicationOffline, applicationUnavailable } from './application'
import type { ApplicationReference, ApplicationRequest, ApplicationResult } from './application'
import type { InventoryOwner, InventoryTopology } from './inventory'
import { sameInventoryOwner } from './inventory'
import { packetEndpointOptions } from './packet-flow'
import { runBrowserSimulation } from './platform/browser'
import { createPlatformRequest } from './platform/request'
import { t } from './i18n'
import './application-messages-ja'

export function ApplicationFlowPanel({ topology, owner, result, onResult }: {
  topology: InventoryTopology
  owner: InventoryOwner
  result?: ApplicationResult
  onResult: (result: ApplicationResult | undefined) => void
}) {
  const [kind, setKind] = useState<ApplicationRequest['kind']>('http')
  const [proxyMode, setProxyMode] = useState<'explicit' | 'transparent'>('explicit')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const controlId = useId()
  const job = useRef<AbortController | null>(null)
  const sources = packetEndpointOptions(topology, t('Address unknown'))
  const services = (topology.application?.services ?? []).filter((service) => !service.owner || sameInventoryOwner(service.owner, owner))
  const profiles = topology.application?.dnsProfiles ?? []
  useEffect(() => () => { job.current?.abort(); job.current = null }, [])
  if (!topology.application) return null
  const originalId = (ref: ApplicationReference) => ref.kind === 'workload'
    ? `${ref.workloadId} / ${ref.nicId} / ${ref.ipConfigurationId}`
    : ref.kind === 'load-balancer-frontend' || ref.kind === 'load-balancer-pool' ? `${ref.loadBalancerId} / ${ref.id}` : ref.id
  return <section className="packet-panel" aria-label={t('Application and DNS contracts')} data-testid="application-flow-panel">
    <h3>{t('Application and DNS contracts')}</h3>
    {!services.some((service) => service.tcpProxy || service.firewallProxy) && <p>{t(applicationUnavailable)}</p>}<p>{t(applicationOffline)}</p>
    <p>{t('TCP provider configuration is separate from HTTP matching and DNS selection. Unimplemented operations remain not assessed.')}</p>
    <ul>{[...services, ...profiles].map((entry) => <li key={entry.id}>
      <strong>{entry.name}</strong>{' · '}<code>{entry.id}</code>{' · '}{t('firewallProxy' in entry && entry.firewallProxy ? 'Declared Firewall proxy provider'
        : 'tcpProxy' in entry && entry.tcpProxy ? 'Declared private TCP provider' : 'Provider unavailable')}
      {entry.unsupportedFeatures.length > 0 && <p>{t('Unsupported declarations')}: {entry.unsupportedFeatures.join(', ')}</p>}
    </li>)}</ul>
    <form onChange={() => { job.current?.abort(); job.current = null; setRunning(false); setError(''); onResult(undefined) }} onSubmit={async (event) => {
      event.preventDefault()
      job.current?.abort()
      const controller = new AbortController()
      job.current = controller
      const form = new FormData(event.currentTarget)
      const sourceKey = String(form.get('source'))
      const source = sources.find((entry) => entry.key === sourceKey)?.ref
        ?? { kind: 'external' as const, address: String(form.get('address')) }
      const application: ApplicationRequest = kind === 'tcp'
        ? { version: 1, kind, serviceId: String(form.get('service')), client: source, sourcePort: Number(form.get('sourcePort')), port: Number(form.get('port')) }
        : kind === 'firewall-proxy'
        ? { version: 1, kind, serviceId: String(form.get('service')), client: source,
          sourcePort: Number(form.get('sourcePort')), scheme: form.get('scheme') === 'http' ? 'http' : 'https',
          host: String(form.get('host')), port: Number(form.get('port')),
          ...(proxyMode === 'explicit' ? { mode: 'explicit', proxyPort: Number(form.get('proxyPort')) }
            : { mode: 'transparent', destinationAddress: String(form.get('destinationAddress')) }) }
        : kind === 'http'
        ? { version: 1, kind, serviceId: String(form.get('service')), client: source, scheme: String(form.get('scheme')) as 'http' | 'https',
          host: String(form.get('host')), port: Number(form.get('port')), path: String(form.get('path')) }
        : { version: 1, kind, profileId: String(form.get('profile')), resolver: source, name: String(form.get('name')),
          evaluatedAt: String(form.get('time')), cache: 'fresh' }
      setRunning(true); setError(''); onResult(undefined)
      try {
        const response = await runBrowserSimulation(createPlatformRequest({
          contractVersion: 2, operation: 'application', application,
          document: topology.version === 1 ? { mode: 'vwan', topology } : { mode: 'full', topology },
        }), controller.signal)
        if (job.current !== controller) return
        if (response.errors.length) setError('The request could not be assessed. Check the original identities, hostname, path and explicit evaluation time.')
        else onResult(response.application)
      } catch {
        if (job.current === controller) setError('The request could not be assessed. Check the original identities, hostname, path and explicit evaluation time.')
      } finally {
        if (job.current === controller) { job.current = null; setRunning(false) }
      }
    }}>
      <label htmlFor={`${controlId}-operation`}>{t('Application operation')}</label><select id={`${controlId}-operation`} value={kind} onChange={(event) => setKind(event.target.value as ApplicationRequest['kind'])}>
        <option value="http">{t('HTTP request matching')}</option><option value="dns">{t('DNS answer selection')}</option>
        <option value="tcp">{t('TCP proxy connections')}</option>
        <option value="firewall-proxy">{t('Firewall application proxy')}</option>
      </select>
      <label htmlFor={`${controlId}-source`}>{t('Original client or resolver')}</label><select id={`${controlId}-source`} name="source">
        <option value="external">{t('Explicit external IPv4')}</option>
        {sources.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </select>
      <label>{t('External client or resolver IPv4')}<input name="address" defaultValue="198.51.100.10" maxLength={15} /></label>
      {kind !== 'dns' ? <>
        <label htmlFor={`${controlId}-service`}>{t('Original application service')}</label><select id={`${controlId}-service`} name="service" required>{services.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.id})</option>)}</select>
        {kind === 'firewall-proxy' && <label>{t('Firewall proxy mode')}<select aria-label={t('Firewall proxy mode')} value={proxyMode}
          onChange={(event) => setProxyMode(event.target.value === 'transparent' ? 'transparent' : 'explicit')}>
          <option value="explicit">{t('Explicit HTTP/HTTPS CONNECT')}</option><option value="transparent">{t('Transparent application rule')}</option>
        </select></label>}
        {kind === 'http' || kind === 'firewall-proxy' ? <>
        <label htmlFor={`${controlId}-scheme`}>{t('Request scheme')}</label><select id={`${controlId}-scheme`} name="scheme"><option value="https">HTTPS</option><option value="http">HTTP</option></select>
        <label>{t(kind === 'firewall-proxy' && proxyMode === 'transparent' ? 'HTTP Host or HTTPS SNI' : 'Request host')}<input name="host" required maxLength={253} defaultValue="app.example.test" /></label>
        <label>{t('Request port')}<input name="port" type="number" min={1} max={65535} required defaultValue={443} /></label>
        {kind === 'http' ? <label>{t('Absolute request path')}<input name="path" required maxLength={2048} defaultValue="/" /></label> : <>
          <label>{t('TCP source port')}<input name="sourcePort" type="number" min={1} max={65535} required defaultValue={49152} /></label>
          {proxyMode === 'explicit' ? <label key="explicit-proxy-port">{t('Firewall proxy port')}<input name="proxyPort" type="number" min={1} max={65535} required defaultValue={3128} /></label>
            : <label key="transparent-destination">{t('Original destination IPv4')}<input name="destinationAddress" required maxLength={15} defaultValue="10.93.1.4" /></label>}
        </>}
        </> : <>
          <label key="tcp-source-port">{t('TCP source port')}<input name="sourcePort" type="number" min={1} max={65535} required defaultValue={49152} /></label>
          <label key="tcp-listener-port">{t('TCP listener port')}<input name="port" type="number" min={1} max={65535} required defaultValue={1433} /></label>
        </>}
      </> : <>
        <label htmlFor={`${controlId}-profile`}>{t('Original DNS profile')}</label><select id={`${controlId}-profile`} name="profile" required>{profiles.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.id})</option>)}</select>
        <label>{t('DNS query name')}<input name="name" required maxLength={253} defaultValue="app.example.test" /></label>
        <label>{t('Evaluation time (UTC)')}<input name="time" required maxLength={24} placeholder="2026-11-16T00:00:00.000Z" /></label>
        <p>{t('Fresh resolver only; no cached answer or failover timing is inferred.')}</p>
      </>}
      <button type="submit" disabled={running || (kind !== 'dns' ? !services.length : !profiles.length)}>{t('Inspect application contract')}</button>
      {running && <button type="button" onClick={() => { job.current?.abort(); job.current = null; setRunning(false); onResult(undefined); setError('Application inspection cancelled; no decisions are verified.') }}>{t('Cancel application inspection')}</button>}
    </form>
    {error && <p role="alert">{t(error)}</p>}
    {result && <div role="status" data-testid="application-decisions">
      <h4>{t('Configuration')}: {t(result.configuration)} · {t('Application availability')}: {t('not-assessed')}</h4>
      <p>{t('Selected application references highlight original subnet and workload cards, not additional routers or guaranteed network legs.')}</p>
      <ol>{result.decisions.map((decision) => <li key={decision.id}>
        <strong>{t(applicationDecisionLabels[decision.kind])}</strong>: {t(decision.outcome)}
        {decision.reasons.map((reason) => <p key={reason}>{t(reason)}</p>)}
        <ul>{decision.references.map((ref, index) => <li key={index}><code>{originalId(ref)}</code></li>)}</ul>
      </li>)}</ol>
      {result.connections?.map((connection) => <section key={connection.id} aria-label={t(connection.id)} data-testid={`application-connection-${connection.id}`}>
        <h4>{t(connection.id)}</h4>
        <p>{t('Separate TCP connection; conditional response only, not a NAT inverse or live session.')}</p>
        {[connection.forward, connection.reply].map((leg) => <details key={leg.direction}>
          <summary>{t(leg.direction)}: {t(leg.routing)}</summary>
          {leg.native && !Array.isArray(leg.native) && <p>{t('Native trace status')}: <code data-testid="application-native-status">{leg.native.status}</code></p>}
          {leg.tuple && <code data-testid="application-connection-tuple">{leg.tuple.sourceAddress}:{leg.tuple.sourcePort} -&gt; {leg.tuple.destinationAddress}:{leg.tuple.destinationPort}</code>}
          {leg.reasons.map((reason) => <p key={reason}>{t(reason)}</p>)}
          <ol>{leg.steps.slice(0, 100).map((step, index) => <li key={index}><code>{step.entity.kind} / {step.entity.id}</code> {t(step.evidence)}</li>)}</ol>
        </details>)}
        <p>{t('Forward NSG permission')}: {t(connection.nsg.forward.outcome)}; {t('Conditional response permission')}: {t(connection.nsg.reply.outcome)}</p>
        {connection.returnVariants && <details data-testid="firewall-instance-returns">
          <summary>{t('Possible Firewall instance return addresses')}: {connection.returnVariants.length}</summary>
          {connection.returnVariants.map((leg) => <p key={leg.tuple?.destinationAddress}><code>{leg.tuple?.destinationAddress}</code>: {t(leg.routing)}</p>)}
        </details>}
        {connection.nsg.forward.checks.map((check, index) => <p key={index}><code>{check.target.id}: {check.tuple.sourceAddress}:{check.tuple.sourcePort} -&gt; {check.tuple.destinationAddress}:{check.tuple.destinationPort}</code> {t(check.outcome)}{check.uncertainty && ` (${t('Illustrative source port')})`}</p>)}
      </section>)}
      {result.limitations.map((limitation) => <p key={limitation}>{t(limitation)}</p>)}
    </div>}
    <a href="https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/load-balancing-overview" target="_blank" rel="noreferrer">{t('Application and DNS service boundaries (Microsoft Learn)')}</a>
  </section>
}
