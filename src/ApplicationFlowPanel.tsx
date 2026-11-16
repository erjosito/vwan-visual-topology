import { useEffect, useId, useRef, useState } from 'react'
import { applicationDecisionLabels, applicationOffline, applicationUnavailable } from './application'
import type { ApplicationReference, ApplicationRequest, ApplicationResult } from './application'
import type { InventoryOwner, InventoryTopology } from './inventory'
import { sameInventoryOwner } from './inventory'
import { packetEndpointOptions } from './packet-flow'
import { runBrowserSimulation } from './platform/browser'
import { t } from './i18n'
import './application-messages-ja'

export function ApplicationFlowPanel({ topology, owner, result, onResult }: {
  topology: InventoryTopology
  owner: InventoryOwner
  result?: ApplicationResult
  onResult: (result: ApplicationResult | undefined) => void
}) {
  const [kind, setKind] = useState<'http' | 'dns'>('http')
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
    <p>{t(applicationUnavailable)}</p><p>{t(applicationOffline)}</p>
    <p>{t('Imported identities only; no service authoring or provider is enabled. DNS answers, HTTP matches and IPv4 TCP legs are separate decisions.')}</p>
    <ul>{[...services, ...profiles].map((entry) => <li key={entry.id}>
      <strong>{entry.name}</strong>{' · '}<code>{entry.id}</code>{' · '}{t('Provider unavailable')}
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
      const application: ApplicationRequest = kind === 'http'
        ? { version: 1, kind, serviceId: String(form.get('service')), client: source, scheme: String(form.get('scheme')) as 'http' | 'https',
          host: String(form.get('host')), port: Number(form.get('port')), path: String(form.get('path')) }
        : { version: 1, kind, profileId: String(form.get('profile')), resolver: source, name: String(form.get('name')),
          evaluatedAt: String(form.get('time')), cache: 'fresh' }
      setRunning(true); setError(''); onResult(undefined)
      try {
        const response = await runBrowserSimulation({
          contractVersion: 2, operation: 'application', application,
          document: { mode: topology.version === 1 ? 'vwan' : 'full', topology },
        }, controller.signal)
        if (job.current !== controller) return
        if (response.errors.length) setError('The request could not be assessed. Check the original identities, hostname, path and explicit evaluation time.')
        else onResult(response.application)
      } catch {
        if (job.current === controller) setError('The request could not be assessed. Check the original identities, hostname, path and explicit evaluation time.')
      } finally {
        if (job.current === controller) { job.current = null; setRunning(false) }
      }
    }}>
      <label htmlFor={`${controlId}-operation`}>{t('Application operation')}</label><select id={`${controlId}-operation`} value={kind} onChange={(event) => setKind(event.target.value as 'http' | 'dns')}>
        <option value="http">{t('HTTP request matching')}</option><option value="dns">{t('DNS answer selection')}</option>
      </select>
      <label htmlFor={`${controlId}-source`}>{t('Original client or resolver')}</label><select id={`${controlId}-source`} name="source">
        <option value="external">{t('Explicit external IPv4')}</option>
        {sources.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </select>
      <label>{t('External client or resolver IPv4')}<input name="address" defaultValue="198.51.100.10" maxLength={15} /></label>
      {kind === 'http' ? <>
        <label htmlFor={`${controlId}-service`}>{t('Original application service')}</label><select id={`${controlId}-service`} name="service" required>{services.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.id})</option>)}</select>
        <label htmlFor={`${controlId}-scheme`}>{t('Request scheme')}</label><select id={`${controlId}-scheme`} name="scheme"><option value="https">HTTPS</option><option value="http">HTTP</option></select>
        <label>{t('Request host')}<input name="host" required maxLength={253} defaultValue="app.example.test" /></label>
        <label>{t('Request port')}<input name="port" type="number" min={1} max={65535} required defaultValue={443} /></label>
        <label>{t('Absolute request path')}<input name="path" required maxLength={2048} defaultValue="/" /></label>
      </> : <>
        <label htmlFor={`${controlId}-profile`}>{t('Original DNS profile')}</label><select id={`${controlId}-profile`} name="profile" required>{profiles.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.id})</option>)}</select>
        <label>{t('DNS query name')}<input name="name" required maxLength={253} defaultValue="app.example.test" /></label>
        <label>{t('Evaluation time (UTC)')}<input name="time" required maxLength={24} placeholder="2026-11-16T00:00:00.000Z" /></label>
        <p>{t('Fresh resolver only; no cached answer or failover timing is inferred.')}</p>
      </>}
      <button type="submit" disabled={running || (kind === 'http' ? !services.length : !profiles.length)}>{t('Inspect application contract')}</button>
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
    </div>}
    <a href="https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/load-balancing-overview" target="_blank" rel="noreferrer">{t('Application and DNS service boundaries (Microsoft Learn)')}</a>
  </section>
}
