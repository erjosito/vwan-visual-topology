import { useEffect, useState } from 'react'
import { t, useLanguage } from '../i18n'
import { useDocumentSaveState, useWorkspaceSession } from '../workspace-context'
import { useCloudSession } from './useCloudSession'

export function DocumentSaveStatus({ detail = false }: { detail?: boolean }) {
  const session = useWorkspaceSession(), state = useDocumentSaveState(), cloud = useCloudSession()
  const [CloudStatus, setCloudStatus] = useState<typeof import('./CloudDocumentSaveStatus').CloudDocumentSaveStatus>()
  useEffect(() => {
    if (!cloud?.configured) return
    let active = true
    void import('./CloudDocumentSaveStatus').then(module => {
      if (active) setCloudStatus(() => module.CloudDocumentSaveStatus)
    }, () => {})
    return () => { active = false }
  }, [cloud?.configured])
  useLanguage()
  if (session?.practice) return detail ? null : <span className="document-save-state">
    {t('Practice canvas')}</span>
  if (!state?.ready) return null
  const local = t(state.local === 'saved' ? 'Saved locally'
    : state.local === 'unavailable' ? 'Local save not confirmed' : 'Not saved locally yet')
  const localStatus = <span className="document-save-state" data-testid={detail ? undefined : 'document-save-state'}
    title={t('Local means this browser or desktop profile, not a JSON backup.')}>
    <span data-testid={detail ? undefined : 'document-local-state'}>{local}</span></span>
  return cloud?.configured && CloudStatus ? <CloudStatus detail={detail} state={state} local={local} /> : localStatus
}
