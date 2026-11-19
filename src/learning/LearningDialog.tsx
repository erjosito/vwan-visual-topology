import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const index = done ? instructions.length - 1 : Math.max(0, instructions.findIndex((item) => item.task.id === (state.reviewId ?? state.taskId)))
  const { lesson, task } = instructions[index]
  const check = bundle.checks.find((item) => item.id === task.checkId)!
  const requirements = 'requirements' in check.params ? check.params.requirements : []
  const [answerId, setAnswerId] = useState<string>()
  const [replayConfirm, setReplayConfirm] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [cue, setCue] = useState<CourseGuidance>()
  const [helpId, setHelpId] = useState<string>()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [explanationOpen, setExplanationOpen] = useState(false)
  const [foreground, setForeground] = useState(document.visibilityState === 'visible')
  const [initialTopology] = useState(() => workspace.topology)
  const [guideRequest, setGuideRequest] = useState(0)
  const focusedGuide = useRef<{ request: number; target: HTMLElement } | undefined>(undefined)
  const job = useRef<AbortController | undefined>(undefined)
  const panel = useRef<HTMLElement>(null)
  const inPractice = session?.practice?.courseId === bundle.course.id && session.practice.scenarioId === lesson.scenarioId
  const plan = useMemo(() => cue && inPractice ? resolveGuidance(workspace, cue) : undefined, [workspace, cue, inPractice])
  const anchorKey = JSON.stringify(plan?.anchors)
  const revealGuidance = useCallback((visible: boolean) => {
    const previous = focusedGuide.current
    if (visible && anchorKey && (previous?.request !== guideRequest || document.activeElement === previous.target
      || !previous.target.isConnected && document.activeElement === document.body)) {
      const target = focusGuidanceTarget(JSON.parse(anchorKey))
      if (target) focusedGuide.current = { request: guideRequest, target }
    }
  }, [anchorKey, guideRequest])
  const showFeedback = !reviewing && state.feedback && (['passed', 'incorrect', 'unassessed', 'progress'].includes(state.feedback)
    || workspace.topology !== initialTopology && ['requirements', 'peering'].includes(state.feedback))
  useEffect(() => {
    runner.setAutomatic(foreground && !reviewing && !running && !confirm && !replayConfirm && !optionsOpen && !explanationOpen)
    return () => runner.setAutomatic(false)
  }, [runner, foreground, reviewing, running, confirm, replayConfirm, optionsOpen, explanationOpen])
  useEffect(() => {
    const visibilityChanged = () => {
      if (document.visibilityState !== 'visible') runner.setAutomatic(false)
      setForeground(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', visibilityChanged)
    document.body.classList.add('learning-sidebar-open')
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged)
      document.body.classList.remove('learning-sidebar-open'); job.current?.abort()
    }
  }, [runner])
  useEffect(() => {
    if (state.celebration && document.activeElement === document.body) document.getElementById('learning-task')?.focus({ preventScroll: true })
  }, [state.celebration])
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
      <p data-testid="learning-completion-count">{instructions.filter(({ task }) => taskCompleted(bundle, state.completions, task)).length} / {instructions.length} {text(runnerText.completed, language)}</p>
      {!reviewing && state.celebration && <div className="learning-success" role="status" data-testid="learning-celebration" title={text(state.celebration.title, language)}>
        <strong>{text(runnerText.success, language)}{state.celebration.points > 0 && ` +${state.celebration.points} ${text(runnerText.points, language)}`}</strong>
        {state.celebration.explanation && <details onToggle={(event) => setExplanationOpen(event.currentTarget.open)}>
          <summary>{text(runnerText.why, language)}</summary><p>{text(state.celebration.explanation, language)}</p>
        </details>}
      </div>}
      {state.replayLessonId && <p>{text(runnerText.replaying, language)}</p>}
      {reviewing && <div className="learning-notice"><p>{text(runnerText.review, language)}</p>
        <button type="button" onClick={() => runner.review()}>{text(runnerText.return, language)}</button></div>}
      {done ? <section><h3 id="learning-task" tabIndex={-1}>{text(runnerText.done, language)}</h3><p>{text(runnerText.doneDetail, language)}</p></section> : <>
      <h3>{text(lesson.title, language)}</h3>
      {check.kind === 'scenario.loaded' && <p>{text(lesson.objective, language)}</p>}
      <section aria-labelledby="learning-task" data-testid="learning-task" data-task-id={task.id} aria-busy={state.running || running}>
        <h4 id="learning-task" tabIndex={-1} aria-live="polite">{text(task.title, language)}</h4>
        <p>{text(task.instruction, language)}</p>
        <p>{task.points} {text(runnerText.points, language)}</p>
        {!reviewing && !inPractice && !confirm && <button type="button" disabled={running} onClick={() => { runner.cancel(); setConfirm(true); setError('') }}>{text(labels.load, language)}</button>}
        {confirm && <div className="learning-notice" data-learning-confirm>
          <p>{text(labels.replace, language)}</p>
          <button type="button" disabled={running} onClick={() => { void load() }}>{text(running ? labels.loading : labels.confirm, language)}</button>
          <button type="button" onClick={() => { job.current?.abort(); setRunning(false); setConfirm(false) }}>{text(labels.cancel, language)}</button>
        </div>}
        {error && <p role="alert">{error}</p>}
        {check.kind === 'quiz.answered' && <fieldset disabled={reviewing || state.running || state.canContinue || running || !inPractice}>
          <legend>{text(check.params.question, language)}</legend>
          {check.params.choices.map((choice) => <label className="learning-choice" key={choice.id}>
            <input type="radio" name={`answer-${task.id}`} value={choice.id} checked={answerId === choice.id}
              onChange={() => { runner.cancel(); setAnswerId(choice.id) }} />{text(choice.text, language)}
          </label>)}
        </fieldset>}
        {check.kind === 'quiz.answered' && !reviewing && inPractice && !state.canContinue
          && !['unassessed', 'progress'].includes(state.feedback ?? '') && <button type="button"
          disabled={!answerId || running || state.running} onClick={() => { void runner.assess(answerId) }}>{text(runnerText.submit, language)}</button>}
        {!reviewing && inPractice && task.guidanceIds.map((id) => {
          const guidance = bundle.guidance.find((item) => item.id === id)!
          return <span className="learning-guide" key={id}
            onMouseEnter={() => setHelpId(id)} onMouseLeave={(event) => { if (!event.currentTarget.contains(document.activeElement)) setHelpId(undefined) }}>
            <button type="button" aria-describedby={`${id}-help`}
              onFocus={() => setHelpId(id)} onBlur={() => setHelpId(undefined)}
              onKeyDown={(event) => { if (event.key === 'Escape' && helpId === id) { event.stopPropagation(); setHelpId(undefined) } }}
              onClick={() => {
                setHelpId(undefined)
                setCue(guidance)
                setGuideRequest((request) => request + 1)
                if (!resolveGuidance(workspace, guidance).reason) onGuide?.(guidance)
              }}>{text(labels.show, language)}</button>
            <span id={`${id}-help`} role="tooltip" hidden={helpId !== id}>{text(guidance.instruction, language)} {text(labels.navigation, language)}</span>
          </span>
        })}
        {cue && plan?.reason && <p role="status">{text(labels[plan.reason], language)}</p>}
        {task.hints.map((hint, hintIndex) => <details key={hintIndex}><summary>{text(learningLabels.hint, language)} {hintIndex + 1}</summary><p>{text(hint, language)}</p></details>)}
        {showFeedback && <div role="status" data-testid="learning-feedback">
          <p>{text(runnerText[state.feedback!], language)}</p>
          {state.explanation && state.feedback !== 'passed' && <p>{text(state.explanation, language)}</p>}
          {!!state.unmet.length && <details><summary>{text(runnerText.conditions, language)}</summary><ul>{state.unmet.map((id) => {
            const requirement = requirements.find((entry) => entry.id === id)
            return requirement && <li key={id}>{text(requirementDescription(requirement), language)}</li>
          })}</ul></details>}
          {['unassessed', 'progress'].includes(state.feedback!) && <button type="button" disabled={state.running || running}
            onClick={() => { void runner.assess(answerId) }}>{text(runnerText.retry, language)}</button>}
        </div>}
      </section>
      </>}
      <details onToggle={(event) => setOptionsOpen(event.currentTarget.open)}><summary>{text(labels.options, language)}</summary>
      <p>{text(runnerText.automatic, language)}</p>
      <p>{text(lesson.objective, language)}</p>
      {!!task.guidanceIds.length && <details><summary>{text(labels.navigationHelp, language)}</summary>
        <p>{text(labels.navigation, language)}</p>
        {task.guidanceIds.map((id) => <p key={id}>{text(bundle.guidance.find((entry) => entry.id === id)!.instruction, language)}</p>)}
      </details>}
      <button type="button" onClick={() => session?.setLearningDetailsOpen?.(true)}>{language === 'ja' ? 'カリキュラムの版と学習データ' : 'Curriculum editions & learning data'}</button>
      <TrackOverview />
      <div className="learning-actions">
        {cue && <button type="button" onClick={() => setCue(undefined)}>{text(labels.stop, language)}</button>}
        {inPractice && !reviewing && !done && <button type="button" disabled={running} onClick={() => {
          runner.cancel(); setConfirm(true); setError('')
          requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('[data-learning-confirm] button')?.focus())
        }}>{text(labels.restart, language)}</button>}
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
      </details>
    </aside>
    {plan?.anchors && <GuidanceHighlight key={guideRequest} anchors={plan.anchors} onVisibility={revealGuidance} />}
  </>, document.body)
}
