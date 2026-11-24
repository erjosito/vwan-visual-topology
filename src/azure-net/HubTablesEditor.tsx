import type { ReactNode } from 'react'
import { DEFAULT_HUB_TABLE, NONE_HUB_TABLE, hubRouteTables } from '../hub-routing'
import type { HubRoutingConfiguration } from '../model'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import type { AzNetTopology, AzVwanHub } from './model'
import { azHubRouting } from './hub-routing'
import { HubStaticRoutesEditor } from '../HubStaticRoutesEditor'
import { ConnectionStaticRoutesEditor } from './ConnectionStaticRoutesEditor'
import { InspectorSection } from '../WorkspacePresentation'
import { RoutingIntentNotice } from '../RoutingIntentNotice'
import { routingIntentConfiguration, routingIntentConfigurationMatches, routingIntentConflicts, routingIntentManaged } from '../routing-intent'

const words = (value: string) => [...new Set(value.split(',').map((word) => word.trim()).filter(Boolean))]
registerJapaneseMessages({ 'Private Traffic Routing Intent': 'プライベート トラフィックのルーティング意図' })

export function HubTablesEditor({ hub, topology, commit, onAttach, focusFirewall, initialOpen = false, children }: {
  hub: AzVwanHub
  topology: AzNetTopology
  commit: (update: (draft: AzNetTopology) => void) => void
  onAttach: (vnetId: string) => void
  focusFirewall?: boolean
  initialOpen?: boolean
  children?: ReactNode
}) {
  const tables = hubRouteTables(hub)
  const managed = routingIntentManaged(hub)
  const conflicts = routingIntentConflicts(hub)
  const attachments = [
    ...topology.vnets.filter((vnet) => vnet.vwanHubAttachment?.hubId === hub.id).map((vnet) => ({
      id: vnet.id, name: vnet.name, config: vnet.vwanHubAttachment!.hubRouting, branch: false,
      update: (draft: AzNetTopology, config: HubRoutingConfiguration) => { draft.vnets.find((entry) => entry.id === vnet.id)!.vwanHubAttachment!.hubRouting = config },
    })),
    ...(['erLinks', 'vpnConnections'] as const).flatMap((kind) => topology[kind]
      .filter((link) => link.targetKind === 'vwan-hub' && link.targetId === hub.id).map((link) => ({
        id: link.id, name: link.name, config: link.hubRouting, branch: true,
        update: (draft: AzNetTopology, config: HubRoutingConfiguration) => { draft[kind].find((entry) => entry.id === link.id)!.hubRouting = config },
      }))),
  ]
  return <div data-testid="aznet-hub-tables-editor">
    <InspectorSection title={t('Hub routing tables')} summary={hub.name} initialOpen={initialOpen || !!focusFirewall}>
    <section aria-label={t('Hub routing tables')}>
    <h4>{t('Hub routing tables')}</h4>
    <RoutingIntentNotice hub={hub} />
    <label className="aznet-hover-toggle">
      <input type="checkbox" data-testid={`aznet-private-routing-intent-${hub.id}`}
        checked={hub.routingIntent.private} disabled={!hub.routingIntent.private && (!hub.firewall || conflicts.length > 0)}
        onChange={(event) => {
          const enabled = event.target.checked
          commit((draft) => { draft.vwanHubs.find((entry) => entry.id === hub.id)!.routingIntent.private = enabled })
        }} />
      {t('Private Traffic Routing Intent')}
    </label>
    <label className="aznet-hover-toggle">
      <input type="checkbox" data-testid={`aznet-internet-routing-intent-${hub.id}`}
        checked={hub.routingIntent.internet} disabled={!hub.routingIntent.internet && (!hub.firewall || conflicts.length > 0)}
        onChange={(event) => {
          const enabled = event.target.checked
          commit((draft) => { draft.vwanHubs.find((entry) => entry.id === hub.id)!.routingIntent.internet = enabled })
        }} />
      {t('Internet traffic routing intent')}
    </label>
    <p>{t('Association selects the ingress lookup table. Propagation controls where routes are advertised. Labels are case-sensitive; None suppresses propagation.')}</p>
    <HubStaticRoutesEditor hub={hub} focusFirewall={focusFirewall} onChange={(owner) => commit((draft) => {
      const target = draft.vwanHubs.find((entry) => entry.id === hub.id)!
      target.firewall = owner.firewall
      target.routeTables = owner.routeTables
    })} />
    {hub.routeTablesStatus === 'unknown' && <p role="status">
      {t('Hub table scope is unknown. Editing tables does not establish that the captured scope is complete.')}
      {' '}<button type="button" className="aznet-btn" onClick={() => commit((draft) => {
        delete draft.vwanHubs.find((entry) => entry.id === hub.id)!.routeTablesStatus
      })}>{t('Use edited hub table scope')}</button>
    </p>}
    {tables.map((table) => <div key={table.id} className="aznet-toggle-row">
      <code>{table.id}</code>
      <label>{t('Name')}<input className="aznet-input" aria-label={`${t('Table name')} ${table.id}`} value={table.name}
        disabled={managed || table.id === DEFAULT_HUB_TABLE || table.id === NONE_HUB_TABLE}
        onChange={(event) => {
          const value = event.target.value
          commit((draft) => { draft.vwanHubs.find((entry) => entry.id === hub.id)!.routeTables!.find((entry) => entry.id === table.id)!.name = value })
        }} /></label>
      <label>{t('Labels')}<input key={JSON.stringify(table.labels)} className="aznet-input"
        aria-label={`${t('Table labels')} ${table.id}`} defaultValue={table.labels.join(', ')} data-configuration-saved={table.labels.join(', ')}
        disabled={managed || table.id === DEFAULT_HUB_TABLE || table.id === NONE_HUB_TABLE}
        onBlur={(event) => {
          const labels = words(event.target.value)
          if (JSON.stringify(labels) === JSON.stringify(table.labels)) return
          commit((draft) => { draft.vwanHubs.find((entry) => entry.id === hub.id)!.routeTables!.find((entry) => entry.id === table.id)!.labels = labels })
        }} /><small className="configuration-save-hint">{t('Save on blur')}</small></label>
      {![DEFAULT_HUB_TABLE, NONE_HUB_TABLE].includes(table.id) && <button type="button" className="aznet-btn"
        disabled={attachments.some((attachment) => attachment.config?.associatedTableId === table.id ||
          attachment.config?.propagatedTableIds.includes(table.id))}
        onClick={() => commit((draft) => {
          const owner = draft.vwanHubs.find((entry) => entry.id === hub.id)!
          owner.routeTables = owner.routeTables?.filter((entry) => entry.id !== table.id)
        })}>{t('Remove hub table')}</button>}
    </div>)}
    <button type="button" className="aznet-btn" disabled={managed} onClick={() => commit((draft) => {
      const owner = draft.vwanHubs.find((entry) => entry.id === hub.id)!
      const id = `table-${crypto.randomUUID()}`
      ;(owner.routeTables ??= []).push({ id, name: t('Custom table'), labels: [] })
    })}>{t('Add hub table')}</button>
    {children}
    </section>
    </InspectorSection>
    {[false, true].map((branch) => <InspectorSection key={String(branch)}
      title={t(branch ? 'Branch connections' : 'VNet connections')} summary={hub.name} initialOpen={initialOpen}>
    <section aria-label={t(branch ? 'Branch connections' : 'VNet connections')}>
    <h4>{t(branch ? 'Branch connections' : 'VNet connections')}</h4>
    {!branch && topology.vnets.filter((vnet) => !vnet.vwanHubAttachment).map((vnet) =>
      <button key={vnet.id} type="button" className="aznet-btn" onClick={() => onAttach(vnet.id)}>{t('Connect {0}', vnet.name)}</button>)}
    {attachments.filter((attachment) => attachment.branch === branch).map((attachment) => {
      const config = azHubRouting(attachment.config)
      const change = (patch: Partial<HubRoutingConfiguration>) => commit((draft) => {
        attachment.update(draft, { ...structuredClone(config), ...patch })
        if (attachment.branch && (patch.propagatedTableIds || patch.labels)) {
          for (const branch of [...draft.erLinks, ...draft.vpnConnections].filter((link) =>
            link.targetKind === 'vwan-hub' && link.targetId === hub.id && link.id !== attachment.id)) {
            branch.hubRouting = { ...structuredClone(azHubRouting(branch.hubRouting)), ...patch }
          }
        }
      })
      return <fieldset key={attachment.id}>
        <legend>{attachment.name}</legend>
        {!attachment.branch && <label className="aznet-toggle-row"><input type="checkbox"
          checked={topology.vnets.find((entry) => entry.id === attachment.id)!.vwanHubAttachment!.propagateDefaultRoute === true}
          onChange={(event) => {
            const enabled = event.target.checked
            commit((draft) => { draft.vnets.find((entry) => entry.id === attachment.id)!.vwanHubAttachment!.propagateDefaultRoute = enabled })
          }} />{t('Propagate default route (0.0.0.0/0)')}</label>}
        {!attachment.branch && <p>{t('Receives an available hub default route into this VNet. This does not create a default route or enable Internet routing intent.')}</p>}
        <fieldset disabled={managed}><legend>{t(managed ? 'Managed by routing intent' : 'Hub routing tables')}</legend>
        <label>{t('Associated table')} <select className="aznet-select" aria-label={`${t('Associated table')} ${attachment.name}`}
          value={config.associatedTableId ?? ''} onChange={(event) => change({ associatedTableId: event.target.value })}>
          <option value="" disabled>{t('Unknown')}</option>
          {tables.filter((table) => !attachment.branch || table.id === DEFAULT_HUB_TABLE)
            .map((table) => <option key={table.id} value={table.id}>{table.name} · {table.id}</option>)}
        </select></label>
        <div>{t('Propagated tables')}{tables.map((table) => <label key={table.id} className="aznet-toggle-row">
          <input type="checkbox" checked={config.propagatedTableIds.includes(table.id)} onChange={(event) => change({
            propagatedTableIds: event.target.checked ? [...config.propagatedTableIds, table.id] : config.propagatedTableIds.filter((id) => id !== table.id),
          })} />{table.name}
        </label>)}</div>
        <label>{t('Propagation labels')}<input key={JSON.stringify(config.labels)} className="aznet-input"
          defaultValue={config.labels.join(', ')} data-configuration-saved={config.labels.join(', ')} onBlur={(event) => {
            const labels = words(event.target.value)
            if (JSON.stringify(labels) !== JSON.stringify(config.labels)) change({ labels })
          }} /><small className="configuration-save-hint">{t('Save on blur')}</small></label>
        <p>{t('Configuration status')}: {config.status}</p>
        {config.status !== 'configured' && <button type="button" className="aznet-btn" disabled={!config.associatedTableId}
          onClick={() => change({ status: 'configured', limitations: [] })}>{t('Use edited configuration')}</button>}
        </fieldset>
        {managed && !routingIntentConfigurationMatches(hub, config) && <>
          <p role="status">{t('Saved connection settings differ from routing intent. Apply the managed settings explicitly; captured or unknown evidence is not silently rewritten.')}</p>
          <button type="button" onClick={() => change(routingIntentConfiguration(hub))}>{t('Apply routing-intent settings')}</button>
        </>}
        {!attachment.branch && <ConnectionStaticRoutesEditor
          vnet={topology.vnets.find((vnet) => vnet.id === attachment.id)!} topology={topology} commit={commit} />}
      </fieldset>
    })}
    </section>
    </InspectorSection>)}
  </div>
}
