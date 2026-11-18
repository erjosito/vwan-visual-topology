import { useState } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import type { AzCapturedObservations } from './azure-import'

registerJapaneseMessages({
  'Captured gateway BGP neighbors': '取得済みゲートウェイ BGP ネイバー',
  'Captured gateway': '取得済みゲートウェイ',
  'Local BGP endpoint': 'ローカル BGP エンドポイント',
  'Captured state': '取得時の状態',
  'Remote ASN': 'リモート ASN',
  'Received prefixes': '受信プレフィックス数',
  'Not captured': '未取得',
  'Captured at {0} in resource group {1}. This is historical Azure observation, not current simulator or live BGP state.': 'リソース グループ {1} で {0} に取得した Azure の履歴です。現在のシミュレーターやライブ BGP の状態ではありません。',
  'One local endpoint is shown at a time. Physical instance identity and other IP aliases are not inferred from IP addresses.': '一度に表示するローカル エンドポイントは 1 つです。IP アドレスから物理インスタンスの識別情報や別の IP エイリアスは推測しません。',
  'Neighbor capture coverage: {0}. Missing rows do not establish that no BGP session exists.': 'ネイバー取得のカバレッジ: {0}。行がないことは BGP セッションが存在しない証明ではありません。',
  '{0} rows have no local address and cannot be assigned to this endpoint.': '{0} 行にローカル アドレスがなく、このエンドポイントに割り当てられません。',
  'No local BGP endpoint was captured for this gateway. Its neighbors cannot be scoped to an instance.': 'このゲートウェイのローカル BGP エンドポイントは取得されていません。ネイバーの範囲をインスタンスに限定できません。',
  'Observed counters': '取得済みカウンター',
  'Connected duration': '接続継続時間',
  'Messages sent / received': '送信 / 受信メッセージ数',
})

export default function GatewayBgpNeighborsPanel({ observations }: { observations: AzCapturedObservations }) {
  const [gatewayName, setGatewayName] = useState('')
  const [localAddress, setLocalAddress] = useState('')
  const gateways = Object.keys(observations.vngBgpPeerStatus ?? {}).sort()
  const gateway = gateways.includes(gatewayName) ? gatewayName : gateways[0]
  if (gateway === undefined) return null
  const peers = observations.vngBgpPeerStatus![gateway]
  const addresses = [...new Set(peers.map((peer) => peer.localAddress).filter((address): address is string => !!address))].sort()
  const address = addresses.includes(localAddress) ? localAddress : addresses[0]
  const rows = address === undefined ? [] : peers.filter((peer) => peer.localAddress === address)
  const unscoped = peers.filter((peer) => !peer.localAddress).length
  const section = observations.sections?.[`vngBgpPeerStatus:${gateway}`]
  const missing = t('Not captured')
  return <section className="aznet-card" data-testid="captured-bgp-neighbors">
    <h3>{t('Captured gateway BGP neighbors')}</h3>
    <p>{t('Captured at {0} in resource group {1}. This is historical Azure observation, not current simulator or live BGP state.',
      observations.capturedAt || t('Not captured'), observations.resourceGroup)}</p>
    <p>{t('One local endpoint is shown at a time. Physical instance identity and other IP aliases are not inferred from IP addresses.')}</p>
    <label className="field"><span>{t('Captured gateway')}</span><select aria-label={t('Captured gateway')} value={gateway}
      onChange={(event) => { setGatewayName(event.target.value); setLocalAddress('') }}>
      {gateways.map((name) => <option key={name}>{name}</option>)}
    </select></label>
    {address !== undefined ? <>
      <label className="field"><span>{t('Local BGP endpoint')}</span><select aria-label={t('Local BGP endpoint')} value={address}
        onChange={(event) => setLocalAddress(event.target.value)}>
        {addresses.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <div className="table-scroll"><table className="aznet-route-table">
        <caption>{gateway} · {address}</caption>
        <thead><tr><th>{t('Neighbor')}</th><th>{t('Remote ASN')}</th><th>{t('Captured state')}</th><th>{t('Received prefixes')}</th></tr></thead>
        <tbody>{rows.map((peer, index) => <tr key={index} data-local-address={peer.localAddress}>
          <td>{peer.neighbor || missing}<details><summary>{t('Observed counters')}</summary>
            <p>{t('Connected duration')}: {peer.connectedDuration || missing}</p>
            <p>{t('Messages sent / received')}: {peer.messagesSent ?? missing} / {peer.messagesReceived ?? missing}</p>
          </details></td>
          <td>{peer.asn ?? missing}</td><td>{peer.state || missing}</td><td>{peer.routesReceived ?? missing}</td>
        </tr>)}</tbody>
      </table></div>
    </> : <p role="status">{t('No local BGP endpoint was captured for this gateway. Its neighbors cannot be scoped to an instance.')}</p>}
    {unscoped > 0 && <p role="status">{t('{0} rows have no local address and cannot be assigned to this endpoint.', unscoped)}</p>}
    {(!section?.complete || section.state !== 'succeeded') &&
      <p role="status">{t('Neighbor capture coverage: {0}. Missing rows do not establish that no BGP session exists.', section?.state ?? 'unknown')}</p>}
  </section>
}
