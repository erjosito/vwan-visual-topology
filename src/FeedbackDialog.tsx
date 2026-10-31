import { t, localizeDiagnostic } from './i18n'
import { LanguageSelector } from './LanguageSelector'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

const draftKey = 'vwan-feedback-draft:v1'
const appRevision = import.meta.env.VITE_APP_REVISION || 'development'
const publicFeedbackRepo = 'erjosito/vwan-visual-topology-feedback'
const publicFeedbackRepoUrl = `https://github.com/${publicFeedbackRepo}`

interface Draft {
  category: string
  title: string
  description: string
  requestId: string
}
function empty(): Draft {
  return { category: 'bug', title: '', description: '', requestId: crypto.randomUUID() }
}
function load(): Draft {
  try {
    const data = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null')
    if (data && ['bug', 'feature', 'other'].includes(data.category) &&
      ['title', 'description', 'requestId'].every((key) => typeof data[key] === 'string') &&
      data.title.length <= 120 && data.description.length <= 8000 &&
      /^[0-9a-f-]{36}$/i.test(data.requestId)) {
      return { category: data.category, title: data.title, description: data.description, requestId: data.requestId }
    }
  } catch { /* Storage can be disabled or contain an invalid draft. */ }
  return empty()
}
function buildFeedbackIssueUrl(draft: Draft, revision = appRevision): string {
  const categoryLabel = draft.category === 'bug' ? 'Bug' : draft.category === 'feature' ? 'Feature request' : 'Other'
  const labels = draft.category === 'bug' ? 'feedback,bug' : draft.category === 'feature' ? 'feedback,enhancement' : 'feedback'
  const title = draft.title.trim() ? `[${categoryLabel}] ${draft.title.trim()}` : ''
  const body = [
    `### Category\n${categoryLabel}`,
    `### Summary\n${draft.title.trim()}`,
    `### Description\n${draft.description.trim()}`,
    `---\n- **App revision:** \`${revision}\`\n- **Report reference:** \`FB-${draft.requestId}\``,
  ].join('\n\n')
  const params = new URLSearchParams({ labels, title, body })
  return `${publicFeedbackRepoUrl}/issues/new?${params.toString()}`
}
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(load)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<{ reference: string; issueUrl: string } | null>(null)
  const [storageError, setStorageError] = useState('')
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    if (element && !element.open) element.showModal()
    const url = new URL(location.href)
    if (url.searchParams.has('feedback')) {
      url.searchParams.delete('feedback')
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  const change = (field: keyof Omit<Draft, 'requestId'>, value: string) => {
    const next = { ...draft, [field]: value, requestId: crypto.randomUUID() }
    setDraft(next)
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); setStorageError('') }
    catch { setStorageError('Tab storage is unavailable. Copy your draft before closing this dialog.') }
    setError('')
  }
  const discard = () => {
    setDraft(empty())
    try { sessionStorage.removeItem(draftKey) } catch { /* Draft remains cleared in memory. */ }
    onClose()
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!consent) return
    const title = draft.title.trim(), description = draft.description.trim()
    if (title.length < 5 || title.length > 120 || description.length < 20 || description.length > 8000) {
      setError('Check the summary and description lengths. Your draft is preserved.')
      return
    }
    const issueUrl = buildFeedbackIssueUrl(draft, appRevision)
    if (issueUrl.length > 7500) {
      setError('Feedback is too long for a pre-filled GitHub issue URL. Shorten the description.')
      return
    }
    setError('')
    try { window.open(issueUrl, '_blank', 'noopener,noreferrer') } catch { /* Fallback link is rendered in the confirmation state. */ }
    setSubmitted({ reference: `FB-${draft.requestId}`, issueUrl })
    try { sessionStorage.removeItem(draftKey) } catch { setStorageError('Unable to remove the saved draft. Clear this tab storage when finished.') }
  }
  return <dialog ref={dialog} className="object-dialog feedback-dialog" aria-labelledby="feedback-title"
    aria-describedby="feedback-privacy" onClose={onClose}>
    <div className="row dialog-heading"><h2 id="feedback-title">{t("Send feedback")}</h2><LanguageSelector /><button type="button" aria-label={t("Close feedback")} onClick={onClose}>{t("Close")}</button></div>
    <p id="feedback-privacy">{t("Feedback is optional and opens a pre-filled issue in the public GitHub feedback repository (erjosito/vwan-visual-topology-feedback) without requiring OAuth app consent. Only the text you enter and the app revision are included. No topology, network configuration, screenshots or browser logs are attached. Do not include secrets or confidential information.")}</p>
    {submitted ? <div role="status"><p>{t("Feedback prepared for GitHub. Reference:")} <strong>{submitted.reference}</strong></p><p>{t("Submit the pre-filled issue in the new GitHub tab to publish your report in the public feedback repository.")}</p><div className="row dialog-actions"><a className="button primary" href={submitted.issueUrl} target="_blank" rel="noopener noreferrer">{t("Continue to GitHub issue form")}</a><a className="button ghost" href={`${publicFeedbackRepoUrl}/issues`} target="_blank" rel="noopener noreferrer">{t("Browse public feedback")}</a></div></div> : <form onSubmit={submit}>
      <label className="field"><span>{t("Category")}</span><select value={draft.category} onChange={(event) => change('category', event.target.value)}><option value="bug">{t("Bug")}</option><option value="feature">{t("Feature request")}</option><option value="other">{t("Other")}</option></select></label>
      <label className="field"><span>{t("Summary")}</span><input required minLength={5} maxLength={120} value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
      <label className="field"><span>{t("Description")}</span><textarea aria-label={t('Description')} required minLength={20} maxLength={8000} rows={6} value={draft.description} onChange={(event) => change('description', event.target.value)} placeholder={t("What happened, what did you expect, and how can we reproduce it?")} /></label>
      <details><summary>{t("Review what will be sent")}</summary><dl><dt>{t("Category")}</dt><dd>{t(draft.category)}</dd><dt>{t("Summary")}</dt><dd>{draft.title}</dd><dt>{t("Description")}</dt><dd className="feedback-preview">{draft.description}</dd><dt>{t("Target repository")}</dt><dd>{publicFeedbackRepo}</dd><dt>{t("App revision")}</dt><dd>{appRevision}</dd><dt>{t("Report reference")}</dt><dd>{`FB-${draft.requestId}`}</dd></dl></details>
      <label className="checkbox-field"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{t("I agree to open this report in the public GitHub feedback repository without confidential data.")}</label>
      <p className="muted">{t("Drafts stay in this tab and are removed after opening the GitHub issue form or Discard. No OAuth app consent is required.")}</p>
      {storageError && <p role="alert" className="notice">{localizeDiagnostic(storageError)}</p>}
      {error && <p role="alert" className="notice error">{localizeDiagnostic(error)}</p>}
      <div className="row dialog-actions"><button type="button" onClick={discard}>{t("Discard draft")}</button><a className="button ghost" href={`${publicFeedbackRepoUrl}/issues`} target="_blank" rel="noopener noreferrer">{t("Browse public feedback")}</a><button type="submit" className="primary" disabled={!consent}>{t("Open issue on GitHub")}</button></div>
    </form>}
  </dialog>
}
