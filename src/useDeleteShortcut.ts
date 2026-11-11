import { useEffect } from 'react'

export function useDeleteShortcut(onDelete: (() => void) | undefined) {
  useEffect(() => {
    if (!onDelete) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || event.defaultPrevented || event.repeat || event.isComposing ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (target instanceof Element && (
        target.closest('input, textarea, select, [role="textbox"], [role="dialog"], [role="alertdialog"], [role="menu"], dialog, .aznet-modal-backdrop') ||
        (target instanceof HTMLElement && target.isContentEditable)
      )) return
      event.preventDefault()
      onDelete()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onDelete])
}
