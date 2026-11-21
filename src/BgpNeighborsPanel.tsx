import { useMemo, useRef, useState } from 'react'
import { CanvasOverlay } from './CanvasOverlay'
import { CompactBgpTable } from './CompactBgpTable'
import { t } from './i18n'
import { inspectAzBgp, inspectVwanBgp, bgpResourceKey } from './bgp-neighbors'
import type { BgpInstance, BgpManagedRelationship, BgpResourceRef, BgpRouteEvidence } from './bgp-neighbors'
import type { Topology } from './model'
import type { AzNetTopology } from './azure-net/model'
import type { AzSimulationResult } from './azure-net/engine'
import './bgp-neighbor-messages-ja'

const roles: Record<BgpInstance['role'], string> = {
  router: 'Logical router', 'ars-1': 'ARS speaker 1', 'ars-2': 'ARS speaker 2',
  'vpn-active': 'Active VPN speaker', 'vpn-1': 'Active VPN speaker 1', 'vpn-2': 'Active VPN speaker 2',
}
const scopes: Record<BgpRouteEvidence['scope'], string> = {
  'received-post-policy': 'Received routes (logical, post-policy)',
  advertised: 'Advertised candidates (logical)',
  'peer-received-post-policy': 'Peer received routes (logical, post-policy; not pre-policy advertisements)',
}
const count = (value: BgpRouteEvidence | undefined) => value === undefined ? t('Not assessed') : new Set(value.routes.map((route) => route.prefix)).size
const relationshipKinds: Record<NonNullable<BgpManagedRelationship['kind']>, string> = {
  'inter-hub': 'Inter-hub routing', vpn: 'VPN peering', 'vpn-static': 'Static VPN routing', 'express-route': 'ExpressRoute / MSEE aggregate',
  'express-route-logical': 'ExpressRoute routing (edge unmapped)', nva: 'NVA peering', 'route-exchange': 'Managed route exchange',
}

export default function BgpNeighborsPanel({ topology, simulation, initialResource, unavailableIds = [], onClose }: {
  topology: AzNetTopology | Topology
  simulation?: AzSimulationResult
  initialResource?: BgpResourceRef
  unavailableIds?: string[]
  onClose: () => void
}) {
  const inspection = useMemo(() => topology.version === 2 ? inspectAzBgp(topology, simulation, unavailableIds)
    : inspectVwanBgp(topology, unavailableIds), [topology, simulation, unavailableIds])
  const [resourceKey, setResourceKey] = useState(() => initialResource ? bgpResourceKey(initialResource) : inspection.resources[0]?.key ?? '')
  const [instanceId, setInstanceId] = useState('')
  const [neighborId, setNeighborId] = useState('')
  const [filter, setFilter] = useState('')
  const [prefix, setPrefix] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const resourceSelect = useRef<HTMLSelectElement>(null)
  const resource = inspection.resources.find((candidate) => candidate.key === resourceKey)
  const instance = instanceId ? resource?.instances.find((candidate) => candidate.id === instanceId) : resource?.instances[0]
  const neighbors = inspection.neighbors.filter((neighbor) => neighbor.localResourceKey === resourceKey && neighbor.localInstanceId === instance?.id)
  const resourceByKey = (key: string) => inspection.resources.find((candidate) => candidate.key === key)!
  const remoteLabel = (key: string, remoteId: string) => {
    const remote = resourceByKey(key)
    const endpoint = remote.instances.find((candidate) => candidate.id === remoteId)!
    return `${remote.name} · ${t(roles[endpoint.role])} · ${endpoint.address ?? t('IP not modeled')}`
  }
  const visible = neighbors.filter((neighbor) => `${remoteLabel(neighbor.remoteResourceKey, neighbor.remoteInstanceId)} ${neighbor.remoteResourceKey} ${resourceByKey(neighbor.remoteResourceKey).asn ?? ''} ${neighbor.connectionId}`.toLowerCase().includes(filter.toLowerCase().trim()))
  const selected = neighbors.find((neighbor) => neighbor.id === neighborId)
  const managed = inspection.managedRelationships.filter((relationship) => relationship.resourceKeys.includes(resourceKey))
  const visibleManaged = managed.filter((relationship) => {
    const remote = resourceByKey(relationship.resourceKeys.find((key) => key !== resourceKey) ?? resourceKey)
    return `${remote.name} ${remote.key} ${remote.asn ?? ''} ${relationship.name ?? ''} ${relationship.connectionId} ${relationship.peerAddress ?? ''}`
      .toLowerCase().includes(filter.toLowerCase().trim())
  })
  const availability = (value: typeof neighbors[number]['availability']) => t(value === 'available' ? 'Modeled relationship available'
    : value === 'unavailable' ? 'Modeled relationship unavailable' : 'Not assessed')
  const changeResource = (key: string) => {
    setResourceKey(key); setInstanceId(''); setNeighborId(''); setFilter(''); setPrefix(''); setCopyStatus('')
    resourceSelect.current?.focus()
  }
  const routeTable = (value: BgpRouteEvidence | undefined, field: string) => {
    if (!value) return <p>{t('No qualified route evidence in this exact scope. This is not a zero-prefix observation.')}</p>
    return <section>
      <h4>{t(scopes[value.scope])}</h4>
      <CompactBgpTable label={t(scopes[value.scope])} testId={`bgp-neighbor-${field}`}
        legend={t('? Relationship-scoped candidates; instance best-path selection is not assessed. The forwarding next hop is not necessarily the advertising neighbor.')}
        rows={value.routes.filter((route) => route.prefix.includes(prefix.trim())).map((route) => ({
          id: route.id, prefix: route.prefix, asPath: route.asPath, status: '?' as const,
          statusLabel: t('Selection not assessed'), nextHop: route.nextHop ?? t('IP not modeled'),
          neighbor: selected ? remoteLabel(selected.remoteResourceKey, selected.remoteInstanceId) : '',
          textEvidence: JSON.stringify(route.evidence),
          details: <pre>{JSON.stringify(route.evidence, null, 2)}</pre>,
        }))} />
      {value.routes.length === 0 && <p role="status">{t('Zero modeled prefixes in this logical scope; this does not prove a live established session.')}</p>}
    </section>
  }
  return <CanvasOverlay title={t('BGP neighbors')} className="bgp-neighbors-panel aznet-routes-window" onClose={onClose}>
    <div data-testid="bgp-neighbors">
      <p>{t('Configuration and modeled relationships')}</p>
      <details><summary>{t('Scope and limitations')}</summary>
        <p>{t('Simulated relationships, not live BGP state or imported Azure observations. Availability does not mean Established. No FSM, uptime or message counters are simulated.')}</p>
        <p>{t('Select one local resource and one local speaker. Modeled speaker roles are not physical Azure instance mappings. Captured observations remain separate in Azure files.')}</p>
        <p>{t('Route counts and routes describe the logical relationship, not measured per-instance advertisements or counters.')}</p>
        {resource?.limitations.map((limitation) => <p key={limitation}>{t(limitation)}</p>)}
      </details>
      <label className="field"><span>{t('Local BGP resource')}</span><select ref={resourceSelect} aria-label={t('Local BGP resource')} value={resourceKey}
        onChange={(event) => changeResource(event.target.value)}>
        {!resource && <option value={resourceKey}>{resourceKey || t('Select local resource')}</option>}
        {inspection.resources.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.name} ({candidate.kind} · {candidate.id})</option>)}
      </select></label>
      {!resource ? <p role="status">{t('The requested BGP resource is unavailable. No other resource is substituted.')}</p> : <>
        <p><strong>{resource.name}</strong> · {resource.id} · ASN {resource.asn ?? t('Not assessed')}</p>
        <label className="field"><span>{t('Filter neighbors')}</span><input type="search" aria-label={t('Filter neighbors')} value={filter}
          onChange={(event) => setFilter(event.target.value)} /></label>
        {resource.instances.length > 0 ? <>
          <label className="field"><span>{t('Local BGP instance')}</span><select aria-label={t('Local BGP instance')} value={instance?.id ?? instanceId}
            onChange={(event) => { setInstanceId(event.target.value); setNeighborId(''); setPrefix(''); setCopyStatus('') }}>
            {!instance && <option value={instanceId}>{t('Requested instance unavailable')}</option>}
            {resource.instances.map((candidate) => <option key={candidate.id} value={candidate.id}>{t(roles[candidate.role])} · {candidate.address ?? t('IP not modeled')}</option>)}
          </select></label>
          {!instance ? <p role="status">{t('The requested local instance is unavailable. Choose a current instance explicitly.')}</p> : <>
            <p>{t('Local endpoint')}: {instance.address ?? t('IP not modeled')} · {t(roles[instance.role])}</p>
            <button type="button" onClick={async () => {
              const text = [
                `${resource.name} (${resource.id}) · ${t(roles[instance.role])} · ${instance.address ?? t('IP not modeled')} · ASN ${resource.asn ?? t('Not assessed')} · ${t('Simulated relationships')}`,
                [t('Neighbor'), t('Remote ASN'), t('Availability'), t('Received (logical)'), t('Advertised (logical)')].join('\t'),
                ...visible.map((neighbor) => [remoteLabel(neighbor.remoteResourceKey, neighbor.remoteInstanceId),
                  resourceByKey(neighbor.remoteResourceKey).asn ?? t('Not assessed'), availability(neighbor.availability),
                  count(neighbor.received), count(neighbor.advertised)].join('\t')),
              ].join('\n')
              try { await navigator.clipboard.writeText(text); setCopyStatus('Summary copied.') }
              catch { setCopyStatus('Unable to copy summary.') }
            }}>{t('Copy neighbor summary')}</button>
            {copyStatus && <p role="status">{t(copyStatus)}</p>}
            <div className="table-scroll" role="region" aria-label={t('BGP neighbor summary')} tabIndex={0}><table className="aznet-route-table" data-testid="bgp-neighbor-rows">
              <caption>{resource.name} · {t(roles[instance.role])} · ASN {resource.asn ?? t('Not assessed')}</caption>
              <thead><tr><th>{t('Neighbor')}</th><th>{t('Remote ASN')}</th><th>{t('Availability')}</th><th>{t('Received (logical)')}</th><th>{t('Advertised (logical)')}</th></tr></thead>
              <tbody>{visible.map((neighbor) => <tr key={neighbor.id} data-neighbor-id={neighbor.id} data-local-instance-id={neighbor.localInstanceId}>
                <td><button type="button" aria-pressed={neighbor.id === neighborId} onClick={() => { setNeighborId(neighbor.id); setPrefix('') }}>
                  {remoteLabel(neighbor.remoteResourceKey, neighbor.remoteInstanceId)}</button><br /><small>{neighbor.connectionId}</small></td>
                <td>{resourceByKey(neighbor.remoteResourceKey).asn ?? t('Not assessed')}</td><td>{availability(neighbor.availability)}</td>
                <td>{count(neighbor.received)}</td><td>{count(neighbor.advertised)}</td>
              </tr>)}</tbody>
            </table></div>
            {!visible.length && !managed.length && <p role="status">{t('No qualified neighbors in this exact instance/filter scope. Missing rows do not prove that no BGP session exists.')}</p>}
            {neighborId && !selected && <p role="status">{t('The selected neighbor is no longer in this instance scope. No other neighbor is substituted.')}</p>}
            {selected && <section data-testid="bgp-neighbor-details">
              <h3>{remoteLabel(selected.remoteResourceKey, selected.remoteInstanceId)}</h3>
              <p>{availability(selected.availability)} · {t(selected.reason)}</p>
              {selected.limitations.map((limitation) => <p key={limitation} role="note">{t(limitation)}</p>)}
              <details><summary>{t('Session identity and provenance')}</summary><pre>{JSON.stringify({
                provenance: inspection.provenance, sessionId: selected.id, relationshipId: selected.relationshipId,
                connectionId: selected.connectionId, localResource: resourceKey, localInstance: selected.localInstanceId,
                remoteResource: selected.remoteResourceKey, remoteInstance: selected.remoteInstanceId,
              }, null, 2)}</pre></details>
              <button type="button" onClick={() => {
                changeResource(selected.remoteResourceKey); setInstanceId(selected.remoteInstanceId)
              }}>{t('Inspect from peer')}</button>
              <label className="field"><span>{t('Filter BGP prefixes')}</span><input type="search" aria-label={t('Filter BGP prefixes')} value={prefix} onChange={(event) => setPrefix(event.target.value)} /></label>
              {routeTable(selected.received, 'received')}
              {routeTable(selected.advertised, 'advertised')}
              {selected.peerReceived && routeTable({ ...selected.peerReceived, scope: 'peer-received-post-policy' }, 'peer-received')}
            </section>}
          </>}
        </> : <p>{t('Managed aggregate · select a relationship for original identities and mapping details.')}</p>}
        {managed.length > 0 && <section data-testid="bgp-managed-relationships">
          <h3>{t('Managed peer relationships')}</h3>
          <div className="table-scroll" role="region" aria-label={t('Managed peer relationships')} tabIndex={0}>
          <table className="aznet-route-table" data-testid="bgp-managed-rows">
            <caption>{resource.name} · ASN {resource.asn ?? t('Not assessed')} · {t('Resource-level relationships, not physical sessions')}</caption>
            <thead><tr><th>{t('Neighbor')}</th><th>{t('Remote ASN')}</th><th>{t('Relationship')}</th><th>{t('Connection / scope')}</th><th>{t('Configuration')}</th><th>{t('Session state')}</th><th>{t('Details')}</th></tr></thead>
            <tbody>{visibleManaged.map((relationship) => {
            const remote = resourceByKey(relationship.resourceKeys.find((key) => key !== resourceKey) ?? resourceKey)
            return <tr key={relationship.id} data-relationship-id={relationship.id}>
              <td><button type="button" onClick={() => changeResource(remote.key)}>{remote.name}</button>
                {remote.kind === 'er-location' && <small> · {t('MSEE aggregate')}</small>}
                {relationship.peerAddress && <div>{relationship.peerAddress}</div>}</td>
              <td>{remote.asn ?? t('Not assessed')}</td>
              <td>{t(relationshipKinds[relationship.kind ?? 'route-exchange'])}</td>
              <td>{relationship.name ?? relationship.connectionId}<br /><small>{relationship.connectionId}</small></td>
              <td>{t(relationship.enabled ? 'Enabled' : 'Disabled / unavailable')}</td>
              <td>{t(relationship.kind === 'vpn-static' ? 'Not applicable (static routing)' : 'Not observed')}</td>
              <td><details><summary>{t('Mapping and provenance')}</summary>
                <p>{t(relationship.reason)}</p>
                {relationship.kind === 'express-route-logical' && <p>{t('MSEE ASN 12076; the original site remains the routing endpoint, not a direct BGP peer.')}</p>}
                <pre>{JSON.stringify({ provenance: inspection.provenance, relationshipId: relationship.id,
                  connectionId: relationship.connectionId, localResource: resource.key, remoteResource: remote.key }, null, 2)}</pre>
                <button type="button" onClick={() => changeResource(remote.key)}>{t('Inspect from peer')}</button>
              </details></td>
            </tr>
          })}</tbody></table></div>
          {!visibleManaged.length && <p role="status">{t('No managed relationships match this filter.')}</p>}
        </section>}
      </>}
    </div>
  </CanvasOverlay>
}
