import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { cloneVnetStructure, vnetCloneSource, type CloneTopology } from './vnet-clone'

export function CloneVnetDialog({ topology, sourceId, onClone, onClose }: {
  topology: CloneTopology; sourceId: string
  onClone: (copy: ReturnType<typeof cloneVnetStructure>) => boolean | void
  onClose: () => void
}) {
  const source = vnetCloneSource(topology, sourceId)
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(() => t('{0} copy', source?.name ?? 'VNet'))
  const [prefixes, setPrefixes] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement, element = dialog.current!
    element.showModal()
    nameInput.current?.focus()
    nameInput.current?.select()
    return () => {
      element.close()
      if (previous?.isConnected && 'focus' in previous) (previous as HTMLElement).focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={dialog} className="object-dialog" aria-label={t('Clone VNet')}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="row dialog-heading"><h2>{t('Clone VNet')}</h2>
      <button type="button" onClick={onClose}>{t('Close')}</button></header>
    <p>{t('Copies the VNet region, layout role and subnet structure with fresh IDs. Devices, peerings, connections, route-table associations, private endpoints and workload/policy inventory are not copied.')}</p>
    {source ? <form onSubmit={event => {
      event.preventDefault()
      try {
        const copy = cloneVnetStructure(topology, sourceId, name, prefixes.split(/[,\s]+/).filter(Boolean))
        if (onClone(copy) === false) throw new Error('The VNet clone could not be created. Review the workspace notice.')
        onClose()
      } catch (error) { setError(error instanceof Error ? t(error.message) : t('The VNet clone could not be created. Review the workspace notice.')) }
    }}>
      <p>{t('Source VNet')}: <strong>{source.name}</strong> · <code>{source.prefixes.join(', ')}</code></p>
      <label className="field"><span>{t('New VNet name')}</span><input ref={nameInput} value={name} maxLength={120} required onChange={event => setName(event.target.value)} /></label>
      <label className="field"><span>{t('New address spaces')}</span><input value={prefixes} required aria-describedby="clone-vnet-address-help" onChange={event => setPrefixes(event.target.value)} /></label>
      <p id="clone-vnet-address-help">{t('Enter one canonical IPv4 CIDR per source address space, in the same order and with the same prefix lengths.')} {t('New address spaces must not overlap each other or existing VNet or virtual hub address spaces.')}</p>
      {error && <p role="alert">{error}</p>}
      <div className="row dialog-actions"><button type="button" onClick={onClose}>{t('Cancel')}</button><button type="submit">{t('Create VNet clone')}</button></div>
    </form> : <p role="alert">{t('The source VNet is no longer available.')}</p>}
  </dialog>
}
