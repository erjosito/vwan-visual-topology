import { useEffect, useRef } from 'react'
import { t } from './i18n'

export function ClearTopologyDialog({ description, onClose, onConfirm }: {
  description: string; onClose: () => void; onConfirm: () => void
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
    <p>{description}</p>
    <div className="row dialog-actions">
      <button ref={cancel} onClick={onClose}>{t('Cancel clearing')}</button>
      <button className="danger" onClick={onConfirm}>{t('Clear all objects')}</button>
    </div>
  </dialog>
}
