import { useEffect, useRef } from 'react'
import { t } from './i18n'
import { hubGatewayLabel, type HubGatewayConnection } from './hub-gateways'
import './hub-dialog-messages-ja'

export default function HubCapabilitiesDialog({ hub, connections, onClose }: {
  hub: { name: string; firewall?: { id: string; name: string }; routingIntent: { private: boolean; internet: boolean } }
  connections: HubGatewayConnection[]
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current!
    element.showModal()
    return () => {
      element.close()
      if (previous?.isConnected && 'focus' in previous) (previous as HTMLElement).focus({ preventScroll: true })
    }
  }, [])
  return <dialog ref={dialog} className="object-dialog" style={{ overflowWrap: 'anywhere' }} aria-label={t('Gateway capabilities (modeled)')}
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className="row dialog-heading"><h2>{t('Gateway capabilities (modeled)')}</h2><button onClick={onClose}>{t('Close')}</button></div>
    <h3>{hub.name}</h3>
    <p>{hubGatewayLabel(connections)}</p>
    <p>{t('Counts are enabled/defined connections, not deployed gateways. Missing connections do not prove that no live gateway exists.')}</p>
    <p>{t('Derived from this topology, not explicit gateway inventory or live observations. SKU, public addresses and provisioning state are unknown.')}</p>
    {connections.length ? <ul>{connections.map((connection) => <li key={`${connection.transport}:${connection.id}`} data-testid={`hub-gateway-${connection.id}`}>
      {connection.transport} · {connection.name} · {t(connection.enabled ? 'Enabled' : 'Disabled')} · <code style={{ overflowWrap: 'anywhere' }}>{connection.id}</code>
    </li>)}</ul> : <p>{t('No modeled VPN or ExpressRoute connections for this hub.')}</p>}
    <p>{hub.firewall ? `${t('Azure Firewall')}: ${hub.firewall.name} · ${hub.firewall.id}` : t('No explicit local Firewall declaration.')}</p>
    {(hub.routingIntent.private || hub.routingIntent.internet) && <p>{t('Routing intent may select Firewall inspection independently of a local declaration.')}</p>}
  </dialog>
}
