import { useEffect, useRef, useState } from 'react'
import { useLanguage } from './i18n'
import { DestinationDialog } from './DocumentActions'
import type { WorkspaceDocument } from './workspace-documents'

export function CloseDocumentsDialog({ documents, onClose, onDiscard }: {
  documents: WorkspaceDocument[]; onClose: () => void; onDiscard: () => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef(document.activeElement)
  const [choosing, setChoosing] = useState<WorkspaceDocument>()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (choosing) return
    const previous = returnFocus.current
    const element = dialog.current
    element?.showModal()
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [choosing])
  const save = async () => {
    setBusy(true); setNotice('')
    try {
      for (const document of documents) {
        if (document.commands?.canClose()) continue
        const result = await document.commands?.save()
        if (result === 'needs-destination') { setChoosing(document); return }
        if (result !== 'saved' || !document.commands?.canClose()) {
          setNotice(document.commands?.getSnapshot().error ?? text(
            'The latest edits are not confirmed saved. Save again or explicitly discard them.',
            '最新の編集の保存を確認できません。もう一度保存するか、明示的に破棄してください。'))
          return
        }
      }
      onDiscard()
    } finally { setBusy(false) }
  }
  if (choosing?.commands) return <DestinationDialog commands={choosing.commands}
    name={choosing.history?.topology.name ?? 'Topology'} onClose={() => {
      const saved = choosing.commands?.canClose()
      setChoosing(undefined)
      if (saved) void save()
    }}
    onResult={result => {
      if (result === 'downloaded') setNotice(text(
        'A download cannot confirm a durable save. Keep the tab open or explicitly discard it after checking your file.',
        'ダウンロードでは保存を確認できません。ファイルを確認してタブを保持するか、明示的に破棄してください。'))
    }} />
  return <dialog ref={dialog} className="object-dialog" aria-labelledby="close-documents-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id="close-documents-title">{text('Save changes before closing?', '閉じる前に変更を保存しますか?')}</h2>
    <p>{text('Profile recovery is not a saved file or cloud artifact. Choose Save, Discard, or Cancel.',
      'プロファイルの復元用コピーはファイルやクラウドへの保存ではありません。保存、破棄、キャンセルを選択してください。')}</p>
    <p>{documents.map(document => document.history?.topology.name ?? 'Topology').join(', ')}</p>
    {notice && <p role="alert">{notice}</p>}
    <button type="button" disabled={busy} onClick={() => { void save() }}>{text('Save and close', '保存して閉じる')}</button>
    <button type="button" disabled={busy} onClick={onDiscard}>{text('Discard and close', '破棄して閉じる')}</button>
    <button type="button" disabled={busy} autoFocus onClick={onClose}>{text('Cancel', 'キャンセル')}</button>
  </dialog>
}
