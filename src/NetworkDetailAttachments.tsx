import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { t } from './i18n'
import type { DetailEntity } from './network-detail-projection'
import type { Workload } from './inventory'

export function NetworkDetailAttachments({ entities, workloads, selectedId, selectedTargetId, subnetId, onSelect, onActions }: {
  entities: DetailEntity[]
  workloads: Workload[]
  selectedId?: string
  selectedTargetId?: string
  subnetId?: string
  onSelect: (id: string) => void
  onActions: (entity: DetailEntity, invoker: HTMLElement, x: number, y: number) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const matches = entities.filter((entity) => [entity.id, entity.name, ...entity.addresses,
    ...workloads.filter((workload) => entity.workloadIds.includes(workload.id)).flatMap((workload) => [workload.id, workload.name])]
    .join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 12) - 1))
  const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, entity: DetailEntity) => {
    event.preventDefault()
    event.stopPropagation()
    const invoker = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget
      : (event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null)
        ?? event.currentTarget.querySelector<HTMLButtonElement>('button')!
    const bounds = invoker.getBoundingClientRect()
    onActions(entity, invoker, 'clientX' in event ? event.clientX : bounds.left, 'clientY' in event ? event.clientY : bounds.bottom)
  }
  return <div className="detail-attachments">
    {entities.length > 12 && <label>{t('Search attached entities')}<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></label>}
    <div className="detail-device-grid">
      {matches.slice(currentPage * 12, (currentPage + 1) * 12).map((entity) => <div key={`${entity.kind}:${entity.id}`}
        className="detail-device" data-entity-id={entity.id} data-entity-kind={entity.kind}
        onContextMenu={(event) => menu(event, entity)}
        onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) menu(event, entity) }}
        data-selected={entity.workloadIds.includes(selectedId ?? '') || !!entity.target && entity.target.id === selectedTargetId} data-testid="detail-device">
        <button type="button" className="detail-device-target" aria-label={`${t(entity.label)}: ${entity.name}`} title={entity.name}
          aria-pressed={entity.target ? entity.target.id === selectedTargetId : undefined}
          onClick={(event) => {
            if (entity.kind === 'nic' && entity.workloadIds[0]) onSelect(entity.workloadIds[0])
            else menu(event, entity)
          }}
          onContextMenu={(event) => menu(event, entity)}
          onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) menu(event, entity) }}>
          <span className={`detail-device-symbol detail-device-symbol-${entity.kind}`} aria-hidden="true">{entity.kind === 'nic' ? '▣' : entity.kind === 'appliance' ? '⬡' : '◇'}</span>
          <span><small>{t(entity.label)}</small><strong>{entity.name}</strong><code>{entity.id}</code></span>
        </button>
        {(subnetId && entity.subnetAddresses ? entity.subnetAddresses.filter((entry) => entry.subnetId === subnetId).map((entry) => entry.address) : entity.addresses)
          .map((address, index) => <code key={index}>{address}</code>)}
        {entity.subnetIds.length > 1 && <small>{t('Original entity; {0} declared subnet associations', entity.subnetIds.length)}</small>}
        {workloads.filter((workload) => entity.workloadIds.includes(workload.id)).map((workload) => <button key={workload.id}
          type="button" className="detail-workload-reference" title={`${workload.name} · ${workload.id}`} aria-pressed={selectedId === workload.id} onClick={() => onSelect(workload.id)}>
          {t('Workload')}: {workload.name} · <code>{workload.id}</code>
          {selectedId === workload.id && <span> · {t('Selected workload')}</span>}
        </button>)}
      </div>)}
    </div>
    {entities.length > 12 && <div className="row detail-pagination">
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('Previous attachments')}</button>
      <span role="status">{t('Showing {0} of {1} attachments', Math.min(12, Math.max(0, matches.length - currentPage * 12)), matches.length)}</span>
      <button type="button" disabled={(currentPage + 1) * 12 >= matches.length} onClick={() => setPage(currentPage + 1)}>{t('Next attachments')}</button>
    </div>}
  </div>
}
