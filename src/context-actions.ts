import type { ContextAction } from './TopologyContextMenu'

export function contextActionDisabled(action: ContextAction): boolean {
  if (action.disabled) return true
  if (action.children?.length) return !action.allowDisabledChildren && action.children.every(contextActionDisabled)
  return action.children !== undefined && !action.run && !action.onSelect
}
