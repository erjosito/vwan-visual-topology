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
    <p>{text('Open topologies in separate tabs; your existing topologies stay open. New topologies can combine Virtual WAN and VNet-based networking. Saved topologies keep their original data format and routing behavior.', 'トポロジは別々のタブで開き、既存のトポロジはそのまま保持します。新しいトポロジでは Virtual WAN と VNet ベースのネットワークを組み合わせられます。保存済みトポロジの元のデータ形式とルーティング動作は維持されます。')}</p>
    {notice && <p role="alert">{t(notice)}</p>}
    {required && <p role="status">{text('Open a saved topology or create a new one. Saved topologies are not opened or overwritten automatically.', '保存済みトポロジを開くか、新しいトポロジを作成してください。保存済みトポロジは自動で開いたり上書きしたりしません。')}</p>}
    <button type="button" onClick={onNew}>{text('New topology', '新しいトポロジ')}</button>
    {onCloseAll && <button type="button" onClick={onCloseAll}>{text('Close all topology tabs', 'すべてのトポロジ タブを閉じる')}</button>}
    {onResetTabs && <section>
      <p>{text('Reset only the damaged tab list. Stored topology records remain available below.', '破損したタブ一覧のみをリセットします。保存済みのトポロジは下から復元できます。')}</p>
      {tabMetadata !== null && <button type="button" onClick={() => download(tabMetadata!, 'workspace-tab-list-recovery.json')}>{text('Download damaged tab list', '破損したタブ一覧をダウンロード')}</button>}
      <button type="button" onClick={onResetTabs}>{text('Reset damaged tab list', '破損したタブ一覧をリセット')}</button>
    </section>}
    {onResumePractice && <button type="button" onClick={onResumePractice}>{text('Resume practice', '練習を再開')}</button>}
    {choices.map((choice) => <section key={choice.provider}>
      <h3>{choice.name}</h3>
      <p>{choice.provider === 'vwan' ? text('Virtual WAN topology · original format retained', 'Virtual WAN トポロジ・元の形式を維持') : text('Saved topology · original format retained', '保存済みトポロジ・元の形式を維持')}</p>
      <button type="button" onClick={() => onOpen(choice.provider)}>{text('Open saved topology', '保存済みトポロジを開く')}: {choice.name}</button>
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
