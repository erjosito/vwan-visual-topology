import { lazy, Suspense } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import { InspectorSection } from '../WorkspacePresentation'
import { ALL_KNOWN_AZURE_REGIONS } from '../er-locations-catalog'
import { validateAdvertisedGatewayPrefixes, type AzArsPreference, type AzNetTopology, type AzVNet, type AzVnetGateway } from './model'

const VnetPrefixEditor = lazy(() => import('./AddressPrefixEditors').then((module) => ({ default: module.VnetPrefixEditor })))
const VnetCommunityEditor = lazy(() => import('../VnetCommunityEditor'))

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

export default function VnetRoutingSettings({ topology, vnet, preview, usesRemoteGateways, onTopologyChange, onDeleteVnet,
  onAddGateway, onRemoveGateway, onAddRouteServer, onRemoveRouteServer, onAddAppliance, onAddVnra, onConfigureVnra, onRemoveAppliance }: {
  topology: AzNetTopology
  vnet: AzVNet
  preview?: boolean
  usesRemoteGateways: boolean
  onTopologyChange: (update: (target: AzNetTopology) => void) => void
  onDeleteVnet: () => void
  onAddGateway: (kind: AzVnetGateway['kind']) => void
  onRemoveGateway: (gatewayId: string) => void
  onAddRouteServer: () => void
  onRemoveRouteServer: () => void
  onAddAppliance: () => void
  onAddVnra: () => void
  onConfigureVnra: (id: string) => void
  onRemoveAppliance: (id: string) => void
}) {
  const onChange = (update: (target: AzVNet) => void) => onTopologyChange((draft) => {
    const target = draft.vnets.find((candidate) => candidate.id === vnet.id)
    if (target) update(target)
  })
  const coexisting = vnet.gateways.some((gateway) => gateway.enabled && gateway.kind === 'Vpn') &&
    vnet.gateways.some((gateway) => gateway.enabled && gateway.kind === 'ExpressRoute')
  return <>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="presentation-vnet-field"><span hidden={!preview}>{t('VNet name')}</span>
          <input type="text" className="aznet-input" value={vnet.name} aria-label={t('VNet name {0}', vnet.name)}
            onChange={(event) => {
              const value = event.target.value
              onChange((target) => { target.name = value })
            }} style={{ fontWeight: 700, width: 145 }} />
        </label>
        <label className="presentation-vnet-field"><span hidden={!preview}>{t('VNet region')}</span>
          <input type="text" className="aznet-input" list={`aznet-region-datalist-${vnet.id}`} data-testid={`aznet-vnet-region-${vnet.id}`}
            aria-label={t('VNet region {0}', vnet.name)} title="Azure Region / Location (e.g. westeurope, eastus)"
            value={vnet.region} onChange={(event) => {
              const value = event.target.value
              onChange((target) => {
                if (target.region !== value && target.bgpCommunities?.regionalCommunity) {
                  if (target.bgpCommunities.virtualNetworkCommunity) target.bgpCommunities = { virtualNetworkCommunity: target.bgpCommunities.virtualNetworkCommunity }
                  else delete target.bgpCommunities
                }
                target.region = value
              })
            }} style={{ width: 130, fontSize: 11.5 }} />
        </label>
        <datalist id={`aznet-region-datalist-${vnet.id}`}>
          {ALL_KNOWN_AZURE_REGIONS.map((region) => <option key={region} value={region} />)}
        </datalist>
        <Suspense fallback={null}><VnetPrefixEditor topology={topology} vnet={vnet} preview={preview} onChange={onTopologyChange} /></Suspense>
        <Suspense fallback={null}><VnetCommunityEditor key={vnet.id} value={vnet.bgpCommunities} onChange={(value) => onChange((target) => {
          if (value) target.bgpCommunities = value
          else delete target.bgpCommunities
        })} /></Suspense>
        <label className="presentation-vnet-field"><span hidden={!preview}>{t('Canvas layout role')}</span>
          <select className="aznet-select" value={vnet.role}
            title="Simulator topology role (controls canvas column layout & default gateway transit heuristics)"
            onChange={(event) => {
              const value = event.target.value as AzVNet['role']
              onChange((target) => { target.role = value })
            }}>
            <option value="hub">Hub Layout Role</option><option value="spoke">Spoke Layout Role</option>
          </select>
        </label>
      </div>
      <button type="button" className="aznet-btn" data-testid={`aznet-delete-vnet-${vnet.id}`}
        style={{ padding: '2px 8px', fontSize: 11, color: 'var(--error)', borderColor: 'var(--border)' }}
        onClick={onDeleteVnet}>Delete VNet</button>
    </div>
    <InspectorSection title={t('Gateway route advertisements')}
      summary={vnet.summarizedGatewayPrefixes?.length ? t('{0} configured prefixes', vnet.summarizedGatewayPrefixes.length) : t('Automatic advertisements')}
      initialOpen={!!vnet.summarizedGatewayPrefixes?.length}>
      <label style={{ display: 'grid', gap: 4, marginBottom: 8, fontSize: 11.5 }}>
        Advertised gateway prefixes (IPv4, comma-separated)
        <input key={`${vnet.id}:${vnet.summarizedGatewayPrefixes?.join(',') ?? ''}`} type="text" className="aznet-input"
          aria-label={`Advertised gateway prefixes ${vnet.name}`} aria-describedby={`aznet-gateway-prefix-help-${vnet.id}`}
          defaultValue={vnet.summarizedGatewayPrefixes?.join(', ') ?? ''}
          data-configuration-saved={vnet.summarizedGatewayPrefixes?.join(', ') ?? ''}
          placeholder="Default: advertise individual hub and eligible spoke address spaces"
          onBlur={(event) => {
            const value = event.target.value
            if (value === (vnet.summarizedGatewayPrefixes ?? []).join(', ')) return
            onChange((target) => { target.summarizedGatewayPrefixes = value.split(',').map((prefix) => prefix.trim()).filter(Boolean) })
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
        <small className="configuration-save-hint">{t('Save on blur')}</small>
        <span id={`aznet-gateway-prefix-help-${vnet.id}`} className="aznet-muted">
          Read only by this VNet's ER/VPN gateway when GatewaySubnet exists; stored beforehand, ignored by a remote hub.
          Include this gateway VNet's address spaces (recommended). Covered hub/spoke spaces are summarized; uncovered spaces remain advertised.
          Independent of local address spaces; no overlapping entries or IPv6. No Route Server required.
        </span>
      </label>
    </InspectorSection>
    <p className="aznet-muted" style={{ fontSize: 11.5 }}>{t('Advertisements do not create forwarding routes.')}</p>
    {validateAdvertisedGatewayPrefixes(vnet.summarizedGatewayPrefixes).map((error) =>
      <strong role="alert" key={error}>VNet "{vnet.name}" {error}</strong>)}
    {usesRemoteGateways && <div data-testid={`aznet-vnet-remote-gw-notice-${vnet.id}`}
      style={{ marginBottom: 8, padding: '5px 8px', background: 'var(--surface-muted)', border: '1px solid var(--warning)', borderRadius: 6, fontSize: 11, color: 'var(--warning)' }}>
      ⚠️ This VNet has <strong>Use Remote Gateways</strong> enabled on a peering. Local VNet Gateways and Route Server cannot be deployed unless <code>useRemoteGateways</code> is disabled first.
    </div>}
    <InspectorSection title={t('Add or remove routing devices')}
      summary={t('Gateways: {0}; appliances: {1}; Route Server: {2}', vnet.gateways.length, vnet.appliances.length, vnet.routeServer ? 1 : 0)}
      initialOpen={!!(vnet.gateways.length || vnet.appliances.length || vnet.routeServer)}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8, padding: '6px 8px', background: 'var(--surface)', borderRadius: 6, border: '1px solid var(--border)' }}>
        <button type="button" className="aznet-btn" data-testid={`aznet-add-fw-${vnet.id}`}
          style={{ fontSize: 11, padding: '3px 8px' }} onClick={onAddAppliance}>+ Firewall / NVA</button>
        <button type="button" className="aznet-btn" onClick={onAddVnra}>{t('Add Managed VNRA')}</button>
        {(['ExpressRoute', 'Vpn'] as const).map((kind) => {
          const gateways = vnet.gateways.filter((gateway) => gateway.kind === kind)
          const label = kind === 'Vpn' ? 'VPN' : 'ER'
          return gateways.length ? gateways.map((gateway) =>
            <button key={gateway.id} type="button" className="aznet-btn" data-testid={`aznet-remove-gw-${gateway.id}`}
              style={{ fontSize: 11, padding: '3px 8px', color: 'var(--error)', borderColor: 'var(--border)' }}
              onClick={() => onRemoveGateway(gateway.id)}>✕ {label} GW ({gateway.name})</button>)
            : <button key={kind} type="button" className="aznet-btn" data-testid={`aznet-add-${kind === 'Vpn' ? 'vpngw' : 'ergw'}-${vnet.id}`}
              disabled={usesRemoteGateways}
              title={usesRemoteGateways ? `Cannot add ${label} Gateway while Use Remote Gateways is enabled on a peering` : `Add ${kind === 'ExpressRoute' ? 'ExpressRoute' : 'VPN'} Gateway`}
              style={{ fontSize: 11, padding: '3px 8px', opacity: usesRemoteGateways ? 0.5 : 1 }}
              onClick={() => onAddGateway(kind)}>+ {label} Gateway</button>
        })}
        {!vnet.routeServer ? <button type="button" className="aznet-btn" data-testid={`aznet-add-ars-${vnet.id}`}
          disabled={usesRemoteGateways}
          title={usesRemoteGateways ? 'Cannot add Route Server while Use Remote Gateways is enabled on a peering' : 'Add Azure Route Server'}
          style={{ fontSize: 11, padding: '3px 8px', opacity: usesRemoteGateways ? 0.5 : 1 }}
          onClick={onAddRouteServer}>+ Route Server (ARS)</button>
          : <button type="button" className="aznet-btn" data-testid={`aznet-remove-ars-${vnet.id}`}
            style={{ fontSize: 11, padding: '3px 8px', color: 'var(--error)', borderColor: 'var(--border)' }}
            onClick={onRemoveRouteServer}>✕ Remove ARS ({vnet.routeServer.name})</button>}
      </div>
    </InspectorSection>
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
    {vnet.appliances.map((appliance) => <div key={appliance.id}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 6, fontSize: 12 }}>
      <span>{appliance.kind === 'vnra' ? t('Managed VNRA') : '🔥'} {appliance.name} (<code>{appliance.privateIp}</code>)</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {appliance.kind === 'vnra' ? <button type="button" className="aznet-btn"
          onClick={() => onConfigureVnra(appliance.id)}>{t('Configure Managed VNRA')}</button>
          : <label className="aznet-checkbox-row">
            <input type="checkbox" checked={appliance.enableIpForwarding} onChange={(event) => {
              const checked = event.target.checked
              onChange((target) => {
                const current = target.appliances.find((candidate) => candidate.id === appliance.id)
                if (current) current.enableIpForwarding = checked
              })
            }} /><span>NIC IP Forwarding</span>
          </label>}
        <button type="button" className="aznet-btn" data-testid={`aznet-remove-app-${appliance.id}`}
          style={{ fontSize: 11, padding: '2px 6px', color: 'var(--error)', borderColor: 'var(--border)' }}
          onClick={() => onRemoveAppliance(appliance.id)}>✕ Remove</button>
      </div>
    </div>)}
  </>
}
