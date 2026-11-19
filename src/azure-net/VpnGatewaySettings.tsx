import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import type { AzArsPreference, AzVNet, AzVnetGateway } from './model'

registerJapaneseMessages({
  'Standalone VPN gateway mode': 'スタンドアロン VPN ゲートウェイのモード',
  'Unspecified (legacy design)': '未指定（以前の設計）',
  'Active/standby': 'アクティブ/スタンバイ',
  'Active/active': 'アクティブ/アクティブ',
  'Both modes have two physical instances. Active/standby has one active BGP endpoint; active/active has two. No endpoint addresses or live sessions are inferred.': 'どちらのモードにも物理インスタンスが 2 つあります。アクティブ/スタンバイのアクティブ BGP エンドポイントは 1 つ、アクティブ/アクティブは 2 つです。アドレスやライブ セッションは推測しません。',
  'Mode is unspecified in this design. Legacy Bicep export defaults to active/standby; this is not observed instance evidence.': 'この設計ではモードが未指定です。以前の Bicep エクスポートの既定値はアクティブ/スタンバイです。これは取得済みインスタンスの証跡ではありません。',
  'ARS route exchange requires active/active and ASN 65515, even when VPN BGP is disabled. Resource-level simulated routes do not qualify an unsupported combination.': 'ARS のルート交換には、VPN BGP が無効でもアクティブ/アクティブと ASN 65515 が必要です。リソース単位のシミュレーション結果は、未サポートの組み合わせを検証するものではありません。',
  'This setting does not model instance failure, failover timing or live BGP establishment. It does not apply to Virtual WAN VPN gateways.': 'この設定は、インスタンス障害、フェールオーバー時間、実際の BGP 確立をモデル化しません。Virtual WAN VPN ゲートウェイには適用されません。',
  'Gateway SKU': 'ゲートウェイ SKU',
  'VPN gateway routing type': 'VPN ゲートウェイのルーティングの種類',
  'VPN gateway generation': 'VPN ゲートウェイの世代',
  'Unspecified (not captured)': '未指定（未取得）',
  'ER/VPN coexistence requires RouteBased VPN, supported non-Basic gateway SKUs and GatewaySubnet /27 or shorter. Missing settings do not prove compatibility. Run Check Routing for affected resources and UDRs.': 'ER/VPN の共存には、RouteBased VPN、サポート対象の非 Basic ゲートウェイ SKU、および /27 以下の GatewaySubnet が必要です。設定が不明な場合、互換性は確認できません。「Check Routing」で対象リソースと UDR を確認してください。',
  'RouteBased gateways can use policy-based traffic selectors on a connection. Those selectors are not a PolicyBased gateway and are not simulated as IPsec policy.': 'RouteBased ゲートウェイでも接続でポリシー ベースのトラフィック セレクターを使用できます。これらのセレクターは PolicyBased ゲートウェイとは異なり、IPsec ポリシーとしてシミュレーションされません。',
  'Azure ER preference does not configure on-premises return preference. VPN backup is for private peering, not Microsoft peering; its Internet underlay is not assessed.': 'Azure の ER 優先設定は、オンプレミスの戻り経路の優先設定を構成しません。VPN バックアップはプライベート ピアリングが対象で、Microsoft ピアリングは対象外です。インターネット アンダーレイは評価されません。',
})

function VpnGatewaySettings({ gateway, routeExchange, coexisting, onMode, onConfiguration }: {
  gateway: AzVnetGateway
  routeExchange: boolean
  coexisting: boolean
  onMode: (mode: boolean | undefined) => void
  onConfiguration: (configuration: Pick<AzVnetGateway, 'sku' | 'vpnType' | 'vpnGatewayGeneration'>) => void
}) {
  const unsupportedSku = coexisting && gateway.sku?.trim().toLowerCase() === 'basic'
  const unsupportedType = coexisting && gateway.vpnType === 'PolicyBased'
  return <fieldset data-testid={`vpn-gateway-settings-${gateway.id}`}>
    <legend>{gateway.name}</legend>
    <label className="field"><span>{t('Gateway SKU')}</span>
      <input aria-label={t('Gateway SKU')} placeholder={t('Unspecified (not captured)')}
        value={gateway.sku ?? ''} maxLength={120}
        aria-invalid={unsupportedSku}
        style={unsupportedSku ? { borderColor: 'var(--error)', color: 'var(--error)' } : undefined}
        onChange={(event) => onConfiguration({ sku: event.target.value || undefined })} />
    </label>
    {gateway.kind === 'Vpn' && <>
    <label className="field"><span>{t('VPN gateway routing type')}</span>
      <select aria-label={t('VPN gateway routing type')} value={gateway.vpnType ?? ''}
        aria-invalid={unsupportedType}
        style={unsupportedType ? { borderColor: 'var(--error)', color: 'var(--error)' } : undefined}
        onChange={(event) => onConfiguration({ vpnType: event.target.value as AzVnetGateway['vpnType'] || undefined })}>
        <option value="">{t('Unspecified (not captured)')}</option>
        <option value="RouteBased">RouteBased</option>
        <option value="PolicyBased">PolicyBased</option>
      </select>
    </label>
    <label className="field"><span>{t('VPN gateway generation')}</span>
      <select aria-label={t('VPN gateway generation')} value={gateway.vpnGatewayGeneration ?? ''}
        onChange={(event) => onConfiguration({ vpnGatewayGeneration: event.target.value as AzVnetGateway['vpnGatewayGeneration'] || undefined })}>
        <option value="">{t('Unspecified (not captured)')}</option>
        <option value="Generation1">Generation1</option>
        <option value="Generation2">Generation2</option>
      </select>
    </label>
    <p>{t('RouteBased gateways can use policy-based traffic selectors on a connection. Those selectors are not a PolicyBased gateway and are not simulated as IPsec policy.')}</p>
    <label className="field"><span>{t('Standalone VPN gateway mode')}</span>
      <select aria-label={t('Standalone VPN gateway mode')}
        value={gateway.activeActive === undefined ? 'unspecified' : gateway.activeActive ? 'active-active' : 'active-standby'}
        onChange={(event) => onMode(event.target.value === 'unspecified' ? undefined : event.target.value === 'active-active')}>
        <option value="unspecified">{t('Unspecified (legacy design)')}</option>
        <option value="active-standby">{t('Active/standby')}</option>
        <option value="active-active">{t('Active/active')}</option>
      </select>
    </label>
    <p>{t('Both modes have two physical instances. Active/standby has one active BGP endpoint; active/active has two. No endpoint addresses or live sessions are inferred.')}</p>
    {gateway.activeActive === undefined && <p role="status">{t('Mode is unspecified in this design. Legacy Bicep export defaults to active/standby; this is not observed instance evidence.')}</p>}
    {routeExchange && (gateway.activeActive !== true || gateway.asn !== 65515) &&
      <p role="status">{t('ARS route exchange requires active/active and ASN 65515, even when VPN BGP is disabled. Resource-level simulated routes do not qualify an unsupported combination.')}</p>}
    <p>{t('This setting does not model instance failure, failover timing or live BGP establishment. It does not apply to Virtual WAN VPN gateways.')}</p>
    </>}
    {coexisting && <>
      <p role="status">{t('ER/VPN coexistence requires RouteBased VPN, supported non-Basic gateway SKUs and GatewaySubnet /27 or shorter. Missing settings do not prove compatibility. Run Check Routing for affected resources and UDRs.')}</p>
      <p>{t('Azure ER preference does not configure on-premises return preference. VPN backup is for private peering, not Microsoft peering; its Internet underlay is not assessed.')}</p>
    </>}
  </fieldset>
}

export default function GatewayRoutingSettings({ vnet, onChange }: {
  vnet: AzVNet
  onChange: (update: (target: AzVNet) => void) => void
}) {
  const coexisting = vnet.gateways.some((gateway) => gateway.enabled && gateway.kind === 'Vpn') &&
    vnet.gateways.some((gateway) => gateway.enabled && gateway.kind === 'ExpressRoute')
  return <>
    {vnet.gateways.map((gateway) => <VpnGatewaySettings key={gateway.id} gateway={gateway} coexisting={coexisting}
      routeExchange={!!(gateway.enabled && vnet.routeServer?.enabled && vnet.routeServer.branchToBranchTraffic)}
      onConfiguration={(configuration) => onChange((target) => {
        const current = target.gateways.find((candidate) => candidate.id === gateway.id)
        if (current) Object.assign(current, configuration)
      })}
      onMode={(mode) => onChange((target) => {
        const current = target.gateways.find((candidate) => candidate.id === gateway.id)
        if (current) {
          if (mode === undefined) delete current.activeActive
          else current.activeActive = mode
        }
      })} />)}
    {vnet.routeServer && <div style={{ marginTop: 6, marginBottom: 6 }} className="aznet-field-grid">
      <label className="aznet-checkbox-row">
        <input type="checkbox" checked={vnet.routeServer.branchToBranchTraffic}
          onChange={(event) => {
            const checked = event.target.checked
            onChange((target) => { if (target.routeServer) target.routeServer.branchToBranchTraffic = checked })
          }} />
        <span>ARS Branch-to-Branch (ER ↔ VPN ↔ NVA)</span>
      </label>
      <label className="aznet-field"><span>ARS Hub Routing Preference</span>
        <select className="aznet-select" value={vnet.routeServer.hubRoutingPreference}
          onChange={(event) => {
            const preference = event.target.value as AzArsPreference
            onChange((target) => { if (target.routeServer) target.routeServer.hubRoutingPreference = preference })
          }}>
          <option value="ExpressRoute">ExpressRoute (Default)</option>
          <option value="VpnGateway">VpnGateway</option>
          <option value="ASPath">ASPath</option>
        </select>
      </label>
    </div>}
  </>
}
