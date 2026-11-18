import { useEffect, useRef, useState } from 'react'
import { t, useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { highestTrackBelt, selectedEdition } from './editions'
import { beltProgress } from './progress-ledger'
import type { LearningStatusDetails } from './LearningStatusDetails'
import './learning-status.css'
import { useCloudSession } from '../cloud/useCloudSession'

export function LearningStatus() {
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
  const unknown = language === 'ja' ? '学習の進捗を利用不可' : 'Learning progress unavailable'
  const identity = cloud?.account?.name ?? (language === 'ja' ? '未サインイン' : 'Not signed in')
  const description = `${identity} · ${t('Highest belt across tracks')}: ${highest ? `${highest.belt.name[language]} · ${t('Tracks at this belt: {0}', highest.trackCount)}` : unknown} · ${course.title[language]} · ${name[language]} · ${progress ? `${progress.belt.name[language]} · ${progress.points}` : unknown}`
  return <>
    <button ref={trigger} type="button" className="learning-status-trigger" data-testid="learning-status"
      title={session?.presentationPreview ? description : undefined}
      aria-description={session?.presentationPreview ? `${t('Learning status')}: ${description}` : undefined}
      onKeyDown={(event) => { if (open && event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}
      aria-expanded={open} aria-controls={open && Panel ? 'local-learning-status' : undefined} onClick={() => setOpen(!open)}>
      {session?.presentationPreview ? <>
        <span className="learning-status-identity">{identity}</span>
        {highest ? <span className="learning-status-belt">
          <svg aria-hidden="true" width="24" height="20" viewBox="0 0 24 20"><path d="M2 5h20v6H2zM10 10l-3 8 5-2 2-6 3 8 4-2-5-7" fill={highest.belt.color} stroke="currentColor" /></svg>
          {highest.belt.name[language]}{highest.trackCount > 1 && <> x{highest.trackCount}</>}
        </span> : unknown}
      </> : <>{identity} · {course.title[language]} · {name[language]} - </>}{progress ? <>
        {!session?.presentationPreview && <>
        <svg aria-hidden="true" width="24" height="20" viewBox="0 0 24 20"><path d="M2 5h20v6H2zM10 10l-3 8 5-2 2-6 3 8 4-2-5-7" fill={progress.belt.color} stroke="currentColor" /></svg>
        {progress.belt.name[language]} · {progress.points} {language === 'ja' ? 'ポイント' : 'points'}
        </>}
        {state?.status !== 'saved' && <> · {state?.status === 'session' ? language === 'ja' ? 'セッションのみ' : 'Session only' : unknown}</>}
      </> : !session?.presentationPreview && unknown}
    </button>
    {open && Panel && <Panel onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }} />}
    {open && !Panel && <span role="status">{failed
      ? language === 'ja' ? '学習状態の詳細を読み込めません。再読み込みして再試行してください。' : 'Learning status details could not load. Reload to retry.'
      : language === 'ja' ? '学習状態を読み込み中...' : 'Loading learning status...'}</span>}
  </>
}
