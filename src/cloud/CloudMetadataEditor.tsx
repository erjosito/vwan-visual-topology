import { useEffect, useId, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { CloudHttpError, type CloudClient } from './client'
import { cloudLimits, parseCloudMetadata, type CloudEntry, type CloudMetadata } from './contracts'

export function CloudMetadataEditor({ entry, api, onClose, onSaved }: {
  entry: CloudEntry; api: CloudClient; onClose: () => void
  onSaved: (metadata: CloudMetadata, etag: string) => Promise<void>
}) {
  const language = useLanguage(), text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null), active = useRef(true)
  const descriptionId = useId()
  const [name, setName] = useState(entry.name), [description, setDescription] = useState(entry.description ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    active.current = true
    const previous = document.activeElement
    dialog.current?.showModal()
    return () => { active.current = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="object-dialog cloud-metadata-editor" aria-labelledby="cloud-metadata-title"
    onClose={event => { event.stopPropagation(); onClose() }}
    onCancel={event => { event.stopPropagation(); if (busy) event.preventDefault() }}>
    <form onSubmit={event => {
      event.preventDefault()
      if (busy) return
      setBusy(true); setError('')
      void (async () => {
        try {
          const value = parseCloudMetadata({ name, description })
          const etag = await api.updateTopologyMetadata(entry.id, value, entry.etag)
          if (!active.current) return
          await onSaved(value, etag)
          if (active.current) onClose()
        } catch (failure) {
          if (active.current) setError(failure instanceof CloudHttpError && failure.status === 412
            ? text('This cloud save changed. Cancel and refresh the library before editing again.',
              'クラウドの保存が変更されました。キャンセルして一覧を更新してから編集してください。')
            : text('Metadata could not be saved. Your topology and local design are unchanged. Check your connection or sign in again, then retry.',
              '名前と説明を保存できませんでした。トポロジとローカル デザインは変更されていません。接続またはサインインを確認して再試行してください。'))
        } finally { if (active.current) setBusy(false) }
      })()
    }}>
      <h2 id="cloud-metadata-title">{text('Edit cloud save', 'クラウドの保存を編集')}</h2>
      <p>{text('Changes only the saved name and description, not its topology or your local design.',
        'このクラウドの保存の名前と説明だけを変更します。トポロジとローカル デザインは変更しません。')}</p>
      <p>{text('Existing shared links include the saved name and description.',
        '既存の共有リンクにも保存名と説明が含まれます。')}</p>
      <small>{entry.id}</small>
      <label>{text('Saved name', '保存名')}<input autoFocus required maxLength={cloudLimits.name} value={name}
        disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label htmlFor={descriptionId}>{text('Description (optional)', '説明 (省略可)')}</label>
      <textarea id={descriptionId} maxLength={cloudLimits.description} rows={4} value={description}
        disabled={busy} onChange={event => setDescription(event.target.value)} />
      <small>{text(`Up to ${cloudLimits.description} characters. Leave blank to clear the description.`,
        `${cloudLimits.description} 文字まで。空にすると説明を削除します。`)}</small>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy || !name.trim()}>{text(busy ? 'Saving…' : 'Save metadata', busy ? '保存中…' : '名前と説明を保存')}</button>
      <button type="button" disabled={busy} onClick={onClose}>{text('Cancel', 'キャンセル')}</button>
    </form>
  </dialog>
}
