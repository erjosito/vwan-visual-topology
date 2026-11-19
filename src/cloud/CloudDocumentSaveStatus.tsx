import { useLanguage } from '../i18n'
import type { DocumentSaveSnapshot } from './document-state'
import { useCloudSession } from './useCloudSession'

export function CloudDocumentSaveStatus({ detail, state, local }: {
  detail: boolean; state: DocumentSaveSnapshot; local: string
}) {
  const cloud = useCloudSession()
  const ja = useLanguage() === 'ja'
  const text = (en: string, jp: string) => ja ? jp : en
  const linked = state.cloud?.accountId === cloud?.account?.id ? state.cloud : undefined
  const cloudLabel = state.operation === 'saving' ? text('Uploading a snapshot…', 'スナップショットをアップロード中…')
    : linked?.state === 'changed' ? text('Cloud save changed: review first', 'クラウドの保存が変更されています。確認してください')
      : linked?.state === 'missing' ? text('Linked cloud save unavailable', '関連するクラウドの保存を利用できません')
        : state.operation === 'failed' || linked?.state === 'unavailable' ? text('Cloud operation not confirmed', 'クラウドの操作を確認できません')
          : linked?.state === 'matches' ? text('Matches last confirmed cloud save', '最後に確認したクラウドの保存と一致')
            : linked?.state === 'modified' ? text('Local changes not saved to cloud', 'ローカルの変更はクラウドに未保存')
              : linked?.state === 'checking' ? text('Checking saved revision…', '保存したリビジョンを確認中…')
                : linked?.state === 'unknown' ? text('Cloud saved; comparison unavailable', 'クラウドに保存済み。比較を利用できません')
                  : text('No cloud save linked in this tab', 'このタブに関連するクラウドの保存はありません')
  const help = text('Local means this browser or desktop profile, not a JSON backup. Cloud status is the last confirmation, not live sync. Shared links show cloud-saved data, not unuploaded local changes.',
    'ローカルはブラウザーまたはデスクトップのプロファイルを指し、JSON バックアップではありません。クラウドの状態は最後の確認であり、ライブ同期ではありません。共有リンクはクラウドの保存を表示し、未アップロードの変更は表示しません。')
  const content = <><span data-testid={detail ? undefined : 'document-local-state'}>{local}</span>
    <small data-testid={detail ? undefined : 'document-cloud-state'}>{cloudLabel}</small></>
  if (detail) return <div className="document-save-detail">
    <p>{content}</p>
    {linked && <p>{text('Linked cloud save', '関連するクラウドの保存')}: <strong>{linked.name}</strong>
      <br />{text('Save ID', '保存 ID')}: <code>{linked.id}</code><br />{text('Last confirmed revision', '最後に確認したリビジョン')}: <code>{linked.etag}</code></p>}
    {linked && !state.retained && <p>{text('The cloud save was confirmed, but this tab cannot retain its link after reload. Reopen the cloud library after reloading.',
      'クラウドの保存は確認しましたが、このタブでは再読み込み後まで関連付けを保持できません。再読み込み後にクラウドの一覧を開いてください。')}</p>}
    <p>{help}</p>
  </div>
  return <button type="button" className="document-save-state" data-testid="document-save-state"
    title={help} aria-label={`${text('Design save status', 'デザインの保存状態')}: ${local}. ${cloudLabel}`}
    onClick={() => window.dispatchEvent(new Event('aznet-open-cloud-sharing'))}>{content}</button>
}
