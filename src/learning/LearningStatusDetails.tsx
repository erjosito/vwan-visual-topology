import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t, useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { editions, selectedEdition } from './editions'
import { beltProgress, type LedgerState } from './progress-ledger'
import { statusLabels as labels } from './status-content'
import { TrackOverview } from './TrackOverview'
import './learning-status-details.css'
import { progressStatusLabel } from '../cloud/progress-status'
import { beltStages } from './belt-stages'

export function LearningStatusDetails({ onClose }: { onClose: () => void }) {
  const session = useWorkspaceSession(), language = useLanguage()
  const state = session?.learningProgress
  const cloud = session?.cloudProgress
  const [confirm, setConfirm] = useState<LedgerState>()
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editionConfirm, setEditionConfirm] = useState<string>()
  const label = (value: { en: string; ja: string }) => value[language]
  const { course, assessments, name } = selectedEdition(state?.ledger, session?.practice?.courseId)
  const progress = state?.ledger ? beltProgress(state.ledger, course, assessments) : undefined
  const started = session?.learningView?.open || session?.practice?.courseId === course.id || (progress?.points ?? 0) > 0
  const start = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(document.activeElement)
  useEffect(() => {
    start.current?.focus({ preventScroll: true })
    return () => {
      const target = returnFocus.current
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true })
    }
  }, [])
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
  const title = cloud ? t('Learning status') : label(labels.details)
  return createPortal(<section id="local-learning-status" className="learning-status-panel" role="dialog" aria-labelledby="learning-status-title"
      data-testid="learning-status-details" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <header role="presentation"><h2 id="learning-status-title">{title}</h2><button type="button" onClick={onClose}>{label(labels.close)}</button></header>
      <div className="learning-status-entry">
        <p>{label(labels.entry)}</p>
        <button ref={start} type="button" className="learning-status-start" data-testid="learning-start"
          disabled={busy || !session?.setLearningView} onClick={() => {
            returnFocus.current = document.getElementById('learning-title') ?? returnFocus.current
            onClose()
            session?.setLearningView?.({ open: true })
          }}>{label(started ? labels.continueLearning : labels.startLearning)}</button>
      </div>
      {(!cloud || state?.status !== 'saved') && <p role="status">{label(state ? labels[state.status] : labels.unavailable)}</p>}
      {cloud && <p role="status" data-testid="learning-cloud-status">{progressStatusLabel(cloud.status, language)}</p>}
      {progress && <>
        <p>{label(course.title)} · {label(name)} - {label(progress.belt.name)} · {progress.points} {label(labels.points)}</p>
        {progress.next ? <>
          <p>{label(labels.next)}: {label(progress.next.name)} · {progress.pointsRemaining} {label(labels.remaining)}</p>
          <p>{label(labels.checkpoints)}: {progress.checkpointsRemaining.length}</p>
        </> : <p>{label(course.publication === 'preview' ? labels.preview : labels.terminal)}</p>}
      </>}
      <details data-testid="learning-belt-stages">
        <summary>{language === 'ja' ? '帯のステージとトピック' : 'Belt stages and topics'}</summary>
        <ol>{(beltStages[course.id] ?? []).map((stage) => <li key={stage.beltId}>
          <strong>{course.belts.find((belt) => belt.id === stage.beltId)!.name[language]} · {stage.title[language]}</strong>
          <ul>{stage.topics.map((topic) => <li key={topic.en}>{topic[language]}</li>)}</ul>
        </li>)}</ol>
        {course.id === 'azure-routing-scenarios' && <p>{language === 'ja'
          ? 'ハイブリッド接続、複数ハブ、引き継ぎ課題は、基礎コースの黒帯以降も続く専門トピックです。'
          : 'Hybrid connectivity, multi-hub routing and the handover challenge continue as specialist practice beyond core black belt.'}</p>}
      </details>
      <TrackOverview />
      <details className="learning-status-advanced" data-testid="learning-advanced">
        <summary>{label(labels.advanced)}</summary>
        <section aria-label={language === 'ja' ? 'カリキュラムの版' : 'Curriculum editions'}>
          <h3>{language === 'ja' ? 'カリキュラムの版' : 'Curriculum editions'}</h3>
          <p>{language === 'ja' ? '版ごとの進捗を保持します。切り替えても過去のポイントや帯は失われません。' : 'Each edition keeps its own progress. Switching preserves historical points and belts.'}</p>
          {editions.filter((entry) => entry.course.id !== course.id).map((entry) => {
            const historical = state?.ledger && beltProgress(state.ledger, entry.course, entry.assessments)
            return <div key={entry.course.id}><p>{label(entry.name)}: {historical
              ? <>{historical.points} {label(labels.points)} · {label(historical.belt.name)}</>
              : label(labels.unknown)}</p>
              <button type="button" disabled={busy || !state?.ledger} onClick={() => setEditionConfirm(entry.course.id)}>
                {language === 'ja' ? `${label(entry.name)}に切り替える` : `Switch to ${label(entry.name)}`}
              </button></div>
          })}
          {editionConfirm && <div>
            <p>{language === 'ja' ? 'この版の続きから学習します。現在の練習キャンバスは、次の初期構成の読み込みを確認するまで変わりません。' : 'Continue this edition from its next unmet task? The current practice canvas stays unchanged until you confirm loading a starter.'}</p>
            <button type="button" disabled={busy} onClick={() => {
              setBusy(true); setFailed(false)
              void session?.selectLearningEdition?.(editionConfirm).then((success) => {
                if (success) setEditionConfirm(undefined)
                else setFailed(true)
              }).catch(() => setFailed(true)).finally(() => setBusy(false))
            }}>{language === 'ja' ? '版の切り替えを確認' : 'Confirm edition switch'}</button>
            <button type="button" disabled={busy} onClick={() => setEditionConfirm(undefined)}>{label(labels.cancel)}</button>
          </div>}
        </section>
        <p>{session?.cloudProgress
          ? language === 'ja' ? 'アカウント別の端末キャッシュです。クラウドの履歴は自己申告であり認定ではありません。'
            : 'Account-specific device cache. Cloud history is self-reported, not verified certification.'
          : label(labels.local)}</p><p>{label(labels.writer)}</p><p>{label(labels.policy)}</p>
        <div className="learning-status-actions">
          <button type="button" onClick={() => backup(false)}>{label(labels.backup)}</button>
          {cloud && <button type="button" disabled={busy || !cloud.status || cloud.status === 'loading' || cloud.status === 'saving'}
            onClick={() => { void cloud.refresh() }}>{label(labels.refreshCloud)}</button>}
          {state?.status === 'session' && <button type="button" disabled={busy} onClick={() => { void operate(false) }}>{label(labels.retry)}</button>}
          {state?.status === 'conflict' && <button type="button" onClick={() => location.reload()}>{label(labels.reload)}</button>}
        </div>
        {state?.legacy && <div><p>{label(labels.legacy)}</p><button type="button" onClick={() => backup(true)}>{label(labels.backupLegacy)}</button></div>}
        <button type="button" disabled={busy || !state} onClick={() => { setConfirm(state); setFailed(false) }}>{label(labels.reset)}</button>
        {confirm && <div><p>{label(labels.confirm)}</p>
          <button type="button" disabled={busy} onClick={() => setConfirm(undefined)}>{label(labels.cancel)}</button>
          <button type="button" disabled={busy} onClick={() => { void operate(true) }}>{label(labels.delete)}</button>
        </div>}
      </details>
      {failed && <p role="alert">{label(labels.failed)}</p>}
    </section>, document.body)
}
