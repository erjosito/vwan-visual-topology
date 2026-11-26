import { useState } from 'react'
import { t } from '../i18n'
import { guidanceAnchor } from '../learning/guidance'
import { InspectorSection } from '../WorkspacePresentation'
import { AzureRegionSelect } from '../AzureRegionSelect'
import type { AzSelectedEntity } from './AzureNetDiagram'
import type { AzNetTopology, AzUdrTable, AzUdrNextHopType } from './model'
import { resolveUdrRegion } from './udr-regions'
import { deleteUdrTable, udrAssociations } from './udr-tables'
import './udr-tables.css'

export function UdrTablesEditor({ topology, selected, selectedVnetId, initialOpen, commit, onCreate, onClone, onLibrary, anchor }: {
  topology: AzNetTopology; selected: AzSelectedEntity; selectedVnetId: string | null
  initialOpen: boolean
  commit: (update: (draft: AzNetTopology) => void) => boolean
  onCreate: () => void
  onClone: (id: string) => void
  onLibrary: (id?: string) => void
  anchor?: { vnetId: string; subnetId: string }
}) {
  const tables = selected.kind === 'subnet'
    ? topology.udrTables.filter((table) => {
        const vnet = topology.vnets.find((vnet) => vnet.id === selected.vnetId)
        return vnet?.subnets.find((subnet) => subnet.id === selected.subnetId)?.routeTableId === table.id
      })
    : selectedVnetId
      ? topology.udrTables.filter((table) => {
          const vnet = topology.vnets.find((vnet) => vnet.id === selectedVnetId)
          return vnet?.subnets.some((subnet) => subnet.routeTableId === table.id) ?? false
        })
      : topology.udrTables
  return <InspectorSection title={t('Route tables')} summary={t('{0} route tables', tables.length)} initialOpen={initialOpen}>
    <div className="aznet-card" data-testid="aznet-udr-editor">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="aznet-btn" onClick={() => onLibrary()}>{t('Route-table library')}</button>
        <button type="button" className="aznet-btn aznet-btn-primary" data-testid="aznet-create-rt-btn"
          onClick={onCreate}>+ Create Route Table</button>
      </div>
      <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: 'var(--text)' }}>
        {t('Route tables are independent resources. Only subnets in the same region can share a table. Legacy regions are inferred only from unambiguous existing associations; otherwise set an explicit region.')}
      </p>
      {tables.map((table) => <UdrTableEditor key={table.id} topology={topology} table={table}
        commit={commit} onClone={onClone} onLibrary={onLibrary} anchor={anchor} />)}
    </div>
  </InspectorSection>
}

export default function UdrTableEditor({ topology, table, commit, onClone, onLibrary, anchor }: {
  topology: AzNetTopology; table: AzUdrTable
  commit: (update: (draft: AzNetTopology) => void) => boolean
  onClone: (id: string) => void
  onLibrary?: (id: string) => void
  anchor?: { vnetId: string; subnetId: string }
}) {
  const [error, setError] = useState('')
  const associations = udrAssociations(topology, table.id)
  const update = (edit: (target: AzUdrTable, draft: AzNetTopology) => void) => {
    const saved = commit((draft) => {
      const target = draft.udrTables.find((candidate) => candidate.id === table.id)
      if (!target) throw new Error('The route table is no longer available.')
      edit(target, draft)
    })
    if (saved) setError('')
    return saved
  }
  return <div className="aznet-card udr-table-editor" data-testid={`aznet-rt-card-${table.id}`}
    data-learning-anchor={anchor ? guidanceAnchor('udr-table', anchor.vnetId, anchor.subnetId, table.id) : undefined}>
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <label>{t('Name')} <input type="text" className="aznet-input" value={table.name} maxLength={120}
        aria-label={t('Route Table name {0}', table.name)} onChange={(event) => {
          const value = event.target.value
          update((target) => { target.name = value })
        }} /></label>
      <button type="button" className="aznet-btn" onClick={() => onClone(table.id)}>{t('Clone route table')}</button>
      {onLibrary && <button type="button" className="aznet-btn" onClick={() => onLibrary(table.id)}>{t('Open in route-table library')}</button>}
      <button type="button" className="aznet-btn" data-testid={`aznet-delete-rt-${table.id}`}
        disabled={associations.length > 0} title={associations.length ? t('Dissociate every subnet before deleting this route table.') : undefined}
        onClick={() => commit((draft) => deleteUdrTable(draft, table.id))}>{t('Delete RT')}</button>
    </div>
    <p>{associations.length ? t('Associated: {0}', associations.map((entry) => entry.name).join(', ')) : t('Unassociated')}</p>
    {associations.length > 0 && <p>{t('Edits affect every associated subnet. Dissociate subnets before deleting this shared resource.')}</p>}
    {associations.map((association) => <button key={association.subnetId} type="button" className="aznet-btn"
      onClick={() => commit((draft) => {
        const subnet = draft.vnets.find((vnet) => vnet.id === association.vnetId)?.subnets.find((subnet) => subnet.id === association.subnetId)
        if (subnet?.routeTableId === table.id) delete subnet.routeTableId
      })}>{t('Dissociate {0}', association.name)}</button>)}
    <form key={table.region ?? resolveUdrRegion(topology, table) ?? ''} onSubmit={(event) => {
      event.preventDefault()
      const region = String(new FormData(event.currentTarget).get('region')).trim()
      if (!update((target) => { target.region = region })) setError(t('Region change rejected. Dissociate incompatible subnets first; saved settings are unchanged.'))
    }} className="row" style={{ flexWrap: 'wrap' }}>
      <label>{t('Route-table region')} <AzureRegionSelect name="region" className="aznet-select" required
        defaultValue={table.region ?? resolveUdrRegion(topology, table) ?? ''} data-testid={`aznet-rt-region-${table.id}`}
        aria-label={t('Route-table region {0}', table.name)} /></label>
      <button type="submit" className="aznet-btn">{t('Apply region')}</button>
      {table.region === undefined && <span>{t(resolveUdrRegion(topology, table) ? 'Inferred legacy region' : 'Unknown region')}</span>}
    </form>
    {error && <p role="alert">{error}</p>}
    <label className="aznet-checkbox-row"><input type="checkbox" data-testid={`aznet-rt-disable-bgp-${table.id}`}
      checked={table.disableBgpRoutePropagation} onChange={(event) => {
        const checked = event.target.checked
        update((target) => { target.disableBgpRoutePropagation = checked })
      }} /><span>{t('Disable Gateway routes (GWroutes:OFF)')}</span></label>
    <label className="aznet-checkbox-row"><input type="checkbox" data-testid={`aznet-rt-disable-peering-${table.id}`}
      checked={!!table.disablePeeringRoutePropagation} onChange={(event) => {
        const checked = event.target.checked
        update((target) => { target.disablePeeringRoutePropagation = checked })
      }} /><span>{t('Disable Peering route propagation (Preview; requires an active covering UDR)')}</span></label>
    <div style={{ overflowX: 'auto' }}>
      <table className="aznet-route-table"><thead><tr>
        {['On', 'Name', 'Prefix', 'Next Hop Type', 'Next Hop IP', 'Actions'].map((label) => <th key={label}>{t(label)}</th>)}
      </tr></thead><tbody>{table.routes.map((route) => {
        const edit = (change: Partial<typeof route>) => update((target) => {
          const current = target.routes.find((candidate) => candidate.id === route.id)
          if (current) Object.assign(current, change)
        })
        return <tr key={route.id} data-learning-anchor={anchor ? guidanceAnchor('udr-route', anchor.vnetId, anchor.subnetId, table.id, route.id) : undefined}>
          <td><input type="checkbox" aria-label={t('Enable route {0}', route.name)} checked={route.enabled} onChange={(event) => edit({ enabled: event.target.checked })} /></td>
          <td><input type="text" className="aznet-input" aria-label={t('Route name {0}', route.name)} value={route.name} onChange={(event) => edit({ name: event.target.value })} /></td>
          <td><input type="text" className="aznet-input" aria-label={t('Route prefix {0}', route.name)} value={route.prefix} onChange={(event) => edit({ prefix: event.target.value })} /></td>
          <td><select className="aznet-select" aria-label={t('Route next hop {0}', route.name)} value={route.nextHopType} onChange={(event) => edit({ nextHopType: event.target.value as AzUdrNextHopType })}>
            {['VirtualAppliance', 'VirtualNetworkGateway', 'VnetLocal', 'Internet', 'None'].map((type) => <option key={type} value={type}>{type}</option>)}
          </select></td>
          <td>{route.nextHopType === 'VirtualAppliance' ? <input type="text" className="aznet-input" aria-label={t('Route next-hop IP {0}', route.name)}
            value={route.nextHopIp ?? ''} onChange={(event) => edit({ nextHopIp: event.target.value })} /> : '-'}</td>
          <td><button type="button" className="aznet-btn" aria-label={t('Delete route {0}', route.name)}
            onClick={() => update((target) => { target.routes = target.routes.filter((candidate) => candidate.id !== route.id) })}>x</button></td>
        </tr>
      })}</tbody></table>
    </div>
    <button type="button" className="aznet-btn" onClick={() => update((target, draft) => {
      const firstApp = draft.vnets.flatMap((vnet) => vnet.appliances)[0]
      target.routes.push({ id: `udr-${crypto.randomUUID()}`, name: `custom-route-${target.routes.length + 1}`,
        prefix: '10.2.0.0/16', nextHopType: firstApp ? 'VirtualAppliance' : 'Internet', nextHopIp: firstApp?.privateIp, enabled: true })
    })}>+ Add UDR Row</button>
  </div>
}
