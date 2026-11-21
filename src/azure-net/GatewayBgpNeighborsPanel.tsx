import { useState } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import { ipv4 } from '../validation'
import type { AzCapturedObservations } from './azure-import'
import { capturedArsRoutes as capturedBgpRoutes } from './captured-ars-routes'
import CapturedGatewayRoutes from './CapturedGatewayRoutes'

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
  'Captured gateway learned BGP routes': '取得済みゲートウェイ学習 BGP ルート',
  'Learned from peer': 'ピアから学習',
  'Unassigned (no local endpoint captured)': '未割り当て（ローカル エンドポイント未取得）',
  'No neighbor observations were captured for this endpoint. Route rows do not establish session state or counters.': 'このエンドポイントのネイバー観測は取得されていません。ルート行はセッション状態やカウンターを証明しません。',
  'Inspect captured routes': '取得済みルートを検査',
  'Source peer': '送信元ピア',
  'All captured source peers': '取得済み送信元ピアすべて',
  'Source peer not captured': '送信元ピア未取得',
  'Captured route attributes': '取得済みルート属性',
  'Captured Azure route origin': '取得済み Azure ルートの生成元',
  'Previous routes': '前のルート',
  'Next routes': '次のルート',
  'Rows {0}–{1} of {2}': '全 {2} 行中 {0}～{1} 行',
  'Gateway route capture coverage: {0}. Missing rows do not establish an empty learned-route table, withdrawal or an unavailable session.': 'ゲートウェイ ルート取得のカバレッジ: {0}。行がないことは空の学習ルート テーブル、経路取り消し、またはセッションの利用不可を証明しません。',
  'Captured learned routes are not advertised routes or simulator best paths. Source peer is not inferred from next hop. ER circuit, primary/secondary edge and physical instance mappings remain unknown.': '取得済み学習ルートは通知ルートやシミュレーターの最適経路ではありません。送信元ピアをネクスト ホップから推測しません。ER 回線、プライマリ/セカンダリ エッジ、物理インスタンスの対応は不明です。',
  'No rows were captured for this selection. Missing rows do not establish that no routes or sessions exist.': 'この選択の行は取得されていません。行がないことはルートやセッションが存在しない証明ではありません。',
  'Malformed or oversized route observations cannot establish complete coverage.': '不正またはサイズ上限を超えたルート観測では、完全なカバレッジを確認できません。',
  'Unknown / incomplete': '不明 / 不完全',
  'Native VPN IP configurations': 'ネイティブ VPN IP 構成',
  'IP configuration ID': 'IP 構成 ID',
  'Assigned default BGP addresses': '割り当て済み既定 BGP アドレス',
  'Custom BGP addresses': 'カスタム BGP アドレス',
  'Tunnel addresses': 'トンネル アドレス',
  'These are captured configuration associations, not physical instance identities, session state or failover evidence. Tunnel addresses are not BGP neighbors.': 'これは取得済み構成の関連付けであり、物理インスタンスの識別情報、セッション状態、フェールオーバーの証拠ではありません。トンネル アドレスは BGP ネイバーではありません。',
  'Malformed native endpoint metadata cannot establish an instance association.': '不正なネイティブ エンドポイント メタデータでは、インスタンスの関連付けを確認できません。',
  'Captured gateway advertised routes': '取得済みゲートウェイ通知ルート',
  'Captured gateway advertised BGP routes': '取得済みゲートウェイ通知 BGP ルート',
  'Advertised-to peer': '通知先ピア',
  'Advertised to peer {0}': 'ピア {0} に通知',
  'Inspect advertised routes': '通知ルートを検査',
  'Gateway advertisement capture coverage: {0}. Some peers or reads remain unknown.': 'ゲートウェイ通知ルート取得のカバレッジ: {0}。一部のピアまたは取得結果は不明です。',
  'Advertised-to peer is the explicit capture request, not source peer or next hop. Command-reported advertisements do not prove peer acceptance, policy installation or packet delivery. ER edge and physical instance mappings remain unknown.': '通知先ピアは明示的な取得要求の対象であり、送信元ピアやネクスト ホップではありません。コマンドの通知ルートはピアの受信、ポリシー適用、パケット到達を証明しません。ER エッジと物理インスタンスの対応は不明です。',
})

export default function GatewayBgpNeighborsPanel({ observations }: { observations: AzCapturedObservations }) {
  const initialScope = { observations, gatewayName: '', localAddress: undefined as string | undefined, sourcePeer: '', page: 0,
    advertisedPeer: '', advertisedPage: 0, advertisedOpen: false }
  const [selection, setSelection] = useState(initialScope)
  const scope = selection.observations === observations ? selection : initialScope
  const { gatewayName, localAddress, sourcePeer } = scope
  const setSourcePeer = (value: string) => setSelection({ ...scope, sourcePeer: value, page: 0 })
  const routeSectionGateways = Object.keys(observations.sections ?? {}).filter((key) => key.startsWith('vngLearnedRoutes:'))
    .map((key) => key.slice('vngLearnedRoutes:'.length))
  const gateways = [...new Set([...Object.keys(observations.vngBgpPeerStatus ?? {}),
    ...Object.keys(observations.vngLearnedRoutes ?? {}), ...Object.keys(observations.vngAdvertisedRoutes ?? {}),
    ...Object.keys(observations.vngBgpEndpoints ?? {}), ...routeSectionGateways])].sort()
  const gateway = gateways.includes(gatewayName) ? gatewayName : gateways[0]
  if (Array.isArray(observations.vngLearnedRoutes) || Array.isArray(observations.vngAdvertisedRoutes) || Array.isArray(observations.vngBgpEndpoints) || gateways.length > 256 ||
      gateways.some((key) => key.length > 512)) return <section className="aznet-card" data-testid="captured-bgp-neighbors">
    <p role="status">{t('Malformed or oversized route observations cannot establish complete coverage.')}</p>
  </section>
  if (gateway === undefined) return null
  const peers = observations.vngBgpPeerStatus?.[gateway] ?? []
  const hasLearned = !!observations.vngLearnedRoutes && Object.hasOwn(observations.vngLearnedRoutes, gateway)
  const routeSection = observations.sections?.[`vngLearnedRoutes:${gateway}`]
  const learned = capturedBgpRoutes(hasLearned ? observations.vngLearnedRoutes![gateway] : [])
  const hasAdvertised = !!observations.vngAdvertisedRoutes && Object.hasOwn(observations.vngAdvertisedRoutes, gateway)
  const rawAdvertised = observations.vngAdvertisedRoutes?.[gateway]
  const advertisedSectionPrefix = `vngAdvertisedRoutes:${gateway}:`
  const advertisedPeers = [...new Set([...Object.keys(rawAdvertised ?? {}),
    ...Object.keys(observations.sections ?? {}).filter((key) => key.startsWith(advertisedSectionPrefix))
      .map((key) => key.slice(advertisedSectionPrefix.length))])].sort((a, b) =>
        (ipv4(a) ?? Infinity) - (ipv4(b) ?? Infinity) || a.localeCompare(b))
  const invalidAdvertised = hasAdvertised && (!rawAdvertised || typeof rawAdvertised !== 'object' || Array.isArray(rawAdvertised))
    || advertisedPeers.length > 256 || advertisedPeers.some((peer) => !peer || peer.length > 512)
  const advertisedPeer = advertisedPeers.includes(scope.advertisedPeer) ? scope.advertisedPeer : advertisedPeers[0] ?? ''
  const advertised = capturedBgpRoutes(invalidAdvertised ? null
    : rawAdvertised && Object.hasOwn(rawAdvertised, advertisedPeer) ? rawAdvertised[advertisedPeer] : [])
  const advertisedSection = observations.sections?.[advertisedSectionPrefix + advertisedPeer]
    ?? observations.sections?.[`vngAdvertisedRoutes:${gateway}`]
  const advertisedInventory = observations.sections?.[`vngAdvertisedRoutes:${gateway}`]
  const setAdvertisedPeer = (value: string) => setSelection({ ...scope, advertisedPeer: value, advertisedPage: 0, advertisedOpen: true })
  const rawEndpoints = observations.vngBgpEndpoints?.[gateway]
  const endpoints = Array.isArray(rawEndpoints) && rawEndpoints.length <= 64 ? rawEndpoints.filter((endpoint) =>
    endpoint && typeof endpoint === 'object' &&
    typeof endpoint.gatewayResourceId === 'string' && !!endpoint.gatewayResourceId && endpoint.gatewayResourceId.length <= 512 &&
    typeof endpoint.ipConfigurationId === 'string' && !!endpoint.ipConfigurationId && endpoint.ipConfigurationId.length <= 512 &&
    endpoint.ipConfigurationId.toLowerCase().startsWith(`${endpoint.gatewayResourceId.toLowerCase()}/ipconfigurations/`) &&
    [endpoint.defaultBgpIpAddresses, endpoint.customBgpIpAddresses, endpoint.tunnelIpAddresses].every((values) =>
      Array.isArray(values) && values.length <= 64 && values.every((value) => typeof value === 'string' && ipv4(value) !== undefined))) : []
  const addresses = [...new Set([...peers.map((peer) => peer.localAddress).filter((value): value is string => !!value),
    ...endpoints.flatMap((endpoint) => [...endpoint.defaultBgpIpAddresses, ...endpoint.customBgpIpAddresses]),
    ...learned.rows.map((route) => route.localAddress || ''),
    ...advertised.rows.map((route) => route.localAddress || '')])].sort((a, b) => Number(!a) - Number(!b) || a.localeCompare(b))
  const address = localAddress !== undefined && addresses.includes(localAddress) ? localAddress : addresses[0]
  const rows = !address ? [] : peers.filter((peer) => peer.localAddress === address)
  const routes = learned.rows.filter((route) => (route.localAddress || '') === address)
  const routeSources = new Set(routes.map((route) => route.sourcePeer))
  const unscoped = peers.filter((peer) => !peer.localAddress).length
  const section = observations.sections?.[`vngBgpPeerStatus:${gateway}`]
  const missing = t('Not captured')
  return <section className="aznet-card" data-testid="captured-bgp-neighbors">
    <h3>{t('Captured gateway BGP neighbors')}</h3>
    <p>{t('Captured at {0} in resource group {1}. This is historical Azure observation, not current simulator or live BGP state.',
      observations.capturedAt || t('Not captured'), observations.resourceGroup)}</p>
    <p>{t('One local endpoint is shown at a time. Physical instance identity and other IP aliases are not inferred from IP addresses.')}</p>
    <label className="field"><span>{t('Captured gateway')}</span><select aria-label={t('Captured gateway')} value={gateway}
      onChange={(event) => setSelection({ ...initialScope, gatewayName: event.target.value })}>
      {gateways.map((name) => <option key={name}>{name}</option>)}
    </select></label>
    {endpoints.length > 0 && <details>
      <summary>{t('Native VPN IP configurations')}</summary>
      <p>{t('These are captured configuration associations, not physical instance identities, session state or failover evidence. Tunnel addresses are not BGP neighbors.')}</p>
      <div className="table-scroll" role="region" aria-label={t('Native VPN IP configurations')} tabIndex={0}><table className="aznet-route-table" data-testid="captured-vpn-ip-configurations">
        <caption>{gateway} · {t('Native VPN IP configurations')}</caption>
        <thead><tr><th>{t('IP configuration ID')}</th><th>{t('Assigned default BGP addresses')}</th><th>{t('Custom BGP addresses')}</th><th>{t('Tunnel addresses')}</th></tr></thead>
        <tbody>{endpoints.map((endpoint, index) => <tr key={`${endpoint.ipConfigurationId}:${index}`}>
          <td><code>{endpoint.ipConfigurationId}</code></td>
          <td>{endpoint.defaultBgpIpAddresses.join(', ') || missing}</td>
          <td>{endpoint.customBgpIpAddresses.join(', ') || missing}</td>
          <td>{endpoint.tunnelIpAddresses.join(', ') || missing}</td>
        </tr>)}</tbody>
      </table></div>
    </details>}
    {rawEndpoints !== undefined && (!Array.isArray(rawEndpoints) || endpoints.length !== rawEndpoints.length) &&
      <p role="status">{t('Malformed native endpoint metadata cannot establish an instance association.')}</p>}
    {address !== undefined ? <>
      <label className="field"><span>{t('Local BGP endpoint')}</span><select aria-label={t('Local BGP endpoint')} value={address}
        onChange={(event) => setSelection({ ...scope, localAddress: event.target.value, sourcePeer: '', page: 0, advertisedPage: 0 })}>
        {addresses.map((value) => <option key={value} value={value}>{value || t('Unassigned (no local endpoint captured)')}</option>)}
      </select></label>
      {rows.length > 0 ? <div className="table-scroll"><table className="aznet-route-table" data-testid="captured-gateway-neighbor-table">
        <caption>{gateway} · {address}</caption>
        <thead><tr><th>{t('Neighbor')}</th><th>{t('Remote ASN')}</th><th>{t('Captured state')}</th><th>{t('Received prefixes')}</th></tr></thead>
        <tbody>{rows.map((peer, index) => <tr key={index} data-local-address={peer.localAddress}>
          <td>{peer.neighbor || missing}<details><summary>{t('Observed counters')}</summary>
            <p>{t('Connected duration')}: {peer.connectedDuration || missing}</p>
            <p>{t('Messages sent / received')}: {peer.messagesSent ?? missing} / {peer.messagesReceived ?? missing}</p>
          </details>
          {peer.neighbor && routeSources.has(peer.neighbor) &&
            <button type="button" className="aznet-btn" onClick={() => setSourcePeer(JSON.stringify([peer.neighbor]))}>{t('Inspect captured routes')}</button>}
          {peer.neighbor && !invalidAdvertised && advertisedPeers.includes(peer.neighbor) &&
            <button type="button" className="aznet-btn" onClick={() => setAdvertisedPeer(peer.neighbor!)}>{t('Inspect advertised routes')}</button>}</td>
          <td>{peer.asn ?? missing}</td><td>{peer.state || missing}</td><td>{peer.routesReceived ?? missing}</td>
        </tr>)}</tbody>
      </table></div> : <p role="status">{t('No neighbor observations were captured for this endpoint. Route rows do not establish session state or counters.')}</p>}
    </> : <p role="status">{t('No local BGP endpoint was captured for this gateway. Its neighbors cannot be scoped to an instance.')}</p>}
    {unscoped > 0 && <p role="status">{t('{0} rows have no local address and cannot be assigned to this endpoint.', unscoped)}</p>}
    {(!section?.complete || section.state !== 'succeeded') &&
      <p role="status">{t('Neighbor capture coverage: {0}. Missing rows do not establish that no BGP session exists.', section?.state ?? 'unknown')}</p>}
    {(hasLearned || routeSection) &&
      <CapturedGatewayRoutes gateway={gateway} address={address}
        rows={routes} rejected={learned.rejected} section={routeSection}
        sourcePeer={sourcePeer} onSourcePeerChange={setSourcePeer} selectedPage={scope.page}
        onPageChange={(page) => setSelection({ ...scope, page })} />}
    {(hasAdvertised || advertisedPeers.length > 0 || advertisedSection) && <details open={scope.advertisedOpen}
      onToggle={(event) => {
        const advertisedOpen = event.currentTarget.open
        if (advertisedOpen !== scope.advertisedOpen) setSelection({ ...scope, advertisedOpen })
      }}>
      <summary>{t('Captured gateway advertised routes')}</summary>
      {advertisedInventory && !advertisedInventory.complete &&
        <p role="status">{t('Gateway advertisement capture coverage: {0}. Some peers or reads remain unknown.', advertisedInventory.state)}</p>}
      {!invalidAdvertised && <label className="field">{t('Advertised-to peer')}<select aria-label={t('Advertised-to peer')} value={advertisedPeer}
        onChange={(event) => setAdvertisedPeer(event.target.value)}>
        {!advertisedPeers.length && <option value="">{missing}</option>}
        {advertisedPeers.map((peer) => <option key={peer}>{peer}</option>)}
      </select></label>}
      <CapturedGatewayRoutes gateway={gateway} address={address} advertisedTo={advertisedPeer}
        rows={advertised.rows.filter((route) => (route.localAddress || '') === address)}
        rejected={advertised.rejected} section={advertisedSection}
        sourcePeer="" onSourcePeerChange={() => {}} selectedPage={scope.advertisedPage}
        onPageChange={(advertisedPage) => setSelection({ ...scope, advertisedPage })} />
    </details>}
  </section>
}
