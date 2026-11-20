import { lazy, Suspense, useState } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import { InspectorSection } from '../WorkspacePresentation'
import { ALL_KNOWN_AZURE_REGIONS } from '../er-locations-catalog'
import { validateAdvertisedGatewayPrefixes, type AzArsPreference, type AzNetTopology, type AzUdrTable, type AzUdrNextHopType, type AzVNet, type AzVnetGateway } from './model'
import { addNva, nvaSubnetError } from './subnet-allocation'
import { resolveUdrRegion } from './udr-regions'
import { guidanceAnchor } from '../learning/guidance'
import type { AzSelectedEntity } from './AzureNetDiagram'

const VnetPrefixEditor = lazy(() => import('./AddressPrefixEditors').then((module) => ({ default: module.VnetPrefixEditor })))
const VnetCommunityEditor = lazy(() => import('../VnetCommunityEditor'))

registerJapaneseMessages({
  'The subnet has no available usable IPv4 addresses.': 'サブネットに使用可能な空き IPv4 アドレスがありません。',
  'VNet no longer exists.': 'VNet は存在しません。',
  'Select a non-service, non-delegated subnet for the NVA.': 'NVA 用にサービス専用でも委任済みでもないサブネットを選択してください。',
  'The appliance subnet overlaps another subnet.': 'アプライアンスのサブネットが別のサブネットと重複しています。',
  'AzureFirewallSubnet must be non-delegated and /26 or larger.': 'AzureFirewallSubnet は委任されておらず、/26 以上のサイズである必要があります。',
  'Select an existing subnet for the NVA.': 'NVA 用の既存のサブネットを選択してください。',
  'Enter an NVA name of 1 to 120 characters.': '1 文字から 120 文字の NVA 名を入力してください。',
  'NVA identity is missing or already exists.': 'NVA の識別子がないか、すでに存在します。',
  'Add Azure Firewall': 'Azure Firewall を追加',
  'Add NVA': 'NVA を追加',
  'Create NVA': 'NVA を作成',
  'NVA name': 'NVA 名',
  'NVA subnet': 'NVA サブネット',
  'Select an existing subnet': '既存のサブネットを選択',
  'Add a valid, non-service, non-delegated subnet to this VNet first.': 'まず、この VNet に有効な、サービス専用でも委任済みでもないサブネットを追加してください。',
  'An available private IP is allocated in the selected subnet. BGP, ARS peers, load balancers and UDRs must be configured separately.': '選択したサブネット内の空きプライベート IP を割り当てます。BGP、ARS ピア、ロード バランサー、UDR は別途構成してください。',
  'Only one Azure Firewall is supported per VNet. Remove the existing Firewall first.': 'VNet ごとにサポートされる Azure Firewall は 1 つだけです。先に既存の Firewall を削除してください。',
  'This imported VNet contains multiple Azure Firewalls. Preserve or move the extra resources to separate VNets; this is not a supported HA design.': 'このインポート済み VNet には Azure Firewall が複数あります。追加のリソースを保持するか別の VNet に移動してください。これはサポートされる HA 設計ではありません。',
  'Microsoft-managed HA': 'Microsoft 管理の HA',
  'Azure Firewall represents one managed service with redundant backend instances, not one VM per instance. Backend failure timing and SLA are not simulated.': 'Azure Firewall は冗長なバックエンド インスタンスを備えた 1 つのマネージド サービスです。インスタンスごとの VM ではありません。バックエンドの障害時間や SLA はシミュレーションしません。',
  'User-managed NVA HA': 'ユーザー管理の NVA HA',
  'For ARS peering, use Inspect NVA Learned BGP Routes in the appliance menu.': 'ARS ピアリングには、アプライアンス メニューの「NVA が学習した BGP ルートを確認」を使用してください。',
  'Multiple NVAs alone do not configure HA. Design redundant appliances and steering with vendor floating IPs, Azure Load Balancer HA ports, or BGP to Azure Route Server.': 'NVA が複数あるだけでは HA は構成されません。ベンダーのフローティング IP、Azure Load Balancer HA ポート、または Azure Route Server への BGP を使用して、冗長アプライアンスと経路制御を設計してください。',
  'Configure original NVA/NIC backends, frontend, pool, probe health and floating HA-ports rules in Load Balancers. Configure NVA BGP advertisements and ARS peers separately.': 'ロード バランサーで元の NVA/NIC バックエンド、フロントエンド、プール、プローブの正常性、およびフローティング HA ポート規則を構成してください。NVA の BGP アドバタイズと ARS ピアは別途構成してください。',
  'Vendor floating-IP reassignment, session replication, live health and failover timing are not assessed. No HA guarantee is inferred from this configuration.': 'ベンダーのフローティング IP 再割り当て、セッション複製、実際の正常性、フェールオーバー時間は評価されません。この構成から HA の保証は推測しません。',
  'Modeled forwarding': 'モデル化された転送',
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

export function ApplianceAvailability({ kind }: { kind: 'azure-firewall' | 'nva-vm' }) {
  return <div className="aznet-muted" data-testid={`appliance-availability-${kind}`}>
    <strong>{t(kind === 'azure-firewall' ? 'Microsoft-managed HA' : 'User-managed NVA HA')}</strong>
    {kind === 'azure-firewall' ? <p>{t('Azure Firewall represents one managed service with redundant backend instances, not one VM per instance. Backend failure timing and SLA are not simulated.')}</p>
      : <>
        <p>{t('Multiple NVAs alone do not configure HA. Design redundant appliances and steering with vendor floating IPs, Azure Load Balancer HA ports, or BGP to Azure Route Server.')}</p>
        <p>{t('Configure original NVA/NIC backends, frontend, pool, probe health and floating HA-ports rules in Load Balancers. Configure NVA BGP advertisements and ARS peers separately.')}</p>
        <p>{t('For ARS peering, use Inspect NVA Learned BGP Routes in the appliance menu.')}</p>
        <p>{t('Vendor floating-IP reassignment, session replication, live health and failover timing are not assessed. No HA guarantee is inferred from this configuration.')}</p>
      </>}
  </div>
}

export function NvaCreationEditor({ topology, vnetId, commit, onSaved, onCancel }: {
  topology: AzNetTopology
  vnetId: string
  commit: (update: (draft: AzNetTopology) => void) => boolean
  onSaved: (id: string) => void
  onCancel: () => void
}) {
  const [subnetId, setSubnetId] = useState('')
  const [error, setError] = useState('')
  const vnet = topology.vnets.find((vnet) => vnet.id === vnetId)
  if (!vnet) return null
  const eligible = vnet.subnets.filter((subnet) => !nvaSubnetError(vnet, subnet))
  return <section className="aznet-card" data-testid="aznet-nva-creation">
    <h3>{t('Add NVA')}</h3>
    <ApplianceAvailability kind="nva-vm" />
    <form data-configuration-pending={!!subnetId} onSubmit={(event) => {
      event.preventDefault()
      try {
        const input = { id: `nva-${crypto.randomUUID()}`, name: String(new FormData(event.currentTarget).get('name')), subnetId }
        addNva(structuredClone(topology), vnetId, input)
        if (!commit((draft) => addNva(draft, vnetId, input))) return
        onSaved(input.id)
      } catch (error) { setError(error instanceof Error ? error.message : 'Inventory edit failed.') }
    }}>
      <label className="field"><span>{t('NVA name')}</span><input name="name" required maxLength={120}
        data-configuration-saved={`${vnet.name}-nva`} defaultValue={`${vnet.name}-nva`} /></label>
      <label className="field"><span>{t('NVA subnet')}</span><select aria-label={t('NVA subnet')} required value={subnetId} onChange={(event) => { setSubnetId(event.target.value); setError('') }}>
        <option value="">{t('Select an existing subnet')}</option>
        {eligible.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.name} · {subnet.prefix} · {subnet.id}</option>)}
      </select></label>
      {!eligible.length && <p role="status">{t('Add a valid, non-service, non-delegated subnet to this VNet first.')}</p>}
      <p>{t('An available private IP is allocated in the selected subnet. BGP, ARS peers, load balancers and UDRs must be configured separately.')}</p>
      <button type="submit" disabled={!eligible.some((subnet) => subnet.id === subnetId)}>{t('Create NVA')}</button>
      <button type="button" onClick={onCancel}>{t('Cancel')}</button>
      {error && <p role="alert">{t(error)}</p>}
    </form>
  </section>
}

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
  onAddGateway, onRemoveGateway, onAddRouteServer, onRemoveRouteServer, onAddFirewall, onAddNva, onAddVnra, onConfigureVnra, onRemoveAppliance }: {
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
  onAddFirewall: () => void
  onAddNva: () => void
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
  const firewalls = vnet.appliances.filter((appliance) => appliance.kind === 'azure-firewall')
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
          disabled={!!firewalls.length}
          title={firewalls.length ? t('Only one Azure Firewall is supported per VNet. Remove the existing Firewall first.') : undefined}
          style={{ fontSize: 11, padding: '3px 8px' }} onClick={onAddFirewall}>{t('Add Azure Firewall')}</button>
        <button type="button" className="aznet-btn" data-testid={`aznet-add-nva-${vnet.id}`} onClick={onAddNva}>{t('Add NVA')}</button>
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
    {firewalls.length > 1 && <p role="alert">{t('This imported VNet contains multiple Azure Firewalls. Preserve or move the extra resources to separate VNets; this is not a supported HA design.')}</p>}
    {!!firewalls.length && <ApplianceAvailability kind="azure-firewall" />}
    {vnet.appliances.some((appliance) => appliance.kind === 'nva-vm') && <ApplianceAvailability kind="nva-vm" />}
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
            }} /><span>{appliance.kind === 'azure-firewall' ? t('Modeled forwarding') : 'NIC IP Forwarding'}</span>
          </label>}
        <button type="button" className="aznet-btn" data-testid={`aznet-remove-app-${appliance.id}`}
          style={{ fontSize: 11, padding: '2px 6px', color: 'var(--error)', borderColor: 'var(--border)' }}
          onClick={() => onRemoveAppliance(appliance.id)}>✕ Remove</button>
      </div>
    </div>)}
  </>
}

export function UdrTableEditor({ topology, rt, associatedSubnets, selected, commit, onRegionSaved }: {
  topology: AzNetTopology
  rt: AzUdrTable
  associatedSubnets: string[]
  selected: AzSelectedEntity
  commit: (edit: (draft: AzNetTopology) => void) => boolean | void
  onRegionSaved: () => void
}) {
  return (
    <div
      key={rt.id}
      data-testid={`aznet-rt-card-${rt.id}`}
      data-learning-anchor={selected.kind === 'subnet' ? guidanceAnchor('udr-table', selected.vnetId, selected.subnetId, rt.id) : undefined}
      style={{
        marginBottom: 10,
        padding: 10,
        background: 'var(--surface)',
        borderRadius: 6,
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="aznet-input"
            value={rt.name}
            aria-label={`Route Table name ${rt.name}`}
            onChange={(e) => {
              const val = e.target.value
              commit((draft) => {
                const target = draft.udrTables.find((t) => t.id === rt.id)
                if (target) target.name = val
              })
            }}
            style={{ fontWeight: 700, width: 175 }}
          />
          <form key={rt.region ?? resolveUdrRegion(topology, rt) ?? ''} onSubmit={(event) => {
            event.preventDefault()
            const region = String(new FormData(event.currentTarget).get('region')).trim()
            const saved = commit((draft) => {
              const table = draft.udrTables.find((candidate) => candidate.id === rt.id)
              if (table) table.region = region
            })
            if (saved) onRegionSaved()
          }} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>{t('Route-table region')}
              <input className="aznet-input" name="region" required data-testid={`aznet-rt-region-${rt.id}`}
                aria-label={t('Route-table region {0}', rt.name)}
                defaultValue={rt.region ?? resolveUdrRegion(topology, rt) ?? ''} style={{ width: 130 }} />
            </label>
            <button className="aznet-btn" type="submit">{t('Apply region')}</button>
            {rt.region === undefined && <span>{t(resolveUdrRegion(topology, rt) ? 'Inferred legacy region' : 'Unknown region')}</span>}
          </form>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {associatedSubnets.length > 0
              ? `Associated: ${associatedSubnets.join(', ')}`
              : 'Unassociated'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="aznet-checkbox-row">
            <input
              type="checkbox"
              data-testid={`aznet-rt-disable-bgp-${rt.id}`}
              checked={rt.disableBgpRoutePropagation}
              onChange={(e) => {
                const checked = e.target.checked
                commit((draft) => {
                  const target = draft.udrTables.find((t) => t.id === rt.id)
                  if (target) target.disableBgpRoutePropagation = checked
                })
              }}
            />
            <span>Disable Gateway routes (GWroutes:OFF)</span>
          </label>
          <label className="aznet-checkbox-row">
            <input
              type="checkbox"
              data-testid={`aznet-rt-disable-peering-${rt.id}`}
              checked={Boolean(rt.disablePeeringRoutePropagation)}
              onChange={(e) => {
                const checked = e.target.checked
                commit((draft) => {
                  const target = draft.udrTables.find((t) => t.id === rt.id)
                  if (target) target.disablePeeringRoutePropagation = checked
                })
              }}
            />
            <span>Disable Peering route propagation (Preview; requires an active covering UDR)</span>
          </label>
          <button
            type="button"
            className="aznet-btn"
            data-testid={`aznet-delete-rt-${rt.id}`}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              color: 'var(--error)',
              borderColor: 'var(--border)',
            }}
            onClick={() => {
              commit((draft) => {
                draft.udrTables = draft.udrTables.filter((t) => t.id !== rt.id)
                for (const v of draft.vnets) {
                  for (const s of v.subnets) {
                    if (s.routeTableId === rt.id) {
                      s.routeTableId = undefined
                    }
                  }
                }
              })
            }}
          >
            Delete RT
          </button>
        </div>
      </div>

      <table className="aznet-route-table">
        <thead>
          <tr>
            <th>On</th>
            <th>Name</th>
            <th>Prefix</th>
            <th>Next Hop Type</th>
            <th>Next Hop IP</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rt.routes.map((r) => (
            <tr key={r.id} data-learning-anchor={selected.kind === 'subnet' ? guidanceAnchor('udr-route', selected.vnetId, selected.subnetId, rt.id, r.id) : undefined}>
              <td>
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => {
                    const checked = e.target.checked
                    commit((draft) => {
                      const targetRt = draft.udrTables.find(
                        (t) => t.id === rt.id,
                      )
                      const targetR = targetRt?.routes.find(
                        (x) => x.id === r.id,
                      )
                      if (targetR) targetR.enabled = checked
                    })
                  }}
                />
              </td>
              <td>
                <input
                  type="text"
                  className="aznet-input"
                  style={{ width: 110 }}
                  value={r.name}
                  onChange={(e) => {
                    const val = e.target.value
                    commit((draft) => {
                      const targetRt = draft.udrTables.find(
                        (t) => t.id === rt.id,
                      )
                      const targetR = targetRt?.routes.find(
                        (x) => x.id === r.id,
                      )
                      if (targetR) targetR.name = val
                    })
                  }}
                />
              </td>
              <td>
                <input
                  type="text"
                  className="aznet-input"
                  style={{ width: 105, fontFamily: 'monospace' }}
                  value={r.prefix}
                  onChange={(e) => {
                    const val = e.target.value
                    commit((draft) => {
                      const targetRt = draft.udrTables.find(
                        (t) => t.id === rt.id,
                      )
                      const targetR = targetRt?.routes.find(
                        (x) => x.id === r.id,
                      )
                      if (targetR) targetR.prefix = val
                    })
                  }}
                />
              </td>
              <td>
                <select
                  className="aznet-select"
                  value={r.nextHopType}
                  onChange={(e) => {
                    const val = e.target.value as AzUdrNextHopType
                    commit((draft) => {
                      const targetRt = draft.udrTables.find(
                        (t) => t.id === rt.id,
                      )
                      const targetR = targetRt?.routes.find(
                        (x) => x.id === r.id,
                      )
                      if (targetR) targetR.nextHopType = val
                    })
                  }}
                >
                  <option value="VirtualAppliance">VirtualAppliance</option>
                  <option value="VirtualNetworkGateway">
                    VirtualNetworkGateway
                  </option>
                  <option value="VnetLocal">VnetLocal</option>
                  <option value="Internet">Internet</option>
                  <option value="None">None (Blackhole)</option>
                </select>
              </td>
              <td>
                {r.nextHopType === 'VirtualAppliance' ? (
                  <input
                    type="text"
                    className="aznet-input"
                    style={{ width: 105 }}
                    value={r.nextHopIp ?? ''}
                    onChange={(e) => {
                      const val = e.target.value
                      commit((draft) => {
                        const targetRt = draft.udrTables.find(
                          (t) => t.id === rt.id,
                        )
                        const targetR = targetRt?.routes.find(
                          (x) => x.id === r.id,
                        )
                        if (targetR) targetR.nextHopIp = val
                      })
                    }}
                  />
                ) : (
                  '—'
                )}
              </td>
              <td>
                <button
                  type="button"
                  className="aznet-btn"
                  style={{ padding: '1px 6px', fontSize: 10.5, color: 'var(--error)' }}
                  onClick={() => {
                    commit((draft) => {
                      const targetRt = draft.udrTables.find(
                        (t) => t.id === rt.id,
                      )
                      if (targetRt) {
                        targetRt.routes = targetRt.routes.filter(
                          (x) => x.id !== r.id,
                        )
                      }
                    })
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="button"
        className="aznet-btn"
        style={{ marginTop: 6 }}
        onClick={() => {
          commit((draft) => {
            const targetRt = draft.udrTables.find((t) => t.id === rt.id)
            if (!targetRt) return
            const firstApp = draft.vnets.flatMap((v) => v.appliances)[0]
            targetRt.routes.push({
              id: `udr-custom-${Date.now()}`,
              name: `custom-route-${targetRt.routes.length + 1}`,
              prefix: '10.2.0.0/16',
              nextHopType: firstApp ? 'VirtualAppliance' : 'Internet',
              nextHopIp: firstApp?.privateIp,
              enabled: true,
            })
          })
        }}
      >
        + Add UDR Row
      </button>
    </div>
  )
}
