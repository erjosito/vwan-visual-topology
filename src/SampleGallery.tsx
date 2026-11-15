import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import './sample-gallery.css'

export interface SampleGalleryEntry {
  id: string
  title: string
  summary: string
  category?: 'flagship' | 'validation'
  badges?: string[]
}

export function SampleGallery({ entries, currentId, hasWorkspace, testIdPrefix, onLoad, onExport, onClose }: {
  entries: readonly SampleGalleryEntry[]
  currentId?: string
  hasWorkspace: boolean
  testIdPrefix: string
  onLoad: (id: string, signal: AbortSignal) => Promise<boolean>
  onExport: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const returnFocus = useRef(document.activeElement)
  const lastChoice = useRef<HTMLButtonElement>(null)
  const request = useRef<AbortController | undefined>(undefined)
  const [query, setQuery] = useState('')
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
  const visible = entries.filter((entry) =>
    [entry.id, t(entry.title), t(entry.summary), ...(entry.badges ?? []).map((badge) => t(badge))]
      .join(' ').toLocaleLowerCase().includes(search))
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
    <label className="field"><span>{t('Search samples')}</span><input ref={searchInput} type="search" value={query}
      onChange={(event) => setQuery(event.target.value)} disabled={!!loadingId} /></label>
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
      {(['flagship', 'validation'] as const).map((category) => {
        const group = visible.filter((entry) => (entry.category ?? 'flagship') === category)
        return !!group.length && <section key={category}>
          <h3>{t(category === 'flagship' ? 'Reference topologies' : 'Validation scenarios')}</h3>
          <div className="sample-gallery-grid">
            {group.map((entry) => <article key={entry.id} className={`sample-gallery-card${currentId === entry.id ? ' current' : ''}`}
              data-testid={`${testIdPrefix}-gallery-card-${entry.id}`}>
              <h4>{t(entry.title)}</h4>
              <p>{t(entry.summary)}</p>
              <div className="sample-gallery-badges">{entry.badges?.map((badge) => <span key={badge}>{t(badge)}</span>)}</div>
              {currentId === entry.id && <span className="muted">{t('Current sample')}</span>}
              <button type="button" className="primary" data-testid={`${testIdPrefix}-gallery-load-${entry.id}`}
                disabled={!!loadingId || !!pending} onClick={(event) => {
                  lastChoice.current = event.currentTarget
                  setError(''); if (hasWorkspace) setPending(entry); else void load(entry)
                }}>
                {t('Load sample topology')}
              </button>
            </article>)}
          </div>
        </section>
      })}
    </div>
  </dialog>
}
