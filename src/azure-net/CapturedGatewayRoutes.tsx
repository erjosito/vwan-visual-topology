import { t } from '../i18n'
import type { AzCapturedBgpPeerRoute, AzCaptureSection } from './azure-import'

export default function CapturedGatewayRoutes({ gateway, address, rows, rejected, section, sourcePeer, onSourcePeerChange, selectedPage, onPageChange }: {
  gateway: string
  address?: string
  rows: AzCapturedBgpPeerRoute[]
  rejected: boolean
  section?: AzCaptureSection
  sourcePeer: string
  onSourcePeerChange: (value: string) => void
  selectedPage: number
  onPageChange: (page: number) => void
}) {
  const sourceKey = (route: AzCapturedBgpPeerRoute) => JSON.stringify([route.sourcePeer || ''])
  const sources = [...new Set(rows.map(sourceKey))].sort()
  const selected = sources.includes(sourcePeer) ? sourcePeer : ''
  const filtered = selected ? rows.filter((route) => sourceKey(route) === selected) : rows
  const page = Math.min(selectedPage, Math.max(0, Math.ceil(filtered.length / 100) - 1))
  const shown = filtered.slice(page * 100, page * 100 + 100)
  const missing = t('Not captured')
  const sourceName = (value: string) => (JSON.parse(value) as string[])[0] || t('Source peer not captured')
  return <section data-testid="captured-gateway-routes">
    <h4>{t('Captured gateway learned BGP routes')}</h4>
    <p>{t('Captured learned routes are not advertised routes or simulator best paths. Source peer is not inferred from next hop. ER circuit, primary/secondary edge and physical instance mappings remain unknown.')}</p>
    <label className="field">{t('Source peer')}<select aria-label={t('Source peer')} value={selected}
      onChange={(event) => onSourcePeerChange(event.target.value)}>
      <option value="">{t('All captured source peers')}</option>
      {sources.map((value) => <option key={value} value={value}>{sourceName(value)}</option>)}
    </select></label>
    {shown.length > 0 ? <div className="table-scroll"><table className="aznet-route-table">
      <caption>{gateway} · {address || t('Unassigned (no local endpoint captured)')} · {t('Learned from peer')}</caption>
      <thead><tr><th>{t('Prefix')}</th><th>{t('Next hop')}</th><th>{t('AS path')}</th><th>{t('Source peer')}</th></tr></thead>
      <tbody>{shown.map((route, index) => <tr key={index}>
        <td>{route.network}<details><summary>{t('Captured route attributes')}</summary>
          <p>{t('Captured Azure route origin')}: {route.origin ?? missing}</p><p>{t('Weight')}: {route.weight ?? missing}</p>
        </details></td>
        <td>{route.nextHop ?? missing}</td><td>{route.asPath ?? missing}</td><td>{route.sourcePeer ?? missing}</td>
      </tr>)}</tbody>
    </table></div> : <p role="status">{t('No rows were captured for this selection. Missing rows do not establish that no routes or sessions exist.')}</p>}
    {filtered.length > 100 && <div>
      <button type="button" className="aznet-btn" disabled={page === 0} onClick={() => onPageChange(page - 1)}>{t('Previous routes')}</button>
      {' '}{t('Rows {0}–{1} of {2}', page * 100 + 1, Math.min(filtered.length, page * 100 + 100), filtered.length)}{' '}
      <button type="button" className="aznet-btn" disabled={(page + 1) * 100 >= filtered.length} onClick={() => onPageChange(page + 1)}>{t('Next routes')}</button>
    </div>}
    <p role="status">{t('Gateway route capture coverage: {0}. Missing rows do not establish an empty Adj-RIB, withdrawal or an unavailable session.',
      `${section?.state ?? 'unknown'}${section?.complete && !rejected ? '' : ` · ${t('Unknown / incomplete')}`}`)}</p>
    {rejected && <p role="status">{t('Malformed or oversized route observations cannot establish complete coverage.')}</p>}
  </section>
}
