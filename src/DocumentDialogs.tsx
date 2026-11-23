import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from './i18n'
import { useCloudSession } from './cloud/useCloudSession'
import { cloudLimits } from './cloud/contracts'
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
        : { kind: 'choose-cloud' as const, name: name.trim() || initialName, description, accountId: cloud!.account!.id }
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
      {target === 'cloud' && <label>{text('Description (optional)', '説明 (省略可)')} <textarea value={description}
        maxLength={cloudLimits.description} rows={3} disabled={state.operation === 'saving'}
        onChange={event => setDescription(event.target.value)} /></label>}
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
