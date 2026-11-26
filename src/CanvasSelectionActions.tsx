import { lazy, Suspense, useState } from 'react'
import { t } from './i18n'
import { contextActionDisabled } from './context-actions'
import type { ContextAction } from './TopologyContextMenu'
import { useWorkspaceSession } from './workspace-context'
import { useCanvasPresentation } from './useCanvasPresentation'

const labels = { configure: 'Configure', connect: 'Hub connection', peer: 'Peer', inspect: 'Inspect routes', trace: 'Trace path' }
const TopologyContextMenu = lazy(() => import('./TopologyContextMenu').then(module => ({ default: module.TopologyContextMenu })))

export function CanvasSelectionActions({ title, actions, onAll, onRun }: {
  title: string; actions: ContextAction[]; onAll: () => void; onRun: () => void
}) {
  const [menu, setMenu] = useState<{ label: string; button: HTMLButtonElement }>()
  const [expanded, setExpanded] = useState(true)
  const session = useWorkspaceSession()
  const { headerActionsOpen, toggleHeaderActions } = useCanvasPresentation()
  if (!session?.presentationPreview || session.practice) return null
  const closeMenu = () => { menu?.button.focus(); setMenu(undefined) }
  const primary = actions.filter(action => action.selectionAction && !action.danger)
  const menuAction = primary.find(action => action.label === menu?.label)
  if (!primary.length) return null
  return <nav className="canvas-selection-actions" aria-label={t('Selected object actions')}>
    <span title={title}>{title}</span>
    <button type="button" aria-expanded={expanded} aria-label={t(expanded ? 'Minimize selection actions' : 'Expand selection actions')}
      onClick={() => { setMenu(undefined); setExpanded(value => !value) }}>{expanded ? '-' : '+'}</button>
    {expanded && <div>{primary.map(action => <button key={action.label} type="button" title={t(action.label)} disabled={contextActionDisabled(action)}
      aria-haspopup={action.children?.length ? 'menu' : undefined}
      aria-expanded={action.children?.length ? menu?.label === action.label : undefined}
      onClick={event => {
        if (action.children?.length) setMenu({ label: action.label, button: event.currentTarget })
        else { onRun(); (action.run ?? action.onSelect)?.() }
      }}>{t(labels[action.selectionAction!])}</button>)}
      <button type="button" onClick={() => {
        if (!headerActionsOpen) toggleHeaderActions()
        onAll()
      }}>{t('All actions')}</button>
    </div>}
    {menu && menuAction?.children && !contextActionDisabled(menuAction) && <Suspense fallback={null}><TopologyContextMenu x={menu.button.getBoundingClientRect().left}
      y={menu.button.getBoundingClientRect().bottom + 4} title={t(menuAction.label)}
      actions={menuAction.children} onClose={closeMenu} /></Suspense>}
  </nav>
}
