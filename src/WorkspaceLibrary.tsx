import { useEffect, useRef } from 'react'
import { t, useLanguage } from './i18n'
import { workspaceOriginals, workspaceStorageKeys, type WorkspaceProvider } from './workspace-session'

function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  URL.revokeObjectURL(url)
}

export function WorkspaceLibrary({ required, notice, onOpen, onNew, onClose, onResumePractice }: {
  required: boolean
  notice?: string
  onOpen: (provider: WorkspaceProvider) => void
  onNew: () => void
  onClose: () => void
  onResumePractice?: () => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement)
  const choices = (Object.keys(workspaceStorageKeys) as WorkspaceProvider[]).flatMap((provider) => {
    try {
      const raw = localStorage.getItem(workspaceStorageKeys[provider])
      if (raw === null) return []
      let name = text('Unreadable saved design', '読み取れない保存済みデザイン')
      try { const parsed = JSON.parse(raw); name = String((parsed.topology ?? parsed).name ?? name).slice(0, 120) } catch {}
      return [{ provider, raw, name }]
    } catch { return [] }
  })
  let originals: ReturnType<typeof workspaceOriginals> = []
  let archiveError = ''
  try { originals = workspaceOriginals(localStorage) } catch { archiveError = text('Saved originals are unavailable. Existing storage has not been replaced.', '保存済みの原本を読み取れません。既存のストレージは置き換えられていません。') }
  useEffect(() => {
    const previous = opener.current
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="object-dialog" aria-labelledby="workspace-library-title"
    onCancel={(event) => { if (required) event.preventDefault(); else onClose() }} onClose={() => { if (!required) onClose() }}>
    <header className="row dialog-heading"><h2 id="workspace-library-title">{text('Workspace', 'ワークスペース')}</h2>
      {!required && <button type="button" onClick={onClose}>{text('Close', '閉じる')}</button>}</header>
    <p>{text('One active design. New workspaces support Virtual WAN and classic networking together. Saved native designs keep their original editor and routing provider without conversion.', '編集するデザインは1つです。新しいワークスペースでは Virtual WAN と従来のネットワークを併用できます。既存のデザインは変換せず、元のエディターとルーティング処理で開きます。')}</p>
    {notice && <p role="alert">{t(notice)}</p>}
    {required && <p role="status">{text('Choose a saved design or start empty. Neither saved family has been selected or overwritten automatically.', '保存済みデザインを選択するか、空の状態で開始してください。保存済みデータは自動で選択・上書きされていません。')}</p>}
    <button type="button" onClick={onNew}>{text('New mixed-network workspace', '新しい混在ネットワーク ワークスペース')}</button>
    {onResumePractice && <button type="button" onClick={onResumePractice}>{text('Resume practice', '練習を再開')}</button>}
    {choices.map((choice) => <section key={choice.provider}>
      <h3>{choice.name}</h3>
      <p>{choice.provider === 'vwan' ? text('Original Virtual WAN design · compatible native editor', '元の Virtual WAN デザイン・互換ネイティブ エディター') : text('Mixed-network design', '混在ネットワーク デザイン')}</p>
      <button type="button" onClick={() => onOpen(choice.provider)}>{text('Open saved design', '保存済みデザインを開く')}: {choice.name}</button>
      <button type="button" onClick={() => download(choice.raw, `${choice.provider}-saved-original.json`)}>{text('Export saved original', '保存済みの原本をエクスポート')}: {choice.name}</button>
    </section>)}
    {!!originals.length && <details><summary>{text('Preserved originals', '保持された原本')} ({originals.length})</summary>
      <p>{text('Download and import an original to restore it. Originals are never used as a second editable topology.', '原本をダウンロードしてインポートすると復元できます。原本は別の編集可能なトポロジとしては使用されません。')}</p>
      {originals.map((entry, index) => <button key={index} type="button" onClick={() => download(entry.raw, `workspace-original-${index + 1}.json`)}>
        {text('Export original', '原本をエクスポート')} {index + 1} · {entry.key}
      </button>)}
    </details>}
    {archiveError && <p role="alert">{archiveError}</p>}
  </dialog>
}
