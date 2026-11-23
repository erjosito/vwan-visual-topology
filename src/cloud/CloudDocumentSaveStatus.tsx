import { t, useLanguage } from '../i18n'
import type { DocumentSaveSnapshot } from './document-state'
import { useCloudSession } from './useCloudSession'

export function CloudDocumentSaveStatus({ detail, state, local, label }: {
  detail: boolean; state: DocumentSaveSnapshot; local: string; label: string
}) {
  const cloud = useCloudSession()
  useLanguage()
  const linked = state.cloud?.accountId === cloud?.account?.id ? state.cloud : undefined
  const cloudLabel = t(state.operation === 'saving' ? 'Uploading a snapshot…'
    : linked?.state === 'changed' ? 'Cloud save changed: review first'
      : linked?.state === 'missing' ? 'Linked cloud save unavailable'
        : state.operation === 'failed' || linked?.state === 'unavailable' ? 'Cloud operation not confirmed'
          : linked?.state === 'matches' ? 'Matches last confirmed cloud save'
            : linked?.state === 'modified' ? 'Local changes not saved to cloud'
              : linked?.state === 'checking' ? 'Checking saved revision…'
                : linked?.state === 'unknown' ? 'Cloud saved; comparison unavailable'
                  : 'No cloud save linked in this tab')
  const help = t('Local means this browser or desktop profile, not a JSON backup. Cloud status is the last confirmation, not live sync. Shared links show cloud-saved data, not unuploaded local changes.')
  const content = <><span data-testid={detail ? undefined : 'document-local-state'}>{local}</span>
    <small data-testid={detail ? undefined : 'document-cloud-state'}>{cloudLabel}</small></>
  if (detail) return <div className="document-save-detail">
    <p>{content}</p>
    {linked && <p>{t('Linked cloud save')}: <strong>{linked.name}</strong>
      <br />{t('Save ID')}: <code>{linked.id}</code><br />{t('Last confirmed revision')}: <code>{linked.etag}</code></p>}
    {linked && !state.retained && <p>{t('The cloud save was confirmed, but this tab cannot retain its link after reload. Reopen the cloud library after reloading.')}</p>}
    <p>{help}</p>
  </div>
  return <button type="button" className="document-save-state" data-testid="document-save-state"
    title={`${local} · ${cloudLabel} · ${help}`}
    onClick={() => window.dispatchEvent(new Event('aznet-open-cloud-sharing'))}>
    <span data-testid="document-cloud-state" title={`${local} · ${cloudLabel} · ${help}`}>{label}</span>
  </button>
}
