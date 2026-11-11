import { useMemo, useState } from 'react'
import { cidr } from '../validation'
import type { AzBgpRibEntry } from './engine'

export function BgpRouteTable({ entries, available }: { entries: AzBgpRibEntry[]; available: boolean }) {
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
  if (!available) return <p role="status" data-testid="aznet-rib-unavailable">The requested router is no longer available. No other router's routes are shown.</p>
  return <>
    <label className="aznet-field"><span>Filter by prefix</span><input type="search" className="aznet-input" aria-label="Filter BGP prefixes" value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
    <p className="route-legend"><strong>* Preferred</strong> · Candidates are grouped by prefix; subnet forwarding routes are inspected separately.</p>
    <div className="table-scroll">
      <table className="aznet-route-table" aria-label="Requested router BGP table">
        <thead><tr><th className="route-state" aria-label="Preferred route">*</th><th>Next hop / source</th><th>AS path</th></tr></thead>
        {visible.map(([prefix, candidates]) => <tbody key={prefix}>
          <tr data-reason-prefix={prefix}><th scope="rowgroup" colSpan={3} className="route-prefix-heading" style={{ whiteSpace: 'normal' }}>
            <code>{prefix}</code>{' '}
            <span className="selection-reason">{[...new Set(candidates.map((entry) => entry.explanation))].join(' ')}</span>
          </th></tr>
          {[...candidates].sort((a, b) => Number(b.preferred) - Number(a.preferred)).map((entry) => <tr key={entry.id}
            data-prefix={prefix} data-preferred={entry.preferred} className={entry.preferred ? 'preferred-route' : 'alternative-route'}>
            <td className="route-state" aria-label={entry.preferred ? 'Preferred' : 'Alternative'}>{entry.preferred ? '*' : ''}</td>
            <td><strong>{entry.nextHopName}</strong><small>{entry.nextHopKind === 'local' ? 'Local origin' : entry.originProtocol}</small></td>
            <td className="as-path">{entry.asPath.join(' ') || '-'}</td>
          </tr>)}
        </tbody>)}
      </table>
    </div>
    {!visible.length && <p className="empty" data-testid="aznet-rib-empty">{filter ? 'No routes match the prefix filter.' : 'No BGP routes are available for this requested router.'}</p>}
  </>
}
