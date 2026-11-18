import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import type { AzVnetGateway } from './model'

registerJapaneseMessages({
  'Standalone VPN gateway mode': 'スタンドアロン VPN ゲートウェイのモード',
  'Unspecified (legacy design)': '未指定（以前の設計）',
  'Active/standby': 'アクティブ/スタンバイ',
  'Active/active': 'アクティブ/アクティブ',
  'Both modes have two physical instances. Active/standby has one active BGP endpoint; active/active has two. No endpoint addresses or live sessions are inferred.': 'どちらのモードにも物理インスタンスが 2 つあります。アクティブ/スタンバイのアクティブ BGP エンドポイントは 1 つ、アクティブ/アクティブは 2 つです。アドレスやライブ セッションは推測しません。',
  'Mode is unspecified in this design. Legacy Bicep export defaults to active/standby; this is not observed instance evidence.': 'この設計ではモードが未指定です。以前の Bicep エクスポートの既定値はアクティブ/スタンバイです。これは取得済みインスタンスの証跡ではありません。',
  'ARS route exchange requires active/active and ASN 65515, even when VPN BGP is disabled. Resource-level simulated routes do not qualify an unsupported combination.': 'ARS のルート交換には、VPN BGP が無効でもアクティブ/アクティブと ASN 65515 が必要です。リソース単位のシミュレーション結果は、未サポートの組み合わせを検証するものではありません。',
  'This setting does not model instance failure, failover timing or live BGP establishment. It does not apply to Virtual WAN VPN gateways.': 'この設定は、インスタンス障害、フェールオーバー時間、実際の BGP 確立をモデル化しません。Virtual WAN VPN ゲートウェイには適用されません。',
})

export default function VpnGatewaySettings({ gateway, routeExchange, onMode }: {
  gateway: AzVnetGateway
  routeExchange: boolean
  onMode: (mode: boolean | undefined) => void
}) {
  return <fieldset data-testid={`vpn-gateway-settings-${gateway.id}`}>
    <legend>{gateway.name}</legend>
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
  </fieldset>
}
