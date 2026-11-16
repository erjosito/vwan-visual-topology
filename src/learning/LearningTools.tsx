import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import type { PlatformDocument } from '../platform/contract'
import type { LearningDialog } from './LearningDialog'

export function LearningTools(props: {
  document: PlatformDocument
  onOpen: (document: PlatformDocument) => void
}) {
  const [Panel, setPanel] = useState<typeof LearningDialog>()
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const lifetime = useRef(0)
  useEffect(() => () => { lifetime.current++ }, [])
  const open = async () => {
    const ticket = lifetime.current
    setLoading(true); setFailed(false)
    try {
      const { LearningDialog } = await import('./LearningDialog')
      if (ticket === lifetime.current) setPanel(() => LearningDialog)
    } catch { if (ticket === lifetime.current) setFailed(true) }
    finally { if (ticket === lifetime.current) setLoading(false) }
  }
  if (Panel) return <Panel {...props} initialOpen />
  return <>
    <button type="button" data-testid="learning-open" disabled={loading} aria-busy={loading}
      onClick={() => { void open() }}>{t('Learn & practice')}</button>
    {failed && <p role="status">{t('Learning tools could not load. Your workspace is unchanged; reload to retry.')}
      <button type="button" onClick={() => window.location.reload()}>{t('Reload')}</button></p>}
  </>
}
