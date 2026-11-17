import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../i18n'
import type { PlatformDocument } from '../platform/contract'
import { contractVersion, engineVersion } from '../platform/contract'
import { useWorkspaceSession } from '../workspace-context'
import { concepts, text, type ConceptId } from './content'
import type { CourseGuidance } from './course-contract'
import { Explain } from './Explain'
import { GuidanceHighlight } from './GuidanceHighlight'
import { focusGuidanceTarget } from './guidance-anchors'
import { resolveGuidance } from './guidance'
import { sidebarLabels as labels } from './sidebar-content'
import { learningLabels, practiceLabels } from './practice-content'
import { practiceConflict, practiceReadFailure, practiceSaveFailure } from './practice-workspace'
import { practiceOwnershipFailure } from './practice-ownership'
import { orderedTasks, taskCompleted } from './runner'
import { requirementDescription, runnerLabels as runnerText } from './runner-content'
import { TrackOverview } from './TrackOverview'
import { editions } from './editions'
import './learning.css'

type PanelProps = {
  document: PlatformDocument
  onGuide?: (cue: CourseGuidance) => void
  onPause: () => void
}

export function LearningDialog(props: PanelProps) {
  const session = useWorkspaceSession()
  if (!session?.learningState || !session.learning) return null
  return <LearningPanel key={`${session.learning.bundle.course.id}:${session.learningState.reviewId ?? session.learningState.taskId ?? 'complete'}`} {...props} />
}

function LearningPanel({ document: workspace, onGuide, onPause }: PanelProps) {
  const language = useLanguage(), session = useWorkspaceSession()
  const runner = session!.learning!, state = session!.learningState!
  const bundle = runner.bundle
  const instructions = orderedTasks(bundle)
  const done = !state.taskId && !state.reviewId
  const reviewing = !!state.reviewId
  const index = Math.max(0, instructions.findIndex((item) => item.task.id === (state.reviewId ?? state.taskId)))
  const { lesson, task } = instructions[index]
  const check = bundle.checks.find((item) => item.id === task.checkId)!
  const requirements = 'requirements' in check.params ? check.params.requirements : []
  const [answerId, setAnswerId] = useState<string>()
  const [replayConfirm, setReplayConfirm] = useState(false)
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
        : error instanceof Error && error.message === practiceOwnershipFailure ? practiceLabels.practiceOwnership
        : error instanceof Error && error.message === practiceSaveFailure ? practiceLabels.practiceStartFailure : labels.unavailable, language))
    } finally { if (!controller.signal.aborted) setRunning(false) }
  }
  return createPortal(<>
    <aside ref={panel} id="learning-sidebar" className="learning-sidebar" aria-labelledby="learning-title" data-testid="learning-sidebar" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onPause() }
    }}>
      <header><h2 id="learning-title">{text(learningLabels.learn, language)}</h2><button type="button" onClick={onPause}>{text(labels.pause, language)}</button></header>
      <p data-testid="learning-active-track"><strong>{text(bundle.course.title, language)}</strong> · {text(editions.find((entry) => entry.course.id === bundle.course.id)!.name, language)}</p>
      <button type="button" onClick={() => session?.setLearningDetailsOpen?.(true)}>{language === 'ja' ? 'カリキュラムの版' : 'Curriculum editions'}</button>
      <TrackOverview />
      <p className="learning-notice">{bundle.course.id === 'azure-networking-preview' ? text(runnerText.preview, language)
        : language === 'ja' ? '7 つの順序立ったシナリオで、この版の白帯から黒帯まで進みます。検証は静的なルーティングのモデルに限定され、Azure 認定ではありません。' : 'Seven sequential scenarios take you from white to black belt in this edition. Checks assess modeled steady-state routing, not Azure certification.'}</p>
      <p>{text(learningLabels.local, language)}</p>
      <p>{text(runnerText.session, language)}</p>
      <p data-testid="learning-completion-count">{instructions.filter(({ task }) => taskCompleted(bundle, state.completions, task)).length} / {instructions.length} {text(runnerText.completed, language)}</p>
      {state.replayLessonId && <p>{text(runnerText.replaying, language)}</p>}
      {reviewing && <div className="learning-notice"><p>{text(runnerText.review, language)}</p>
        <button type="button" onClick={() => runner.review()}>{text(runnerText.return, language)}</button></div>}
      {done ? <section><h3 id="learning-task" tabIndex={-1}>{text(runnerText.done, language)}</h3><p>{text(runnerText.doneDetail, language)}</p></section> : <>
      <h3>{text(lesson.title, language)}</h3>
      <p>{text(lesson.objective, language)}</p>
      <section aria-labelledby="learning-task" data-testid="learning-task" data-task-id={task.id}>
        <h4 id="learning-task" tabIndex={-1} aria-live="polite">{text(task.title, language)}</h4>
        <p>{text(task.instruction, language)}</p>
        <p>{task.points} {text(runnerText.points, language)}</p>
        {inPractice && <p>{text(labels.loaded, language)}</p>}
        {!reviewing && <button type="button" disabled={running || state.running} onClick={() => { runner.cancel(); setConfirm(true); setError('') }}>{text(labels.load, language)}</button>}
        {confirm && <div className="learning-notice">
          <p>{text(labels.replace, language)}</p>
          <button type="button" disabled={running} onClick={() => { void load() }}>{text(running ? labels.loading : labels.confirm, language)}</button>
          <button type="button" onClick={() => { job.current?.abort(); setRunning(false); setConfirm(false) }}>{text(labels.cancel, language)}</button>
        </div>}
        {error && <p role="alert">{error}</p>}
        {check.kind === 'quiz.answered' && <fieldset disabled={reviewing || state.running || running || !inPractice}>
          <legend>{text(check.params.question, language)}</legend>
          {check.params.choices.map((choice) => <label className="learning-choice" key={choice.id}>
            <input type="radio" name={`answer-${task.id}`} value={choice.id} checked={answerId === choice.id}
              onChange={() => { runner.cancel(); setAnswerId(choice.id) }} />{text(choice.text, language)}
          </label>)}
        </fieldset>}
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
        {!reviewing && <div className="learning-actions">
          <button type="button" disabled={running || state.running} onClick={() => { void runner.assess(answerId) }}>{text(state.running ? runnerText.checking : runnerText.check, language)}</button>
          {state.running && <button type="button" onClick={() => runner.cancel()}>{text(runnerText.cancel, language)}</button>}
        </div>}
        {!reviewing && state.feedback && <div role="status" data-testid="learning-feedback">
          <p>{text(runnerText[state.feedback], language)}</p>
          {state.explanation && <p>{text(state.explanation, language)}</p>}
          {!!state.unmet.length && <ul>{state.unmet.map((id) => {
            const requirement = requirements.find((entry) => entry.id === id)
            return requirement && <li key={id}>{text(requirementDescription(requirement), language)}</li>
          })}</ul>}
        </div>}
      </section>
      {!reviewing && <nav className="learning-actions" aria-label={text(runnerText.current, language)}>
        <button type="button" disabled={!state.canContinue || running} onClick={() => {
          if (runner.advance()) requestAnimationFrame(() => {
            // Advance replaces the keyed panel and removes its focused button.
            if (document.activeElement === document.body) document.getElementById('learning-task')?.focus({ preventScroll: true })
          })
        }}>{text(runnerText.continue, language)}</button>
      </nav>}
      </>}
      <div className="learning-actions">
        <button type="button" disabled={state.running || running} onClick={() => setReplayConfirm(true)}>{text(runnerText.replay, language)}</button>
        {state.replayLessonId && <button type="button" onClick={() => runner.resumeCurrent()}>{text(runnerText.return, language)}</button>}
      </div>
      {replayConfirm && <div className="learning-notice"><p>{text(runnerText.replayNotice, language)}</p>
        <button type="button" onClick={() => { setReplayConfirm(false); runner.replayLesson(lesson.id) }}>{text(runnerText.replayConfirm, language)}</button>
        <button type="button" onClick={() => setReplayConfirm(false)}>{text(labels.cancel, language)}</button>
      </div>}
      <nav aria-label={text(runnerText.outline, language)}><details><summary>{text(runnerText.outline, language)}</summary><ol>{instructions.map((item) => {
        const completed = taskCompleted(bundle, state.completions, item.task)
        const current = item.task.id === state.taskId
        return <li key={item.task.id} aria-current={current ? 'step' : undefined}>
          {completed ? <button type="button" onClick={() => runner.review(item.task.id)}>{text(item.task.title, language)} — {text(runnerText.completed, language)}</button>
            : <span>{text(item.task.title, language)} — {text(current ? runnerText.current : runnerText.locked, language)}</span>}
        </li>
      })}</ol></details>
      </nav>
      <details><summary>{text(labels.help, language)}</summary>{(Object.keys(concepts) as ConceptId[]).map((id) => <Explain key={id} concept={id} />)}</details>
    </aside>
    {plan?.anchors && <GuidanceHighlight key={guideRequest} anchors={plan.anchors} onVisibility={setVisible} />}
  </>, document.body)
}
