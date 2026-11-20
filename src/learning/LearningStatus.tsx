import { useEffect, useRef, useState } from 'react'
import { t, useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { highestTrackBelt, selectedEdition } from './editions'
import { beltProgress } from './progress-ledger'
import type { LearningStatusDetails } from './LearningStatusDetails'
import './learning-status.css'
import { useCloudSession } from '../cloud/useCloudSession'
import { progressStatusLabel } from '../cloud/progress-status'
import { nextBeltLabel } from './belt-progress-label'

export function LearningStatus({ showIdentity = true }: { showIdentity?: boolean }) {
  const cloud = useCloudSession()
  const session = useWorkspaceSession(), state = session?.learningProgress, language = useLanguage()
  const { course, assessments, name } = selectedEdition(state?.ledger, session?.practice?.courseId)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const open = session?.learningDetailsOpen ?? fallbackOpen
  const setOpen = session?.setLearningDetailsOpen ?? setFallbackOpen
  const [Panel, setPanel] = useState<typeof LearningStatusDetails>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (open && !Panel) void import('./LearningStatusDetails').then(({ LearningStatusDetails }) => setPanel(() => LearningStatusDetails), () => setFailed(true))
  }, [open, Panel])
  const trigger = useRef<HTMLButtonElement>(null)
  const progress = state?.ledger ? beltProgress(state.ledger, course, assessments) : undefined
  const highest = state?.ledger ? highestTrackBelt(state.ledger) : undefined
  const unknown = t('Learning progress unavailable')
  const identity = cloud?.account?.name ?? t('Not signed in')
  const syncStatus = session?.cloudProgress && progressStatusLabel(session.cloudProgress.status, language, true)
  const beltLabel = highest ? `${highest.belt.name[language]}${highest.trackCount > 1 ? ` x${highest.trackCount}` : ''}` : unknown
  const localWarning = progress && state?.status !== 'saved'
    ? state?.status === 'session' ? t('Session only') : unknown : undefined
  const pointsUnit = t('points')
  const progressLabel = progress ? `${highest?.belt.id !== progress.belt.id ? `${name[language]}: ` : ''}${session?.presentationPreview ? `${progress.points} ${pointsUnit} · ` : ''}${nextBeltLabel(progress, language)}` : ''
  const description = `${identity} · ${t('Highest belt across tracks')}: ${highest ? `${highest.belt.name[language]} · ${t('Tracks at this belt: {0}', highest.trackCount)}` : unknown} · ${course.title[language]} · ${name[language]} · ${progress ? `${progress.belt.name[language]} · ${progress.points} ${pointsUnit} · ${nextBeltLabel(progress, language)}` : unknown}${syncStatus ? ` · ${syncStatus}` : ''}`
  return <>
    <button ref={trigger} type="button" className="learning-status-trigger" data-testid="learning-status"
      title={session?.presentationPreview ? `${t('Learning status')}: ${description}` : undefined}
      aria-label={!showIdentity ? `${t('Learning status')}: ${beltLabel}${localWarning ? ` · ${localWarning}` : ''}${progressLabel ? ` ${progressLabel}` : ''}${syncStatus ? ` · ${syncStatus}` : ''}` : undefined}
      aria-description={session?.presentationPreview ? `${t('Learning status')}: ${description}` : syncStatus}
      onKeyDown={(event) => { if (open && event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open && Panel ? 'local-learning-status' : undefined} onClick={() => setOpen(!open)}>
      {session?.presentationPreview ? <>
        {showIdentity && <span className="learning-status-identity">{identity}</span>}
        {highest ? <span className="learning-status-belt">
          <svg aria-hidden="true" width="24" height="20" viewBox="0 0 24 20"><path d="M2 5h20v6H2zM10 10l-3 8 5-2 2-6 3 8 4-2-5-7" fill={highest.belt.color} stroke="currentColor" /></svg>
          {beltLabel}
        </span> : unknown}
      </> : <>{identity} · {course.title[language]} · {name[language]} - </>}{progress ? <>
        {!session?.presentationPreview && <>
        <svg aria-hidden="true" width="24" height="20" viewBox="0 0 24 20"><path d="M2 5h20v6H2zM10 10l-3 8 5-2 2-6 3 8 4-2-5-7" fill={progress.belt.color} stroke="currentColor" /></svg>
        {progress.belt.name[language]} · {progress.points} {pointsUnit}
        </>}
        {localWarning && <> · {localWarning}</>}
        {' '}<span className="learning-status-next" data-testid="learning-next-belt">{progressLabel}</span>
      </> : !session?.presentationPreview && unknown}
      {syncStatus && <span data-testid="learning-sync-summary"> · {syncStatus}</span>}
    </button>
    {open && Panel && <Panel onClose={() => setOpen(false)} />}
    {open && !Panel && <span role="status">{failed
      ? t('Learning status details could not load. Reload to retry.')
      : t('Loading learning status...')}</span>}
  </>
}
