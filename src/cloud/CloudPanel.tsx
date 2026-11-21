import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useLanguage } from '../i18n'
import { useDocumentSaveState, useWorkspaceSession } from '../workspace-context'
import { parseCloudTopology, type CloudEntry } from './contracts'
import { CloudHttpError } from './client'
import { useCloudSession } from './useCloudSession'
import './cloud-panel.css'
import { CloudSharing } from './CloudSharing'
import { DocumentSaveStatus } from './DocumentSaveStatus'
import { progressStatusLabel } from './progress-status'

export function CloudPanel({ onClose, returnFocus }: { onClose: () => void; returnFocus?: RefObject<HTMLElement | null> }) {
  const cloud = useCloudSession()!, session = useWorkspaceSession(), language = useLanguage()
  const documentState = useDocumentSaveState(), documentSave = session?.documentSave
  const text = useCallback((en: string, ja: string) => language === 'ja' ? ja : en, [language])
  const dialog = useRef<HTMLDialogElement>(null)
  const [entries, setEntries] = useState<CloudEntry[]>([])
  const [busy, setBusy] = useState(!!cloud.api)
  const [notice, setNotice] = useState('')
  const [listError, setListError] = useState('')
  const [listed, setListed] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('updated')
  const [sharing, setSharing] = useState<{ entry?: CloudEntry }>()
  const search = useRef<HTMLInputElement>(null)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const [name, setName] = useState(() => documentState?.cloud?.name ?? session?.getEditorHistory?.()?.topology.name ?? '')
  const api = cloud.api, progress = session?.cloudProgress
  useEffect(() => {
    if (!busy && restoreFocus.current) { restoreFocus.current = false; refreshButton.current?.focus() }
  }, [busy])
  const failure = useCallback((error: unknown) => {
    const status = error instanceof CloudHttpError ? error.status : undefined
    return status === 401 || status === 403
      ? text('Cloud access was denied. Sign in again; if it persists, check the API authorization configuration.',
        'クラウドへのアクセスが拒否されました。再サインインし、解決しない場合は API の認可設定を確認してください。')
      : status === 404 ? text('The cloud API is unavailable. Check the backend deployment, then refresh the cloud list.',
        'クラウド API を利用できません。バックエンドのデプロイを確認し、一覧を更新してください。')
        : status === 412 ? text('Cloud data changed. Refresh the cloud list before replacing or deleting it.',
          'クラウドのデータが変更されています。置き換えや削除の前に一覧を更新してください。')
          : status === 413 ? text('The cloud document or library limit was reached. Keep a local backup and reduce its size or delete an unused save.',
            'クラウドのサイズまたは保存件数の上限に達しました。バックアップを保持し、サイズを減らすか不要な保存を削除してください。')
            : text('Cloud storage could not be reached. Check your connection and retry. Signing in does not confirm storage availability.',
              'クラウド ストレージに接続できません。接続を確認して再試行してください。サインインの成功はストレージの利用可能性を保証しません。')
  }, [text])
  useEffect(() => {
    const previous = returnFocus?.current ?? document.activeElement
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [returnFocus])
  const refresh = useCallback(async () => {
    if (!api) return
    const ticket = documentSave?.scope(cloud.account?.id)
    try {
      const entries = await api.listTopologies()
      setEntries(entries); setListed(true); setListError('')
      documentSave?.listed(entries, ticket)
    }
    catch (error) { documentSave?.listUnavailable(ticket); setListed(false); setListError(failure(error)) }
    finally { setBusy(false) }
  }, [api, failure, documentSave, cloud.account?.id])
  useEffect(() => {
    if (!api) return
    let active = true
    const ticket = documentSave?.scope(cloud.account?.id)
    void api.listTopologies().then(values => {
      if (active) { documentSave?.listed(values, ticket); setEntries(values); setListed(true); setListError('') }
    })
      .catch(error => { if (active) { documentSave?.listUnavailable(ticket); setListed(false); setListError(failure(error)) } })
      .finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [api, failure, documentSave, cloud.account?.id])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setNotice('')
    try { await operation() }
    catch (error) { setNotice(`${text('The cloud operation did not complete. Local data is unchanged.',
      'クラウドの操作は完了しませんでした。ローカル データは変更されていません。')} ${failure(error)}`) }
    finally { setBusy(false) }
  }
  const save = async (entry?: CloudEntry) => {
    const history = session?.getEditorHistory?.()
    if (!api || !history || session?.practice || !cloud.account || !documentSave) throw new Error('Return to your design first.')
    const value = parseCloudTopology({ version: 1, name: name.trim() || history.topology.name, topology: history.topology })
    if (!window.confirm(text('Upload this topology to your private cloud library? It may contain network configuration. Do not upload secrets or confidential data without approval.',
      'このトポロジを自分のクラウドにアップロードしますか。ネットワーク構成が含まれる場合があります。許可のない機密データや秘密情報を保存しないでください。'))) return
    const id = entry?.id ?? documentSave.newCopyId()
    const ticket = documentSave.begin(id, cloud.account.id)
    if (!ticket) throw new Error('Cloud selection changed or another upload is pending.')
    let etag: string
    try {
      try { etag = await api.saveTopology(id, value, entry?.etag ?? null) }
      catch (error) {
        if (entry || !(error instanceof CloudHttpError) || error.status !== 412) throw error
        const existing = await api.getTopology(id)
        if (!existing || JSON.stringify(existing.value) !== JSON.stringify(value)) throw error
        etag = existing.etag
      }
      if (!await documentSave.confirmed(ticket, { accountId: cloud.account.id, id, name: value.name, etag }, value.topology, history.provider)) return
    } catch (error) {
      documentSave.failed(ticket, error instanceof CloudHttpError && error.status === 412)
      throw error
    }
    setEntries(values => [...values.filter(item => item.id !== id), { id, name: value.name, etag, updatedAt: '' }])
    setNotice(text('Topology saved to your cloud library.', 'トポロジをクラウドに保存しました。'))
    await refresh()
    if (entry) search.current?.focus()
  }
  const load = async (entry: CloudEntry) => {
    if (!api || !session) return
    const revision = session.getRequestVersion()
    const found = await api.getTopology(entry.id)
    if (!found || revision !== session.getRequestVersion()) throw new Error('Cloud selection changed.')
    const value = parseCloudTopology(found.value)
    if (!window.confirm(text(`Open cloud save "${entry.name}" (${entry.id}) in a new topology tab? Your current design and the cloud save are kept unchanged.`,
      `クラウドの保存「${entry.name}」(${entry.id}) を新しいトポロジ タブで開きますか。現在のデザインとクラウドの保存は変更しません。`))) return
    await session.openDocument(value.topology, { accountId: cloud.account!.id, id: entry.id, name: value.name, etag: found.etag })
    onClose()
  }
  const overwrite = (entry: CloudEntry) => {
    if (window.confirm(text(`Overwrite cloud save "${entry.name}" (${entry.id}) with the current design? The cloud copy will change; the local workspace is kept.`,
      `クラウドの保存「${entry.name}」(${entry.id}) を現在のデザインで上書きしますか。クラウドの内容を変更し、ローカルのワークスペースは保持します。`))) void run(() => save(entry))
  }
  const linked = documentState?.cloud?.accountId === cloud.account?.id ? documentState?.cloud : undefined
  const saving = busy || documentState?.operation === 'saving'
  const status = progress?.status
  const matching = entries.filter(entry => entry.name.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)))
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name, language)
      : (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)) || a.id.localeCompare(b.id))
  const updated = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? text('Not available', '不明') : date.toLocaleString(language)
  }
  return <dialog ref={dialog} className="object-dialog cloud-panel" aria-labelledby="cloud-account-title" onClose={onClose}>
    <header role="presentation" className="row dialog-heading"><h2 id="cloud-account-title">{text('Cloud account', 'クラウド アカウント')}</h2>
      <button type="button" onClick={onClose}>{text('Close', '閉じる')}</button></header>
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
      <section><h3>{text('Current design', '現在のデザイン')}</h3>
        <DocumentSaveStatus detail />
        {linked && <button type="button" disabled={saving || !!session?.practice || ['changed', 'missing', 'checking'].includes(linked.state)}
          onClick={() => overwrite({ ...linked, updatedAt: '' })}>
          {text('Update linked cloud save', '関連するクラウドの保存を更新')}
        </button>}
        <label>{text('Cloud topology name', 'クラウドのトポロジ名')}<input maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <button type="button" disabled={saving || !!session?.practice || !session?.getEditorHistory?.()} onClick={() => { void run(() => save()) }}>
          {text('Save as new cloud copy', '新しいクラウドのコピーとして保存')}
        </button>
        <p>{text('Update changes the linked cloud record. Save as new cloud copy creates a different record. Neither happens automatically. Shared links show the saved cloud version, not local changes.',
          '更新は関連するクラウドの保存を変更します。新しいコピーとして保存すると別の保存を作成します。どちらも自動では実行しません。共有リンクはクラウドの保存を表示し、ローカルの変更は表示しません。')}</p>
      </section>
      <section><h3>{text('Learning progress', '学習の進捗')}</h3>
        <p>{text('Your account uses its own local cache and automatically synchronizes curriculum history while signed in. Awards remain self-reported, not verified certification. Sign-out does not erase this device cache.',
          'アカウント別のローカル キャッシュを使用し、サインイン中は学習履歴を自動で同期します。達成記録は自己申告であり認定ではありません。サインアウトしても端末のキャッシュは削除されません。')}</p>
        <p role="status" data-testid="cloud-progress-status">{progressStatusLabel(status, language)}</p>
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
        <p id="cloud-library-help">{text('Load in new tab opens a cloud save without replacing your current design. Overwrite cloud save uploads your current design to that save. Delete removes only the cloud save. Nothing is deployed to Azure.',
          '新しいタブに読み込むと、現在のデザインを置き換えずに保存内容を開きます。クラウドの保存を上書きすると、現在のデザインをアップロードします。削除はクラウドの保存だけを削除します。Azure へのデプロイは行いません。')}</p>
        <button ref={refreshButton} type="button" disabled={busy} onClick={() => { setBusy(true); setNotice(''); void refresh() }}>{text('Refresh cloud topologies', 'クラウドの一覧を更新')}</button>
        {listError && <p role="alert">{listError}</p>}
        {busy && <p role="status">{text('Cloud operation in progress…', 'クラウドの操作中…')}</p>}
        {!busy && listed && !entries.length && <p>{text('No saved cloud topologies.', 'クラウドに保存されたトポロジはありません。')}</p>}
        {!!entries.length && <>
          <div className="cloud-library-tools">
            <label>{text('Find cloud saves', 'クラウドの保存を検索')}<input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label>{text('Sort cloud saves', 'クラウドの保存の並べ替え')}<select value={sort} onChange={event => setSort(event.target.value)}>
              <option value="updated">{text('Recently updated', '更新日時が新しい順')}</option>
              <option value="name">{text('Name', '名前順')}</option>
            </select></label>
          </div>
          <p role="status">{text(`${matching.length} of ${entries.length} cloud saves`, `${entries.length} 件中 ${matching.length} 件の保存`)}</p>
          {!matching.length && <p>{text('No matching cloud saves. Change your search.', '一致する保存はありません。検索条件を変更してください。')}</p>}
          {!!matching.length && <div className="cloud-library-scroll" tabIndex={0} role="region" aria-label={text('Cloud saves', 'クラウドの保存')} aria-describedby="cloud-library-help">
            <table className="cloud-library" role="table"><caption>{text('Saved configurations', '保存済みの構成')}</caption>
              <thead><tr role="row"><th scope="col" role="columnheader">{text('Configuration', '構成')}</th><th scope="col" role="columnheader">{text('Last updated', '最終更新')}</th><th scope="col" role="columnheader">{text('Actions', '操作')}</th></tr></thead>
              <tbody>{matching.map(entry => <tr role="row" key={entry.id} data-cloud-save-id={entry.id}>
                <th scope="row" role="rowheader"><h4>{entry.name}</h4><small>{text('Save ID', '保存 ID')}: {entry.id}</small></th>
                <td role="cell"><time dateTime={entry.updatedAt || undefined}>{updated(entry.updatedAt)}</time></td>
                <td role="cell"><div className="cloud-library-actions">
                  <button type="button" aria-label={`${text('Load in new tab', '新しいタブに読み込む')} ${entry.name} (${entry.id})`} disabled={busy || !!session?.practice}
                    onClick={() => { void run(() => load(entry)) }}>{text('Load in new tab', '新しいタブに読み込む')}</button>
                  <button type="button" aria-label={`${text('Overwrite cloud save', 'クラウドの保存を上書き')} ${entry.name} (${entry.id})`} disabled={saving || !!session?.practice}
                    onClick={() => overwrite(entry)}>{text('Overwrite cloud save', 'クラウドの保存を上書き')}</button>
                  <button type="button" aria-label={`${text('Share saved version', '保存したバージョンを共有')} ${entry.name} (${entry.id})`} disabled={busy || !!session?.practice}
                    onClick={() => setSharing({ entry })}>{text('Share saved version', '保存したバージョンを共有')}</button>
                  <button type="button" aria-label={`${text('Delete', '削除')} ${entry.name} (${entry.id})`} disabled={busy || !!session?.practice} onClick={() => {
                    if (window.confirm(text(`Permanently delete cloud save "${entry.name}" (${entry.id})? Your current local design is kept.`,
                      `クラウドの保存「${entry.name}」(${entry.id}) を完全に削除しますか。現在のローカル デザインは保持します。`))) {
                      restoreFocus.current = true
                      void run(async () => { await api.deleteTopology(entry.id, entry.etag); await refresh() })
                    }
                  }}>{text('Delete', '削除')}</button>
                </div></td>
              </tr>)}</tbody>
            </table>
          </div>}
        </>}
      </section>
      <button type="button" disabled={busy || !!session?.practice} onClick={() => setSharing({})}>{text('Manage shared links', '共有リンクを管理')}</button>
      {sharing && <CloudSharing api={api} entries={entries} entry={sharing.entry && entries.find(value => value.id === sharing.entry!.id)} refreshed={refresh} />}
    </>}
    {notice && <p role="status">{notice}</p>}
  </dialog>
}
