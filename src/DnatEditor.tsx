import { useRef, useState } from 'react'
import './packet-messages-ja'
import { t } from './i18n'
import { namedEndpoints, type DnatRule, type InventoryTopology, type PublicIp, type RouterDnatPolicy, type RouterSnatOwner } from './inventory'
import { packetEndpointOptions } from './packet-flow'

export function DnatEditor({ topology, owner, name, kind, change }: {
  topology: InventoryTopology; owner: RouterSnatOwner; name: string; kind: RouterDnatPolicy['kind']
  change: (update: (draft: InventoryTopology) => void) => boolean
}) {
  const policy = topology.inventory?.routerDnatPolicies?.find((policy) => policy.owner.kind === owner.kind && policy.owner.id === owner.id)
  const [selectedId, setSelectedId] = useState('')
  const selected = policy?.rules.find((rule) => rule.id === selectedId)
  const save = useRef<HTMLButtonElement>(null)
  const endpoints = packetEndpointOptions(topology).filter((option) =>
    !namedEndpoints(topology).find((entry) => entry.workload.id === option.ref.workloadId)?.workload.backingDeviceId)
  const targetKey = selected ? endpoints.find((option) => option.ref.workloadId === selected.target.workloadId
    && option.ref.nicId === selected.target.nicId && option.ref.ipConfigurationId === selected.target.ipConfigurationId)?.key ?? '' : ''
  return <details data-testid="router-dnat-editor">
    <summary>{name}: {t(kind === 'firewall-dnat' ? 'Firewall public DNAT' : 'Explicit NVA guest DNAT')}</summary>
    <p>{t('Explicit IPv4 TCP/UDP frontend, source filter and original backend only. A matching NAT rule does not establish downstream permission, a listener or guest readiness.')}</p>
    <p>{t(kind === 'firewall-dnat'
      ? 'Firewall public DNAT also translates the source to an illustrative AzureFirewallSubnet address, preserving the client source port. Exact instance allocation and private/forced-tunnel DNAT are not modeled.'
      : 'NVA public-IP mapping reaches its private interface before guest DNAT. Declare source preservation or private-interface SNAT explicitly; no vendor NAT behavior is inferred.')}</p>
    {owner.kind === 'hub' && <p>{t('Secured-hub private translation interfaces are not modeled; these declarations remain unassessed.')}</p>}
    <form key={JSON.stringify([policy?.publicIpIds, policy?.kind === 'nva-dnat' && policy.sourceTranslation, topology.inventory?.publicIps])}
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const addresses = String(data.get('addresses')).split(',').map((address) => address.trim()).filter(Boolean)
        const ips = addresses.map((address, index): PublicIp => {
          const old = topology.inventory?.publicIps.find((ip) => ip.address === address)
            ?? topology.inventory?.publicIps.find((ip) => ip.id === policy?.publicIpIds[index])
          const ip = old ? { ...old } : { id: `pip-${crypto.randomUUID()}`, name: `${name} DNAT frontend ${index + 1}`,
            sku: 'Standard' as const, allocation: 'Static' as const }
          if (address === '?') delete ip.address
          else ip.address = address
          return ip
        })
        const base = { owner, publicIpIds: ips.map((ip) => ip.id), rules: policy?.rules ?? [],
          ...(policy?.rulesStatus ? { rulesStatus: policy.rulesStatus } : {}) }
        const next: RouterDnatPolicy = kind === 'firewall-dnat' ? { ...base, kind }
          : { ...base, kind, sourceTranslation: String(data.get('sourceTranslation')) as 'preserve' | 'interface' }
        if (change((draft) => {
          const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
          for (const ip of ips) {
            const index = inventory.publicIps.findIndex((entry) => entry.id === ip.id)
            if (index < 0) inventory.publicIps.push(ip)
            else inventory.publicIps[index] = ip
          }
          inventory.routerDnatPolicies = [...(inventory.routerDnatPolicies ?? []).filter((policy) =>
            policy.owner.kind !== owner.kind || policy.owner.id !== owner.id), next]
        })) requestAnimationFrame(() => save.current?.focus())
      }}>
      <label>{t('DNAT public IPv4 frontends (comma-separated; ? means unknown)')}
        <input name="addresses" required defaultValue={policy?.publicIpIds.map((id) => topology.inventory?.publicIps.find((ip) => ip.id === id)?.address ?? '?').join(', ') ?? ''} />
      </label>
      {kind === 'nva-dnat' && <label>{t('Guest DNAT source translation')}
        <select name="sourceTranslation" aria-label={t('Guest DNAT source translation')} defaultValue={policy?.kind === 'nva-dnat' ? policy.sourceTranslation : 'preserve'}>
          <option value="preserve">{t('Preserve Internet client source')}</option>
          <option value="interface">{t('SNAT to original private interface')}</option>
        </select>
      </label>}
      <button ref={save} type="submit">{t('Save DNAT frontends')}</button>
      {policy && <button type="button" onClick={() => {
        if (change((draft) => { draft.inventory!.routerDnatPolicies = draft.inventory!.routerDnatPolicies!.filter((policy) =>
          policy.owner.kind !== owner.kind || policy.owner.id !== owner.id) })) setSelectedId('')
      }}>{t('Remove DNAT declaration')}</button>}
    </form>
    {policy && <>
      {policy.rulesStatus === 'unknown' && <p>{t('Captured DNAT rules are unknown; no matching permission or target is inferred.')}</p>}
      <ul>{policy.rules.map((rule) => <li key={rule.id}>
        <code>{rule.priority} · {rule.name} · {rule.protocol.toUpperCase()} · {rule.frontendPort} → {rule.translatedPort}</code>{' '}
        <button type="button" onClick={() => setSelectedId(rule.id)}>{t('Edit DNAT rule')}</button>
        <button type="button" onClick={() => {
          if (change((draft) => {
            const current = draft.inventory!.routerDnatPolicies!.find((policy) => policy.owner.kind === owner.kind && policy.owner.id === owner.id)!
            current.rules = current.rules.filter((entry) => entry.id !== rule.id)
          })) setSelectedId('')
        }}>{t('Delete DNAT rule')}</button>
      </li>)}</ul>
      <button type="button" onClick={() => setSelectedId('')}>{t('Add DNAT rule')}</button>
      <form key={JSON.stringify([selected, policy.publicIpIds])} onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget), endpoint = endpoints.find((option) => option.key === data.get('target'))!.ref
        const rule: DnatRule = { id: selected?.id ?? `dnat-rule-${crypto.randomUUID()}`, name: String(data.get('name')),
          priority: Number(data.get('priority')), protocol: String(data.get('protocol')) as 'tcp' | 'udp',
          sourcePrefixes: String(data.get('sources')).split(',').map((prefix) => prefix.trim()).filter(Boolean),
          publicIpId: String(data.get('frontend')), frontendPort: Number(data.get('frontendPort')),
          target: { workloadId: endpoint.workloadId, nicId: endpoint.nicId, ipConfigurationId: endpoint.ipConfigurationId },
          translatedPort: Number(data.get('translatedPort')) }
        if (change((draft) => {
          const current = draft.inventory!.routerDnatPolicies!.find((policy) => policy.owner.kind === owner.kind && policy.owner.id === owner.id)!
          current.rules = [...current.rules.filter((entry) => entry.id !== rule.id), rule]
          if (data.has('complete')) delete current.rulesStatus
        })) setSelectedId(rule.id)
      }}>
        <label>{t('DNAT rule name')}<input name="name" required defaultValue={selected?.name ?? ''} maxLength={120} /></label>
        <label>{t('DNAT priority')}<input name="priority" type="number" min="100" max="65000" required
          defaultValue={selected?.priority ?? Math.max(0, ...policy.rules.map((rule) => rule.priority)) + 100} /></label>
        <label>{t('DNAT protocol')}<select name="protocol" aria-label={t('DNAT protocol')} defaultValue={selected?.protocol ?? 'tcp'}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
        <label>{t('DNAT source IPv4 prefixes')}<input name="sources" required defaultValue={selected?.sourcePrefixes.join(', ') ?? '0.0.0.0/0'} /></label>
        <label>{t('DNAT frontend')}<select name="frontend" aria-label={t('DNAT frontend')} required defaultValue={selected?.publicIpId ?? policy.publicIpIds[0]}>
          {policy.publicIpIds.map((id) => <option key={id} value={id}>{topology.inventory?.publicIps.find((ip) => ip.id === id)?.name} · {topology.inventory?.publicIps.find((ip) => ip.id === id)?.address ?? '?'}</option>)}
        </select></label>
        <label>{t('DNAT frontend port')}<input name="frontendPort" type="number" min="1" max="65535" required defaultValue={selected?.frontendPort ?? 443} /></label>
        <label>{t('DNAT original backend')}<select name="target" aria-label={t('DNAT original backend')} required defaultValue={targetKey}>
          <option value="">{t('Select an IP configuration')}</option>
          {endpoints.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select></label>
        <label>{t('DNAT backend port')}<input name="translatedPort" type="number" min="1" max="65535" required defaultValue={selected?.translatedPort ?? 443} /></label>
        {policy.rulesStatus === 'unknown' && <label><input type="checkbox" name="complete" />{t('Declare this edited rule set complete')}</label>}
        <button type="submit">{t('Save DNAT rule')}</button>
      </form>
    </>}
  </details>
}
