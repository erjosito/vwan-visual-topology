import { useEffect, useRef } from 'react'
import { t, useLanguage } from './i18n'
import { workspaceOriginals, workspaceStorageKeys, type WorkspaceProvider } from './workspace-session'
import { readWorkspaceTabs, workspaceTabsKey, workspaceTabKey, type WorkspaceTab } from './workspace-tabs'

function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  URL.revokeObjectURL(url)
}

export function WorkspaceLibrary({ required, notice, onOpen, onNew, onClose, onResumePractice, onReopen, onCloseAll, onResetTabs }: {
  required: boolean
  notice?: string
  onOpen: (provider: WorkspaceProvider) => void
  onNew: () => void
  onClose: () => void
  onResumePractice?: () => void
  onReopen?: (tab: WorkspaceTab) => void
  onCloseAll?: () => void
  onResetTabs?: () => void
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
  const recovery: { tab?: WorkspaceTab; raw: string; name: string; closed: number }[] = []
  let tabMetadata: string | null = null
  try {
    tabMetadata = localStorage.getItem(workspaceTabsKey)
    const open = new Set(readWorkspaceTabs(localStorage).session?.tabs.map(tab => tab.id))
    for (let index = 0; index < Math.min(localStorage.length, 2048); index++) {
      const key = localStorage.key(index)
      const id = key?.match(/^network-simulator:workspace-tab:v1:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):topology$/)?.[1]
      if (!key || !id || open.has(id)) continue
      const raw = localStorage.getItem(key)
      if (raw === null || raw.length > 4_000_000) continue
      let tab: WorkspaceTab | undefined
      let name = text('Unreadable recovery copy', '読み取れない復元用コピー')
      try {
        const parsed = JSON.parse(raw), topology = parsed.topology ?? parsed
        const provider = topology.version === 1 && !topology.kind ? 'vwan'
          : topology.version === 2 && topology.kind === 'azure-network-topology' ? 'azure-net' : undefined
        if (typeof topology.name === 'string') name = topology.name.slice(0, 120)
        if (provider) tab = { id, provider, name }
      } catch {}
      const closed = tab ? Number(localStorage.getItem(workspaceTabKey(tab, 'closed'))) : 0
      recovery.push({ tab, name, raw, closed: Number.isFinite(closed) ? closed : 0 })
    }
    recovery.sort((a, b) => b.closed - a.closed)
  } catch {}
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
    <p>{text('Open designs in separate tabs; your existing designs stay open. New workspaces support Virtual WAN and classic networking together. Saved native designs keep their original editor and routing provider without conversion.', 'デザインは別々のタブで開き、既存のデザインはそのまま保持します。新しいワークスペースでは Virtual WAN と従来のネットワークを併用できます。既存のデザインは変換せず、元のエディターとルーティング処理で開きます。')}</p>
    {notice && <p role="alert">{t(notice)}</p>}
    {required && <p role="status">{text('Choose a saved design or start empty. Neither saved family has been selected or overwritten automatically.', '保存済みデザインを選択するか、空の状態で開始してください。保存済みデータは自動で選択・上書きされていません。')}</p>}
    <button type="button" onClick={onNew}>{text('New mixed-network workspace', '新しい混在ネットワーク ワークスペース')}</button>
    {onCloseAll && <button type="button" onClick={onCloseAll}>{text('Close all topology tabs', 'すべてのトポロジ タブを閉じる')}</button>}
    {onResetTabs && <section>
      <p>{text('Reset only the damaged tab list. Stored topology records remain available below.', '破損したタブ一覧のみをリセットします。保存済みのトポロジは下から復元できます。')}</p>
      {tabMetadata !== null && <button type="button" onClick={() => download(tabMetadata!, 'workspace-tab-list-recovery.json')}>{text('Download damaged tab list', '破損したタブ一覧をダウンロード')}</button>}
      <button type="button" onClick={onResetTabs}>{text('Reset damaged tab list', '破損したタブ一覧をリセット')}</button>
    </section>}
    {onResumePractice && <button type="button" onClick={onResumePractice}>{text('Resume practice', '練習を再開')}</button>}
    {choices.map((choice) => <section key={choice.provider}>
      <h3>{choice.name}</h3>
      <p>{choice.provider === 'vwan' ? text('Original Virtual WAN design · compatible native editor', '元の Virtual WAN デザイン・互換ネイティブ エディター') : text('Mixed-network design', '混在ネットワーク デザイン')}</p>
      <button type="button" onClick={() => onOpen(choice.provider)}>{text('Open saved design', '保存済みデザインを開く')}: {choice.name}</button>
      <button type="button" onClick={() => download(choice.raw, `${choice.provider}-saved-original.json`)}>{text('Export saved original', '保存済みの原本をエクスポート')}: {choice.name}</button>
    </section>)}
    {!!recovery.length && <details open><summary>{text('Closed & recovered designs', '閉じたデザイン・復元用デザイン')} ({recovery.length})</summary>
      <p>{text('The latest 32 recovery copies are shown. Reopening preserves native data and retained cloud links; a profile copy is not a confirmed file/cloud save. Closed in-memory undo/redo, analysis and view state are not restored.', '最新32件の復元用コピーを表示します。再表示してもネイティブ データと保持されたクラウド リンクは変換しません。プロファイルのコピーはファイル・クラウドへの保存の確認ではありません。閉じた元に戻す履歴、分析や表示状態は復元されません。')}</p>
      {recovery.slice(0, 32).map((entry, index) => <section key={entry.tab?.id ?? index}>
        <h3>{entry.name}</h3>
        {entry.tab && onReopen && <button type="button" disabled={!!onResetTabs} onClick={() => onReopen(entry.tab!)}>
          {text('Reopen topology', 'トポロジを再表示')}: {entry.name}
        </button>}
        <button type="button" onClick={() => download(entry.raw, `topology-recovery-${index + 1}.json`)}>
          {text('Download recovery copy', '復元用コピーをダウンロード')}: {entry.name}
        </button>
      </section>)}
    </details>}
    {!!originals.length && <details><summary>{text('Preserved originals', '保持された原本')} ({originals.length})</summary>
      <p>{text('Download and import an original to restore it. Originals are never used as a second editable topology.', '原本をダウンロードしてインポートすると復元できます。原本は別の編集可能なトポロジとしては使用されません。')}</p>
      {originals.map((entry, index) => <button key={index} type="button" onClick={() => download(entry.raw, `workspace-original-${index + 1}.json`)}>
        {text('Export original', '原本をエクスポート')} {index + 1} · {entry.key}
      </button>)}
    </details>}
    {archiveError && <p role="alert">{archiveError}</p>}
  </dialog>
}
