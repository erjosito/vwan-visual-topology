import { useRef, useState } from 'react'
import './packet-messages-ja'
import { t } from './i18n'
import { natGatewayForSubnet, sameInventoryOwner, type InventoryOwner, type InventoryTopology } from './inventory'

export function NatGatewayEditor({ topology, owner, subnetId, change }: {
  topology: InventoryTopology
  owner: InventoryOwner
  subnetId: string
  change: (update: (draft: InventoryTopology) => void) => boolean
}) {
  const [pool, setPool] = useState('addresses')
  const action = useRef<HTMLButtonElement>(null)
  const focusAction = () => requestAnimationFrame(() => action.current?.focus({ preventScroll: true }))
  const gateway = natGatewayForSubnet(topology, owner, subnetId)
  const available = topology.inventory?.natGateways?.filter((gateway) => sameInventoryOwner(gateway.owner, owner)) ?? []
  const originalSubnet = topology.version === 2 ? topology.vnets.find((vnet) => vnet.id === owner.id)?.subnets.find((subnet) => subnet.id === subnetId) : undefined
  return <details className="nat-gateway-editor" data-testid="nat-gateway-editor">
    <summary>{t('Internet egress')}{gateway ? `: ${gateway.name}` : ''}</summary>
    <p>{t('Standard IPv4 TCP/UDP only. NAT Gateway applies after a direct Internet route is selected; it does not override UDRs to NVAs, gateways or hubs, and never permits unsolicited ingress.')}</p>
    {originalSubnet?.internetEgressStatus && <p role="status">{t('Captured outbound association is incomplete or unsupported. Egress remains unknown until explicitly configured.')}</p>}
    {originalSubnet && <label><input type="checkbox" checked={originalSubnet.defaultOutboundAccess === false} onChange={(event) => {
      const enabled = !event.target.checked
      change((draft) => {
        if (draft.version === 2) draft.vnets.find((vnet) => vnet.id === owner.id)!.subnets.find((subnet) => subnet.id === subnetId)!.defaultOutboundAccess = enabled
      })
    }} />{t('Disable legacy default outbound access')}</label>}
    <label>{t('NAT Gateway association')}<select aria-label={t('NAT Gateway association')} value={gateway ? `gateway:${gateway.id}` : originalSubnet?.internetEgressStatus ? 'unknown' : 'none'} onChange={(event) => {
      if (event.target.value === 'unknown') return
      const id = event.target.value.startsWith('gateway:') ? event.target.value.slice(8) : ''
      change((draft) => {
        if (draft.version === 2) delete draft.vnets.find((vnet) => vnet.id === owner.id)!.subnets.find((subnet) => subnet.id === subnetId)!.internetEgressStatus
        for (const gateway of draft.inventory?.natGateways ?? []) {
          if (sameInventoryOwner(gateway.owner, owner)) gateway.subnetIds = gateway.subnetIds.filter((value) => value !== subnetId)
          if (gateway.id === id) gateway.subnetIds.push(subnetId)
        }
      })
    }}>
      {originalSubnet?.internetEgressStatus && <option value="unknown" disabled>{t('Unknown captured association')}</option>}
      <option value="none">{t('No explicit NAT Gateway')}</option>
      {available.map((gateway) => <option key={gateway.id} value={`gateway:${gateway.id}`}>{gateway.name}</option>)}
    </select></label>
    {gateway ? <form key={JSON.stringify([gateway, topology.inventory?.publicIps, topology.inventory?.publicIpPrefixes])} onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      if (change((draft) => {
        const target = draft.inventory!.natGateways!.find((entry) => entry.id === gateway.id)!
        target.name = String(data.get('name'))
        for (const id of target.publicIpIds) {
          const ip = draft.inventory!.publicIps.find((entry) => entry.id === id)!
          const address = String(data.get(id)).trim()
          if (address) ip.address = address
          else delete ip.address
        }
        for (const id of target.publicIpPrefixIds ?? []) {
          const prefix = draft.inventory!.publicIpPrefixes!.find((entry) => entry.id === id)!
          const value = String(data.get(id)).trim()
          if (value) prefix.prefix = value
          else delete prefix.prefix
        }
      })) focusAction()
    }}>
      <label>{t('NAT Gateway name')}<input name="name" required maxLength={120} defaultValue={gateway.name} /></label>
      <p><code>{gateway.id}</code> · {t('Original owner')}: <code>{owner.id}</code> · {t('Associated subnets')}: {gateway.subnetIds.length}</p>
      {gateway.publicIpIds.map((id) => <label key={id}>{t('Public IPv4 address (blank means unknown)')}
        <input name={id} defaultValue={topology.inventory?.publicIps.find((entry) => entry.id === id)?.address ?? ''} />
      </label>)}
      {gateway.publicIpPrefixIds?.map((id) => <label key={id}>{t('Public IPv4 prefix (blank means unknown)')}
        <input name={id} defaultValue={topology.inventory?.publicIpPrefixes?.find((entry) => entry.id === id)?.prefix ?? ''} />
      </label>)}
      <button ref={action} type="submit">{t('Save NAT Gateway')}</button>
      <button type="button" onClick={() => { if (change((draft) => {
        draft.inventory!.natGateways = draft.inventory!.natGateways!.filter((entry) => entry.id !== gateway.id)
      })) focusAction() }}>{t('Remove NAT Gateway from all associated subnets')}</button>
    </form> : <form onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget, data = new FormData(form), id = `nat-${crypto.randomUUID()}`
      const name = String(data.get('name')), addresses = String(data.get('addresses') ?? '').split(',').map((address) => address.trim())
      const prefix = String(data.get('prefix') ?? '').trim(), prefixId = `prefix-${crypto.randomUUID()}`
      const ips = addresses.map((address, index) => ({ id: `pip-${crypto.randomUUID()}`, name: `${name} public IP ${index + 1}`,
        sku: 'Standard' as const, allocation: 'Static' as const, ...(address ? { address } : {}) }))
      if (change((draft) => {
        if (draft.version === 2) delete draft.vnets.find((vnet) => vnet.id === owner.id)!.subnets.find((subnet) => subnet.id === subnetId)!.internetEgressStatus
        const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
        if (pool === 'addresses') inventory.publicIps.push(...ips)
        else (inventory.publicIpPrefixes ??= []).push({ id: prefixId, name: `${name} public prefix`, sku: 'Standard',
          prefixLength: Number(data.get('prefixLength')), ...(prefix ? { prefix } : {}) })
        ;(inventory.natGateways ??= []).push({ id, name, sku: 'Standard', owner, subnetIds: [subnetId],
          publicIpIds: pool === 'addresses' ? ips.map((ip) => ip.id) : [],
          ...(pool === 'prefix' ? { publicIpPrefixIds: [prefixId] } : {}) })
      })) { form.reset(); focusAction() }
    }}>
      <h5>{t('Declare NAT Gateway')}</h5>
      <label>{t('NAT Gateway name')}<input name="name" required maxLength={120} /></label>
      <label>{t('Public address pool')}<select aria-label={t('Public address pool')} value={pool} onChange={(event) => setPool(event.target.value)}>
        <option value="addresses">{t('Standard static public IPs')}</option><option value="prefix">{t('Standard public IPv4 prefix')}</option>
      </select></label>
      {pool === 'addresses' ? <label>{t('Public IPv4 addresses (comma-separated; blank means unknown)')}<input name="addresses" /></label> : <>
        <label>{t('Public IPv4 prefix (blank means unknown)')}<input name="prefix" placeholder="20.40.50.64/31" /></label>
        <label>{t('Prefix length')}<select name="prefixLength" defaultValue="31">
          {[28, 29, 30, 31].map((length) => <option key={length} value={length}>/{length}</option>)}
        </select></label>
      </>}
      <button ref={action} type="submit">{t('Add NAT Gateway')}</button>
    </form>}
  </details>
}
