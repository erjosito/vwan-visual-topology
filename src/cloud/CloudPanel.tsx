import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { parseCloudTopology, type CloudEntry } from './contracts'
import { useCloudSession } from './useCloudSession'

export function CloudPanel({ onClose }: { onClose: () => void }) {
  const cloud = useCloudSession()!, session = useWorkspaceSession(), language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null)
  const [entries, setEntries] = useState<CloudEntry[]>([])
  const [busy, setBusy] = useState(!!cloud.api)
  const [notice, setNotice] = useState('')
  const [name, setName] = useState(() => session?.getEditorHistory?.()?.topology.name ?? '')
  const draftId = useRef(crypto.randomUUID())
  const api = cloud.api, progress = session?.cloudProgress
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  const refresh = useCallback(async () => {
    if (!api) return
    try { setEntries(await api.listTopologies()); setNotice('') }
    catch { setNotice(language === 'ja' ? 'クラウドの一覧を取得できません。サインインと接続を確認してください。' : 'Cloud list is unavailable. Check your session and connection, then retry.') }
    finally { setBusy(false) }
  }, [api, language])
  useEffect(() => {
    if (!api) return
    let active = true
    void api.listTopologies().then(values => { if (active) setEntries(values) })
      .catch(() => { if (active) setNotice(language === 'ja' ? 'クラウドの一覧を取得できません。再試行してください。' : 'Cloud list is unavailable. Retry when connected.') })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [api, language])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setNotice('')
    try { await operation() }
    catch { setNotice(text('The cloud operation did not complete. Local data is unchanged. Check your connection/session or reload a changed cloud version before retrying.',
      'クラウドの操作は完了しませんでした。ローカル データは変更されていません。接続、サインイン、クラウドの版を確認して再試行してください。')) }
    finally { setBusy(false) }
  }
  const save = async (entry?: CloudEntry) => {
    const history = session?.getEditorHistory?.()
    if (!api || !history || session?.practice) throw new Error('Return to your design first.')
    const value = parseCloudTopology({ version: 1, name: name.trim() || history.topology.name, topology: history.topology })
    if (!window.confirm(text('Upload this topology to your private cloud library? It may contain network configuration. Do not upload secrets or confidential data without approval.',
      'このトポロジを自分のクラウドにアップロードしますか。ネットワーク構成が含まれる場合があります。許可のない機密データや秘密情報を保存しないでください。'))) return
    await api.saveTopology(entry?.id ?? draftId.current, value, entry?.etag ?? null)
    if (!entry) draftId.current = crypto.randomUUID()
    setEntries(await api.listTopologies())
    setNotice(text('Topology saved to your cloud library.', 'トポロジをクラウドに保存しました。'))
  }
  const load = async (entry: CloudEntry) => {
    if (!api || !session) return
    const revision = session.getRequestVersion()
    const found = await api.getTopology(entry.id)
    if (!found || revision !== session.getRequestVersion()) throw new Error('Cloud selection changed.')
    const value = parseCloudTopology(found.value)
    if (!window.confirm(text('Load this cloud topology into the active workspace? Export any unsaved design first.',
      'クラウドのトポロジを現在のワークスペースに読み込みますか。未保存のデザインは先にエクスポートしてください。'))) return
    await session.openDocument(value.topology)
    onClose()
  }
  const status = progress?.status
  return <dialog ref={dialog} className="object-dialog" aria-labelledby="cloud-account-title" onClose={onClose}>
    <header className="row dialog-heading"><h2 id="cloud-account-title">{text('Cloud account', 'クラウド アカウント')}</h2>
      <button type="button" onClick={onClose}>{text('Close cloud account', 'クラウド アカウントを閉じる')}</button></header>
    <p>{text('Optional personal Microsoft sign-in. Anonymous simulation and local files remain available. No Azure resource access is requested.',
      '個人用 Microsoft アカウントで任意にサインインできます。匿名での利用とローカル ファイルは引き続き使えます。Azure リソースへのアクセスは要求しません。')}</p>
    {cloud.account ? <p>{text('Signed in as', 'サインイン中')}: <strong>{cloud.account.name}</strong></p>
      : <p>{text('Not signed in. Signing in does not upload local designs or import anonymous learning history.',
        '未サインインです。サインインだけではローカルのデザインや匿名の学習履歴をアップロードしません。')}</p>}
    {cloud.status === 'error' && <p role="alert">{text('Microsoft sign-in did not complete. Your local workspace is unchanged. Retry from this button.',
      'Microsoft サインインが完了しませんでした。ローカルのワークスペースは変更されていません。再試行してください。')}</p>}
    <button type="button" disabled={busy || cloud.status === 'connecting' || !!session?.practice} onClick={() => { void cloud.connect() }}>
      {cloud.account ? text('Sign in again / switch account', '再サインイン / アカウントの切り替え') : text('Sign in with Microsoft', 'Microsoft でサインイン')}
    </button>
    {cloud.account && <button type="button" disabled={!!session?.practice} onClick={() => { void cloud.disconnect() }}>
      {text('Sign out of this app', 'このアプリからサインアウト')}
    </button>}
    {session?.practice && <p>{text('Return to your design before switching accounts or saving a topology.', 'アカウントの切り替えや保存の前に、自分のデザインに戻ってください。')}</p>}
    {api && <>
      <section><h3>{text('Learning progress', '学習の進捗')}</h3>
        <p>{text('Your account uses its own local cache and automatically synchronizes curriculum history while signed in. Awards remain self-reported, not verified certification. Sign-out does not erase this device cache.',
          'アカウント別のローカル キャッシュを使用し、サインイン中は学習履歴を自動で同期します。達成記録は自己申告であり認定ではありません。サインアウトしても端末のキャッシュは削除されません。')}</p>
        <p role="status" data-testid="cloud-progress-status">{text('Cloud progress', 'クラウドの進捗')}: {status === 'synced'
          ? text('Synced', '同期済み') : status === 'saving' ? text('Saving', '保存中') : status === 'conflict'
            ? text('Conflict: no cloud overwrite was made', '競合: クラウドは上書きしていません') : status === 'offline'
              ? text('Not synced: keep a local backup and retry', '未同期: バックアップして再試行してください') : text('Loading', '読み込み中')}</p>
        <button type="button" disabled={busy || status === 'loading' || status === 'saving'} onClick={() => { void run(async () => { await progress?.refresh() }) }}>
          {text('Refresh cloud progress', 'クラウドの進捗を再取得')}
        </button>
        {status === 'conflict' && <>
          <p>{text('The cloud and this device differ. Download a learning backup before choosing which history to keep.',
            'クラウドと端末の履歴が異なります。残す履歴を選ぶ前に、学習のバックアップを保存してください。')}</p>
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(text('Replace this account cache with cloud history? Export a learning backup first.', 'このアカウントのキャッシュをクラウドの履歴に置き換えますか。先にバックアップしてください。'))) {
              void run(async () => { await progress?.refresh('cloud') })
            }
          }}>{text('Use cloud history', 'クラウドの履歴を使用')}</button>
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(text('Replace cloud history with this account cache? This affects your other devices.', 'クラウドの履歴をこのアカウントのキャッシュで置き換えますか。他の端末にも影響します。'))) {
              void run(async () => { await progress?.refresh('local') })
            }
          }}>{text('Use this account cache', 'このアカウントのキャッシュを使用')}</button>
        </>}
        {progress?.hasAnonymousProgress && <div>
          <p>{text('Anonymous learning history is still separate. Import it only if it belongs to you.',
            '匿名の学習履歴は別に保持されています。自分の履歴である場合だけ取り込んでください。')}</p>
          <button type="button" disabled={busy || !status || ['loading', 'saving', 'conflict'].includes(status)} onClick={() => {
            if (window.confirm(text("Import this device's anonymous curriculum history into your account and upload it? The anonymous original will be kept.",
              'この端末の匿名の学習履歴をアカウントに取り込み、アップロードしますか。匿名の原本は保持します。'))) {
              void run(async () => { if (!await progress.importAnonymous()) throw new Error('Import unavailable.') })
            }
          }}>{text('Import anonymous progress', '匿名の進捗を取り込む')}</button>
        </div>}
      </section>
      <section><h3>{text('Cloud topology library', 'クラウド トポロジ ライブラリ')}</h3>
        <p>{text('Topologies are uploaded only when you explicitly save. Loading does not deploy anything to Azure.',
          'トポロジは明示的に保存した場合だけアップロードします。読み込んでも Azure にはデプロイしません。')}</p>
        <label>{text('Cloud topology name', 'クラウドのトポロジ名')}<input maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <button type="button" disabled={busy || !!session?.practice || !session?.getEditorHistory?.()} onClick={() => { void run(() => save()) }}>
          {text('Save current topology to cloud', '現在のトポロジをクラウドに保存')}
        </button>
        <button type="button" disabled={busy} onClick={() => { setBusy(true); void refresh() }}>{text('Refresh cloud topologies', 'クラウドの一覧を更新')}</button>
        {!busy && !entries.length && <p>{text('No saved cloud topologies.', 'クラウドに保存されたトポロジはありません。')}</p>}
        {entries.map(entry => <section key={entry.id}><h4>{entry.name}</h4>
          <p>{entry.updatedAt}</p>
          <button type="button" disabled={busy || !!session?.practice} onClick={() => { void run(() => load(entry)) }}>{text('Load', '読み込む')} {entry.name}</button>
          <button type="button" disabled={busy || !!session?.practice} onClick={() => {
            if (window.confirm(text('Replace this saved cloud topology with the current design?', '保存済みのクラウド トポロジを現在のデザインで置き換えますか。'))) void run(() => save(entry))
          }}>{text('Replace', '置き換える')} {entry.name}</button>
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(text('Permanently delete this cloud topology? Your current local design is kept.', 'このクラウド トポロジを完全に削除しますか。現在のローカル デザインは保持します。'))) {
              void run(async () => { await api.deleteTopology(entry.id, entry.etag); setEntries(await api.listTopologies()) })
            }
          }}>{text('Delete', '削除')} {entry.name}</button>
        </section>)}
      </section>
    </>}
    {notice && <p role="status">{notice}</p>}
  </dialog>
}
