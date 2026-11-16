import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { labels, text } from './content'
import './practice-workspace.css'

export function PracticeWorkspaceBar({ active, notice, onReturn, onResume, onDiscard }: {
  active: boolean
  notice: '' | 'read' | 'save' | 'conflict'
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
  return <section className="practice-workspace-bar" aria-label={text(labels.practiceWorkspace, language)} data-testid="practice-workspace-bar">
    <span>{text(active ? labels.practiceProtected : labels.practiceAvailable, language)}</span>
    {active ? <button type="button" onClick={onReturn}>{text(labels.returnDesign, language)}</button>
      : onResume && <button type="button" onClick={onResume}>{text(labels.resumePractice, language)}</button>}
    <button ref={discard} type="button" onClick={() => setConfirm(true)}>{text(labels.discardPractice, language)}</button>
    {notice && <p role="alert">{text(notice === 'read' ? labels.practiceReadFailure
      : notice === 'conflict' ? labels.practiceConflict : onResume ? labels.practiceSaveFailure : labels.practiceStartFailure, language)}</p>}
    <dialog ref={dialog} aria-labelledby="discard-practice-title" onCancel={(event) => { event.preventDefault(); close() }}>
      <h2 id="discard-practice-title">{text(labels.discardPractice, language)}</h2>
      <p>{text(labels.discardPracticeConfirm, language)}</p>
      <button type="button" autoFocus onClick={close}>{text(labels.cancel, language)}</button>
      <button type="button" onClick={() => { close(); onDiscard() }}>{text(labels.discardPractice, language)}</button>
    </dialog>
  </section>
}
