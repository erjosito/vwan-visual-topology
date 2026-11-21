import { useRef } from 'react'
import { useLanguage } from './i18n'
import type { WorkspaceTab } from './workspace-tabs'
import './workspace-tabs.css'

export function WorkspaceTabs({ tabs, activeId, onActivate, onNew, onClose }: {
  tabs: WorkspaceTab[]
  activeId?: string
  onActivate: (tab: WorkspaceTab) => void
  onNew: () => void
  onClose?: (tab: WorkspaceTab) => void
}) {
  const language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const list = useRef<HTMLDivElement>(null)
  return <nav className="workspace-tabs" aria-label={text('Open topologies', '開いているトポロジ')}>
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
        <button type="button" role="tab" id={`workspace-tab-${tab.id}`} aria-controls="workspace-design-panel"
          aria-selected={tab.id === activeId} tabIndex={tab.id === activeId ? 0 : -1}
          title={`${tab.name} · ${tab.provider === 'vwan' ? 'Virtual WAN' : text('Mixed networking', '混在ネットワーク')}`}
          onClick={() => onActivate(tab)}>
          <span>{tab.name || text('Untitled topology', '名称未設定のトポロジ')}</span>
        </button>
        {onClose && <button type="button" className="workspace-tab-close" tabIndex={tab.id === activeId ? 0 : -1}
          aria-label={text(`Close topology: ${tab.name}`, `トポロジを閉じる: ${tab.name}`)}
          onClick={() => onClose(tab)}>&#215;</button>}
      </div>)}
    </div>
    <button type="button" className="workspace-tab-new" onClick={onNew}
      aria-label={text('New topology tab', '新しいトポロジ タブ')}>+</button>
  </nav>
}
