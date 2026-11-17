import { useEffect, useRef, useState } from 'react'
import type { ComponentProps } from 'react'
import { t } from './i18n'
import {
  DIFFICULTY_LABELS,
  SAMPLE_TRACKS,
  VWAN_SAMPLE_GALLERY,
  type SampleDifficulty,
  type SampleGalleryEntry,
  type SampleTrackId,
} from './sample-catalog'
import './sample-gallery.css'

export type { SampleGalleryEntry }

const difficultyLevels = ['foundational', 'intermediate', 'advanced'] as const

export function SampleGallery({ entries, currentId, hasWorkspace, testIdPrefix, onLoad, onExport, onOpenCurriculum, onClose }: {
  entries: readonly SampleGalleryEntry[]
  currentId?: string
  hasWorkspace: boolean
  testIdPrefix: string
  onLoad: (id: string, signal: AbortSignal) => Promise<boolean>
  onExport: () => void
  onOpenCurriculum?: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const returnFocus = useRef(document.activeElement)
  const lastChoice = useRef<HTMLButtonElement>(null)
  const request = useRef<AbortController | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [collection, setCollection] = useState<'flagship' | 'validation'>('flagship')
  const [trackFilter, setTrackFilter] = useState<'all' | SampleTrackId>('all')
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | SampleDifficulty>('all')
  const [expandedId, setExpandedId] = useState<string>()
  const [pending, setPending] = useState<SampleGalleryEntry>()
  const [loadingId, setLoadingId] = useState<string>()
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = returnFocus.current
    if (!dialog.current?.open) dialog.current?.showModal()
    searchInput.current?.focus()
    return () => {
      request.current?.abort()
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  const close = () => {
    request.current?.abort()
    dialog.current?.close()
  }
  const load = async (entry: SampleGalleryEntry) => {
    const controller = new AbortController()
    request.current = controller
    setLoadingId(entry.id)
    setError('')
    try {
      const loaded = await onLoad(entry.id, controller.signal)
      if (!controller.signal.aborted) {
        if (loaded) close()
        else setError('Sample could not be loaded. Your current workspace is unchanged.')
      }
    } catch {
      if (!controller.signal.aborted) setError('Sample could not be loaded. Your current workspace is unchanged.')
    } finally {
      if (!controller.signal.aborted) setLoadingId(undefined)
    }
  }
  const search = query.trim().toLocaleLowerCase()
  const availableTracks = SAMPLE_TRACKS.filter((track) => entries.some((entry) => entry.track === track.id))
  const visible = entries.filter((entry) => {
    if (entry.category !== collection) return false
    if (trackFilter !== 'all' && entry.track !== trackFilter) return false
    if (difficultyFilter !== 'all' && entry.difficulty !== difficultyFilter) return false
    if (!search) return true
    const haystack = [
      entry.id,
      ...(entry.aliases ?? []),
      t(entry.title),
      t(entry.summary),
      t(entry.purpose),
      ...entry.concepts.map((concept) => t(concept)),
    ].join(' ').toLocaleLowerCase()
    return haystack.includes(search)
  })
  return <dialog ref={dialog} className="object-dialog sample-gallery" aria-labelledby="sample-gallery-title"
    data-testid={`${testIdPrefix}-sample-gallery-modal`} onClose={onClose}
    onCancel={(event) => { event.preventDefault(); close() }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); close()
      } else if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')]
          .filter((element) => element.getClientRects().length > 0)
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first && last) {
          event.preventDefault(); last.focus()
        } else if (!event.shiftKey && document.activeElement === last && first) {
          event.preventDefault(); first.focus()
        }
      }
    }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
    }}>
    <div className="row dialog-heading">
      <h2 id="sample-gallery-title">{t('Sample topologies')}</h2>
      <button type="button" data-testid={`${testIdPrefix}-close-sample-gallery-btn`} aria-label={t('Close sample gallery')} onClick={close}>{t('Close')}</button>
    </div>
    <p>{t('Browse reference designs and validation scenarios. Loading a sample replaces the current workspace; export JSON first to keep a copy.')}</p>
    <label className="field"><span>{t('Collection')}</span>
      <select value={collection} disabled={!!loadingId || !!pending}
        onChange={(event) => { setCollection(event.target.value as 'flagship' | 'validation'); setTrackFilter('all'); setDifficultyFilter('all') }}>
        <option value="flagship">{t('Reference topologies')}</option>
        <option value="validation">{t('Validation scenarios')}</option>
      </select>
    </label>
    <p>{t('Samples are open-ended workspaces, not assessed practice. Validation scenarios may contain intentional faults. Related lessons remain in course order in Learn & practice.')}</p>
    <div className="sample-gallery-filters">
      <label className="field"><span>{t('Search samples')}</span><input ref={searchInput} type="search" value={query}
        onChange={(event) => setQuery(event.target.value)} disabled={!!loadingId || !!pending} /></label>
      <label className="field"><span>{t('Concept track')}</span>
        <select value={trackFilter} data-testid={`${testIdPrefix}-gallery-track-filter`}
          onChange={(event) => setTrackFilter(event.target.value as 'all' | SampleTrackId)} disabled={!!loadingId || !!pending}>
          <option value="all">{t('All concept tracks')}</option>
          {availableTracks.map((track) => <option key={track.id} value={track.id}>{t(track.label)}</option>)}
        </select>
      </label>
      <label className="field"><span>{t('Complexity')}</span>
        <select value={difficultyFilter} data-testid={`${testIdPrefix}-gallery-difficulty-filter`}
          onChange={(event) => setDifficultyFilter(event.target.value as 'all' | SampleDifficulty)} disabled={!!loadingId || !!pending}>
          <option value="all">{t('All levels')}</option>
          {difficultyLevels.map((level) =>
            <option key={level} value={level}>{t(DIFFICULTY_LABELS[level])}</option>)}
        </select>
      </label>
    </div>
    <p className="muted" role="status">{loadingId ? t('Loading sample…') : t('Showing {0} of {1} samples', visible.length, entries.length)}</p>
    {error && <p role="alert" className="notice error">{t(error)}</p>}
    {pending && <section className="sample-replacement" aria-label={t('Replace current workspace')}>
      <h3>{t('Replace current workspace')}</h3>
      <p>{t('Load {0}? This replaces the current design and its undo history. Export JSON first to keep your work.', t(pending.title))}</p>
      <div className="row">
        <button type="button" disabled={!!loadingId} onClick={onExport}>{t('Export JSON')}</button>
        <button type="button" autoFocus disabled={!!loadingId} onClick={() => {
          setPending(undefined); setError('')
          requestAnimationFrame(() => lastChoice.current?.focus())
        }}>{t('Cancel replacement')}</button>
        <button type="button" className="primary" disabled={!!loadingId} onClick={() => void load(pending)}>{t('Replace and load')}</button>
      </div>
    </section>}
    {!visible.length && <p>{t('No samples match your search.')}</p>}
    <div className="sample-gallery-groups" aria-busy={!!loadingId}>
      {availableTracks.map((track) => {
        const group = visible.filter((entry) => entry.track === track.id)
          .sort((a, b) => difficultyLevels.indexOf(a.difficulty) - difficultyLevels.indexOf(b.difficulty))
        return !!group.length && <section key={track.id} data-testid={`${testIdPrefix}-gallery-track-${track.id}`}>
          <div className="sample-track-header">
            <h3>{t(track.label)}</h3>
            <p className="muted">{t(track.description)}</p>
          </div>
          <div className="sample-gallery-grid">
            {group.map((entry) => {
              const isExpanded = expandedId === entry.id
              return <article key={entry.id} className={`sample-gallery-card${currentId === entry.id ? ' current' : ''}`}
                data-testid={`${testIdPrefix}-gallery-card-${entry.id}`}>
                <div className="sample-card-meta-row">
                  <span className={`sample-tier-pill tier-${entry.difficulty}`}>{t(DIFFICULTY_LABELS[entry.difficulty])}</span>
                  <span className="sample-kind-pill">{t(entry.category === 'flagship' ? 'Reference architecture' : 'Validation case study')}</span>
                  {currentId === entry.id && <span className="muted">{t('Current sample')}</span>}
                </div>
                <h4>{t(entry.title)}</h4>
                <p>{t(entry.summary)}</p>
                <p className="sample-purpose"><strong>{t('Why inspect this:')}</strong> {t(entry.purpose)}</p>
                <div className="sample-concepts">
                  <strong>{t('Key concepts:')}</strong> {entry.concepts.map((concept) => t(concept)).join(' · ')}
                </div>
                {entry.curriculum && <div className="sample-curriculum-callout">
                  <span><strong>{t('Related practice objective:')}</strong> {t(entry.curriculum.title)}</span>
                  {onOpenCurriculum && <button type="button" className="sample-link-btn"
                    data-testid={`${testIdPrefix}-gallery-curriculum-${entry.id}`}
                    disabled={!!loadingId || !!pending}
                    onClick={() => { close(); onOpenCurriculum() }}>
                    {t('Open Learn & practice')}
                  </button>}
                </div>}
                {isExpanded && <div className="sample-study-guide" data-testid={`${testIdPrefix}-gallery-guide-${entry.id}`}>
                  <p><strong>{t('Prerequisites:')}</strong> {t(entry.prerequisites)}</p>
                  <p><strong>{t('Try this after loading:')}</strong> {t(entry.suggestedExperiment)}</p>
                  <p><strong>{t('Supported capabilities:')}</strong> {entry.capabilities.map((cap) => t(cap)).join(' · ')}</p>
                  <p><strong>{t('Scope & limitations:')}</strong> {entry.limitations.map((lim) => t(lim)).join(' ')}</p>
                </div>}
                <div className="sample-card-actions">
                  <button type="button" data-testid={`${testIdPrefix}-gallery-details-${entry.id}`}
                    aria-expanded={isExpanded}
                    disabled={!!loadingId}
                    onClick={() => setExpandedId(isExpanded ? undefined : entry.id)}>
                    {t(isExpanded ? 'Hide study guide' : 'Study guide & scope')}
                  </button>
                  <button type="button" className="primary" data-testid={`${testIdPrefix}-gallery-load-${entry.id}`}
                    disabled={!!loadingId || !!pending} onClick={(event) => {
                      lastChoice.current = event.currentTarget
                      setError(''); if (hasWorkspace) setPending(entry); else void load(entry)
                    }}>
                    {t('Load sample topology')}
                  </button>
                </div>
              </article>
            })}
          </div>
        </section>
      })}
    </div>
  </dialog>
}

export function VwanSampleGallery(props: Omit<ComponentProps<typeof SampleGallery>, 'entries'>) {
  return <SampleGallery {...props} entries={VWAN_SAMPLE_GALLERY} />
}
