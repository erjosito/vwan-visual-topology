import { useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { selectedEdition } from './editions'
import { beltProgress } from './progress-ledger'
import type { LearningStatusDetails } from './LearningStatusDetails'
import './learning-status.css'

export function LearningStatus() {
  const session = useWorkspaceSession(), state = session?.learningProgress, language = useLanguage()
  const { course, assessments, name } = selectedEdition(state?.ledger, session?.practice?.courseId)
  const [open, setOpen] = useState(false)
  const [Panel, setPanel] = useState<typeof LearningStatusDetails>()
  const [failed, setFailed] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const progress = state?.ledger ? beltProgress(state.ledger, course, assessments) : undefined
  const unknown = language === 'ja' ? '学習の進捗を利用不可' : 'Learning progress unavailable'
  return <>
    <button ref={trigger} type="button" className="learning-status-trigger" data-testid="learning-status"
      onKeyDown={(event) => { if (open && event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}
      aria-expanded={open} aria-controls={open && Panel ? 'local-learning-status' : undefined} onClick={() => {
        setOpen(!open)
        if (!Panel) void import('./LearningStatusDetails').then(({ LearningStatusDetails }) => setPanel(() => LearningStatusDetails), () => setFailed(true))
      }}>
      {language === 'ja' ? '未サインイン' : 'Not signed in'} · {course.title[language]} · {name[language]} - {progress ? <>
        <svg aria-hidden="true" width="24" height="20" viewBox="0 0 24 20"><path d="M2 5h20v6H2zM10 10l-3 8 5-2 2-6 3 8 4-2-5-7" fill={progress.belt.color} stroke="currentColor" /></svg>
        {progress.belt.name[language]} · {progress.points} {language === 'ja' ? 'ポイント' : 'points'}
        {state?.status !== 'saved' && <> · {state?.status === 'session' ? language === 'ja' ? 'セッションのみ' : 'Session only' : unknown}</>}
      </> : unknown}
    </button>
    {open && Panel && <Panel onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }) }} />}
    {open && !Panel && <span role="status">{failed
      ? language === 'ja' ? '学習状態の詳細を読み込めません。再読み込みして再試行してください。' : 'Learning status details could not load. Reload to retry.'
      : language === 'ja' ? '学習状態を読み込み中...' : 'Loading learning status...'}</span>}
  </>
}
