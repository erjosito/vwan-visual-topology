import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { previewCourse, checkpointAssessments } from './course-profile'
import { beltProgress, type LedgerState } from './progress-ledger'
import { statusLabels as labels } from './status-content'
import { TrackOverview } from './TrackOverview'
import './learning-status-details.css'

export function LearningStatusDetails({ onClose }: { onClose: () => void }) {
  const session = useWorkspaceSession(), language = useLanguage()
  const state = session?.learningProgress
  const [confirm, setConfirm] = useState<LedgerState>()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const label = (value: { en: string; ja: string }) => value[language]
  const progress = state?.ledger ? beltProgress(state.ledger, previewCourse, checkpointAssessments) : undefined
  const operate = async (reset: boolean) => {
    setBusy(true); setFailed(false)
    try {
      const success = reset && confirm ? await session?.resetLearningProgress?.(confirm) : await session?.retryLearningProgress?.()
      if (success) setConfirm(undefined)
      else setFailed(true)
    } catch { setFailed(true) }
    finally { setBusy(false) }
  }
  const backup = (legacy: boolean) => {
    try {
      const raw = session?.backupLearningProgress?.(legacy)
      if (typeof raw !== 'string') { setFailed(true); return }
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = legacy ? 'previous-practice-backup.json' : 'guided-learning-backup.json'
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch { setFailed(true) }
  }
  return createPortal(<section id="local-learning-status" className="learning-status-panel" aria-label={label(labels.details)}
      data-testid="learning-status-details" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <header><h2>{label(labels.details)}</h2><button type="button" onClick={onClose}>{label(labels.close)}</button></header>
      <p role="status">{label(state ? labels[state.status] : labels.unavailable)}</p>
      {progress && <>
        <p>{label(previewCourse.title)} - {label(progress.belt.name)} · {progress.points} {label(labels.points)}</p>
        {progress.next ? <>
          <p>{label(labels.next)}: {label(progress.next.name)} · {progress.pointsRemaining} {label(labels.remaining)}</p>
          <p>{label(labels.checkpoints)}: {progress.checkpointsRemaining.length}</p>
        </> : <p>{label(previewCourse.publication === 'preview' ? labels.preview : labels.terminal)}</p>}
      </>}
      <TrackOverview />
      <p>{label(labels.local)}</p><p>{label(labels.writer)}</p><p>{label(labels.policy)}</p>
      <div className="learning-status-actions">
        <button type="button" onClick={() => backup(false)}>{label(labels.backup)}</button>
        {state?.status === 'session' && <button type="button" disabled={busy} onClick={() => { void operate(false) }}>{label(labels.retry)}</button>}
        {state?.status === 'conflict' && <button type="button" onClick={() => location.reload()}>{label(labels.reload)}</button>}
      </div>
      {state?.legacy && <div><p>{label(labels.legacy)}</p><button type="button" onClick={() => backup(true)}>{label(labels.backupLegacy)}</button></div>}
      <button type="button" disabled={busy || !state} onClick={() => { setConfirm(state); setFailed(false) }}>{label(labels.reset)}</button>
      {confirm && <div><p>{label(labels.confirm)}</p>
        <button type="button" disabled={busy} onClick={() => setConfirm(undefined)}>{label(labels.cancel)}</button>
        <button type="button" disabled={busy} onClick={() => { void operate(true) }}>{label(labels.delete)}</button>
      </div>}
      {failed && <p role="alert">{label(labels.failed)}</p>}
    </section>, document.body)
}
