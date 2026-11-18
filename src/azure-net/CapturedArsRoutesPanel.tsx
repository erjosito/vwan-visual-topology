import { useState } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import type { AzCapturedObservations } from './azure-import'
import { capturedArsEndpoint, capturedArsRoutes } from './captured-ars-routes'

registerJapaneseMessages({
  'Not captured': '未取得',
  'Captured at {0} in resource group {1}. This is historical Azure observation, not current simulator or live BGP state.': 'リソース グループ {1} で {0} に取得した Azure の履歴です。現在のシミュレーターやライブ BGP の状態ではありません。',
  'Captured ARS BGP routes': '取得済み ARS BGP ルート',
  'Captured ARS peering': '取得済み ARS ピアリング',
  'Route direction': 'ルートの方向',
  'Learned from peer': 'ピアから学習',
  'Advertised to peer': 'ピアに通知',
  'Captured ARS endpoint': '取得済み ARS エンドポイント',
  'Unassigned (no local endpoint captured)': '未割り当て（ローカル エンドポイント未取得）',
  'Source peer': '送信元ピア',
  'Captured route attributes': '取得済みルート属性',
  'Previous routes': '前のルート',
  'Next routes': '次のルート',
  'Rows {0}–{1} of {2}': '全 {2} 行中 {0}～{1} 行',
  'Azure role labels and local addresses are shown as captured; physical instance identity and IP aliases are not inferred.': 'Azure のロール名とローカル アドレスを取得時のまま表示します。物理インスタンスの識別情報や IP エイリアスは推測しません。',
  'No rows were captured for this selection. Missing rows do not establish that no routes or sessions exist.': 'この選択の行は取得されていません。行がないことはルートやセッションが存在しない証明ではありません。',
  'ARS route capture coverage: {0}. Captured rows are historical, not simulator-selected routes or a live session state.': 'ARS ルート取得のカバレッジ: {0}。取得済みの行は履歴であり、シミュレーターで選択されたルートやライブ セッション状態ではありません。',
  'Malformed or oversized route observations cannot establish complete coverage.': '不正またはサイズ上限を超えたルート観測では、完全なカバレッジを確認できません。',
  'Unknown / incomplete': '不明 / 不完全',
})

export default function CapturedArsRoutesPanel({ observations }: { observations: AzCapturedObservations }) {
  const [selectedPeering, setPeering] = useState('')
  const [direction, setDirection] = useState<'arsLearnedRoutes' | 'arsAdvertisedRoutes'>('arsLearnedRoutes')
  const [selectedEndpoint, setEndpoint] = useState('')
  const [selectedPage, setPage] = useState(0)
  const peerings = [...new Set([...Object.keys(observations.arsLearnedRoutes ?? {}), ...Object.keys(observations.arsAdvertisedRoutes ?? {})])].sort()
  const invalidPeerings = peerings.length > 256 || peerings.some((key) => key.length > 512)
  const peering = peerings.includes(selectedPeering) ? selectedPeering : peerings[0]
  if (peering === undefined) return null
  if (invalidPeerings) return <section className="aznet-card" data-testid="captured-ars-routes">
    <h3>{t('Captured ARS BGP routes')}</h3>
    <p role="status">{t('Malformed or oversized route observations cannot establish complete coverage.')}</p>
  </section>
  const parsed = capturedArsRoutes(observations[direction]?.[peering] ?? [])
  const endpoints = [...new Set(parsed.rows.map(capturedArsEndpoint))].sort((a, b) =>
    Number(a === '["",""]') - Number(b === '["",""]') || a.localeCompare(b))
  const endpoint = endpoints.includes(selectedEndpoint) ? selectedEndpoint : endpoints[0]
  const rows = parsed.rows.filter((row) => capturedArsEndpoint(row) === endpoint)
  const page = Math.min(selectedPage, Math.max(0, Math.ceil(rows.length / 100) - 1))
  const shown = rows.slice(page * 100, page * 100 + 100)
  const section = observations.sections?.[`${direction}:${peering}`]
  const missing = t('Not captured')
  const endpointName = (value: string) => {
    const [role, address] = JSON.parse(value) as string[]
    return [role, address].filter(Boolean).join(' · ') || t('Unassigned (no local endpoint captured)')
  }
  return <section className="aznet-card" data-testid="captured-ars-routes">
    <h3>{t('Captured ARS BGP routes')}</h3>
    <p>{t('Captured at {0} in resource group {1}. This is historical Azure observation, not current simulator or live BGP state.',
      observations.capturedAt || missing, observations.resourceGroup)}</p>
    <p>{t('Azure role labels and local addresses are shown as captured; physical instance identity and IP aliases are not inferred.')}</p>
    <label className="field">{t('Captured ARS peering')}<select aria-label={t('Captured ARS peering')} value={peering}
      onChange={(event) => { setPeering(event.target.value); setEndpoint(''); setPage(0) }}>
      {peerings.map((value) => <option key={value}>{value}</option>)}
    </select></label>
    <label className="field">{t('Route direction')}<select aria-label={t('Route direction')} value={direction}
      onChange={(event) => { setDirection(event.target.value as typeof direction); setEndpoint(''); setPage(0) }}>
      <option value="arsLearnedRoutes">{t('Learned from peer')}</option>
      <option value="arsAdvertisedRoutes">{t('Advertised to peer')}</option>
    </select></label>
    {endpoint !== undefined && <label className="field">{t('Captured ARS endpoint')}<select aria-label={t('Captured ARS endpoint')} value={endpoint}
      onChange={(event) => { setEndpoint(event.target.value); setPage(0) }}>
      {endpoints.map((value) => <option key={value} value={value}>{endpointName(value)}</option>)}
    </select></label>}
    {shown.length > 0 ? <div className="table-scroll"><table className="aznet-route-table">
      <caption>{peering} · {endpointName(endpoint!)}</caption>
      <thead><tr><th>{t('Prefix')}</th><th>{t('Next hop')}</th><th>{t('AS path')}</th><th>{t('Source peer')}</th></tr></thead>
      <tbody>{shown.map((route, index) => <tr key={index}>
        <td>{route.network}<details><summary>{t('Captured route attributes')}</summary>
          <p>{t('Origin')}: {route.origin ?? missing}</p><p>{t('Weight')}: {route.weight ?? missing}</p>
        </details></td>
        <td>{route.nextHop ?? missing}</td><td>{route.asPath ?? missing}</td><td>{route.sourcePeer ?? missing}</td>
      </tr>)}</tbody>
    </table></div> : <p role="status">{t('No rows were captured for this selection. Missing rows do not establish that no routes or sessions exist.')}</p>}
    {rows.length > 100 && <div>
      <button type="button" className="aznet-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('Previous routes')}</button>
      {' '}{t('Rows {0}–{1} of {2}', page * 100 + 1, Math.min(rows.length, page * 100 + 100), rows.length)}{' '}
      <button type="button" className="aznet-btn" disabled={(page + 1) * 100 >= rows.length} onClick={() => setPage(page + 1)}>{t('Next routes')}</button>
    </div>}
    <p role="status">{t('ARS route capture coverage: {0}. Captured rows are historical, not simulator-selected routes or a live session state.',
      `${section?.state ?? 'unknown'}${section?.complete ? '' : ` · ${t('Unknown / incomplete')}`}`)}</p>
    {parsed.rejected && <p role="status">{t('Malformed or oversized route observations cannot establish complete coverage.')}</p>}
  </section>
}
