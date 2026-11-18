import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { t } from './i18n'
import type { DetailEntity } from './network-detail-projection'
import type { Workload } from './inventory'

export function NetworkDetailAttachments({ entities, workloads, selectedId, selectedTargetId, subnetId, focusRequest, onRevealOriginal, onRevealSubnet, subnetNames, onSelect, onActions }: {
  entities: DetailEntity[]
  workloads: Workload[]
  selectedId?: string
  selectedTargetId?: string
  subnetId?: string
  focusRequest?: { key: string; sequence: number }
  onRevealOriginal?: (entity: DetailEntity) => void
  onRevealSubnet?: (id: string) => void
  subnetNames?: Map<string, string>
  onSelect: (id: string) => void
  onActions: (entity: DetailEntity, invoker: HTMLElement, x: number, y: number) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pendingFocus, setPendingFocus] = useState<string>()
  const graph = useRef<HTMLDivElement>(null)
  const currentEntities = useRef(entities)
  useEffect(() => { currentEntities.current = entities }, [entities])
  const [edges, setEdges] = useState<{ key: string; path: string }[]>([])
  useEffect(() => {
    if (!focusRequest) return
    const index = currentEntities.current.findIndex((entity) => `${entity.kind}:${entity.id}` === focusRequest.key)
    if (index < 0) return
    setQuery('')
    setPage(Math.floor(index / 12))
    setPendingFocus(focusRequest.key)
  }, [focusRequest])
  const matches = entities.filter((entity) => [entity.id, entity.name, ...entity.addresses,
    ...workloads.filter((workload) => entity.workloadIds.includes(workload.id)).flatMap((workload) => [workload.id, workload.name])]
    .join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 12) - 1))
  const visible = matches.slice(currentPage * 12, (currentPage + 1) * 12)
  const visibleKeys = visible.map((entity) => `${entity.kind}:${entity.id}`).join('\n')
  useLayoutEffect(() => {
    if (!pendingFocus) return
    const target = [...(graph.current?.querySelectorAll<HTMLElement>('[data-original-entity]') ?? [])]
      .find((element) => element.dataset.originalEntity === pendingFocus)?.querySelector<HTMLButtonElement>('button')
    if (!target) return
    target.scrollIntoView({ block: 'center' })
    target.focus({ preventScroll: true })
    setPendingFocus(undefined)
  }, [pendingFocus, visibleKeys])
  useLayoutEffect(() => {
    const element = graph.current
    if (!element || !subnetId) return
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      const anchor = element.querySelector<HTMLElement>('.detail-attachment-label')!.getBoundingClientRect()
      const start = anchor.bottom - bounds.top
      setEdges([...element.querySelectorAll<HTMLElement>('[data-entity-id]')].map((node) => {
        const target = node.getBoundingClientRect(), end = target.top - bounds.top + Math.min(32, target.height / 2)
        return { key: `${node.dataset.entityKind}:${node.dataset.entityId}`, path: `M 10 ${start} V ${end} H ${target.left - bounds.left}` }
      }))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const node of element.querySelectorAll<HTMLElement>('[data-entity-id]')) observer.observe(node)
    measure()
    return () => observer.disconnect()
  }, [subnetId, visibleKeys])
  const menu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, entity: DetailEntity) => {
    event.preventDefault()
    event.stopPropagation()
    const invoker = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget
      : (event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null)
        ?? event.currentTarget.querySelector<HTMLButtonElement>('button')!
    const bounds = invoker.getBoundingClientRect()
    onActions(entity, invoker, 'clientX' in event ? event.clientX : bounds.left, 'clientY' in event ? event.clientY : bounds.bottom)
  }
  return <div className="detail-attachments" ref={graph} data-attachment-graph={subnetId}>
    {subnetId && <>
      <p className="detail-attachment-label">{t('Declared attachments')} ↓</p>
      <svg className="detail-attachment-edges" aria-hidden="true">
        {edges.map((edge) => <path key={edge.key} d={edge.path} data-attachment-edge={edge.key} />)}
      </svg>
    </>}
    {entities.length > 12 && <label>{t('Search attached entities')}<input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /></label>}
    <div className="detail-device-grid">
      {visible.map((entity) => {
        const reference = !!subnetId && entity.subnetIds.length > 1
        return <div key={`${entity.kind}:${entity.id}`}
        className="detail-device" data-entity-id={entity.id} data-entity-kind={entity.kind}
        data-original-entity={!reference ? `${entity.kind}:${entity.id}` : undefined}
        data-attachment-reference={reference ? `${entity.kind}:${entity.id}` : undefined}
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
          <span><small>{t(entity.label)}:</small><strong>{entity.name}</strong></span>
        </button>
        <code>{entity.id}</code>
        {(subnetId && entity.subnetAddresses ? entity.subnetAddresses.filter((entry) => entry.subnetId === subnetId).map((entry) => entry.address) : entity.addresses)
          .map((address, index) => <code key={index}>{address}</code>)}
        {entity.subnetIds.length > 1 && <>
          <small>{t('Original entity; {0} declared subnet associations', entity.subnetIds.length)}</small>
          {reference ? <button type="button" className="detail-original-link" onClick={() => onRevealOriginal?.(entity)}>
            {t('Attachment reference → original entity')}
          </button> : <div className="detail-subnet-references" aria-label={t('Declared attachments')}>
            {entity.subnetIds.map((id) => <button key={id} type="button" onClick={() => onRevealSubnet?.(id)}>
              {t('Subnet')}: {subnetNames?.get(id) ?? id} · <code>{id}</code>
            </button>)}
          </div>}
        </>}
        {workloads.filter((workload) => entity.workloadIds.includes(workload.id)).map((workload) => <button key={workload.id}
          type="button" className="detail-workload-reference" title={`${workload.name} · ${workload.id}`} aria-pressed={selectedId === workload.id} onClick={() => onSelect(workload.id)}>
          {t('Workload')}: {workload.name} · <code>{workload.id}</code>
          {selectedId === workload.id && <span> · {t('Selected workload')}</span>}
        </button>)}
      </div>})}
    </div>
    {entities.length > 12 && <div className="row detail-pagination">
      <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('Previous attachments')}</button>
      <span role="status">{t('Showing {0} of {1} attachments', Math.min(12, Math.max(0, matches.length - currentPage * 12)), matches.length)}</span>
      <button type="button" disabled={(currentPage + 1) * 12 >= matches.length} onClick={() => setPage(currentPage + 1)}>{t('Next attachments')}</button>
    </div>}
  </div>
}
