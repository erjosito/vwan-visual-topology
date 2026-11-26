import { useState } from 'react'
import { t } from './i18n'
import './application-messages-ja'
import { sameInventoryOwner, type InventoryOwner, type InventoryTopology } from './inventory'
import { validateFirewallProxyInventory } from './application-inventory'

export function FirewallProxyEditor({ topology, owner, change }: {
  topology: InventoryTopology; owner: InventoryOwner; change: (update: (draft: InventoryTopology) => void) => boolean
}) {
  const [selectedId, select] = useState('')
  const [error, setError] = useState(false)
  if (topology.version !== 2 || owner.kind !== 'vnet') return null
  const appliances = topology.vnets.find((entry) => entry.id === owner.id)!.appliances.filter((entry) => entry.kind === 'azure-firewall')
  if (!appliances.length) return null
  const services = (topology.application?.services ?? []).filter((entry) => entry.kind === 'azure-firewall' && entry.owner && sameInventoryOwner(entry.owner, owner))
  const selected = services.find((entry) => entry.id === selectedId), config = selected?.firewallProxy
  const complete = config?.configuration === 'complete' && config.parentPolicy === 'none' && config.dnat === 'none'
    && config.threatIntelligence === 'off' && config.idps === 'off' && config.tlsInspection === 'off'
  return <details data-testid="firewall-proxy-editor">
    <summary>{t('Original Firewall proxy policy')}</summary>
    <p>{t('Use an existing Firewall appliance and original policy, collection, rule and DNS binding IDs. JSON edits are validated before saving. No resources, DNS answers or serving-instance IPs are discovered.')}</p>
    <label>{t('Original Firewall service')}<select aria-label={t('Original Firewall service')} value={selected?.id ?? ''} onChange={(event) => { select(event.target.value); setError(false) }}>
      <option value="">{t('New Firewall service binding')}</option>
      {services.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.id})</option>)}
    </select></label>
    <form key={JSON.stringify([selected, selectedId])} data-testid="firewall-proxy-form" onSubmit={(event) => {
      event.preventDefault()
      setError(false)
      const data = new FormData(event.currentTarget), id = selected?.id ?? `firewall-service-${crypto.randomUUID()}`
      try {
        const collections: unknown = JSON.parse(String(data.get('collections')))
        const dnsBindings: unknown = JSON.parse(String(data.get('dnsBindings')))
        const known = data.get('complete') === 'on'
        if (change((draft) => {
          const application = draft.application ??= { version: 1, services: [], dnsProfiles: [] }
          let service = application.services.find((entry) => entry.id === id)
          if (!service) { service = { id, name: String(data.get('name')), kind: 'azure-firewall', owner, references: [], unsupportedFeatures: [] }; application.services.push(service) }
          const applianceId = String(data.get('appliance')), previousId = service.firewallProxy?.applianceId
          const candidate = { ...service, firewallProxy: {
            applianceId, policyId: String(data.get('policyId')), sku: data.get('sku'),
            configuration: known ? 'complete' : 'unknown', parentPolicy: known ? 'none' : 'unknown', dnat: known ? 'none' : 'unknown',
            threatIntelligence: known ? 'off' : 'unknown', idps: known ? 'off' : 'unknown', tlsInspection: known ? 'off' : 'unknown',
            provisioningState: data.get('provisioned') === 'on' ? 'succeeded' : 'unknown',
            explicitProxy: { enabled: data.get('enabled') === 'on', httpPort: Number(data.get('proxyPort')) }, collections, dnsBindings,
          } }
          validateFirewallProxyInventory(draft, candidate, new Set())
          service.name = String(data.get('name')); service.firewallProxy = candidate.firewallProxy
          service.references = service.references.filter((ref) => ref.kind !== 'appliance' || !sameInventoryOwner(ref.owner, owner) || ref.id !== previousId)
          if (!service.references.some((ref) => ref.kind === 'appliance' && sameInventoryOwner(ref.owner, owner) && ref.id === applianceId)) service.references.push({ kind: 'appliance', owner, id: applianceId })
        })) select(id)
        else setError(true)
      } catch {
        setError(true)
      }
    }}>
      <label>{t('Firewall service name')}<input name="name" required maxLength={120} defaultValue={selected?.name} /></label>
      <label>{t('Original Firewall appliance')}<select aria-label={t('Original Firewall appliance')} name="appliance" required defaultValue={config?.applianceId}>
        {appliances.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({entry.id})</option>)}
      </select></label>
      <label>{t('Original Firewall policy ID')}<input name="policyId" required maxLength={120} defaultValue={config?.policyId} /></label>
      <label>{t('Firewall SKU')}<select aria-label={t('Firewall SKU')} name="sku" defaultValue={config?.sku ?? 'Standard'}><option>Standard</option><option>Premium</option></select></label>
      <label><input name="enabled" type="checkbox" defaultChecked={config?.explicitProxy.enabled} />{t('Enable explicit proxy in the declared policy')}</label>
      <label>{t('Firewall proxy port')}<input name="proxyPort" type="number" min={1} max={65535} required defaultValue={config?.explicitProxy.httpPort ?? 3128} /></label>
      <label><input name="complete" type="checkbox" defaultChecked={complete} />{t('Declare complete policy without inheritance, DNAT, threat intelligence, IDPS or TLS inspection (unverified)')}</label>
      <label><input name="provisioned" type="checkbox" defaultChecked={config?.provisioningState === 'succeeded'} />{t('Declare successful service provisioning (unverified)')}</label>
      <label>{t('Original policy collections (JSON)')}<textarea aria-label={t('Original policy collections (JSON)')} name="collections" rows={10} required maxLength={200000} defaultValue={JSON.stringify(config?.collections ?? [], null, 2)} /></label>
      <label>{t('Original DNS bindings (JSON)')}<textarea aria-label={t('Original DNS bindings (JSON)')} name="dnsBindings" rows={8} required maxLength={100000} defaultValue={JSON.stringify(config?.dnsBindings ?? [], null, 2)} /></label>
      <button type="submit">{t('Save original Firewall policy')}</button>
    </form>
    {error && <p role="alert">{t('Firewall policy was not saved. Check JSON syntax, original identities, priorities and dedicated Firewall subnet.')}</p>}
    {config && <button type="button" onClick={() => {
      setError(!change((draft) => { delete draft.application!.services.find((entry) => entry.id === selected!.id)!.firewallProxy }))
    }}>{t('Remove Firewall provider configuration')}</button>}
  </details>
}
