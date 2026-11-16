import { useState } from 'react'
import { t } from './i18n'
import './vpn-nat-messages-ja'
import type { AzNetTopology, AzVpnConnection } from './azure-net/model'
import { VPN_NAT_CAPABILITIES, validateVpnNat, vpnNatGateway, type ClassicVpnNatGateway, type VpnNatRule } from './vpn-nat'
import { traceVpnNatPacket, type VpnNatPacketResult } from './vpn-nat-packet'

type Props = { topology: AzNetTopology; commit: (edit: (draft: AzNetTopology) => void) => void }
const updateChecked = (topology: AzNetTopology, commit: Props['commit'], edit: (draft: AzNetTopology) => void) => {
  const draft = structuredClone(topology)
  edit(draft)
  validateVpnNat(draft)
  commit(edit)
}

export function VpnNatGatewayEditor({ topology, targetKind, targetId, commit }: Props & {
  targetKind: 'vnet-gateway' | 'vwan-hub'; targetId: string
}) {
  const [error, setError] = useState('')
  const classic = targetKind === 'vnet-gateway'
  const gateway = classic ? topology.vnets.flatMap((vnet) => vnet.gateways).find((gateway) => gateway.id === targetId)
    : topology.vwanHubs.find((hub) => hub.id === targetId)
  if (!gateway || 'kind' in gateway && gateway.kind !== 'Vpn') return null
  const config = gateway.vpnNat
  const connections = topology.vpnConnections.filter((connection) => connection.targetId === targetId && connection.targetKind === targetKind && connection.nat)
  return <section className="aznet-card" data-testid="vpn-nat-gateway-editor">
    <h3>{t('VPN overlap NAT gateway')}: {gateway.name}</h3>
    <p>{t(classic ? VPN_NAT_CAPABILITIES.classic : VPN_NAT_CAPABILITIES.vwan)}</p>
    <p>{t(VPN_NAT_CAPABILITIES.scope)}</p>
    <form key={JSON.stringify(config)} onSubmit={(event) => {
      event.preventDefault()
      try {
        const data = new FormData(event.currentTarget)
        updateChecked(topology, commit, (draft) => {
          if (classic) draft.vnets.flatMap((vnet) => vnet.gateways).find((gateway) => gateway.id === targetId)!.vpnNat = {
            sku: String(data.get('sku')) as ClassicVpnNatGateway['sku'], bgpRouteTranslation: data.has('bgpTranslation'),
          }
          else draft.vwanHubs.find((hub) => hub.id === targetId)!.vpnNat = { bgpRouteTranslation: data.has('bgpTranslation') }
        })
        setError('')
      } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    }}>
      {classic && <label className="field">{t('Classic VPN NAT SKU')}<select name="sku" defaultValue={config && 'sku' in config ? config.sku : 'VpnGw2'}>
        {['VpnGw2', 'VpnGw3', 'VpnGw4', 'VpnGw5', 'VpnGw2AZ', 'VpnGw3AZ', 'VpnGw4AZ', 'VpnGw5AZ'].map((sku) => <option key={sku}>{sku}</option>)}
      </select></label>}
      <label><input type="checkbox" name="bgpTranslation" defaultChecked={config?.bgpRouteTranslation ?? false} />{t('Enable gateway BGP route translation')}</label>
      <p>{t('Gateway-wide setting; only exact prefixes with matching connection-owned NAT rules are translated. Unmatched connections and prefixes stay unchanged. Static routing requires explicit post-NAT routes.')}</p>
      <button type="submit">{t('Save VPN NAT gateway capability')}</button>
    </form>
    <p>{t('NAT-associated original connections')}: {connections.map((connection) => connection.name).join(', ') || t('None')}</p>
    {error && <p role="alert">{t('VPN NAT edit rejected.')}{' '}{error}</p>}
  </section>
}

export function VpnNatConnectionEditor({ topology, connectionId, commit }: Props & { connectionId: string }) {
  const [error, setError] = useState('')
  const [editing, setEditing] = useState('')
  const connection = topology.vpnConnections.find((connection) => connection.id === connectionId)
  if (!connection) return null
  if (connection.targetKind === 'appliance' || connection.transport === 'SDWAN') return <p>{t('VPN overlap NAT is unsupported on appliance or SD-WAN connections.')}</p>
  const rule = connection.nat?.rules.find((rule) => rule.id === editing)
  const save = (edit: (draft: AzNetTopology, connection: AzVpnConnection) => void) => {
    try {
      updateChecked(topology, commit, (draft) => edit(draft, draft.vpnConnections.find((connection) => connection.id === connectionId)!))
      setError(''); return true
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); return false }
  }
  return <>
    <VpnNatGatewayEditor topology={topology} targetKind={connection.targetKind} targetId={connection.targetId} commit={commit} />
    <section className="aznet-card" data-testid="vpn-nat-connection-editor">
      <h3>{t('Connection-owned VPN overlap NAT')}</h3>
      <p><code>{connection.id}</code></p>
      <p>{t('IngressSNAT maps branch sources into Azure; EgressSNAT maps Azure sources toward the branch. Each rule also reverses destinations; do not create a separate DNAT rule.')}</p>
      <p>{t('Static 1:1 allows initiation from either side. Dynamic rules allow internal-side initiation only, with a conditional response for that exact assessed flow.')}</p>
      <p>{t('Classic BGP peers must be excluded from NAT internal ranges in this model. VWAN peers inside a mapping require the static translated peer; a dynamic range needs a separate static /32 peer rule. APIPA is unsupported.')}</p>
      {!vpnNatGateway(topology, connection) ? <p role="status">{t('Declare the gateway capability before adding connection rules.')}</p> : <>
        <ul>{connection.nat?.rules.map((entry) => <li key={entry.id}>
          <strong>{entry.name}</strong>{' '}<code>{entry.mode} {entry.type}: {entry.internalMapping} ↔ {entry.externalMapping}</code>{' '}
          <button type="button" onClick={() => setEditing(entry.id)}>{t('Edit VPN NAT rule')} {entry.name}</button>{' '}
          <button type="button" onClick={() => {
            if (save((_draft, target) => {
              target.nat!.rules = target.nat!.rules.filter((rule) => rule.id !== entry.id)
              if (!target.nat!.rules.length) delete target.nat
            })) setEditing('')
          }}>{t('Delete VPN NAT rule')} {entry.name}</button>
        </li>)}</ul>
        <button type="button" onClick={() => setEditing('')}>{t('New VPN NAT rule')}</button>
        <form key={JSON.stringify([rule, connection.nat?.bgpPeerIp, connection.nat?.bgpPeerTranslatedIp])} onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const instance = String(data.get('instance'))
          const next: VpnNatRule = {
            id: rule?.id ?? `vpn-nat-${crypto.randomUUID()}`, name: String(data.get('name')).trim(),
            mode: String(data.get('mode')) as VpnNatRule['mode'], type: String(data.get('type')) as VpnNatRule['type'],
            internalMapping: String(data.get('internal')).trim(), externalMapping: String(data.get('external')).trim(),
            ...(instance ? { ipConfigurationId: instance as VpnNatRule['ipConfigurationId'] } : {}),
          }
          if (save((_draft, target) => {
            target.nat ??= { purpose: 'overlap', connectionType: 'IPsec', trafficSelectors: 'route-based', rules: [] }
            target.nat.rules = [...target.nat.rules.filter((rule) => rule.id !== next.id), next]
            const peer = String(data.get('peer')).trim(), translatedPeer = String(data.get('translatedPeer')).trim()
            if (peer || target.bgpEnabled) target.nat.bgpPeerIp = peer
            else delete target.nat.bgpPeerIp
            if (translatedPeer || target.bgpEnabled) target.nat.bgpPeerTranslatedIp = translatedPeer
            else delete target.nat.bgpPeerTranslatedIp
            target.nat.onPremisesRoutes = String(data.get('manualRoutes')).split(/[,\s]+/).filter(Boolean)
          })) setEditing(next.id)
        }}>
          <label className="field">{t('VPN NAT rule name')}<input name="name" required maxLength={120} defaultValue={rule?.name ?? ''} /></label>
          <label className="field">{t('VPN NAT mode')}<select name="mode" defaultValue={rule?.mode ?? 'IngressSNAT'}>
            <option>IngressSNAT</option><option>EgressSNAT</option></select></label>
          <label className="field">{t('VPN NAT type')}<select name="type" defaultValue={rule?.type ?? 'Static'}>
            <option>Static</option><option>Dynamic</option></select></label>
          <label className="field">{t('Internal mapping (pre-NAT IPv4 CIDR)')}<input name="internal" required defaultValue={rule?.internalMapping ?? ''} /></label>
          <label className="field">{t('External mapping (post-NAT IPv4 CIDR)')}<input name="external" required defaultValue={rule?.externalMapping ?? ''} /></label>
          <label className="field">{t('VPN gateway instance')}<select name="instance" defaultValue={rule?.ipConfigurationId ?? (connection.targetKind === 'vnet-gateway' ? 'default' : '')}>
            {connection.targetKind === 'vnet-gateway' ? <option value="default">default</option> : <>
              <option value="">{t('Both instances (static only)')}</option><option value="0">0</option><option value="1">1</option></>}
          </select></label>
          <label className="field">{t('Original on-premises BGP peer IPv4')}<input name="peer" required={connection.bgpEnabled} defaultValue={connection.nat?.bgpPeerIp ?? ''} /></label>
          <label className="field">{t('Configured post-NAT BGP peer IPv4')}<input name="translatedPeer" required={connection.bgpEnabled} defaultValue={connection.nat?.bgpPeerTranslatedIp ?? ''} /></label>
          {!connection.bgpEnabled && <p>{t('Optional while BGP is disabled; declare both peers before enabling BGP.')}</p>}
          <label className="field">{t('Explicit on-premises static routes (post-NAT CIDRs; comma-separated)')}
            <input name="manualRoutes" defaultValue={connection.nat?.onPremisesRoutes?.join(', ') ?? ''} /></label>
          <button type="submit">{t('Save VPN NAT rule')}</button>
        </form>
      </>}
      {error && <p role="alert">{t('VPN NAT edit rejected.')}{' '}{error}</p>}
    </section>
    {connection.nat && <VpnNatPacketInspector key={JSON.stringify([connection, vpnNatGateway(topology, connection)])} topology={topology} connection={connection} />}
  </>
}

function VpnNatPacketInspector({ topology, connection }: { topology: AzNetTopology; connection: AzVpnConnection }) {
  const [assessment, setAssessment] = useState<{ topology: AzNetTopology; result: VpnNatPacketResult }>()
  const result = assessment?.topology === topology ? assessment.result : undefined
  const [error, setError] = useState('')
  const tupleText = (tuple: NonNullable<VpnNatPacketResult['forward']['tuple']>) => `${tuple.sourceAddress}:${tuple.sourcePort} → ${tuple.destinationAddress}:${tuple.destinationPort} (${tuple.protocol})`
  return <section className="aznet-card" data-testid="vpn-nat-packet-inspector">
    <h3>{t('VPN NAT packet assessment')}</h3>
    <p>{t('Enter the initiator-visible destination, using the external mapping when required. Native route tables, UDRs, peering and hub association still decide the path; NAT does not create routes.')}</p>
    <form onSubmit={(event) => {
      event.preventDefault()
      try {
        const data = new FormData(event.currentTarget)
        setAssessment({ topology, result: traceVpnNatPacket(topology, { connectionId: connection.id, direction: String(data.get('direction')) as 'ingress' | 'egress', tuple: {
          sourceAddress: String(data.get('source')).trim(), destinationAddress: String(data.get('destination')).trim(),
          sourcePort: Number(data.get('sourcePort')), destinationPort: Number(data.get('destinationPort')),
          protocol: String(data.get('protocol')) as 'tcp' | 'udp',
        } }) })
        setError('')
      } catch (error) { setAssessment(undefined); setError(error instanceof Error ? error.message : String(error)) }
    }}>
      <label className="field">{t('VPN initiation direction')}<select name="direction"><option value="ingress">{t('Branch to Azure')}</option><option value="egress">{t('Azure to branch')}</option></select></label>
      <label className="field">{t('VPN source IPv4')}<input name="source" required /></label>
      <label className="field">{t('VPN destination IPv4')}<input name="destination" required /></label>
      <label className="field">{t('VPN packet protocol')}<select name="protocol"><option>tcp</option><option>udp</option></select></label>
      <label className="field">{t('VPN source port')}<input name="sourcePort" type="number" min={1} max={65535} defaultValue={49152} required /></label>
      <label className="field">{t('VPN destination port')}<input name="destinationPort" type="number" min={1} max={65535} defaultValue={443} required /></label>
      <button type="submit">{t('Assess VPN NAT packet')}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {result && <div data-testid="vpn-nat-packet-result" aria-live="polite">
      <p>{t('VPN routing and translation only; security and application delivery are not assessed.')}</p>
      {[result.forward, result.reply].map((leg) => <section key={leg.direction} data-testid={`vpn-nat-${leg.direction}`}>
        <h4>{t(leg.direction === 'forward' ? 'Forward VPN routing' : 'Conditional VPN reply')}: {t(leg.routing)}</h4>
        {leg.tuple && <code>{tupleText(leg.tuple)}</code>}
        <ol>{leg.steps.map((step, index) => {
          const rule = connection.nat?.rules.find((rule) => rule.id === step.entity.id)
          return <li key={index}><p>{rule?.name}: <code>{rule?.mode} {rule?.type} {rule?.internalMapping} ↔ {rule?.externalMapping}</code></p>
            <p>{t(leg.direction === 'reply' ? 'Paired reverse mapping; no separate DNAT rule.'
              : rule?.type === 'Dynamic' ? 'Illustrative dynamic source allocation; internal-side initiation only.'
                : 'Static 1:1 address offset mapping; either side may initiate.')}</p>
            <code>{tupleText(step.before)} / {step.after && tupleText(step.after)}</code></li>
        })}</ol>
        {leg.native && !Array.isArray(leg.native) && <details><summary>{t('Native VPN forwarding evidence')}</summary><ol>{leg.native.hops.map((hop) =>
          <li key={hop.index}>{hop.detail}</li>)}</ol></details>}
        {leg.reasons.map((reason) => <p key={reason}>{reason}</p>)}
      </section>)}
      <p>{t('Dynamic allocations are illustrative and isolated to this assessment; no capacity, timeout or live session state is predicted.')}</p>
    </div>}
  </section>
}
