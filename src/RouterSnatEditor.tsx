import { useEffect, useRef, useState } from 'react'
import './packet-messages-ja'
import { t } from './i18n'
import { validateInventory, type InventoryTopology, type PublicIp, type RouterSnatOwner, type RouterSnatPolicy } from './inventory'
import { DnatEditor } from './DnatEditor'

export function RouterSnatEditor({ topology, owner, name, kind, change }: {
  topology: InventoryTopology; owner: RouterSnatOwner; name: string; kind: RouterSnatPolicy['kind']
  change: (update: (draft: InventoryTopology) => void) => boolean
}) {
  const policy = topology.inventory?.routerSnatPolicies?.find((policy) => policy.owner.kind === owner.kind && policy.owner.id === owner.id)
  const save = useRef<HTMLButtonElement>(null)
  return <details data-testid="router-snat-editor">
    <summary>{name}: {t(kind === 'firewall-network-rules' ? 'Firewall network-rule SNAT' : 'Explicit NVA guest SNAT')}</summary>
    <p>{t('One original router and IPv4 TCP/UDP only. Routing is evaluated first. Translation and conditional responses do not prove security permission or live session state.')}</p>
    {kind === 'firewall-network-rules' ? <p>{t('IANAPrivateRanges includes RFC1918 and RFC6598. Custom ranges replace defaults. 0.0.0.0/0 means never-SNAT; 255.255.255.255/32 means always-SNAT. Application-rule proxying and auto-learn are not modeled.')}</p>
      : <p>{t('Declare one guest SNAT rule to the original NVA private interface. Unmatched tuples retain their source. IP forwarding alone does not enable NAT.')}</p>}
    <form key={JSON.stringify([policy, topology.inventory?.publicIps])} onSubmit={(event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      const split = (field: string) => String(data.get(field) ?? '').split(',').map((value) => value.trim()).filter(Boolean)
      const addresses = split('addresses')
      const ips = addresses.map((address, index) => {
        const old = topology.inventory?.publicIps.find((ip) => ip.address === address)
          ?? topology.inventory?.publicIps.find((ip) => ip.id === policy?.publicIpIds[index])
        const ip: PublicIp = old ? { ...old } : { id: `pip-${crypto.randomUUID()}`, name: `${name} SNAT public IP ${index + 1}`,
          sku: 'Standard' as const, allocation: 'Static' as const }
        if (address === '?') delete ip.address
        else ip.address = address
        return ip
      })
      const ranges = split('ranges')
      const next: RouterSnatPolicy = kind === 'firewall-network-rules'
        ? { owner, kind, publicIpIds: ips.map((ip) => ip.id), zoneRedundant: data.has('zoneRedundant'),
          ...(ranges.length ? { privateRanges: ranges } : {}) }
        : { owner, kind, publicIpIds: ips.map((ip) => ip.id), sourcePrefixes: split('sources'),
          destinationPrefixes: split('destinations'), protocol: String(data.get('protocol')) as 'tcp' | 'udp' | 'any' }
      if (change((draft) => {
        const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
        for (const ip of ips) {
          const index = inventory.publicIps.findIndex((entry) => entry.id === ip.id)
          if (index < 0) inventory.publicIps.push(ip)
          else inventory.publicIps[index] = ip
        }
        inventory.routerSnatPolicies = [...(inventory.routerSnatPolicies ?? []).filter((entry) => entry.owner.kind !== owner.kind || entry.owner.id !== owner.id), next]
      })) requestAnimationFrame(() => save.current?.focus())
    }}>
      <label>{t('Router public IPv4 pool (comma-separated; ? means unknown; blank means no declared pool)')}
        <input name="addresses" defaultValue={policy?.publicIpIds.map((id) => topology.inventory?.publicIps.find((ip) => ip.id === id)?.address ?? '?').join(', ') ?? ''} />
      </label>
      {kind === 'firewall-network-rules' ? <><label>{t('Firewall private/shared SNAT exclusions')}
        <input name="ranges" defaultValue={policy?.kind === 'firewall-network-rules' ? policy.privateRanges?.join(', ') ?? 'IANAPrivateRanges' : 'IANAPrivateRanges'} />
      </label><label><input type="checkbox" name="zoneRedundant" defaultChecked={policy?.kind === 'firewall-network-rules' && policy.zoneRedundant === true} />
        {t('Zone-redundant Firewall (not supported with Standard NAT Gateway)')}</label></> : <>
        <label>{t('Guest SNAT source prefixes')}<input name="sources" required defaultValue={policy?.kind === 'nva-snat' ? policy.sourcePrefixes.join(', ') : '0.0.0.0/0'} /></label>
        <label>{t('Guest SNAT destination prefixes')}<input name="destinations" required defaultValue={policy?.kind === 'nva-snat' ? policy.destinationPrefixes.join(', ') : '0.0.0.0/0'} /></label>
        <label>{t('Guest SNAT protocol')}<select name="protocol" defaultValue={policy?.kind === 'nva-snat' ? policy.protocol : 'any'}>
          <option value="any">TCP / UDP</option><option value="tcp">TCP</option><option value="udp">UDP</option>
        </select></label>
      </>}
      <button ref={save} type="submit">{t('Save router SNAT')}</button>
      {policy && <button type="button" onClick={() => {
        if (change((draft) => { draft.inventory!.routerSnatPolicies = draft.inventory!.routerSnatPolicies!.filter((entry) =>
          entry.owner.kind !== owner.kind || entry.owner.id !== owner.id) })) requestAnimationFrame(() => save.current?.focus())
      }}>{t('Remove explicit router SNAT')}</button>}
    </form>
  </details>
}

export function RouterSnatDialog({ topology, owner, name, commit, onClose }: {
  topology: InventoryTopology; owner: RouterSnatOwner; name: string
  commit: (update: (draft: InventoryTopology) => void) => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement)
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = opener.current
    dialog.current?.showModal()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} className="object-dialog" aria-label={t('Firewall SNAT')} onClose={onClose}>
    <header className="row dialog-heading"><h2>{t('Firewall SNAT')}: {name}</h2><button onClick={() => dialog.current?.close()}>{t('Close')}</button></header>
    {error && <p role="alert">{error}</p>}
    <RouterSnatEditor topology={topology} owner={owner} name={name} kind="firewall-network-rules" change={(update) => {
      try {
        const next = structuredClone(topology); update(next); validateInventory(next); commit(update); setError(''); return true
      } catch (error) { setError(error instanceof Error ? error.message : t('Inventory edit failed.')); return false }
    }} />
    <DnatEditor topology={topology} owner={owner} name={name} kind="firewall-dnat" change={(update) => {
      try {
        const next = structuredClone(topology); update(next); validateInventory(next); commit(update); setError(''); return true
      } catch (error) { setError(error instanceof Error ? error.message : t('Inventory edit failed.')); return false }
    }} />
  </dialog>
}
