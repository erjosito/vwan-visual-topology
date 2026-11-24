import type { ContextAction } from './TopologyContextMenu'
import { t } from './i18n'

export function previewVnetActions(actions: ContextAction[], openAll: () => void): ContextAction[] {
  return [
    ...actions.filter((action) => action.previewPrimary),
    { label: t('All VNet actions'), run: openAll },
    ...actions.filter((action) => action.danger && !action.previewPrimary),
  ]
}

export function previewSubnetActions(actions: ContextAction[]): ContextAction[] {
  // Keep existing destination pickers at the root: wrapping them adds a second submenu level.
  const secondary = actions.filter((action) => !action.previewPrimary && !action.danger && !action.children)
  return [
    ...actions.filter((action) => action.previewPrimary || (!action.danger && action.children)),
    ...(secondary.length ? [{ label: t('Subnet policies'), children: secondary }] : []),
    ...actions.filter((action) => action.danger && !action.previewPrimary),
  ]
}

export function contextActionDisabled(action: ContextAction): boolean {
  if (action.disabled) return true
  if (action.children?.length) return !action.allowDisabledChildren && action.children.every(contextActionDisabled)
  return action.children !== undefined && !action.run && !action.onSelect
}
