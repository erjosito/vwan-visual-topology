import { lazy, Suspense, useState } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import { InspectorSection } from '../WorkspacePresentation'
import { AzureRegionSelect } from '../AzureRegionSelect'
import { validateAdvertisedGatewayPrefixes, type AzArsPreference, type AzNetTopology, type AzVNet, type AzVnetGateway } from './model'
import { addNva, nvaSubnetError } from './subnet-allocation'

const VnetPrefixEditor = lazy(() => import('./AddressPrefixEditors').then((module) => ({ default: module.VnetPrefixEditor })))
const VnetCommunityEditor = lazy(() => import('../VnetCommunityEditor'))

registerJapaneseMessages({
  'Virtual WAN VNet connection enabled': 'Virtual WAN VNet 接続を有効化',
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

export function VpnGatewaySettings({ gateway, routeExchange, coexisting, onMode, onConfiguration }: {
  gateway: AzVnetGateway
  routeExchange: boolean
  coexisting: boolean
  onMode: (mode: boolean | undefined) => void
  onConfiguration: (configuration: Pick<AzVnetGateway, 'sku' | 'vpnType' | 'vpnGatewayGeneration'>) => void
}) {
  const skus = gateway.kind === 'Vpn'
    ? ['VpnGw1AZ', 'VpnGw2AZ', 'VpnGw3AZ', 'VpnGw4AZ', 'VpnGw5AZ', 'VpnGw1', 'VpnGw2', 'VpnGw3', 'VpnGw4', 'VpnGw5', 'Basic', 'Standard', 'HighPerformance']
    : ['ErGw1AZ', 'ErGw2AZ', 'ErGw3AZ', 'ErGwScale', 'Standard', 'HighPerformance', 'UltraPerformance', 'Basic']
  const unsupportedSku = coexisting && gateway.sku?.trim().toLowerCase() === 'basic'
  const unsupportedType = coexisting && gateway.vpnType === 'PolicyBased'
  return <fieldset data-testid={`vpn-gateway-settings-${gateway.id}`}>
    <legend>{gateway.name}</legend>
    <label className="field"><span>{t('Gateway SKU')}</span>
      <select aria-label={t('Gateway SKU')} value={gateway.sku ?? ''}
        aria-invalid={unsupportedSku}
        style={unsupportedSku ? { borderColor: 'var(--error)', color: 'var(--error)' } : undefined}
        onChange={(event) => {
          const sku = event.target.value || undefined
          onConfiguration({ sku, ...(/^VpnGw1(AZ)?$/.test(sku ?? '')
            ? { vpnGatewayGeneration: 'Generation1' }
            : /^VpnGw[45](AZ)?$/.test(sku ?? '') ? { vpnGatewayGeneration: 'Generation2' } : {}) })
        }}>
        <option value="">{t('Unspecified (not captured)')}</option>
        {!!gateway.sku && !skus.includes(gateway.sku) && <option value={gateway.sku}>{gateway.sku}</option>}
        {skus.map((sku) => <option key={sku} value={sku}>{sku}</option>)}
      </select>
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
          <AzureRegionSelect className="aznet-select" data-testid={`aznet-vnet-region-${vnet.id}`}
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
    {vnet.vwanHubAttachment && <label className="aznet-checkbox-row">
      <input type="checkbox" data-testid={`aznet-vwan-connection-enabled-${vnet.id}`}
        checked={vnet.vwanHubAttachment.enabled} onChange={(event) => {
          const enabled = event.target.checked
          onChange((target) => { if (target.vwanHubAttachment) target.vwanHubAttachment.enabled = enabled })
        }} />
      <span>{t('Virtual WAN VNet connection enabled')}</span>
    </label>}
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
