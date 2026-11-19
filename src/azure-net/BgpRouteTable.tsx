import { useMemo, useState } from 'react'
import { cidr } from '../validation'
import type { AzBgpRibEntry } from './engine'
import { Explain } from '../learning/Explain'
import { t, localizeDiagnostic } from '../i18n'
import '../vpn-nat-messages-ja'
import { CompactBgpTable, modeledBgpLegend } from '../CompactBgpTable'
import { guidanceAnchor } from '../learning/guidance'

export function BgpRouteTable({ entries, available, learningScope }: {
  entries: AzBgpRibEntry[]; available: boolean
  learningScope?: ({ hubId: string; tableId: string } | { siteId: string }) & { prefix?: string }
}) {
  const [filter, setFilter] = useState('')
  const groups = useMemo(() => {
    const byPrefix = new Map<string, AzBgpRibEntry[]>()
    for (const entry of entries) {
      const candidates = byPrefix.get(entry.prefix) ?? []
      candidates.push(entry)
      byPrefix.set(entry.prefix, candidates)
    }
    return [...byPrefix].sort(([a], [b]) =>
      (cidr(a)?.network ?? 0) - (cidr(b)?.network ?? 0) || (cidr(a)?.length ?? 0) - (cidr(b)?.length ?? 0))
  }, [entries])
  const visible = groups.filter(([prefix]) => prefix.includes(filter.trim()))
  if (!available) return <p role="status" data-testid="aznet-rib-unavailable">{t("The requested router is no longer available. No other router's routes are shown.")}</p>
  return <>
    {learningScope?.prefix && !entries.some((entry) => entry.prefix === learningScope.prefix)
      && <p role="status">{t('The requested prefix {0} is absent from this exact table. No other table is substituted.', learningScope.prefix)}</p>}
    <label className="aznet-field"><span>{t('Filter by prefix')}</span><input type="search" className="aznet-input" aria-label={t('Filter BGP prefixes')} value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
    <CompactBgpTable label={t('Requested router BGP table')}
      legend={`${t(modeledBgpLegend)} ${t('BGP candidates; subnet forwarding routes are inspected separately.')}`}
      rows={visible.flatMap(([prefix, candidates]) => {
        const tied = candidates.filter((entry) => entry.preferred).length > 1
        return [...candidates]
        .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.id.localeCompare(b.id))
        .map((entry) => ({
          id: entry.id, prefix, preferred: entry.preferred,
          learningAnchor: learningScope ? 'siteId' in learningScope
            ? guidanceAnchor('site-effective-prefix', learningScope.siteId, prefix)
            : guidanceAnchor('hub-effective-prefix', learningScope.hubId, learningScope.tableId, prefix) : undefined,
          status: entry.preferred ? tied ? '=' as const : '*' as const : '-' as const,
          statusLabel: t(entry.preferred ? tied ? 'Model tie' : 'Preferred' : 'Alternative'),
          nextHop: entry.nextHopIp && !entry.nextHopName.includes(entry.nextHopIp) ? `${entry.nextHopName} (${entry.nextHopIp})` : entry.nextHopName,
          asPath: entry.asPath,
          textEvidence: JSON.stringify(entry),
          details: <div data-reason-prefix={prefix}>
            <p>{localizeDiagnostic(entry.explanation)}</p>
            <Explain concept="selection" evidence={[entry.explanation]} />
            <p>{t('Azure provenance and selection evidence')}</p>
            <p>{t(entry.nextHopKind === 'local' ? 'Local origin' : entry.originProtocol)}</p>
            <p>{entry.id} · {entry.nextHopKind} · {entry.nextHopId} · {entry.originProtocol}</p>
            {entry.connectionId && <p>{t('Connection')}: {entry.connectionId}</p>}
            <p>{t('Communities')}: {entry.communities?.join(' ') || '—'}</p>
            {entry.vnetCommunityOrigin && <p>{t('Original VNet community configuration')}: {entry.vnetCommunityOrigin.virtualNetworkCommunity ?? '—'}
              {' · '}{t('Captured regional community')}: {entry.vnetCommunityOrigin.regionalCommunity ?? '—'}
              {' · '}{entry.vnetCommunityOrigin.vnetId}</p>}
            {entry.natOriginalPrefix && <p>{t('Original VPN prefix')}: <code>{entry.natOriginalPrefix}</code>{' → '}
              {t('Translated VPN prefix')}: <code>{entry.prefix}</code></p>}
            {entry.routeMapTrace?.map((trace, index) => <p key={index}>{localizeDiagnostic(trace)}</p>)}
            <details><summary>{t('Azure provenance and selection evidence')}</summary><pre>{JSON.stringify(entry, null, 2)}</pre></details>
          </div>,
        }))
      })} />
    {!visible.length && <p className="empty" data-testid="aznet-rib-empty">{filter ? 'No routes match the prefix filter.' : 'No BGP routes are available for this requested router.'}</p>}
  </>
}
