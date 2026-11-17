import { useState } from 'react'
import { t } from '../i18n'
import { cidr, isVwanNvaAsn, parseAsPath } from '../validation'
import type { AzNetTopology } from './model'
import { PeerRouteAttributes } from './RouteMapsPanel'
import { VpnNatConnectionEditor } from '../VpnNatEditor'
import { saveManagedVnra, vnraSubnetName } from './vnra-authoring'

type Props = { topology: AzNetTopology; commit: (edit: (draft: AzNetTopology) => void) => void }
const prefixes = (text: string) => {
  const values = text.split(/[,\s]+/).filter(Boolean)
  if (values.some((prefix) => !cidr(prefix))) throw new Error(t('Enter valid IPv4 CIDR prefixes.'))
  return values
}

export function HybridConnectionEditor({ topology, connectionId, commit }: Props & { connectionId: string }) {
  const [error, setError] = useState('')
  const vpn = topology.vpnConnections.find((connection) => connection.id === connectionId)
  const er = topology.erLinks.find((connection) => connection.id === connectionId)
  const connection = vpn ?? er
  const [transport, setTransport] = useState(vpn?.transport ?? 'VPN')
  const [bgp, setBgp] = useState(vpn?.bgpEnabled ?? true)
  if (!connection) return null
  const hub = connection.targetKind === 'vwan-hub'
  return <><section className="aznet-card" data-testid="aznet-hybrid-connection-editor">
    <h3>{t('Hybrid connection routing')}</h3>
    <p className="muted">{connection.id}</p>
    <form onSubmit={(event) => {
      event.preventDefault()
      try {
        const data = new FormData(event.currentTarget)
        const inbound = parseAsPath(String(data.get('inbound') ?? ''))
        const outbound = parseAsPath(String(data.get('outbound') ?? ''))
        const staticPrefixes = prefixes(String(data.get('prefixes') ?? ''))
        commit((draft) => {
          const target = draft.vpnConnections.find((connection) => connection.id === connectionId)
          if (target) {
            target.name = String(data.get('name'))
            target.enabled = data.has('enabled')
            target.inboundPrepend = inbound
            target.outboundPrepend = outbound
            target.staticPrefixes = staticPrefixes
            target.bgpEnabled = data.has('bgp')
            if (hub) {
              target.transport = data.get('transport') === 'SDWAN' ? 'SDWAN' : 'VPN'
              if (target.transport === 'SDWAN') target.bgpEnabled = true
              target.learnSiteRoutes = data.has('learn')
              target.propagateDefaultRoute = data.has('default')
            }
          } else {
            const link = draft.erLinks.find((connection) => connection.id === connectionId)!
            link.name = String(data.get('name'))
            link.enabled = data.has('enabled')
            link.prepend = inbound
            if (hub) {
              link.learnSiteRoutes = data.has('learn')
              link.propagateDefaultRoute = data.has('default')
            }
          }
        })
        setError('')
      } catch (error) { setError(error instanceof Error ? error.message : 'Invalid connection.') }
    }}>
      <label className="field"><span>{t('Connection name')}</span><input name="name" required maxLength={120} defaultValue={connection.name} /></label>
      <label><input type="checkbox" name="enabled" defaultChecked={connection.enabled} />{t('Enabled')}</label>
      {vpn && <>
        {hub && <label className="field"><span>{t('Transport')}</span><select name="transport" value={transport} onChange={(event) => {
          setTransport(event.target.value as 'VPN' | 'SDWAN')
          if (event.target.value === 'SDWAN') setBgp(true)
        }}><option value="VPN">VPN</option><option value="SDWAN">SD-WAN</option></select></label>}
        <label><input type="checkbox" name="bgp" disabled={transport === 'SDWAN'} checked={bgp} onChange={(event) => setBgp(event.target.checked)} />{t('BGP enabled (required for SD-WAN)')}</label>
        <label className="field"><span>{t('Static VPN prefixes (BGP disabled)')}</span><textarea name="prefixes" defaultValue={vpn.staticPrefixes?.join('\n') ?? ''} /></label>
      </>}
      <label className="field"><span>{t('Inbound AS-path prepend')}</span><input name="inbound" defaultValue={(vpn?.inboundPrepend ?? er?.prepend)?.join(' ') ?? ''} /></label>
      {vpn && <label className="field"><span>{t('Outbound AS-path prepend')}</span><input name="outbound" defaultValue={vpn.outboundPrepend?.join(' ') ?? ''} /></label>}
      {hub && <>
        <label><input type="checkbox" name="learn" defaultChecked={connection.learnSiteRoutes !== false} />{t('Learn branch routes')}</label>
        <label><input type="checkbox" name="default" defaultChecked={connection.propagateDefaultRoute === true} />{t('Propagate default route')}</label>
      </>}
      <p className="muted">{t('Use router-owned route maps for prefix-specific policies. Static VPN routes bypass BGP policies. SD-WAN supports site policies, not hub route maps.')}</p>
      <button type="submit">{t('Save connection routing')}</button>
      {error && <p role="alert">{error}</p>}
    </form>
  </section>
  {vpn && <VpnNatConnectionEditor topology={topology} connectionId={connectionId} commit={commit} />}
  </>
}

export function HybridNvaEditor({ topology, applianceId, commit }: Props & { applianceId: string }) {
  const [error, setError] = useState('')
  const vnet = topology.vnets.find((vnet) => vnet.appliances.some((app) => app.id === applianceId))
  const app = vnet?.appliances.find((app) => app.id === applianceId)
  if (!app || !vnet) return null
  if (app.kind === 'vnra') return <ManagedVnraEditor key={app.subnetId} topology={topology} vnetId={vnet.id} applianceId={app.id} commit={commit} />
  return <section className="aznet-card" data-testid="aznet-hybrid-nva-editor">
    <h3>{t('NVA BGP advertisements')}</h3>
    <form onSubmit={(event) => {
      event.preventDefault()
      try {
        const data = new FormData(event.currentTarget)
        const asn = Number(data.get('asn'))
        if (!Number.isInteger(asn) || asn < 1 || asn > 4294967294 || [65515, 65520, 12076].includes(asn)) throw new Error(t('Enter a non-reserved BGP peer ASN.'))
        if (data.has('hub') && !isVwanNvaAsn(asn)) throw new Error(t('Spoke NVA peering requires a non-reserved public or private 2-byte ASN, different from the Azure hub ASN.'))
        const advertised = prefixes(String(data.get('prefixes') ?? ''))
        commit((draft) => {
          const target = draft.vnets.find((owner) => owner.id === vnet.id)!.appliances.find((app) => app.id === applianceId)!
          target.asn = asn; target.bgpEnabled = data.has('bgp')
          if (vnet.vwanHubAttachment?.enabled) target.vwanBgpEnabled = data.has('hub')
          target.advertisedPrefixes = advertised
          target.advertisedRouteAttributes = target.advertisedRouteAttributes?.filter((attributes) => advertised.includes(attributes.prefix))
        })
        setError('')
      } catch (error) { setError(error instanceof Error ? error.message : 'Invalid BGP peer.') }
    }}>
      <label className="field"><span>{t('Peer ASN')}</span><input type="number" min={1} max={4294967294} name="asn" defaultValue={app.asn ?? 65501} /></label>
      <label><input type="checkbox" name="bgp" defaultChecked={app.bgpEnabled === true} />{t('BGP enabled')}</label>
      <label><input type="checkbox" name="hub" disabled={!vnet.vwanHubAttachment?.enabled || app.kind === 'azure-firewall'} defaultChecked={app.vwanBgpEnabled === true} />{t('Peer with the attached Virtual WAN hub')}</label>
      <label className="field"><span>{t('Advertised prefixes')}</span><textarea name="prefixes" defaultValue={app.advertisedPrefixes?.join('\n') ?? ''} /></label>
      <p className="muted">{t('Uses this original appliance and VNet connection. Requires BGP and IP forwarding; hub policies apply on the hosting VNet connection. Advertisements do not create data-plane reachability.')}</p>
      <button type="submit">{t('Save NVA BGP routing')}</button>
      {error && <p role="alert">{error}</p>}
    </form>
    <PeerRouteAttributes key={app.advertisedPrefixes?.join(',')} app={app} onSave={(attributes) => commit((draft) => {
      draft.vnets.find((owner) => owner.id === vnet.id)!.appliances.find((app) => app.id === applianceId)!.advertisedRouteAttributes = attributes
    })} />
  </section>
}

export function ManagedVnraEditor({ topology, vnetId, applianceId, commit, onSaved, onCancel }: Props & {
  vnetId: string
  applianceId?: string
  onSaved?: (id: string) => void
  onCancel?: () => void
}) {
  const vnet = topology.vnets.find((entry) => entry.id === vnetId)
  const app = vnet?.appliances.find((entry) => entry.id === applianceId && entry.kind === 'vnra')
  const [subnetId, setSubnetId] = useState(app?.subnetId ?? vnet?.subnets.find((entry) => entry.name === vnraSubnetName)?.id ?? '')
  const [error, setError] = useState('')
  if (!vnet || (applianceId && !app)) return null
  return <section className="aznet-card" data-testid="aznet-vnra-editor">
    <h3>{t(app ? 'Configure Managed VNRA' : 'Add Managed VNRA')}</h3>
    <p>{t('Original VNet')}: {vnet.name} (<code>{vnet.id}</code>){app && <> · <code>{app.id}</code></>}</p>
    <p>{t('Use a dedicated VirtualNetworkApplianceSubnet and UDRs targeting the VNRA private IP. Configure peering access, forwarded traffic and return routes separately; this action does not change peerings or routes.')}</p>
    <form key={app ? JSON.stringify([app.name, app.privateIp, app.subnetId]) : vnet.id} onSubmit={(event) => {
      event.preventDefault()
      try {
        const data = new FormData(event.currentTarget)
        const input = {
          id: app?.id ?? `vnra-${crypto.randomUUID()}`, name: String(data.get('name')),
          privateIp: String(data.get('address')), subnetId: subnetId || undefined,
          newSubnetPrefix: subnetId ? undefined : String(data.get('prefix')),
        }
        saveManagedVnra(structuredClone(topology), vnet.id, input)
        commit((draft) => saveManagedVnra(draft, vnet.id, input))
        setError('')
        onSaved?.(input.id)
      } catch (error) { setError(t(error instanceof Error ? error.message : 'Inventory edit failed.')) }
    }}>
      <label className="field"><span>{t('VNRA name')}</span><input name="name" required maxLength={120} defaultValue={app?.name ?? `${vnet.name}-vnra`} /></label>
      <label className="field"><span>{t('VNRA subnet')}</span><select value={subnetId} onChange={(event) => setSubnetId(event.target.value)}>
        <option value="">{t('Create dedicated VNRA subnet')}</option>
        {vnet.subnets.filter((subnet) => subnet.name === vnraSubnetName || subnet.id === app?.subnetId).map((subnet) =>
          <option key={subnet.id} value={subnet.id}>{subnet.name} · {subnet.prefix} · {subnet.id}</option>)}
      </select></label>
      {!subnetId && <label className="field"><span>{t('VNRA subnet prefix')}</span><input name="prefix" required placeholder={vnet.prefixes.join(', ')} /></label>}
      <label className="field"><span>{t('VNRA private IPv4 address')}</span><input name="address" required defaultValue={app?.privateIp ?? ''} /></label>
      <p>{t('Managed forwarding only. Guest BGP, firewall inspection and NAT controls are not VNRA capabilities here. Throughput, HA, live readiness and IPv6 forwarding are not assessed. Bicep export does not deploy VNRA; preserve native JSON.')}</p>
      {app?.enableIpForwarding === false && <p role="status">{t('Modeled forwarding is disabled in this saved design; editing identity does not silently enable it.')}</p>}
      <button type="submit">{t(app ? 'Save Managed VNRA' : 'Create Managed VNRA')}</button>
      {onCancel && <button type="button" onClick={onCancel}>{t('Cancel')}</button>}
      {error && <p role="alert">{error}</p>}
    </form>
  </section>
}
