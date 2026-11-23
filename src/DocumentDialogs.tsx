import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from './i18n'
import { useCloudSession } from './cloud/useCloudSession'
import { cloudLimits } from './cloud/contracts'
import { CloudSavePicker, type CloudSaveSelection } from './cloud/CloudSavePicker'
import type { createDocumentCommands, CommandResult } from './document-commands'

export function DestinationDialog({ commands, name: initialName, onClose, onResult }: {
  commands: ReturnType<typeof createDocumentCommands>; name: string; onClose: () => void; onResult?: (result: CommandResult) => void
}) {
  const language = useLanguage(), cloud = useCloudSession()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState('')
  const descriptionId = useId()
  const [selection, setSelection] = useState<CloudSaveSelection>()
  const [target, setTarget] = useState<'file' | 'cloud' | 'download'>('file')
  const state = useSyncExternalStore(commands.subscribe, commands.getSnapshot)
  const validCloud = !!selection && selection.accountId === cloud?.account?.id && selection.api === cloud?.api
    && (!!selection.entry || !selection.full)
  const existing = target === 'cloud' && validCloud ? selection?.entry : undefined
  const busy = state.operation === 'saving'
  useEffect(() => {
    const focused = document.activeElement
    const previous = returnFocus.current ?? focused?.closest('details')?.querySelector('summary') ?? focused
    returnFocus.current = previous
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={dialog} className="object-dialog document-command-dialog" aria-labelledby="document-destination-title" onClose={onClose}
    onCancel={event => { if (state.operation === 'saving') event.preventDefault() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (busy || target === 'cloud' && !validCloud) return
      if (existing && !window.confirm(text(
        `Overwrite cloud save "${existing.name}" (${existing.id}) with the current topology? This uploads your design, does not load the cloud save locally, and keeps its saved name and description.`,
        `クラウドの保存「${existing.name}」(${existing.id}) を現在のトポロジで上書きしますか。デザインをアップロードし、クラウドの保存はローカルに読み込みません。保存名と説明は保持します。`))) return
      const filename = Array.from(name.trim().replace(/\.json$/i, '')).filter(character => character.charCodeAt(0) >= 32)
        .join('').replace(/[\\/:*?"<>|]/g, '-').slice(0, 115).trim() || 'topology'
      const choice = target !== 'cloud' ? { kind: target === 'file' ? 'choose-file' as const : 'download-copy' as const,
        name: `${filename}.json` }
        : existing ? { kind: 'cloud' as const, id: existing.id, name: existing.name, etag: existing.etag, accountId: selection!.accountId }
          : { kind: 'choose-cloud' as const, name: name.trim() || initialName, description, accountId: selection!.accountId }
      void commands.saveAs(choice).then(result => {
        onResult?.(result)
        if (result === 'saved' || result === 'downloaded') onClose()
      })
    }}>
      <h2 id="document-destination-title">{text('Save As', '名前を付けて保存')}</h2>
      <label>{text('Destination', '保存先')} <select value={target} disabled={state.operation === 'saving'}
        onChange={event => setTarget(event.target.value as 'file' | 'cloud' | 'download')}>
        <option value="file">{text('File', 'ファイル')}</option>
        <option value="cloud" disabled={!cloud?.configured}>{text('Private cloud library', '自分のクラウド ライブラリ')}</option>
        <option value="download">{text('Download copy (unconfirmed)', 'コピーをダウンロード (未確認)')}</option>
      </select></label>
      {target === 'cloud' && <>
        {!cloud?.api && <p>{text('Sign in with your personal Microsoft account to choose cloud saves. Signing in does not upload this topology.',
          '個人用 Microsoft アカウントでサインインしてクラウドの保存を選択してください。サインインだけではトポロジをアップロードしません。')}</p>}
        <button type="button" disabled={busy || !cloud?.configured || cloud.status === 'connecting'} onClick={() => { void cloud?.connect() }}>
          {cloud?.account ? text('Sign in again / switch account', '再サインイン / アカウントの切り替え') : text('Sign in with Microsoft', 'Microsoft でサインイン')}
        </button>
        {cloud?.status === 'error' && <p role="alert">{text('Sign-in did not complete. Retry or save a local copy.',
          'サインインが完了しませんでした。再試行するか、ローカルのコピーを保存してください。')}</p>}
        {cloud?.api && cloud.account && <CloudSavePicker key={cloud.account.id} api={cloud.api} accountId={cloud.account.id}
          disabled={busy} onSelect={setSelection} />}
      </>}
      {!existing && <>
        <label>{text('Name', '名前')} <input value={name} maxLength={120} required disabled={busy}
          onChange={event => setName(event.target.value)} /></label>
        {target === 'cloud' && <>
          <label htmlFor={descriptionId}>{text('Description (optional)', '説明 (省略可)')}</label>
          <textarea id={descriptionId} value={description} maxLength={cloudLimits.description} rows={3} disabled={busy}
            onChange={event => setDescription(event.target.value)} />
        </>}
      </>}
      {existing && <p role="status">{text('Selected cloud save to overwrite', '上書きするクラウドの保存')}: <strong>{existing.name}</strong> ({existing.id}).
        {' '}{text('The current topology will be uploaded. Its saved name and description are kept.',
          '現在のトポロジをアップロードします。保存名と説明は保持します。')}</p>}
      <p>{target === 'cloud' ? text('Choose a new save or an existing cloud destination. Nothing is written until you Save and confirm upload consent.',
        '新しい保存または既存のクラウドの保存先を選択します。保存とアップロードの同意を確認するまで書き込みません。')
        : text('Choose a file. Unsupported browsers download a copy; its final location and overwrite cannot be confirmed.',
          'ファイルを選択します。未対応のブラウザーではコピーをダウンロードします。保存先と上書きは確認できません。')}</p>
      {state.error && <p role="alert">{target === 'cloud' && /Cloud data changed/.test(state.error)
        ? text('The selected cloud save changed. Refresh and select it again before overwriting. Your local design is unchanged.',
          '選択したクラウドの保存が変更されました。更新して再選択してから上書きしてください。ローカルのデザインは変更していません。') : state.error}</p>}
      <button type="submit" disabled={busy || target === 'cloud' && !validCloud || !existing && !name.trim()}>{text('Save', '保存')}</button>
      <button type="button" disabled={state.operation === 'saving'} onClick={onClose}>{text('Cancel', 'キャンセル')}</button>
    </form>
  </dialog>, document.body)
}

export function LoadDialog({ onClose, onLoad, onCloud }: {
  onClose: () => void; onLoad: () => void; onCloud: () => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<Element | null>(null)
  useEffect(() => {
    const focused = document.activeElement
    const previous = returnFocus.current ?? focused?.closest('details')?.querySelector('summary') ?? focused
    returnFocus.current = previous
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return createPortal(<dialog ref={dialog} className="object-dialog" aria-labelledby="document-load-title" onClose={onClose}>
    <h2 id="document-load-title">{text('Load topology', 'トポロジの読み込み')}</h2>
    <p>{text('Opens another tab. Your current design stays unchanged.', '別のタブで開きます。現在のデザインは変更しません。')}</p>
    <button type="button" onClick={onLoad}>{text('Load file', 'ファイルを読み込み')}</button>
    <button type="button" onClick={onCloud}>{text('Cloud library / sign in', 'クラウド ライブラリ / サインイン')}</button>
    <button type="button" onClick={onClose}>{text('Cancel', 'キャンセル')}</button>
  </dialog>, document.body)
}
