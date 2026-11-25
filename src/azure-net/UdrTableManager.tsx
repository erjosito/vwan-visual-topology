import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { ConfigurationEditStatus } from '../WorkspacePresentation'
import { AzureRegionSelect } from '../AzureRegionSelect'
import { createUdrTable, udrAssociations } from './udr-tables'
import { resolveUdrRegion } from './udr-regions'
import type { AzNetTopology } from './model'
import UdrTableEditor from './UdrTableEditor'
import { confirmConfigurationSwitch } from '../configuration-selection'

export interface UdrManagerRequest {
  tableId?: string
  create?: boolean
  cloneId?: string
  associate?: { vnetId: string; subnetId: string }
}

export default function UdrTableManager({ topology, request, commit, onClose }: {
  topology: AzNetTopology; request: UdrManagerRequest
  commit: (update: (draft: AzNetTopology) => void) => boolean
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selectedId, setSelectedId] = useState(request.tableId ?? topology.udrTables[0]?.id)
  const [form, setForm] = useState<{ sourceId?: string; name: string; region: string; associate?: UdrManagerRequest['associate'] } | undefined>(() => {
    const source = topology.udrTables.find((table) => table.id === request.cloneId)
    if (request.cloneId) return { sourceId: request.cloneId, name: t('{0} copy', source?.name ?? ''),
      region: source ? source.region ?? resolveUdrRegion(topology, source) ?? '' : '' }
    return request.create ? { name: `rt-workload-${topology.udrTables.length + 1}`,
      region: topology.vnets.find((vnet) => vnet.id === request.associate?.vnetId)?.region ?? '', associate: request.associate } : undefined
  })
  const [error, setError] = useState('')
  const canSwitch = () => confirmConfigurationSwitch('[data-testid="udr-table-manager"]')
  const close = () => { if (canSwitch()) onClose() }
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current!
    element.showModal()
    return () => {
      element.close()
      if (previous?.isConnected && 'focus' in previous) (previous as HTMLElement).focus({ preventScroll: true })
    }
  }, [])
  const formOpen = !!form
  useEffect(() => { if (formOpen) dialog.current?.querySelector<HTMLInputElement>('input[name="name"]')?.focus() }, [formOpen])
  const selected = topology.udrTables.find((table) => table.id === selectedId)
  return <dialog ref={dialog} className="object-dialog udr-manager" data-testid="udr-table-manager" aria-label={t('Route tables')}
    onCancel={(event) => { event.preventDefault(); close() }} data-configuration-scope>
    <header className="row dialog-heading"><h2>{t('Route tables')}</h2>
      <button type="button" onClick={close}>{t('Close')}</button></header>
    <p>{t('Route tables are independent resources. Only subnets in the same region can share a table. Legacy regions are inferred only from unambiguous existing associations; otherwise set an explicit region.')}</p>
    <ConfigurationEditStatus />
    {form ? <form data-testid="udr-create-form" data-configuration-pending="true" onSubmit={(event) => {
      event.preventDefault()
      try {
        const source = form.sourceId ? topology.udrTables.find((table) => table.id === form.sourceId) : undefined
        if (form.sourceId && !source) throw new Error('The route table is no longer available.')
        const table = createUdrTable(topology, form.name, form.region, source)
        const association = form.associate
        const saved = commit((draft) => {
          draft.udrTables.push(table)
          if (!source && association) {
            const subnet = draft.vnets.find((vnet) => vnet.id === association.vnetId)?.subnets.find((subnet) => subnet.id === association.subnetId)
            if (!subnet) throw new Error('The subnet is no longer available.')
            subnet.routeTableId = table.id
          }
        })
        if (!saved) throw new Error('The route table could not be saved. Review the workspace notice.')
        setSelectedId(table.id); setForm(undefined); setError('')
      } catch (error) { setError(error instanceof Error ? t(error.message) : t('The route table could not be saved. Review the workspace notice.')) }
    }}>
      <h3>{t(form.sourceId ? 'Clone route table' : 'Create route table')}</h3>
      {form.sourceId && <p>{t('Copies routes and propagation settings with fresh IDs, without subnet associations. Next-hop addresses are not rewritten when choosing another region.')}</p>}
      <label className="field">{t('Route-table name')}<input name="name" required maxLength={120} value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label className="field">{t('Route-table region')}<AzureRegionSelect name="region" required aria-label={t('Route-table region')} value={form.region}
        onChange={(event) => setForm({ ...form, region: event.target.value })} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="row dialog-actions"><button type="button" onClick={() => { setForm(undefined); setError('') }}>{t('Cancel')}</button>
        <button type="submit">{t(form.sourceId ? 'Create route-table clone' : 'Create route table')}</button></div>
    </form> : <>
      <button type="button" className="aznet-btn" onClick={() => {
        if (canSwitch()) setForm({ name: `rt-workload-${topology.udrTables.length + 1}`, region: '' })
      }}>{t('Create route table')}</button>
      <p>{t('Fields update the workspace immediately; region changes require Apply region. Cloud saving is separate.')}</p>
      <div className="udr-manager-layout">
        <nav aria-label={t('Route-table library')}>{topology.udrTables.length ? topology.udrTables.map((table) => {
          const associations = udrAssociations(topology, table.id)
          return <button key={table.id} type="button" className="udr-library-entry" aria-current={table.id === selectedId ? 'true' : undefined}
            data-testid={`udr-library-${table.id}`} onClick={() => {
              if (table.id === selectedId || canSwitch()) setSelectedId(table.id)
            }}>
            <strong>{table.name}</strong><span>{table.region ?? resolveUdrRegion(topology, table) ?? t('Unknown region')}</span>
            <span>{t('{0} routes', table.routes.length)} · {t(table.disableBgpRoutePropagation ? 'BGP propagation disabled' : 'BGP propagation enabled')}</span>
            <span>{associations.map((entry) => entry.name).join(', ') || t('Unassociated')}</span>
          </button>
        }) : <p>{t('No route tables yet.')}</p>}</nav>
        <section aria-label={t('Route-table details')}>{selected ? <UdrTableEditor key={selected.id} topology={topology} table={selected} commit={commit}
          onClone={(sourceId) => {
            if (!canSwitch()) return
            const source = topology.udrTables.find((table) => table.id === sourceId)!
            setForm({ sourceId, name: t('{0} copy', source.name), region: source.region ?? resolveUdrRegion(topology, source) ?? '' })
          }} /> : <p>{t('Select a route table to edit its shared settings.')}</p>}</section>
      </div>
    </>}
  </dialog>
}
