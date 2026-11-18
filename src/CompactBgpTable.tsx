import type { ReactNode } from 'react'
import { t } from './i18n'
import { registerJapaneseMessages } from './messages'
import './compact-bgp.css'

registerJapaneseMessages({
  'Network': 'ネットワーク',
  'Evidence': '証跡',
  'Filter BGP prefixes': 'BGP プレフィックスのフィルター',
  'Requested router BGP table': '指定ルーターの BGP テーブル',
  'BGP candidates; subnet forwarding routes are inspected separately.': 'BGP 候補を表示します。サブネットの転送ルートは別途確認してください。',
  'Route details': 'ルートの詳細',
  'Copyable route text': 'コピー用ルートテキスト',
  'Select route text to copy': 'コピーするルートテキストを選択',
  '* Preferred; - alternative. Selection is not a validity or live-session check.': '* 優先、- 代替。選択状態は有効性や実際のセッションの確認ではありません。',
  '* Selected by ARS; ? ARS selection not indicated. NVA best-path selection is not modeled.': '* ARS が選択、? ARS の選択情報なし。NVA の最適パス選択はモデル化されていません。',
  '? Selection not assessed in this received/advertised scope.': '? この受信/広告スコープでは選択は評価されません。',
  'Azure provenance and selection evidence': 'Azure の出所と選択の証跡',
})

export interface CompactBgpRow {
  id: string
  prefix: string
  status: '*' | '-' | '?'
  statusLabel: string
  nextHop: string
  asPath: number[]
  neighbor?: string
  details: ReactNode
  textEvidence?: string
  network?: ReactNode
  preferred?: boolean
  peerId?: string
  warning?: ReactNode
}

export function CompactBgpTable({ rows, label, legend, testId, neighborLabel }: {
  rows: CompactBgpRow[]
  label: string
  legend: string
  testId?: string
  neighborLabel?: string
}) {
  const text = [
    legend,
    ['Status', 'Network', ...(neighborLabel ? [neighborLabel] : []), 'Next hop', 'AS path', 'Evidence'].map(t).join('\t'),
    ...rows.map((row) => [row.status, row.prefix, ...(neighborLabel ? [row.neighbor ?? '—'] : []),
      row.nextHop, row.asPath.join(' ') || '—', row.textEvidence ?? row.id].join('\t')),
  ].join('\n')
  return <div className="compact-bgp">
    <p className="route-legend">{legend}</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className="aznet-route-table compact-bgp-table" aria-label={label} data-testid={testId}>
        <thead><tr><th scope="col">{t('Status')}</th><th scope="col">{t('Network')}</th>
          {neighborLabel && <th scope="col">{neighborLabel}</th>}
          <th scope="col">{t('Next hop')}</th><th scope="col">{t('AS path')}</th><th scope="col">{t('Route details')}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={`${row.prefix}:${row.id}`} data-prefix={row.prefix} data-route-id={row.id}
          data-ars-id={row.peerId} data-preferred={row.preferred}
          className={row.preferred === undefined ? undefined : row.preferred ? 'preferred-route' : 'alternative-route'}>
          <td className="route-state" aria-label={row.statusLabel}><span aria-hidden="true">{row.status}</span></td>
          <th scope="row">{row.network ?? <code>{row.prefix}</code>}</th>
          {neighborLabel && <td>{row.neighbor}</td>}
          <td>{row.nextHop}</td><td className="as-path">{row.asPath.join(' ') || '—'}</td>
          <td>{row.warning}<details><summary aria-label={`${t('Evidence')} · ${row.prefix} · ${row.id}`}>{t('Evidence')}</summary>
            <div className="compact-bgp-evidence">{row.details}</div>
          </details></td>
        </tr>)}</tbody>
      </table>
    </div>
    <details className="compact-bgp-copy"><summary>{t('Copyable route text')}</summary>
      <textarea readOnly aria-label={t('Select route text to copy')} value={text} onFocus={(event) => event.currentTarget.select()} />
    </details>
  </div>
}
