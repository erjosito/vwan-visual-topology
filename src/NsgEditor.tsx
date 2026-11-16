import { useState } from 'react'
import { t } from './i18n'
import './packet-messages-ja'
import { nsgAssociation, sameInventoryOwner, type InventoryOwner, type InventoryTopology, type NetworkSecurityRule, type NsgAssociation } from './inventory'
import { defaultNsgRules } from './packet-security'

export function NsgEditor({ topology, owner, target, change }: {
  topology: InventoryTopology
  owner: InventoryOwner
  target: NsgAssociation['target']
  change: (update: (draft: InventoryTopology) => void) => boolean
}) {
  const [editing, setEditing] = useState<string>()
  const binding = nsgAssociation(topology, owner, target)
  const group = topology.inventory?.networkSecurityGroups?.find((group) => group.id === binding?.nsgId)
  const rule = group?.rules.find((rule) => rule.id === editing)
  const removeBinding = (draft: InventoryTopology) => {
    if (draft.inventory?.nsgAssociations) draft.inventory.nsgAssociations = draft.inventory.nsgAssociations.filter((binding) =>
      !sameInventoryOwner(binding.owner, owner) || binding.target.kind !== target.kind || binding.target.id !== target.id)
  }
  return <details className="nsg-editor" data-testid={`nsg-editor-${target.kind}-${target.id}`}>
    <summary>NSG · {target.kind}: {group?.name ?? target.id}</summary>
    <p>{t('Both original subnet and NIC NSGs must allow a new flow. Rules use private tuples at the enforcement point; an allow does not supply routing, NAT, a listener or guest/firewall permission.')}</p>
    {binding?.status && <p role="status">{t('Captured NSG association is incomplete or unsupported.')}</p>}
    <label>{t('NSG association')}<select aria-label={t('NSG association')} value={binding?.status ? 'unknown' : group ? `group:${group.id}` : 'none'} onChange={(event) => {
      const value = event.target.value
      if (value === 'unknown') return
      if (change((draft) => {
        removeBinding(draft)
        if (value.startsWith('group:')) (draft.inventory!.nsgAssociations ??= []).push({ owner, target, nsgId: value.slice(6) })
      })) setEditing(undefined)
    }}>
      {binding?.status && <option value="unknown" disabled>{t('Unknown captured association')}</option>}
      <option value="none">{t('No associated NSG')}</option>
      {topology.inventory?.networkSecurityGroups?.map((group) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}
    </select></label>
    {!group ? <form onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget, name = String(new FormData(form).get('name')), id = `nsg-${crypto.randomUUID()}`
      if (change((draft) => {
        const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
        const region = topology.version === 2 ? topology.vnets.find((vnet) => vnet.id === owner.id)?.region : undefined
        ;(inventory.networkSecurityGroups ??= []).push({ id, name, rules: [], ...(region ? { region } : {}) })
        removeBinding(draft)
        ;(inventory.nsgAssociations ??= []).push({ owner, target, nsgId: id })
      })) form.reset()
    }}>
      <label>{t('NSG name')}<input name="name" required maxLength={120} /></label>
      <button type="submit">{t('Declare default-only NSG')}</button>
    </form> : <>
      <p><code>{group.id}</code> · {t('Shared original NSG; editing its rules affects every associated subnet/NIC.')}</p>
      {group.rulesStatus && <p role="status">{t('Captured NSG rules are incomplete. No permission is inferred.')}</p>}
      {group.rulesStatus && <button type="button" onClick={() => change((draft) => {
        delete draft.inventory!.networkSecurityGroups!.find((entry) => entry.id === group.id)!.rulesStatus
      })}>{t('Declare this edited rule set complete')}</button>}
      <ul>{[...group.rules].sort((a, b) => a.priority - b.priority).map((rule) => <li key={rule.id}>
        <code>{rule.priority} · {rule.direction} · {rule.action} · {rule.protocol}</code> · {rule.name}
        <button type="button" onClick={() => setEditing(rule.id)}>{t('Edit NSG rule')}</button>
        <button type="button" onClick={() => {
          if (change((draft) => {
            const target = draft.inventory!.networkSecurityGroups!.find((entry) => entry.id === group.id)!
            target.rules = target.rules.filter((entry) => entry.id !== rule.id)
          }) && editing === rule.id) setEditing(undefined)
        }}>{t('Delete NSG rule')}</button>
      </li>)}</ul>
      <form key={`${group.id}:${editing ?? 'new'}`} onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const selectors = (name: string) => String(data.get(name)).split(',').map((value) => value.trim())
        const next: NetworkSecurityRule = { id: rule?.id ?? `nsg-rule-${crypto.randomUUID()}`, name: String(data.get('name')),
          priority: Number(data.get('priority')), direction: data.get('direction') as NetworkSecurityRule['direction'],
          action: data.get('action') as NetworkSecurityRule['action'], protocol: data.get('protocol') as NetworkSecurityRule['protocol'],
          sources: selectors('sources'), destinations: selectors('destinations'),
          sourcePorts: selectors('sourcePorts'), destinationPorts: selectors('destinationPorts') }
        if (change((draft) => {
          const target = draft.inventory!.networkSecurityGroups!.find((entry) => entry.id === group.id)!
          const index = target.rules.findIndex((entry) => entry.id === next.id)
          if (index < 0) target.rules.push(next)
          else target.rules[index] = next
        })) setEditing(next.id)
      }}>
        <h5>{t(rule ? 'Edit NSG rule' : 'Add NSG rule')}</h5>
        <label>{t('NSG rule name')}<input name="name" required maxLength={80} defaultValue={rule?.name ?? ''} /></label>
        <label>{t('NSG priority')}<input type="number" name="priority" min="100" max="4096" required defaultValue={rule?.priority ?? 100} /></label>
        <label>{t('NSG direction')}<select name="direction" aria-label={t('NSG direction')} defaultValue={rule?.direction ?? 'inbound'}><option value="inbound">{t('Inbound')}</option><option value="outbound">{t('Outbound')}</option></select></label>
        <label>{t('NSG action')}<select name="action" aria-label={t('NSG action')} defaultValue={rule?.action ?? 'allow'}><option value="allow">{t('Allow')}</option><option value="deny">{t('Deny')}</option></select></label>
        <label>{t('NSG protocol')}<select name="protocol" aria-label={t('NSG protocol')} defaultValue={rule?.protocol ?? 'tcp'}>
          <option value="tcp">TCP</option><option value="udp">UDP</option><option value="any">{t('Any')}</option>
          {rule && !['tcp', 'udp', 'any'].includes(rule.protocol) && <option value={rule.protocol}>{rule.protocol} ({t('not-assessed')})</option>}
        </select></label>
        {(['sources', 'destinations', 'sourcePorts', 'destinationPorts'] as const).map((field) => <label key={field}>
          {t({ sources: 'NSG source addresses/tags', destinations: 'NSG destination addresses/tags', sourcePorts: 'NSG source ports', destinationPorts: 'NSG destination ports' }[field])}
          <input name={field} required defaultValue={rule?.[field].join(', ') ?? '*'} />
        </label>)}
        <p>{t('Comma-separated IPv4/CIDRs or one service tag; comma-separated ports/ranges or *. Dynamic tags, ASGs and unsupported protocols remain unassessed, never wildcard-allowed.')}</p>
        <button type="submit">{t('Save NSG rule')}</button>
        {editing && <button type="button" onClick={() => setEditing(undefined)}>{t('Add another NSG rule')}</button>}
      </form>
      <details><summary>{t('Built-in NSG default rules')}</summary><ul>{['inbound', 'outbound'].flatMap((direction) =>
        defaultNsgRules(direction as NetworkSecurityRule['direction']).map((rule) =>
          <li key={`${direction}:${rule.id}`}><code>{rule.priority} · {rule.direction} · {rule.action}</code> · {rule.name}</li>))}</ul></details>
      <button type="button" onClick={() => change((draft) => {
        draft.inventory!.networkSecurityGroups = draft.inventory!.networkSecurityGroups!.filter((entry) => entry.id !== group.id)
        draft.inventory!.nsgAssociations = draft.inventory!.nsgAssociations?.filter((binding) => binding.nsgId !== group.id)
      })}>{t('Delete NSG and all its associations')}</button>
    </>}
  </details>
}
