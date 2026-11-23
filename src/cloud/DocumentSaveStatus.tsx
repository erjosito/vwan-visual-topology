import { useEffect, useState, useSyncExternalStore } from 'react'
import { t, useLanguage } from '../i18n'
import { documentSaveLabel, useDocumentSaveState, useWorkspaceSession } from '../workspace-context'
import { useCloudSession } from './useCloudSession'

const noSubscribe = () => () => {}
const noSnapshot = () => undefined

export function DocumentSaveStatus({ detail = false }: { detail?: boolean }) {
  const session = useWorkspaceSession(), state = useDocumentSaveState(), cloud = useCloudSession()
  const artifact = useSyncExternalStore(session?.artifactCommands?.subscribe ?? noSubscribe,
    session?.artifactCommands?.getSnapshot ?? noSnapshot)
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
    : state.local === 'unavailable' ? 'Profile recovery unavailable. Confirmed file and cloud saves are unaffected.' : 'Not saved locally yet')
  const label = t(documentSaveLabel(cloud?.configured
    ? { ...state, cloud: state.cloud?.accountId === cloud.account?.id ? state.cloud : undefined } : state, artifact))
  const localStatus = <span className="document-save-state" data-testid={detail ? undefined : 'document-save-state'}
    title={`${local} · ${t('Local means this browser or desktop profile, not a JSON backup.')}`}>
    <span data-testid={detail ? undefined : 'document-local-state'}>{detail ? local : label}</span></span>
  return cloud?.configured && CloudStatus ? <CloudStatus detail={detail} state={state} local={local} label={label} /> : localStatus
}
