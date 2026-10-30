import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

const draftKey = 'vwan-feedback-draft:v1'
const appRevision = import.meta.env.VITE_APP_REVISION || 'development'
interface Draft {
  category: string
  title: string
  description: string
  contact: string
  requestId: string
}
function empty(): Draft {
  return { category: 'bug', title: '', description: '', contact: '', requestId: crypto.randomUUID() }
}
function load(): Draft {
  try {
    const data = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null')
    if (data && ['bug', 'feature', 'other'].includes(data.category) &&
      ['title', 'description', 'contact', 'requestId'].every((key) => typeof data[key] === 'string') &&
      data.title.length <= 120 && data.description.length <= 8000 && data.contact.length <= 254 &&
      /^[0-9a-f-]{36}$/i.test(data.requestId)) {
      return { category: data.category, title: data.title, description: data.description, contact: data.contact, requestId: data.requestId }
    }
  } catch { /* Storage can be disabled or contain an invalid draft. */ }
  return empty()
}
export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(load)
  const [identity, setIdentity] = useState('')
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const [consent, setConsent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [reference, setReference] = useState('')
  const [storageError, setStorageError] = useState('')
  const inFlight = useRef(false)
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    if (element && !element.open) element.showModal()
    const url = new URL(location.href)
    if (url.searchParams.has('feedback')) {
      url.searchParams.delete('feedback')
      history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => { setAvailability('unavailable'); controller.abort() }, 10_000)
    void Promise.all([
      fetch('/api/feedback/status', { signal: controller.signal, cache: 'no-store' }).then(async (result) => {
        if (!result.ok) throw new Error()
        return result.json() as Promise<{ available: boolean }>
      }),
      fetch('/.auth/me', { signal: controller.signal, cache: 'no-store' }).then(async (result) => {
        if (!result.ok) throw new Error()
        return result.json() as Promise<{ clientPrincipal: { identityProvider: string; userDetails: string; userRoles: string[] } | null }>
      }),
    ]).then(([status, auth]) => {
      if (controller.signal.aborted) return
      setAvailability(status.available ? 'ready' : 'unavailable')
      const principal = auth.clientPrincipal
      setIdentity(principal?.identityProvider === 'github' && principal.userRoles.includes('authenticated') ? principal.userDetails : '')
    }).catch(() => { if (!controller.signal.aborted) setAvailability('unavailable') }).finally(() => clearTimeout(timeout))
    return () => {
      controller.abort()
      clearTimeout(timeout)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])
  const change = (field: keyof Omit<Draft, 'requestId'>, value: string) => {
    const next = { ...draft, [field]: value, requestId: crypto.randomUUID() }
    setDraft(next)
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); setStorageError('') }
    catch { setStorageError('Tab storage is unavailable. Copy your draft before signing in or closing this dialog.') }
    setError('')
  }
  const discard = () => {
    setDraft(empty())
    try { sessionStorage.removeItem(draftKey) } catch { /* Draft remains cleared in memory. */ }
    onClose()
  }
  const signIn = () => {
    try { sessionStorage.setItem(draftKey, JSON.stringify(draft)) }
    catch { setStorageError('Save a copy of your draft before signing in. Tab storage is unavailable.'); return }
    const destination = `${location.pathname}?feedback=1`
    location.assign(`/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(destination)}`)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!consent || !identity || availability !== 'ready' || inFlight.current) return
    const body = JSON.stringify({ ...draft, appRevision })
    if (new TextEncoder().encode(body).length > 16 * 1024) { setError('Feedback exceeds 16 KiB. Shorten the description.'); return }
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      const result = await fetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(30_000),
      })
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          setIdentity('')
          throw new Error('Your sign-in expired or was rejected. Sign in with GitHub again. Your draft is preserved.')
        }
        if (result.status === 429) throw new Error('Feedback is rate limited. Try again later; your draft is preserved.')
        if (result.status === 400 || result.status === 413 || result.status === 409) {
          throw new Error('Check the text lengths and email. Your draft is preserved; edit it before trying again.')
        }
        throw new Error('Receipt could not be confirmed. Your report may have been received; avoid resubmitting immediately.')
      }
      const data = await result.json() as { reference?: string }
      if (!data.reference || !/^FB-[0-9a-f-]{36}$/i.test(data.reference)) throw new Error()
      setReference(data.reference)
      try { sessionStorage.removeItem(draftKey) } catch { setStorageError('Unable to remove the saved draft. Clear this tab storage when finished.') }
    } catch (reason) {
      setError(reason instanceof Error && !['AbortError', 'TimeoutError', 'TypeError', 'SyntaxError'].includes(reason.name) && reason.message
        ? reason.message : 'Receipt could not be confirmed. Your report may have been received; avoid resubmitting immediately.')
    } finally { inFlight.current = false; setPending(false) }
  }
  return <dialog ref={dialog} className="object-dialog feedback-dialog" aria-labelledby="feedback-title"
    aria-describedby="feedback-privacy" onCancel={(event) => { if (inFlight.current) event.preventDefault() }} onClose={onClose}>
    <div className="row dialog-heading"><h2 id="feedback-title">Send feedback</h2><button type="button" disabled={pending} aria-label="Close feedback" onClick={onClose}>Close</button></div>
    <p id="feedback-privacy">Feedback is optional and online. Only the text you enter, your GitHub reporter name and app revision are sent to a private GitHub issue visible to this app&apos;s maintainers. No topology, network configuration, screenshots or browser logs are attached. Do not include secrets or confidential information.</p>
    {reference ? <div role="status"><p>Feedback received. Reference: <strong>{reference}</strong></p><p>The private issue is not publicly accessible. No automatic status notifications are provided.</p></div> : <form onSubmit={(event) => { void submit(event) }}>
      {availability !== 'ready' && <p role="status">{availability === 'loading' ? 'Checking feedback availability...' : 'Feedback is not configured or is temporarily unavailable. The simulator still works offline.'}</p>}
      <label className="field"><span>Category</span><select disabled={pending} value={draft.category} onChange={(event) => change('category', event.target.value)}><option value="bug">Bug</option><option value="feature">Feature request</option><option value="other">Other</option></select></label>
      <label className="field"><span>Summary</span><input required minLength={5} maxLength={120} disabled={pending} value={draft.title} onChange={(event) => change('title', event.target.value)} /></label>
      <label className="field"><span>Description</span><textarea required minLength={20} maxLength={8000} rows={6} disabled={pending} value={draft.description} onChange={(event) => change('description', event.target.value)} placeholder="What happened, what did you expect, and how can we reproduce it?" /></label>
      <label className="field"><span>Contact email (optional)</span><input type="email" maxLength={254} disabled={pending} value={draft.contact} onChange={(event) => change('contact', event.target.value)} /></label>
      <details><summary>Review what will be sent</summary><dl><dt>Category</dt><dd>{draft.category}</dd><dt>Summary</dt><dd>{draft.title}</dd><dt>Description</dt><dd className="feedback-preview">{draft.description}</dd><dt>Optional contact</dt><dd>{draft.contact || 'None'}</dd><dt>Reporter</dt><dd>{identity || 'Your GitHub name after sign-in'}</dd><dt>App revision</dt><dd>{appRevision}</dd><dt>Report reference</dt><dd>{draft.requestId}</dd></dl></details>
      <label className="checkbox-field"><input type="checkbox" checked={consent} disabled={pending} onChange={(event) => setConsent(event.target.checked)} />I agree to send this text and my GitHub reporter identity to the maintainers.</label>
      <p className="muted">Drafts stay in this tab across sign-in and are removed after success or Discard. Signing in is only for feedback; the simulator needs no account.</p>
      {storageError && <p role="alert" className="notice">{storageError}</p>}
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="row dialog-actions"><button type="button" disabled={pending} onClick={discard}>Discard draft</button>{!identity
        ? <button type="button" className="primary" disabled={availability !== 'ready'} onClick={signIn}>Sign in with GitHub</button>
        : <button type="submit" className="primary" disabled={pending || !consent || availability !== 'ready'}>{pending ? 'Sending...' : 'Send feedback'}</button>}</div>
    </form>}
  </dialog>
}
