import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { PlatformDocument } from '../platform/contract'
import type { LearningDialog } from './LearningDialog'
import type { CourseGuidance } from './course-contract'
import { useWorkspaceSession } from '../workspace-context'

export function LearningTools(props: {
  document: PlatformDocument
  onGuide?: (cue: CourseGuidance) => void
}) {
  const session = useWorkspaceSession()
  const [localView, setLocalView] = useState({ open: false })
  const view = session?.learningView ?? localView
  const setView = session?.setLearningView ?? setLocalView
  const trigger = useRef<HTMLButtonElement>(null)
  const [Panel, setPanel] = useState<typeof LearningDialog>()
  const [failed, setFailed] = useState(false)
  const ready = Panel && (!session || session.learning)
  const loading = view.open && !ready && !failed
  const loadLearning = session?.loadLearning
  useEffect(() => {
    if (!view.open || ready || failed) return
    let active = true
    Promise.all([import('./LearningDialog'), loadLearning?.()]).then(([{ LearningDialog }]) => {
      if (active) setPanel(() => LearningDialog)
    }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [view.open, ready, failed, loadLearning])
  useEffect(() => {
    if (view.open && ready) document.getElementById('learning-title')?.focus({ preventScroll: true })
  }, [view.open, ready])
  return <>
    <button ref={trigger} type="button" data-testid="learning-open"
      aria-label={t('Learn & practice')} title={t('Learn & practice')}
      aria-haspopup="dialog" aria-expanded={session?.learningDetailsOpen ?? view.open}
      aria-controls={session?.learningDetailsOpen ? 'local-learning-status' : undefined}
      onClick={() => session?.setLearningDetailsOpen
        ? session.setLearningDetailsOpen(!session.learningDetailsOpen)
        : setView({ ...view, open: !view.open })}>{t(session?.presentationPreview ? 'Learn' : 'Learn & practice')}</button>
    {view.open && Panel && <Panel document={props.document} onGuide={props.onGuide}
      onPause={() => { setView({ ...view, open: false }); trigger.current?.focus({ preventScroll: true }) }} />}
    {loading && <span role="status">{t('Loading learning status...')}</span>}
    {failed && <p role="status">{t('Learning tools could not load. Your workspace is unchanged; reload to retry.')}
      <button type="button" onClick={() => window.location.reload()}>{t('Reload')}</button></p>}
  </>
}
