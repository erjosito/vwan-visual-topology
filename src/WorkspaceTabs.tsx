import { useContext, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { t, useLanguage } from './i18n'
import { documentSaveLabel, WorkspaceTabsContext, useWorkspaceSession } from './workspace-context'
import { workspaceTabsLimit, type WorkspaceTab } from './workspace-tabs'
import type { DocumentSaveState } from './cloud/document-state'
import type { createDocumentCommands } from './document-commands'
import './workspace-tabs.css'
const noSubscribe = () => () => {}
const noSnapshot = () => undefined

export function WorkspaceCanvasTabs() {
  const tabs = useContext(WorkspaceTabsContext)
  useLayoutEffect(() => {
    tabs?.restoreFocus()
  })
  return tabs?.navigation
}

export function WorkspaceTabPanel({ children }: { children: ReactNode }) {
  const id = useWorkspaceSession()?.tabId
  return <div className="workspace-tab-panel" id={id ? 'workspace-design-panel' : undefined}
    role={id ? 'tabpanel' : undefined} aria-labelledby={id ? `workspace-tab-${id}` : undefined}>
    {children}
  </div>
}

function TabButton({ tab, selected, save, commands, onActivate }: {
  tab: WorkspaceTab; selected: boolean; save: DocumentSaveState; commands?: ReturnType<typeof createDocumentCommands>; onActivate: (tab: WorkspaceTab) => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const state = useSyncExternalStore(save.subscribe, save.getSnapshot)
  const artifact = useSyncExternalStore(commands?.subscribe ?? noSubscribe, commands?.getSnapshot ?? noSnapshot)
  const detailStatus = t(artifact?.operation === 'saving' ? 'Saving'
    : artifact?.operation === 'failed' ? 'Save failed'
      : artifact?.destination?.kind === 'file' ? artifact.revision === 'matches' ? 'File saved'
        : 'File modified'
        : state.operation === 'saving' ? 'Saving'
    : state.operation === 'failed' ? 'Save failed'
      : state.cloud ? state.cloud.state === 'matches' ? 'Cloud saved'
        : state.cloud.state === 'modified' ? 'Cloud modified'
          : 'Cloud unverified'
        : state.local === 'unavailable' ? 'Not in profile'
          : state.local === 'saved' ? 'Profile saved'
            : !state.ready ? 'Not opened'
              : 'Draft')
  const name = tab.name || text('Untitled topology', '名称未設定のトポロジ')
  const status = t(documentSaveLabel(state, artifact))
  const tooltip = `${name} · ${tab.provider === 'vwan' ? 'Virtual WAN' : text('Mixed networking', '混在ネットワーク')} · ${detailStatus}${state.cloud ? `: ${state.cloud.name}` : ''}${artifact?.destination?.kind === 'file' ? `: ${artifact.destination.location}` : ''}${artifact?.error ? ` · ${artifact.error}` : ''}${state.local === 'unavailable' ? ` · ${t('Profile recovery unavailable. Confirmed file and cloud saves are unaffected.')}` : ''}`
  return <><button type="button" role="tab" id={`workspace-tab-${tab.id}`} aria-controls="workspace-design-panel"
    aria-label={name}
    aria-describedby={`workspace-tab-state-${tab.id}`} aria-selected={selected} tabIndex={selected ? 0 : -1}
    title={tooltip}
    onFocus={event => event.currentTarget.parentElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
    onClick={() => onActivate(tab)}>
    <span className="workspace-tab-name">{name}</span>
  </button><small id={`workspace-tab-state-${tab.id}`} title={tooltip}>{status}</small></>
}

export function WorkspaceTabs({ tabs, activeId, temporary, getSave, getCommands, onActivate, onNew, onClose }: {
  tabs: WorkspaceTab[]
  activeId?: string
  temporary?: boolean
  getSave: (tab: WorkspaceTab) => DocumentSaveState
  getCommands?: (tab: WorkspaceTab) => ReturnType<typeof createDocumentCommands> | undefined
  onActivate: (tab: WorkspaceTab) => void
  onNew: () => void
  onClose?: (tab: WorkspaceTab) => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const list = useRef<HTMLDivElement>(null)
  return <nav className="workspace-tabs" aria-label={text('Open topologies', '開いているトポロジ')}>
    {temporary && <span role="status" title={text('Temporary copies: profile storage is unavailable or another window owns it. Save a file or cloud copy before closing. Reload after the other window closes to restore profile editing.',
      '一時コピー: プロファイルを利用できないか、別のウィンドウが使用中です。閉じる前にファイルまたはクラウドに保存してください。別のウィンドウを閉じて再読み込みすると、プロファイルの編集を再開できます。')}>
      {text('Temporary', '一時コピー')}</span>}
    <div ref={list} className="workspace-tabs-list"
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
      <div className="workspace-tab-semantics" role="tablist" aria-label={text('Designs', 'デザイン')}>
        {tabs.map((tab, index) => <div className="workspace-tab" key={tab.id} style={{ gridColumn: index + 1 }}>
          <TabButton tab={tab} selected={tab.id === activeId} save={getSave(tab)} commands={getCommands?.(tab)} onActivate={onActivate} />
        </div>)}
      </div>
      {onClose && tabs.map((tab, index) => {
        const name = tab.name || text('Untitled topology', '名称未設定のトポロジ')
        const suffix = tabs.filter(other => other.name === tab.name).length > 1 ? text(` (tab ${index + 1})`, ` (タブ ${index + 1})`) : ''
        const closeLabel = text(`Close topology: ${name}${suffix}`, `トポロジを閉じる: ${name}${suffix}`)
        return <button type="button" className="workspace-tab-close" key={tab.id} style={{ gridColumn: index + 1 }}
          aria-label={closeLabel} title={closeLabel} onClick={() => onClose(tab)}>&#215;</button>
      })}
    </div>
    <button type="button" className="workspace-tab-new" onClick={onNew} disabled={tabs.length >= workspaceTabsLimit}
      title={tabs.length >= workspaceTabsLimit ? text('Close a tab to open another (maximum 16). Closed designs remain in recovery.', '別のタブを開くにはタブを閉じてください (最大16)。閉じたデザインは復元用に保持します。') : undefined}
      aria-label={text('New topology tab', '新しいトポロジ タブ')}>+</button>
  </nav>
}
