import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../i18n'
import type { PlatformDocument } from '../platform/contract'
import { contractVersion, engineVersion } from '../platform/contract'
import { useWorkspaceSession } from '../workspace-context'
import { concepts, text, type ConceptId } from './content'
import { exampleCourse as bundle } from './course-examples'
import type { CourseGuidance } from './course-contract'
import { Explain } from './Explain'
import { GuidanceHighlight } from './GuidanceHighlight'
import { focusGuidanceTarget } from './guidance-anchors'
import { resolveGuidance } from './guidance'
import { sidebarLabels as labels } from './sidebar-content'
import { learningLabels, practiceLabels } from './practice-content'
import { practiceConflict, practiceReadFailure, practiceSaveFailure } from './practice-workspace'
import './learning.css'

const instructions = bundle.course.lessonOrder.flatMap((id) => {
  const lesson = bundle.lessons.find((item) => item.id === id)!
  return lesson.taskOrder.map((taskId) => ({ lesson, task: lesson.tasks.find((item) => item.id === taskId)! }))
})

export function LearningDialog({ document: workspace, onGuide, onPause, taskId, onTask }: {
  document: PlatformDocument
  onGuide?: (cue: CourseGuidance) => void
  onPause: () => void
  taskId?: string
  onTask: (id: string) => void
}) {
  const language = useLanguage(), session = useWorkspaceSession()
  const index = Math.max(0, instructions.findIndex((item) => item.task.id === taskId))
  const { lesson, task } = instructions[index]
  const [confirm, setConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [cue, setCue] = useState<CourseGuidance>()
  const [visible, setVisible] = useState(false)
  const [guideRequest, setGuideRequest] = useState(0)
  const job = useRef<AbortController | undefined>(undefined)
  const panel = useRef<HTMLElement>(null)
  const inPractice = session?.practice?.courseId === bundle.course.id && session.practice.scenarioId === lesson.scenarioId
  const plan = useMemo(() => cue && inPractice ? resolveGuidance(workspace, cue) : undefined, [workspace, cue, inPractice])
  useEffect(() => {
    document.body.classList.add('learning-sidebar-open')
    return () => { document.body.classList.remove('learning-sidebar-open'); job.current?.abort() }
  }, [])
  const move = (offset: number) => {
    job.current?.abort(); setRunning(false); setConfirm(false); setError(''); setCue(undefined); setVisible(false)
    onTask(instructions[index + offset].task.id)
    panel.current?.scrollTo({ top: 0 })
  }
  const load = async () => {
    const controller = new AbortController()
    job.current?.abort(); job.current = controller
    setRunning(true); setError(''); setCue(undefined)
    try {
      if (!session?.openPractice) throw new Error('unavailable')
      const scenario = bundle.scenarios.find((item) => item.id === lesson.scenarioId)!
      const { runBrowserSimulation } = await import('../platform/browser')
      if (controller.signal.aborted) return
      const admitted = await runBrowserSimulation({ contractVersion, engineVersion, operation: 'validate', document: structuredClone(scenario.document) }, controller.signal)
      if (controller.signal.aborted) return
      if (admitted.status !== 'complete' || !admitted.document) throw new Error('Invalid scenario')
      await session.openPractice({ courseId: bundle.course.id, scenarioId: scenario.id, document: admitted.document }, controller.signal)
      if (!controller.signal.aborted) setConfirm(false)
    } catch (error) {
      if (!controller.signal.aborted) setError(text(error instanceof Error && error.message === practiceReadFailure ? practiceLabels.practiceReadFailure
        : error instanceof Error && error.message === practiceConflict ? practiceLabels.practiceConflict
        : error instanceof Error && error.message === practiceSaveFailure ? practiceLabels.practiceStartFailure : labels.unavailable, language))
    } finally { if (!controller.signal.aborted) setRunning(false) }
  }
  return createPortal(<>
    <aside ref={panel} id="learning-sidebar" className="learning-sidebar" aria-labelledby="learning-title" data-testid="learning-sidebar" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onPause() }
    }}>
      <header><h2 id="learning-title">{text(learningLabels.learn, language)}</h2><button type="button" onClick={onPause}>{text(labels.pause, language)}</button></header>
      <p className="learning-notice">{text(labels.preview, language)}</p>
      <p>{text(learningLabels.local, language)}</p>
      <p>{index + 1} / {instructions.length}</p>
      <h3>{text(lesson.title, language)}</h3>
      <p>{text(lesson.objective, language)}</p>
      <section aria-labelledby="learning-task">
        <h4 id="learning-task" aria-live="polite">{text(task.title, language)}</h4>
        <p>{text(task.instruction, language)}</p>
        {inPractice && <p>{text(labels.loaded, language)}</p>}
        <button type="button" disabled={running} onClick={() => { setConfirm(true); setError('') }}>{text(labels.load, language)}</button>
        {confirm && <div className="learning-notice">
          <p>{text(labels.replace, language)}</p>
          <button type="button" disabled={running} onClick={() => { void load() }}>{text(running ? labels.loading : labels.confirm, language)}</button>
          <button type="button" onClick={() => { job.current?.abort(); setRunning(false); setConfirm(false) }}>{text(labels.cancel, language)}</button>
        </div>}
        {error && <p role="alert">{error}</p>}
        <p>{text(labels.navigation, language)}</p>
        {task.guidanceIds.map((id) => {
          const guidance = bundle.guidance.find((item) => item.id === id)!
          return <div key={id}><p>{text(guidance.instruction, language)}</p><button type="button" onClick={() => {
            setCue(guidance); setVisible(false)
            setGuideRequest((request) => request + 1)
            if (inPractice && !resolveGuidance(workspace, guidance).reason) onGuide?.(guidance)
          }}>{text(labels.show, language)}</button></div>
        })}
        {cue && <div>
          <p role="status">{text(!inPractice ? labels.scope : plan?.reason ? labels[plan.reason] : visible ? labels.location : labels.unavailable, language)}</p>
          {visible && plan?.anchors && <button type="button" data-learning-menu-navigation onClick={() => focusGuidanceTarget(plan.anchors)}>{text(labels.focus, language)}</button>}
          <button type="button" onClick={() => setCue(undefined)}>{text(labels.stop, language)}</button>
        </div>}
        {task.hints.map((hint, hintIndex) => <details key={hintIndex}><summary>{text(learningLabels.hint, language)} {hintIndex + 1}</summary><p>{text(hint, language)}</p></details>)}
      </section>
      <nav className="learning-actions" aria-label={text(labels.instructions, language)}>
        <button type="button" disabled={!index || running} onClick={() => move(-1)}>{text(labels.previous, language)}</button>
        <button type="button" disabled={index === instructions.length - 1 || running || !inPractice} onClick={() => move(1)}>{text(labels.next, language)}</button>
      </nav>
      <details><summary>{text(labels.outline, language)}</summary><ol>{instructions.map((item) => <li key={item.task.id} aria-current={item.task.id === task.id ? 'step' : undefined}>{text(item.task.title, language)}</li>)}</ol></details>
      <details><summary>{text(labels.help, language)}</summary>{(Object.keys(concepts) as ConceptId[]).map((id) => <Explain key={id} concept={id} />)}</details>
    </aside>
    {plan?.anchors && <GuidanceHighlight key={guideRequest} anchors={plan.anchors} onVisibility={setVisible} />}
  </>, document.body)
}
