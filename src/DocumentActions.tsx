import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from './i18n'
import { useWorkspaceSession } from './workspace-context'
import { useCloudSession } from './cloud/useCloudSession'
import type { createDocumentCommands, CommandResult } from './document-commands'
import './document-actions.css'

const CloudPanel = lazy(() => import('./cloud/CloudPanel').then(module => ({ default: module.CloudPanel })))
type Commands = ReturnType<typeof createDocumentCommands>
const noSubscribe = () => () => {}
const noSnapshot = () => undefined

export function DocumentArtifactStatus() {
  const commands = useWorkspaceSession()?.artifactCommands, language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const state = useSyncExternalStore(commands?.subscribe ?? noSubscribe, commands?.getSnapshot ?? noSnapshot)
  if (!state) return null
  const label = state.operation === 'saving' ? text('Saving…', '保存中…')
    : state.operation === 'failed' ? text('Save failed', '保存に失敗')
      : state.revision === 'matches' ? text('Saved', '保存済み') : text('Unsaved changes', '未保存の変更')
  const destination = state.destination?.kind === 'file' ? state.destination.location : state.destination?.name
  return <details className="presentation-group document-artifact-details">
    <summary title={destination} aria-label={`${text('Document save status', 'ドキュメントの保存状態')}: ${label}${state.destination ? ` · ${state.destination.name}` : ''}`}>
      <span className="document-artifact-status" aria-live="polite">{label}
      {state.destination && ` · ${state.destination.name}`}
      {state.notice?.kind === 'downloaded' && ` · ${text('Download unconfirmed', 'ダウンロード未確認')}`}</span></summary>
    <div className="presentation-group-content">
      <p>{label}{state.destination
        && ` · ${state.destination.kind === 'cloud' ? text('Cloud', 'クラウド') : text('File', 'ファイル')}: ${destination}`}</p>
      <p>{text('Profile recovery is separate from an explicitly saved file or cloud artifact.',
        'プロファイルの復元用コピーと、ファイルやクラウドへの明示的な保存は異なります。')}</p>
      {state.notice && <p role="status">{state.notice.kind === 'saved'
        ? text(`Saved to ${state.notice.location ?? state.notice.name}`, `${state.notice.location ?? state.notice.name} に保存しました`)
        : text('Copy downloaded; final location and overwrite are unconfirmed.', 'コピーをダウンロードしました。保存先と上書きは未確認です。')}</p>}
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  </details>
}

export function DestinationDialog({ commands, name: initialName, onClose, onResult }: {
  commands: Commands; name: string; onClose: () => void; onResult?: (result: CommandResult) => void
}) {
  const language = useLanguage(), cloud = useCloudSession()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<Element | null>(null)
  const [name, setName] = useState(initialName)
  const [target, setTarget] = useState<'file' | 'cloud' | 'download'>('file')
  const state = useSyncExternalStore(commands.subscribe, commands.getSnapshot)
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
      const filename = Array.from(name.trim().replace(/\.json$/i, '')).filter(character => character.charCodeAt(0) >= 32)
        .join('').replace(/[\\/:*?"<>|]/g, '-').slice(0, 115).trim() || 'topology'
      const choice = target !== 'cloud' ? { kind: target === 'file' ? 'choose-file' as const : 'download-copy' as const,
        name: `${filename}.json` }
        : { kind: 'choose-cloud' as const, name: name.trim() || initialName, accountId: cloud!.account!.id }
      void commands.saveAs(choice).then(result => {
        onResult?.(result)
        if (result === 'saved' || result === 'downloaded') onClose()
      })
    }}>
      <h2 id="document-destination-title">{text('Save As', '名前を付けて保存')}</h2>
      <label>{text('Destination', '保存先')} <select value={target} disabled={state.operation === 'saving'}
        onChange={event => setTarget(event.target.value as 'file' | 'cloud' | 'download')}>
        <option value="file">{text('File', 'ファイル')}</option>
        <option value="cloud" disabled={!cloud?.api}>{text('Private cloud library', '自分のクラウド ライブラリ')}</option>
        <option value="download">{text('Download copy (unconfirmed)', 'コピーをダウンロード (未確認)')}</option>
      </select></label>
      <label>{text('Name', '名前')} <input value={name} maxLength={120} required disabled={state.operation === 'saving'}
        onChange={event => setName(event.target.value)} /></label>
      <p>{target === 'cloud' ? text('Creates a new private cloud entry. Upload consent is requested before writing.',
        '自分のクラウドに新しい保存を作成します。書き込みの前にアップロードの同意を確認します。')
        : text('Choose a file. Unsupported browsers download a copy; its final location and overwrite cannot be confirmed.',
          'ファイルを選択します。未対応のブラウザーではコピーをダウンロードします。保存先と上書きは確認できません。')}</p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={state.operation === 'saving' || target === 'cloud' && !cloud?.api}>{text('Save', '保存')}</button>
      <button type="button" disabled={state.operation === 'saving'} onClick={onClose}>{text('Cancel', 'キャンセル')}</button>
    </form>
  </dialog>, document.body)
}

export function DocumentActions() {
  const session = useWorkspaceSession(), language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const commands = session?.artifactCommands
  const state = useSyncExternalStore(commands?.subscribe ?? noSubscribe, commands?.getSnapshot ?? noSnapshot)
  const [dialog, setDialog] = useState<'save' | 'load' | 'cloud'>()
  const [error, setError] = useState('')
  const loadDialog = useRef<HTMLDialogElement>(null)
  const loadReturnFocus = useRef<Element | null>(null)
  const save = async () => {
    if (!commands) return
    const result = await commands.save()
    if (result === 'needs-destination') setDialog('save')
  }
  useEffect(() => {
    if (dialog !== 'load') return
    const focused = document.activeElement
    const previous = loadReturnFocus.current ?? focused?.closest('details')?.querySelector('summary') ?? focused
    loadReturnFocus.current = previous
    loadDialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [dialog])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (!commands || document.querySelector('dialog[open]') || event.repeat) return
      if (event.shiftKey) setDialog('save')
      else void save()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  return <>
    <button type="button" disabled={!commands || state?.operation === 'saving'} onClick={() => setDialog('load')}>{text('Load', '読み込み')}</button>
    <button type="button" disabled={!commands || state?.operation === 'saving'} onClick={() => { void save() }}
      aria-keyshortcuts="Control+s Meta+s">{text('Save', '保存')}</button>
    <button type="button" disabled={!commands || state?.operation === 'saving'} onClick={() => setDialog('save')}
      aria-keyshortcuts="Control+Shift+s Meta+Shift+s">{text('Save As', '名前を付けて保存')}</button>
    {(state?.error || error) && <span role="alert">{state?.error || error}</span>}
    {dialog === 'save' && commands && <DestinationDialog commands={commands}
      name={session?.getEditorHistory?.()?.topology.name ?? 'Topology'} onClose={() => setDialog(undefined)} />}
    {dialog === 'cloud' && createPortal(<Suspense fallback={null}><CloudPanel onClose={() => setDialog(undefined)} /></Suspense>, document.body)}
    {dialog === 'load' && createPortal(<dialog ref={loadDialog} className="object-dialog" aria-labelledby="document-load-title"
      onClose={() => setDialog(undefined)}>
      <h2 id="document-load-title">{text('Load topology', 'トポロジの読み込み')}</h2>
      <p>{text('Opens another tab. Your current design stays unchanged.', '別のタブで開きます。現在のデザインは変更しません。')}</p>
      <button type="button" onClick={() => {
        setDialog(undefined); setError('')
        void session?.loadFile?.().catch(error => setError(error instanceof Error ? error.message : text('Load failed', '読み込みに失敗')))
      }}>{text('Load file', 'ファイルを読み込み')}</button>
      <button type="button" onClick={() => setDialog('cloud')}>{text('Cloud library / sign in', 'クラウド ライブラリ / サインイン')}</button>
      <button type="button" onClick={() => setDialog(undefined)}>{text('Cancel', 'キャンセル')}</button>
    </dialog>, document.body)}
  </>
}
