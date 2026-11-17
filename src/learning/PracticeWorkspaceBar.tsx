import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { text } from './content'
import { learningLabels as labels, practiceLabels } from './practice-content'
import './practice-workspace.css'

export function PracticeWorkspaceBar({ active, notice, onReturn, onResume, onDiscard }: {
  active: boolean
  notice: '' | 'read' | 'save' | 'conflict' | 'ownership'
  onReturn: () => void
  onResume?: () => void
  onDiscard: () => void
}) {
  const language = useLanguage()
  const [confirm, setConfirm] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const discard = useRef<HTMLButtonElement>(null)
  const close = () => { setConfirm(false); dialog.current?.close(); discard.current?.focus() }
  useEffect(() => {
    if (confirm) dialog.current?.showModal()
    else dialog.current?.close()
  }, [confirm])
  return <section className="practice-workspace-bar" aria-label={text(practiceLabels.practiceWorkspace, language)} data-testid="practice-workspace-bar">
    <span>{text(active ? practiceLabels.practiceProtected : practiceLabels.practiceAvailable, language)}</span>
    {active ? <button type="button" onClick={onReturn}>{text(practiceLabels.returnDesign, language)}</button>
      : onResume && <button type="button" onClick={onResume}>{text(practiceLabels.resumePractice, language)}</button>}
    <button ref={discard} type="button" onClick={() => setConfirm(true)}>{text(practiceLabels.discardPractice, language)}</button>
    {notice && <p role="alert">{text(notice === 'ownership' ? practiceLabels.practiceOwnership
      : notice === 'read' ? practiceLabels.practiceReadFailure
      : notice === 'conflict' ? practiceLabels.practiceConflict : onResume ? practiceLabels.practiceSaveFailure : practiceLabels.practiceStartFailure, language)}</p>}
    <dialog ref={dialog} aria-labelledby="discard-practice-title" onCancel={(event) => { event.preventDefault(); close() }}>
      <h2 id="discard-practice-title">{text(practiceLabels.discardPractice, language)}</h2>
      <p>{text(practiceLabels.discardPracticeConfirm, language)}</p>
      <button type="button" autoFocus onClick={close}>{text(labels.cancel, language)}</button>
      <button type="button" onClick={() => { close(); onDiscard() }}>{text(practiceLabels.discardPractice, language)}</button>
    </dialog>
  </section>
}
