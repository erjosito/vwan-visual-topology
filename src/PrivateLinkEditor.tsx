import { useState } from 'react'
import { t } from './i18n'
import './packet-messages-ja'
import { sameInventoryOwner, type InventoryOwner, type InventoryTopology, type PrivateEndpointConnection } from './inventory'

export function PrivateLinkEditor({ topology, owner, change }: {
  topology: InventoryTopology; owner: InventoryOwner; change: (update: (draft: InventoryTopology) => void) => boolean
}) {
  const [query, setQuery] = useState('')
  if (topology.version !== 2 || owner.kind !== 'vnet') return null
  const vnet = topology.vnets.find((vnet) => vnet.id === owner.id)!
  const services = topology.inventory?.privateLinkServices ?? []
  const local = services.filter((service) => sameInventoryOwner(service.owner, owner))
  const frontends = (topology.inventory?.loadBalancers ?? []).filter((lb) => sameInventoryOwner(lb.owner, owner))
    .flatMap((lb) => lb.frontends.filter((frontend) => frontend.kind === 'private')
      .map((frontend) => ({ lb, frontend, key: JSON.stringify([lb.id, frontend.id]) })))
  const endpoints = vnet.subnets.flatMap((subnet) => (subnet.privateEndpoints ?? []).map((endpoint) => ({ endpoint, subnet })))
  const matchingServices = local.filter((service) => `${service.id} ${service.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const matchingEndpoints = endpoints.filter(({ endpoint }) => `${endpoint.id} ${endpoint.name} ${endpoint.ipAddress}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <details data-testid="private-link-editor">
    <summary>{t('Private Link services and connections')}</summary>
    <p>{t('Declare original approved service bindings, not VNet transit. One provider NAT configuration and ordinary Standard internal LB rules are assessed; Proxy Protocol v2 and Application Gateway private connectivity are separate.')}</p>
    <label>{t('Search original services and endpoints')}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {(matchingServices.length > 100 || matchingEndpoints.length > 100) && <p>{t('Showing up to 100 matching services and endpoints. Search to narrow the list.')}</p>}
    {matchingServices.slice(0, 100).map((service) => <article key={service.id}>
      <strong>{service.name}</strong> <code>{service.id}</code>
      <p><code>{service.loadBalancerId} / {service.frontendId}</code> · {service.provisioningState} · {service.natIpConfigurations.map((config) => config.privateIp).join(', ')}</p>
      <form key={JSON.stringify([service.provisioningState, service.proxyProtocol])} onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        change((draft) => {
          const entry = draft.inventory!.privateLinkServices!.find((entry) => entry.id === service.id)!
          entry.provisioningState = data.get('provisioned') === 'on' ? 'succeeded' : 'unknown'
          entry.proxyProtocol = data.get('proxy') === 'on'
        })
      }}>
        <label><input type="checkbox" name="provisioned" defaultChecked={service.provisioningState === 'succeeded'} />{t('Declare successful service provisioning (unverified)')}</label>
        <label><input type="checkbox" name="proxy" defaultChecked={service.proxyProtocol} />{t('Proxy Protocol v2 enabled (not assessed)')}</label>
        <button type="submit">{t('Save service state')}</button>
      </form>
      <button type="button" onClick={() => change((draft) => {
        draft.inventory!.privateLinkServices = draft.inventory!.privateLinkServices!.filter((entry) => entry.id !== service.id)
        draft.inventory!.privateEndpointConnections = draft.inventory!.privateEndpointConnections?.filter((entry) => entry.serviceId !== service.id)
      })}>{t('Remove service binding')}</button>
    </article>)}
    {!!frontends.length && <form data-testid="create-private-link-service" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget, data = new FormData(form)
      const binding = frontends.find((entry) => entry.key === data.get('frontend'))!
      if (change((draft) => {
        if (draft.version !== 2) return
        const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
        ;(inventory.privateLinkServices ??= []).push({ id: `pls-${crypto.randomUUID()}`, name: String(data.get('name')), owner,
          loadBalancerId: binding.lb.id, frontendId: binding.frontend.id,
          natIpConfigurations: [{ id: `pls-nat-${crypto.randomUUID()}`, subnetId: String(data.get('subnet')), privateIp: String(data.get('address')).trim() }],
          provisioningState: data.get('provisioned') === 'on' ? 'succeeded' : 'unknown', proxyProtocol: false })
        if (data.get('disablePolicies') === 'on') {
          draft.vnets.find((vnet) => vnet.id === owner.id)!.subnets.find((subnet) => subnet.id === data.get('subnet'))!.privateLinkServiceNetworkPolicies = 'Disabled'
        }
      })) form.reset()
    }}>
      <h4>{t('Declare Private Link Service')}</h4>
      <label>{t('Service name')}<input name="name" required maxLength={120} /></label>
      <label>{t('Original provider LB frontend')}<select name="frontend" aria-label={t('Original provider LB frontend')}>{frontends.map((entry) => <option key={entry.key} value={entry.key}>{entry.lb.name} / {entry.frontend.name}</option>)}</select></label>
      <label>{t('Provider NAT subnet')}<select name="subnet" aria-label={t('Provider NAT subnet')}>{vnet.subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.name} · {subnet.prefix}</option>)}</select></label>
      <label>{t('Provider NAT IPv4')}<input name="address" required /></label>
      <label><input type="checkbox" name="disablePolicies" />{t('Explicitly disable Private Link Service network policies on this NAT subnet')}</label>
      <label><input type="checkbox" name="provisioned" />{t('Declare successful service provisioning (unverified)')}</label>
      <button type="submit">{t('Add original service binding')}</button>
    </form>}
    {matchingEndpoints.slice(0, 100).map(({ endpoint }) => {
      const connection = topology.inventory?.privateEndpointConnections?.find((connection) => connection.privateEndpointId === endpoint.id)
      return <form key={JSON.stringify([endpoint.id, connection])} data-testid={`private-endpoint-binding-${endpoint.id}`} onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget), serviceId = String(data.get('service'))
        change((draft) => {
          const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
          inventory.privateEndpointConnections = (inventory.privateEndpointConnections ?? []).filter((entry) => entry.privateEndpointId !== endpoint.id)
          if (serviceId) inventory.privateEndpointConnections.push({ id: connection?.id ?? `pe-connection-${crypto.randomUUID()}`,
            privateEndpointId: endpoint.id, serviceId, state: String(data.get('state')) as PrivateEndpointConnection['state'] })
        })
      }}>
        <h4>{endpoint.name} <code>{endpoint.id} · {endpoint.ipAddress}</code></h4>
        <label>{t('Original provider service')}<select name="service" aria-label={t('Original provider service')} defaultValue={connection?.serviceId ?? ''}>
          <option value="">{t('Unknown service binding')}</option>
          {services.map((service) => <option key={service.id} value={service.id}>{service.name} / {service.owner.id}</option>)}
        </select></label>
        <label>{t('Declared connection approval')}<select name="state" aria-label={t('Declared connection approval')} defaultValue={connection?.state ?? 'unknown'}>
          {(['unknown', 'pending', 'approved', 'rejected', 'disconnected'] as const).map((state) => <option key={state} value={state}>{t(state)}</option>)}
        </select></label>
        <button type="submit">{t('Save Private Endpoint binding')}</button>
      </form>
    })}
  </details>
}
