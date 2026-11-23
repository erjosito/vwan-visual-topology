import { useState } from 'react'
import { t } from './i18n'
import { useWorkspaceSession } from './workspace-context'

export function DesktopTools() {
  const workspace = useWorkspaceSession()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  return <section className="desktop-tools" aria-label={t('Local desktop tools')}>
    <strong>{t('Desktop · offline modeling · optional cloud sync')}</strong>
    <button disabled={busy} onClick={async () => {
      setBusy(true); setNotice('')
      try { await workspace?.loadFile?.() }
      catch (error) { setNotice(error instanceof Error ? error.message : t('Local operation failed.')) }
      finally { setBusy(false) }
    }}>{t('Load file')}</button>
    {notice && <p role="status">{notice}</p>}
  </section>
}
