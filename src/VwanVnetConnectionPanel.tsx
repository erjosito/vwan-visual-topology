import type { ReactNode } from 'react'
import { CanvasOverlay } from './CanvasOverlay'
import { t } from './i18n'
import { registerJapaneseMessages } from './messages'
import type { HubRouteTable, HubRoutingConfiguration } from './model'
import './RoutingIntentNotice'

registerJapaneseMessages({
  'Virtual WAN VNet connection': 'Virtual WAN VNet 接続',
  'Microsoft-managed peering': 'Microsoft 管理のピアリング',
  'Virtual WAN manages the underlying VNet peering and remote hub routing. Ordinary peering flags are not independently editable on this connection.': 'Virtual WAN は基盤の VNet ピアリングとリモート ハブのルーティングを管理します。この接続で通常のピアリング フラグを個別に編集することはできません。',
  'A VNet can connect to only one virtual hub and cannot host a VPN/ExpressRoute gateway or Azure Route Server while connected.': 'VNet が接続できる仮想ハブは 1 つだけです。接続中は VPN/ExpressRoute ゲートウェイや Azure Route Server を配置できません。',
  'Additional ordinary VNet peerings are allowed; they must not consume another remote gateway or Route Server. Peering alone does not extend Virtual WAN transit to an indirect VNet.': '通常の VNet ピアリングは追加できますが、別のリモート ゲートウェイや Route Server を使用することはできません。ピアリングだけでは、間接 VNet への Virtual WAN 転送は拡張されません。',
  'This VNet has a local gateway/Route Server or another remote-gateway peering. Resolve that conflict before deploying this connection.': 'この VNet にはローカル ゲートウェイ/Route Server、または別のリモート ゲートウェイ ピアリングがあります。この接続をデプロイする前に競合を解消してください。',
})

export default function VwanVnetConnectionPanel({ vnetName, hubName, tables, config, propagateDefaultRoute,
  enabled, conflict, managedConfig, onRoutingChange, onDefaultRouteChange, onEnabledChange, onClose, children }: {
  vnetName: string
  hubName: string
  tables: HubRouteTable[]
  config: HubRoutingConfiguration
  propagateDefaultRoute: boolean
  enabled?: boolean
  conflict?: boolean
  managedConfig?: HubRoutingConfiguration
  onRoutingChange: (config: HubRoutingConfiguration) => void
  onDefaultRouteChange: (enabled: boolean) => void
  onEnabledChange?: (enabled: boolean) => void
  onClose: () => void
  children?: ReactNode
}) {
  const change = (patch: Partial<HubRoutingConfiguration>) => onRoutingChange({ ...structuredClone(config), ...patch })
  return <CanvasOverlay title={t('Virtual WAN VNet connection')} className="object-editor" onClose={onClose}>
    <section data-testid="vwan-vnet-connection-panel">
      <h3>{vnetName} ↔ {hubName}</h3>
      <h4>{t('Microsoft-managed peering')}</h4>
      <p>{t('Virtual WAN manages the underlying VNet peering and remote hub routing. Ordinary peering flags are not independently editable on this connection.')}</p>
      <p>{t('A VNet can connect to only one virtual hub and cannot host a VPN/ExpressRoute gateway or Azure Route Server while connected.')}</p>
      <p>{t('Additional ordinary VNet peerings are allowed; they must not consume another remote gateway or Route Server. Peering alone does not extend Virtual WAN transit to an indirect VNet.')}</p>
      {conflict && <p role="alert">{t('This VNet has a local gateway/Route Server or another remote-gateway peering. Resolve that conflict before deploying this connection.')}</p>}
      {onEnabledChange && <label className="aznet-toggle-row"><input type="checkbox" checked={enabled}
        onChange={(event) => onEnabledChange(event.target.checked)} />{t('Enabled')}</label>}
      <label className="aznet-toggle-row"><input type="checkbox" checked={propagateDefaultRoute}
        onChange={(event) => onDefaultRouteChange(event.target.checked)} />{t('Propagate default route (0.0.0.0/0)')}</label>
      <p>{t('Receives an available hub default route into this VNet. This does not create a default route or enable Internet routing intent.')}</p>
      {managedConfig && <p role="status"><strong>{t('Managed by routing intent')}</strong>.{' '}
        {t('Routing intent manages association and propagation for every connection. Default-route receipt and connection static-route advertisement remain independent.')}</p>}
      {managedConfig?.propagatedTableIds.includes('noneRouteTable') && <p>{t('Private routing intent uses None for connection propagation while Azure programs the security appliance routing domain. This is not manual connection isolation.')}</p>}
      <p>{t('Association selects the ingress lookup table. Propagation controls where routes are advertised. Labels are case-sensitive; None suppresses propagation.')}</p>
      <fieldset disabled={!!managedConfig}><legend>{t('Hub routing tables')}</legend>
      <label>{t('Associated table')} <select aria-label={t('Associated table')} value={config.associatedTableId ?? ''}
        onChange={(event) => change({ associatedTableId: event.target.value })}>
        <option value="" disabled>{t('Unknown')}</option>
        {config.associatedTableId && !tables.some((table) => table.id === config.associatedTableId) &&
          <option value={config.associatedTableId}>{config.associatedTableId} ({t('Unknown')})</option>}
        {tables.map((table) => <option key={table.id} value={table.id}>{table.name} · {table.id}</option>)}
      </select></label>
      <fieldset><legend>{t('Propagated tables')}</legend>
        {tables.map((table) => <label key={table.id} className="aznet-toggle-row">
          <input type="checkbox" checked={config.propagatedTableIds.includes(table.id)} onChange={(event) => change({
            propagatedTableIds: event.target.checked ? [...config.propagatedTableIds, table.id]
              : config.propagatedTableIds.filter((id) => id !== table.id),
          })} />{table.name}
        </label>)}
      </fieldset>
      <label>{t('Propagation labels')}<input aria-label={t('Propagation labels')} key={JSON.stringify(config.labels)}
        defaultValue={config.labels.join(', ')} data-configuration-saved={config.labels.join(', ')}
        onBlur={(event) => {
          const labels = [...new Set(event.target.value.split(',').map((label) => label.trim()).filter(Boolean))]
          if (JSON.stringify(labels) !== JSON.stringify(config.labels)) change({ labels })
        }} /><small className="configuration-save-hint">{t('Save on blur')}</small></label>
      <p>{t('Configuration status')}: {config.status}</p>
      {config.limitations?.map((limitation) => <p role="status" key={limitation}>{limitation}</p>)}
      {config.status !== 'configured' && <button type="button" disabled={!config.associatedTableId}
        onClick={() => change({ status: 'configured', limitations: [] })}>{t('Use edited configuration')}</button>}
      </fieldset>
      {managedConfig && JSON.stringify(config) !== JSON.stringify(managedConfig) && <>
        <p role="status">{t('Saved connection settings differ from routing intent. Apply the managed settings explicitly; captured or unknown evidence is not silently rewritten.')}</p>
        <button type="button" onClick={() => onRoutingChange(managedConfig)}>{t('Apply routing-intent settings')}</button>
      </>}
      {children}
    </section>
  </CanvasOverlay>
}
