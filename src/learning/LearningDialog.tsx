import { useEffect, useRef, useState } from 'react'
import { useLanguage, localizeDiagnostic } from '../i18n'
import { contractVersion, engineVersion } from '../platform/contract'
import type { PlatformDocument, PlatformResult } from '../platform/contract'
import { concepts, labels, text } from './content'
import type { ConceptId } from './content'
import { Explain } from './Explain'
import { exercises } from './exercises'
import { emptyProgress, entryFor, maxDraftChars, parseProgress, progressKey, recordAttempt } from './progress'
import type { Progress } from './progress'
import './learning.css'
import { useWorkspaceSession } from '../workspace-context'

export function LearningDialog({ document: workspace, onOpen, initialOpen = false }: {
  document: PlatformDocument
  onOpen: (document: PlatformDocument) => void
  initialOpen?: boolean
}) {
  const language = useLanguage()
  const session = useWorkspaceSession()
  const [open, setOpen] = useState(initialOpen)
  const [tab, setTab] = useState<'concepts' | 'practice'>('concepts')
  const [exerciseId, setExerciseId] = useState(() => exercises.find((item) => item.starter.mode === workspace.mode)!.id)
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(progressKey)
      return { progress: raw ? parseProgress(raw) : emptyProgress(), blocked: false }
    } catch { return { progress: emptyProgress(), blocked: true } }
  })
  const [progress, setProgress] = useState(initial.progress)
  const [blocked, setBlocked] = useState(initial.blocked)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saveFailed' | 'damaged'>(initial.blocked ? 'damaged' : 'saved')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ draft: string; value: PlatformResult }>()
  const [running, setRunning] = useState(false)
  const [confirm, setConfirm] = useState<'open' | 'reset'>()
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const job = useRef<AbortController | undefined>(undefined)
  const exercise = exercises.find((item) => item.id === exerciseId)!
  const matchingMode = (exercise.starter.mode === 'vwan') === (workspace.mode === 'vwan')
  const entry = entryFor(progress, exercise)
  const last = entry.attempts.at(-1)
  const outcomeLabel = (outcome: 'satisfied' | 'violated' | 'not assessed') =>
    text(outcome === 'satisfied' ? labels.passed : outcome === 'violated' ? labels.violated : labels.unknown, language)

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
    return () => { job.current?.abort(); job.current = undefined }
  }, [open])

  const close = () => {
    job.current?.abort(); job.current = undefined
    setRunning(false); setConfirm(undefined); setOpen(false)
    dialog.current?.close()
    trigger.current?.focus()
  }
  const store = (next: Progress, reset = false) => {
    setProgress(next)
    if (blocked && !reset) return
    try {
      const serialized = JSON.stringify(next)
      parseProgress(serialized)
      localStorage.setItem(progressKey, serialized)
      setBlocked(false); setSaveStatus('saved')
    } catch { setSaveStatus('saveFailed') }
  }
  const draftChange = (draft: string) => {
    if (draft.length > maxDraftChars) { setError(text(labels.invalid, language)); return }
    job.current?.abort(); job.current = undefined; setRunning(false)
    setError(''); setConfirm(undefined)
    store({ ...progress, entries: [...progress.entries.filter((item) => item.id !== entry.id), { ...entry, draft }] })
  }
  const input = () => {
    if (entry.draft.length > maxDraftChars) throw new Error(text(labels.invalid, language))
    return {
      contractVersion, engineVersion, operation: 'evaluate' as const,
      document: { mode: exercise.starter.mode, topology: JSON.parse(entry.draft) },
      requirements: exercise.requirements,
    }
  }
  const assess = async () => {
    job.current?.abort()
    const controller = new AbortController()
    job.current = controller
    const draft = entry.draft
    setError(''); setResult(undefined); setRunning(true)
    try {
      const { runBrowserSimulation } = await import('../platform/browser')
      if (job.current !== controller || controller.signal.aborted) return
      const value = await runBrowserSimulation(input(), controller.signal)
      if (job.current !== controller || controller.signal.aborted) return
      setResult({ draft, value })
      store(recordAttempt(progress, exercise, value, draft))
    } catch { if (job.current === controller) setError(text(labels.invalid, language)) }
    finally { if (job.current === controller) { job.current = undefined; setRunning(false) } }
  }
  const openDraft = async () => {
    setConfirm(undefined); setError(''); setRunning(true)
    const controller = new AbortController()
    job.current = controller
    try {
      const request = input()
      const { runBrowserSimulation } = await import('../platform/browser')
      if (job.current !== controller || controller.signal.aborted) return
      const admitted = await runBrowserSimulation({ ...request, operation: 'validate' }, controller.signal)
      if (job.current !== controller || controller.signal.aborted) return
      if (admitted.status !== 'complete' || !admitted.document) throw new Error('Invalid draft')
      if (!matchingMode && session) await session.openDocument(admitted.document.topology)
      else onOpen(admitted.document)
      close()
    } catch { if (job.current === controller) setError(text(labels.invalid, language)) }
    finally { if (job.current === controller) { job.current = undefined; setRunning(false) } }
  }

  return <>
    <button ref={trigger} type="button" data-testid="learning-open" onClick={() => setOpen(true)}>{text(labels.learn, language)}</button>
    <dialog ref={dialog} className="learning-dialog" aria-labelledby={`learning-title-${workspace.mode}`} onCancel={(event) => { event.preventDefault(); close() }}>
      <header><h2 id={`learning-title-${workspace.mode}`}>{text(labels.learn, language)}</h2><button type="button" onClick={close}>{text(labels.close, language)}</button></header>
      <nav aria-label={text(labels.learn, language)}>
        <button type="button" aria-pressed={tab === 'concepts'} onClick={() => { setTab('concepts'); setConfirm(undefined) }}>{text(labels.concepts, language)}</button>
        <button type="button" aria-pressed={tab === 'practice'} onClick={() => { setTab('practice'); setConfirm(undefined) }}>{text(labels.practice, language)}</button>
      </nav>
      {tab === 'concepts' ? <section aria-label={text(labels.concepts, language)}>
        {(Object.keys(concepts) as ConceptId[]).map((concept) => <Explain key={concept} concept={concept} />)}
      </section> : <section aria-label={text(labels.practice, language)}>
        <p className="learning-notice">{text(labels.local, language)}</p>
        <label>{text(labels.exercise, language)} <select aria-label={text(labels.exercise, language)} value={exerciseId} disabled={running} onChange={(event) => {
          setExerciseId(event.target.value); setResult(undefined); setError(''); setConfirm(undefined)
        }}>{exercises.map((item) => <option key={item.id} value={item.id}>{text(item.title, language)}</option>)}</select></label>
        <h3>{text(exercise.title, language)}</h3>
        <p>{text(exercise.objective, language)}</p>
        {!!exercise.prerequisites.length && <p>{text(labels.prerequisite, language)}: {exercise.prerequisites.map((id) => text(exercises.find((item) => item.id === id)!.title, language)).join(', ')}</p>}
        <h4>{text(labels.requirements, language)} · v{exercise.version}</h4>
        <pre>{JSON.stringify(exercise.requirements, null, 2)}</pre>
        {exercise.concepts.map((concept) => <Explain key={concept} concept={concept} />)}
        <label className="learning-draft">{text(labels.draft, language)}
          <textarea aria-label={text(labels.draft, language)} spellCheck={false} maxLength={maxDraftChars} value={entry.draft} onChange={(event) => draftChange(event.target.value)} />
        </label>
        <div className="learning-actions">
          <button type="button" disabled={running || !matchingMode} onClick={() => draftChange(JSON.stringify(workspace.topology, null, 2))}>{text(labels.useWorkspace, language)}</button>
          <button type="button" disabled={running || (!matchingMode && !session)} onClick={() => setConfirm('open')}>{text(labels.openEditor, language)}</button>
          <button type="button" disabled={running} onClick={() => { void assess() }}>{text(running ? labels.running : labels.assess, language)}</button>
          {running && <button type="button" onClick={() => { job.current?.abort(); job.current = undefined; setRunning(false) }}>{text(labels.cancel, language)}</button>}
          <button type="button" disabled={entry.hints === exercise.hints.length || running} onClick={() => store({ ...progress, entries: [...progress.entries.filter((item) => item.id !== entry.id), { ...entry, hints: entry.hints + 1 }] })}>{text(labels.hint, language)}</button>
        </div>
        {!matchingMode && <p>{text(labels.matchingMode, language)}</p>}
        {confirm === 'open' && <div className="learning-notice" role="alert">
          <p>{text(labels.replace, language)}</p>
          <button type="button" disabled={running} onClick={() => { void openDraft() }}>{text(labels.confirm, language)}</button>
          <button type="button" onClick={() => setConfirm(undefined)}>{text(labels.cancel, language)}</button>
        </div>}
        <p>{text(labels.hints, language)}: {entry.hints}/{exercise.hints.length}</p>
        {exercise.hints.slice(0, entry.hints).map((hint, index) => <p key={index}>{text(hint, language)}</p>)}
        <p role="status">{text(labels[saveStatus], language)}</p>
        {error && <p role="alert">{error}</p>}
        {result && <div data-testid="practice-result">
          <h4>{last ? outcomeLabel(last.outcome) : text(labels.unknown, language)}</h4>
          {result.draft !== entry.draft && <p role="status">{text(labels.stale, language)}</p>}
          {result.value.errors.map((item) => <p key={item.code}>{localizeDiagnostic(item.message, language)}</p>)}
          {result.value.assessments.map((item) => <p key={item.id}><code>{item.id}</code>: {outcomeLabel(item.outcome)}</p>)}
          <details><summary>{text(labels.details, language)}</summary><pre>{JSON.stringify(result.value, null, 2)}</pre></details>
        </div>}
        <h3>{text(labels.history, language)}</h3>
        <ul>{exercises.map((item) => {
          const saved = entryFor(progress, item)
          const attempts = saved.attempts
          const passed = saved.achievement
          return <li key={item.id}>
            <strong>{text(item.title, language)}</strong>: {passed ? <>
              {text(labels.badge, language)} · {passed.at} · {passed.engine} · v{passed.exerciseVersion} · {text(labels.hints, language)}: {passed.hints}
              {(passed.engine !== engineVersion || passed.exerciseVersion !== item.version) && <p>{text(labels.older, language)}</p>}
            </> : text(labels.fresh, language)}
            {!!attempts.length && <details><summary>{attempts.length} · {text(labels.history, language)}</summary><ul>{[...attempts].reverse().map((attempt, index) => <li key={index}>{attempt.at} · {outcomeLabel(attempt.outcome)} · {attempt.engine} · v{attempt.exerciseVersion} · {text(labels.hints, language)}: {attempt.hints}</li>)}</ul></details>}
          </li>
        })}</ul>
        <button type="button" disabled={running} onClick={() => setConfirm('reset')}>{text(labels.reset, language)}</button>
        {confirm === 'reset' && <div role="alert">
          <p>{text(labels.resetConfirm, language)}</p>
          <button type="button" onClick={() => { store(emptyProgress(), true); setResult(undefined); setError(''); setConfirm(undefined) }}>{text(labels.resetNow, language)}</button>
          <button type="button" onClick={() => setConfirm(undefined)}>{text(labels.cancel, language)}</button>
        </div>}
      </section>}
    </dialog>
  </>
}
