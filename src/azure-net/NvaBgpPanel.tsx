import { useState } from 'react'
import { CanvasOverlay } from '../CanvasOverlay'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import { ARS_MAX_BGP_PEERS, azArsPeerHosts } from './ars-route-maps'
import type { AzNvaBgpPeer, AzSimulationResult } from './engine'
import type { AzNetTopology } from './model'
import { CompactBgpTable } from '../CompactBgpTable'
import { cidr } from '../validation'

registerJapaneseMessages({
  'NVA learned BGP routes': 'NVA が学習した BGP ルート',
  'ARS to NVA received candidates only. NVA advertisements and hosting-subnet effective routes are separate views.': 'ARS から NVA が受信する候補のみを表示します。NVA の広告とホストサブネットの有効ルートは別のビューです。',
  'ARS selects before export. NVA best-path selection and forwarding from these candidates are not modeled.': 'ARS はエクスポート前にルートを選択します。NVA の最適パス選択と、これらの候補による転送はモデル化されていません。',
  'ARS neighbor IPs, per-instance sessions, live adjacency and vendor-specific neighbor configuration are not modeled.': 'ARS のネイバー IP、インスタンス別セッション、実際の隣接関係、ベンダー固有のネイバー設定はモデル化されていません。',
  'NVA no longer exists. No received-route evidence is available.': 'NVA は存在しません。受信ルートの証跡はありません。',
  'ARS peers': 'ARS ピア',
  'Edit ARS peers': 'ARS ピアを編集',
  'Finish editing peers': 'ピアの編集を終了',
  'Changing membership affects only that ARS. BGP peering does not enable gateway transit, subnet route injection or packet forwarding.': 'メンバーシップの変更は対象の ARS のみに適用されます。BGP ピアリングはゲートウェイトランジット、サブネットへのルート注入、パケット転送を有効にしません。',
  'ARS peer {0}': 'ARS ピア {0}',
  'Modeled peer available': 'モデル上でピアが利用可能',
  'Gateway summary impact on ARS-to-NVA exports is not assessed. Shown candidates do not prove presence or absence of configured gateway summaries.': 'ゲートウェイ集約プレフィックスが ARS から NVA への広告に与える影響は未評価です。表示候補は構成された集約プレフィックスの有無を証明しません。',
  'Configured gateway summaries (not assessed)': '構成されたゲートウェイ集約プレフィックス（未評価）',
  'BGP over subnet peering is not assessed': 'サブネット ピアリング経由の BGP は未評価です',
  'ARS disabled': 'ARS が無効',
  'NVA BGP disabled': 'NVA の BGP が無効',
  'Unsupported Azure-reserved peer ASN': 'Azure 予約済みのピア ASN は未対応',
  'Unsupported appliance kind': '未対応のアプライアンスの種類',
  'No active direct VNet peering with bidirectional VNet access': '双方向 VNet アクセスを許可する有効な直接 VNet ピアリングがありません',
  'Received-route evidence unavailable': '受信ルートの証跡を利用できません',
  'Not configured': '未構成',
  'Policy connection': 'ポリシー接続',
  'No supported policy connection': '対応するポリシー接続なし',
  'VNet-scoped policy; not per-neighbor': 'VNet スコープのポリシー（ネイバー別ではありません）',
  'No ARS peers configured for this NVA.': 'この NVA には ARS ピアが構成されていません。',
  'NVA BGP peer filter': 'NVA BGP ピアフィルター',
  'All ARS peers': 'すべての ARS ピア',
  'Received candidates': '受信候補',
  'Advertising ARS / neighbor': '広告元 ARS / ネイバー',
  'ARS selection / policy evidence': 'ARS の選択 / ポリシーの証跡',
  'Selected by ARS': 'ARS が選択',
  'ARS selection not indicated': 'ARS の選択情報なし',
  'IP not modeled': 'IP はモデル化されていません',
  'Empty AS path': '空の AS パス',
  'None modeled': 'モデル上はなし',
  'No received candidates in this scope. Check peer availability and ARS export policies.': 'このスコープには受信候補がありません。ピアの可用性と ARS エクスポートポリシーを確認してください。',
  'The selected ARS peer is no longer configured. No received-route evidence is available in this scope.': '選択した ARS ピアは構成されていません。このスコープで利用できる受信ルートの証跡はありません。',
})

const peerStates: Record<AzNvaBgpPeer['state'], string> = {
  available: 'Modeled peer available',
  'ars-disabled': 'ARS disabled',
  'bgp-disabled': 'NVA BGP disabled',
  'unsupported-asn': 'Unsupported Azure-reserved peer ASN',
  'unsupported-appliance': 'Unsupported appliance kind',
  unreachable: 'No active direct VNet peering with bidirectional VNet access',
  'subnet-peering-not-assessed': 'BGP over subnet peering is not assessed',
}

export default function NvaBgpPanel({ topology, simulation, vnetId, applianceId, onPeerChange, onClose }: {
  topology: AzNetTopology
  simulation: AzSimulationResult
  vnetId: string
  applianceId: string
  onPeerChange: (routeServerId: string, checked: boolean) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState('')
  const [prefixFilter, setPrefixFilter] = useState('')
  const [editing, setEditing] = useState(false)
  const owner = topology.vnets.find((vnet) => vnet.id === vnetId)
  const app = owner?.appliances.find((app) => app.id === applianceId)
  const arsHosts = topology.vnets.filter((vnet) => vnet.routeServer)
  const configuredHosts = arsHosts.filter((host) => host.routeServer!.peerApplianceIds.includes(applianceId))
  const peers = (simulation.nvaBgpPeers?.[applianceId] ?? []).filter((peer) => configuredHosts.some((host) => host.routeServer!.id === peer.routeServerId))
  const missingPeer = Boolean(filter) && !configuredHosts.some((host) => host.routeServer!.id === filter)
  const rows = peers.filter((peer) => !filter || peer.routeServerId === filter)
    .flatMap((peer) => peer.routes.map((route) => ({ peer, route })))
    .filter(({ route }) => route.prefix.includes(prefixFilter.trim()))
    .sort((a, b) => (cidr(a.route.prefix)?.network ?? 0) - (cidr(b.route.prefix)?.network ?? 0)
      || (cidr(a.route.prefix)?.length ?? 0) - (cidr(b.route.prefix)?.length ?? 0)
      || a.peer.routeServerId.localeCompare(b.peer.routeServerId)
      || a.route.id.localeCompare(b.route.id))
  const title = `${t('NVA learned BGP routes')} · ${app?.name ?? applianceId}`
  return <CanvasOverlay title={title} className="nva-bgp-panel aznet-routes-window" onClose={onClose}>
    {!app ? <p role="status">{t('NVA no longer exists. No received-route evidence is available.')}</p> : <>
      <p>{t('ARS to NVA received candidates only. NVA advertisements and hosting-subnet effective routes are separate views.')}</p>
      <p className="muted">{t('ARS selects before export. NVA best-path selection and forwarding from these candidates are not modeled.')}</p>
      <p className="muted">{t('ARS neighbor IPs, per-instance sessions, live adjacency and vendor-specific neighbor configuration are not modeled.')}</p>
      <h3>{t('ARS peers')}</h3>
      <button onClick={() => setEditing(!editing)}>{t(editing ? 'Finish editing peers' : 'Edit ARS peers')}</button>
      {editing && <p>{t('Changing membership affects only that ARS. BGP peering does not enable gateway transit, subnet route injection or packet forwarding.')}</p>}
      <div className="table-scroll"><table data-testid="nva-bgp-peers">
        <thead><tr><th>{t('Azure Route Server')}</th><th>{t('VNet')}</th><th>{t('Region')}</th><th>{t('Status')}</th><th>{t('Policy connection')}</th></tr></thead>
        <tbody>{arsHosts.filter((host) => editing || host.routeServer!.peerApplianceIds.includes(applianceId)).map((host) => {
          const ars = host.routeServer!
          const configured = ars.peerApplianceIds.includes(applianceId)
          const peer = peers.find((peer) => peer.routeServerId === ars.id)
          const reachable = azArsPeerHosts(host, topology).some((candidate) => candidate.id === vnetId)
          const canAdd = reachable && ars.enabled && app.bgpEnabled && app.kind === 'nva-vm' &&
            app.asn !== 65515 && app.asn !== 12076 && ars.peerApplianceIds.length < ARS_MAX_BGP_PEERS
          return <tr key={ars.id} data-ars-id={ars.id}>
            <td>{editing && <input type="checkbox" aria-label={t('ARS peer {0}', ars.name)}
              checked={configured} disabled={!configured && !canAdd}
              onChange={(event) => onPeerChange(ars.id, event.target.checked)} />}
              {ars.name}<br /><small>{ars.id} · ASN 65515</small></td>
            <td>{host.name}<br /><small>{host.id}</small></td><td>{host.region}</td>
            <td>{t(!configured ? 'Not configured' : peer ? peerStates[peer.state] : 'Received-route evidence unavailable')}</td>
            <td>{peer?.policyConnectionId ?? t('No supported policy connection')}
              {peer?.policyConnectionId?.startsWith('vnet:') && <p className="muted">{t('VNet-scoped policy; not per-neighbor')}</p>}</td>
          </tr>
        })}</tbody>
      </table></div>
      {!configuredHosts.length && <p role="status">{t('No ARS peers configured for this NVA.')}</p>}
      <label className="field"><span>{t('NVA BGP peer filter')}</span><select aria-label={t('NVA BGP peer filter')} value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="">{t('All ARS peers')}</option>
        {missingPeer && <option value={filter}>{filter} ({t('Not configured')})</option>}
        {configuredHosts.map((host) => <option key={host.routeServer!.id} value={host.routeServer!.id}>
          {host.routeServer!.name} ({host.routeServer!.id})
        </option>)}
      </select></label>
      <label className="field"><span>{t('Filter by prefix')}</span><input type="search" aria-label={t('Filter by prefix')}
        value={prefixFilter} onChange={(event) => setPrefixFilter(event.target.value)} /></label>
      <h3>{t('Received candidates')} ({rows.length})</h3>
      {peers.filter((peer) => (!filter || peer.routeServerId === filter) && peer.gatewaySummaryAssessment).map((peer) => <p role="status" key={peer.routeServerId} data-testid="nva-gateway-summary-boundary">
        <strong>{peer.routeServerId}: {t('Configured gateway summaries (not assessed)')}</strong>
        {' '}{peer.gatewaySummaryAssessment!.configuredPrefixes.join(', ')}<br />
        {t('Gateway summary impact on ARS-to-NVA exports is not assessed. Shown candidates do not prove presence or absence of configured gateway summaries.')}
      </p>)}
      <CompactBgpTable label={t('NVA learned BGP routes')} testId="nva-bgp-routes"
        neighborLabel={t('Advertising ARS / neighbor')}
        legend={t('* Selected by ARS; ? ARS selection not indicated. NVA best-path selection is not modeled.')}
        rows={rows.map(({ peer, route }) => ({
          id: `${peer.routeServerId}:${route.id}`, peerId: peer.routeServerId, prefix: route.prefix,
          status: route.selectedByArs ? '*' : '?',
          statusLabel: t(route.selectedByArs ? 'Selected by ARS' : 'ARS selection not indicated'),
          neighbor: `${arsHosts.find((host) => host.id === peer.routeServerVnetId)?.routeServer?.name ?? peer.routeServerId} (${peer.routeServerId})`,
          nextHop: route.nextHopIp && !route.nextHopName.includes(route.nextHopIp) ? `${route.nextHopName} (${route.nextHopIp})` : route.nextHopName,
          asPath: route.asPath,
          textEvidence: JSON.stringify({ routeServerId: peer.routeServerId, connectionId: peer.connectionId, policyConnectionId: peer.policyConnectionId, route }),
          details: <>
            <p>{t('ARS selection / policy evidence')}: {t(route.selectedByArs ? 'Selected by ARS' : 'ARS selection not indicated')}</p>
            <p>{peer.routeServerId} · {peer.connectionId} · {peer.policyConnectionId}</p>
            <p>{route.id} · {route.nextHopId} · {route.originProtocol}</p>
            <p>{t('Next hop')}: {route.nextHopIp ?? t('IP not modeled')}</p>
            <p>{t('Communities')}: {route.communities?.join(', ') || t('None modeled')}</p>
            <p>{route.explanation}</p>{route.routeMapTrace?.map((trace, index) => <p key={index}>{trace}</p>)}
            <details><summary>{t('Azure provenance and selection evidence')}</summary><pre>{JSON.stringify(route, null, 2)}</pre></details>
          </>,
        }))} />
      {!rows.length && <p role="status">{t(missingPeer
        ? 'The selected ARS peer is no longer configured. No received-route evidence is available in this scope.'
        : prefixFilter ? 'No routes match the current filters.'
          : 'No received candidates in this scope. Check peer availability and ARS export policies.')}</p>}
    </>}
  </CanvasOverlay>
}
