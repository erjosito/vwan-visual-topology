import { DEFAULT_HUB_TABLE, NONE_HUB_TABLE, hubRouteTables } from '../hub-routing'
import type { HubRoutingConfiguration } from '../model'
import { t } from '../i18n'
import type { AzNetTopology, AzVwanHub } from './model'
import { azHubRouting } from './hub-routing'
import { HubStaticRoutesEditor } from '../HubStaticRoutesEditor'

const words = (value: string) => [...new Set(value.split(',').map((word) => word.trim()).filter(Boolean))]

export function HubTablesEditor({ hub, topology, commit, onAttach, focusFirewall }: {
  hub: AzVwanHub
  topology: AzNetTopology
  commit: (update: (draft: AzNetTopology) => void) => void
  onAttach: (vnetId: string) => void
  focusFirewall?: boolean
}) {
  const tables = hubRouteTables(hub)
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
  return <section aria-label={t('Hub routing tables')} data-testid="aznet-hub-tables-editor">
    <h4>{t('Hub routing tables')}</h4>
    <p>{t('Association selects the ingress lookup table. Propagation controls where routes are advertised. Labels are case-sensitive; None suppresses propagation.')}</p>
    <p>{t('Custom tables with routing intent and arbitrary hub next hops are not assessed. Static inspection requires a declared local Azure Firewall in a single hub.')}</p>
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
        disabled={table.id === DEFAULT_HUB_TABLE || table.id === NONE_HUB_TABLE}
        onChange={(event) => {
          const value = event.target.value
          commit((draft) => { draft.vwanHubs.find((entry) => entry.id === hub.id)!.routeTables!.find((entry) => entry.id === table.id)!.name = value })
        }} /></label>
      <label>{t('Labels')}<input key={JSON.stringify(table.labels)} className="aznet-input"
        aria-label={`${t('Table labels')} ${table.id}`} defaultValue={table.labels.join(', ')}
        disabled={table.id === DEFAULT_HUB_TABLE || table.id === NONE_HUB_TABLE}
        onBlur={(event) => {
          const labels = words(event.target.value)
          if (JSON.stringify(labels) === JSON.stringify(table.labels)) return
          commit((draft) => { draft.vwanHubs.find((entry) => entry.id === hub.id)!.routeTables!.find((entry) => entry.id === table.id)!.labels = labels })
        }} /></label>
    </div>)}
    <button type="button" className="aznet-btn" onClick={() => commit((draft) => {
      const owner = draft.vwanHubs.find((entry) => entry.id === hub.id)!
      const id = `table-${crypto.randomUUID()}`
      ;(owner.routeTables ??= []).push({ id, name: t('Custom table'), labels: [] })
    })}>{t('Add hub table')}</button>
    <h4>{t('VNet attachments')}</h4>
    {topology.vnets.filter((vnet) => !vnet.vwanHubAttachment).map((vnet) =>
      <button key={vnet.id} type="button" className="aznet-btn" onClick={() => onAttach(vnet.id)}>{t('Attach {0}', vnet.name)}</button>)}
    {attachments.map((attachment) => {
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
          defaultValue={config.labels.join(', ')} onBlur={(event) => {
            const labels = words(event.target.value)
            if (JSON.stringify(labels) !== JSON.stringify(config.labels)) change({ labels })
          }} /></label>
        <p>{t('Configuration status')}: {config.status}</p>
        {config.status !== 'configured' && <button type="button" className="aznet-btn" disabled={!config.associatedTableId}
          onClick={() => change({ status: 'configured', limitations: [] })}>{t('Use edited configuration')}</button>}
      </fieldset>
    })}
  </section>
}
