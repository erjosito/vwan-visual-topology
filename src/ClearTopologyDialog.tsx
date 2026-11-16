import { useEffect, useRef } from 'react'
import { t } from './i18n'
import './hub-dialog-messages-ja'

export function ClearTopologyDialog({ workspace, onClose, onConfirm }: {
  workspace: 'vwan' | 'azure-net'; onClose: () => void; onConfirm: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current!
    element.showModal()
    cancel.current?.focus()
    return () => {
      element.close()
      if (previous?.isConnected && 'focus' in previous) (previous as HTMLElement).focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={dialog} className="object-dialog" aria-label={t('Clear topology')}
    onCancel={(event) => { event.preventDefault(); onClose() }} onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose()
    }}>
    <div className="row dialog-heading"><h2>{t('Clear topology')}</h2><button aria-label={t('Close {0}', t('Clear topology'))} onClick={onClose}>{t('Close')}</button></div>
    <p>{t(workspace === 'vwan'
      ? 'Remove all hubs, sites, spokes, ER locations, connections, route maps and saved layouts? This replaces the workspace saved in this browser and cannot be undone. Export JSON first if you need a backup.'
      : 'Clear all objects from the current topology? This replaces the saved topology in this workspace and cannot be undone. Export JSON first if you need a backup. Other workspaces, preferences and training progress are kept.')}</p>
    <div className="row dialog-actions">
      <button ref={cancel} onClick={onClose}>{t('Cancel clearing')}</button>
      <button className="danger" onClick={onConfirm}>{t('Clear all objects')}</button>
    </div>
  </dialog>
}
