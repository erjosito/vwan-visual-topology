import { useRef, useSyncExternalStore } from 'react'
import { useLanguage } from './i18n'
import { workspaceTabsLimit, type WorkspaceTab } from './workspace-tabs'
import type { DocumentSaveState } from './cloud/document-state'
import './workspace-tabs.css'

function TabButton({ tab, selected, save, onActivate }: {
  tab: WorkspaceTab; selected: boolean; save: DocumentSaveState; onActivate: (tab: WorkspaceTab) => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const state = useSyncExternalStore(save.subscribe, save.getSnapshot)
  const status = state.operation === 'saving' ? text('Saving', '保存中')
    : state.operation === 'failed' ? text('Save failed', '保存失敗')
      : state.cloud ? state.cloud.state === 'matches' ? text('Cloud saved', 'クラウド保存済み')
        : state.cloud.state === 'modified' ? text('Cloud modified', 'クラウド未保存')
          : text('Cloud unverified', 'クラウド未確認')
        : state.local === 'unavailable' ? text('Not in profile', 'プロファイル未保存')
          : state.local === 'saved' ? text('Profile saved', 'プロファイル保存済み')
            : !state.ready ? text('Not opened', '未表示')
              : text('Draft', '下書き')
  return <><button type="button" role="tab" id={`workspace-tab-${tab.id}`} aria-controls="workspace-design-panel"
    aria-label={tab.name || text('Untitled topology', '名称未設定のトポロジ')}
    aria-describedby={`workspace-tab-state-${tab.id}`} aria-selected={selected} tabIndex={selected ? 0 : -1}
    title={`${tab.name} · ${tab.provider === 'vwan' ? 'Virtual WAN' : text('Mixed networking', '混在ネットワーク')} · ${status}${state.cloud ? `: ${state.cloud.name}` : ''}`}
    onClick={() => onActivate(tab)}>
    <span>{tab.name || text('Untitled topology', '名称未設定のトポロジ')}</span>
  </button><small id={`workspace-tab-state-${tab.id}`}>{status}</small></>
}

export function WorkspaceTabs({ tabs, activeId, temporary, getSave, onActivate, onNew, onClose }: {
  tabs: WorkspaceTab[]
  activeId?: string
  temporary?: boolean
  getSave: (tab: WorkspaceTab) => DocumentSaveState
  onActivate: (tab: WorkspaceTab) => void
  onNew: () => void
  onClose?: (tab: WorkspaceTab) => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const list = useRef<HTMLDivElement>(null)
  const selected = tabs.find(tab => tab.id === activeId)
  return <nav className="workspace-tabs" aria-label={text('Open topologies', '開いているトポロジ')}>
    {temporary && <span role="status" title={text('Temporary copies: profile storage is unavailable or another window owns it. Save a file or cloud copy before closing. Reload after the other window closes to restore profile editing.',
      '一時コピー: プロファイルを利用できないか、別のウィンドウが使用中です。閉じる前にファイルまたはクラウドに保存してください。別のウィンドウを閉じて再読み込みすると、プロファイルの編集を再開できます。')}>
      {text('Temporary', '一時コピー')}</span>}
    <div ref={list} className="workspace-tabs-list" role="tablist" aria-label={text('Designs', 'デザイン')}
      onKeyDown={event => {
        if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
        const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])
        const current = buttons.indexOf(event.target as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowRight' ? (current + 1) % buttons.length
            : event.key === 'ArrowLeft' ? (current + buttons.length - 1) % buttons.length : -1
        if (next < 0) return
        event.preventDefault()
        buttons[next]?.focus()
      }}>
      {tabs.map(tab => <div className="workspace-tab" key={tab.id}>
        <TabButton tab={tab} selected={tab.id === activeId} save={getSave(tab)} onActivate={onActivate} />
      </div>)}
    </div>
    {onClose && selected && <button type="button" className="workspace-tab-close"
      aria-label={text(`Close topology: ${selected.name}`, `トポロジを閉じる: ${selected.name}`)}
      onClick={() => onClose(selected)}>&#215;</button>}
    <button type="button" className="workspace-tab-new" onClick={onNew} disabled={tabs.length >= workspaceTabsLimit}
      title={tabs.length >= workspaceTabsLimit ? text('Close a tab to open another (maximum 16). Closed designs remain in recovery.', '別のタブを開くにはタブを閉じてください (最大16)。閉じたデザインは復元用に保持します。') : undefined}
      aria-label={text('New topology tab', '新しいトポロジ タブ')}>+</button>
  </nav>
}
