import { useState } from 'react'
import { t } from './i18n'
import './application-messages-ja'
import { sameInventoryOwner, type InventoryOwner, type InventoryTopology } from './inventory'
import { packetEndpointOptions } from './packet-flow'
import type { TcpProxyConfiguration } from './application'

export function TcpProxyEditor({ topology, owner, change }: {
  topology: InventoryTopology; owner: InventoryOwner; change: (update: (draft: InventoryTopology) => void) => boolean
}) {
  const [selectedId, select] = useState('')
  if (topology.version !== 2 || owner.kind !== 'vnet') return null
  const services = (topology.application?.services ?? []).filter((service) => service.kind === 'application-gateway' && service.owner && sameInventoryOwner(service.owner, owner))
  const selected = services.find((service) => service.id === selectedId), config = selected?.tcpProxy
  const subnets = topology.vnets.find((vnet) => vnet.id === owner.id)!.subnets
  const endpoints = packetEndpointOptions(topology, t('Address unknown'))
  const selectedBackend = config && endpoints.find((entry) => entry.ref.workloadId === config.backend.workloadId
    && entry.ref.nicId === config.backend.nicId && entry.ref.ipConfigurationId === config.backend.ipConfigurationId)
  return <details data-testid="tcp-proxy-editor">
    <summary>{t('Application Gateway private TCP proxy')}</summary>
    <p>{t('Declare one original private listener, serving instance and workload backend. The backend TCP connection starts at the instance address, not the client or frontend. TLS, HTTP/WAF, autoscale and live health remain unverified.')}</p>
    <label>{t('Original TCP gateway')}<select aria-label={t('Original TCP gateway')} value={selected?.id ?? ''} onChange={(event) => select(event.target.value)}>
      <option value="">{t('New original gateway')}</option>
      {services.map((service) => <option key={service.id} value={service.id}>{service.name} ({service.id})</option>)}
    </select></label>
    <form key={JSON.stringify([selected, selectedId])} data-testid="tcp-proxy-form" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget, data = new FormData(form), backend = endpoints.find((entry) => entry.key === data.get('backend'))!
      const id = selected?.id ?? `appgw-${crypto.randomUUID()}`
      if (change((draft) => {
        const application = draft.application ??= { version: 1, services: [], dnsProfiles: [] }
        let service = application.services.find((service) => service.id === id)
        if (!service) { service = { id, name: String(data.get('name')), kind: 'application-gateway', owner, references: [], unsupportedFeatures: [] }; application.services.push(service) }
        service.name = String(data.get('name'))
        const previousSubnet = service.tcpProxy?.subnetId, subnetId = String(data.get('subnet'))
        service.references = service.references.filter((ref) => ref.kind !== 'subnet' || !sameInventoryOwner(ref.owner, owner) || ref.id !== previousSubnet)
        if (!service.references.some((ref) => ref.kind === 'subnet' && sameInventoryOwner(ref.owner, owner) && ref.id === subnetId)) service.references.push({ kind: 'subnet', owner, id: subnetId })
        const frontendAddress = String(data.get('frontend')).trim(), instanceAddress = String(data.get('instance')).trim()
        service.tcpProxy = { sku: String(data.get('sku')) as TcpProxyConfiguration['sku'], subnetId,
          ...(frontendAddress ? { frontendAddress } : {}), ...(instanceAddress ? { instanceAddress } : {}),
          listenerId: config?.listenerId ?? `listener-${crypto.randomUUID()}`, ruleId: config?.ruleId ?? `rule-${crypto.randomUUID()}`,
          rulePriority: Number(data.get('priority')), poolId: config?.poolId ?? `pool-${crypto.randomUUID()}`,
          frontendPort: Number(data.get('frontendPort')), backendPort: Number(data.get('backendPort')),
          backend: { workloadId: backend.ref.workloadId, nicId: backend.ref.nicId, ipConfigurationId: backend.ref.ipConfigurationId },
          declaredHealth: String(data.get('health')) as TcpProxyConfiguration['declaredHealth'],
          provisioningState: data.get('provisioned') === 'on' ? 'succeeded' : 'unknown', proxyProtocol: data.get('proxyProtocol') === 'on' }
      })) select(id)
    }}>
      <label>{t('TCP gateway name')}<input name="name" required maxLength={120} defaultValue={selected?.name} /></label>
      <label>{t('Gateway SKU')}<select name="sku" aria-label={t('Gateway SKU')} defaultValue={config?.sku ?? 'Standard_v2'}><option>Standard_v2</option><option>WAF_v2</option></select></label>
      <label>{t('Dedicated gateway subnet')}<select name="subnet" aria-label={t('Dedicated gateway subnet')} defaultValue={config?.subnetId}>
        {subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.name} · {subnet.prefix}</option>)}
      </select></label>
      <label>{t('Private frontend IPv4 (blank means unknown)')}<input name="frontend" defaultValue={config?.frontendAddress} /></label>
      <label>{t('Serving instance IPv4 (blank means unknown)')}<input name="instance" defaultValue={config?.instanceAddress} /></label>
      <label>{t('TCP listener port')}<input name="frontendPort" type="number" min={1} max={65535} required defaultValue={config?.frontendPort ?? 1433} /></label>
      <label>{t('Original rule priority')}<input name="priority" type="number" min={1} max={20000} required defaultValue={config?.rulePriority ?? 100} /></label>
      <label>{t('Original TCP backend')}<select name="backend" aria-label={t('Original TCP backend')} required defaultValue={selectedBackend?.key}>
        {endpoints.map((endpoint) => <option key={endpoint.key} value={endpoint.key}>{endpoint.label}</option>)}
      </select></label>
      <label>{t('Backend TCP port')}<input name="backendPort" type="number" min={1} max={65535} required defaultValue={config?.backendPort ?? 1433} /></label>
      <label>{t('Declared default TCP probe health')}<select name="health" aria-label={t('Declared default TCP probe health')} defaultValue={config?.declaredHealth ?? 'unknown'}>
        {(['unknown', 'healthy', 'unhealthy'] as const).map((state) => <option key={state} value={state}>{t(state)}</option>)}
      </select></label>
      <label><input type="checkbox" name="provisioned" defaultChecked={config?.provisioningState === 'succeeded'} />{t('Declare successful service provisioning (unverified)')}</label>
      <label><input type="checkbox" name="proxyProtocol" defaultChecked={config?.proxyProtocol} />{t('Proxy Protocol enabled (not assessed)')}</label>
      <button type="submit" disabled={!endpoints.length || !subnets.length}>{t('Save original TCP proxy')}</button>
    </form>
    {config && <button type="button" onClick={() => change((draft) => { delete draft.application!.services.find((service) => service.id === selected!.id)!.tcpProxy })}>{t('Remove TCP provider configuration')}</button>}
  </details>
}
