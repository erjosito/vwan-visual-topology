import { useEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { inventoryOwners, pruneDeletedInventory, sameInventoryOwner, validateInventory, type InventoryOwner, type InventoryTopology } from './inventory'
import { PacketFlowPanel } from './PacketFlowPanel'
import { NatGatewayEditor } from './NatGatewayEditor'
import { RouterSnatEditor } from './RouterSnatEditor'
import { NsgEditor } from './NsgEditor'
import { DnatEditor } from './DnatEditor'
import { LoadBalancerEditor } from './LoadBalancerEditor'
import type { Simulation } from './routing'
import type { AzSimulationResult } from './azure-net/engine'
import './network-detail.css'
import './network-detail-messages-ja'
import { contains, ipv4 } from './validation'
import { ApplicationFlowPanel } from './ApplicationFlowPanel'
import { applicationProjection, validateApplicationInventory, type ApplicationResult } from './application'
import { revisionOf } from './platform/service'
import { TopologyContextMenu, type ContextAction } from './TopologyContextMenu'
import { networkDetailProjection, type DetailEntity, type DetailTarget } from './network-detail-projection'
import { NetworkDetailAttachments } from './NetworkDetailAttachments'

export interface DetailBoundary { direction: 'forward' | 'reply'; destination: string; evidence: string; subnetIds: string[] }

export function NetworkDetail({ topology, owner, simulation, selectedId, selectedTargetId, boundaries = [], returnFocus, onSelect, onSelectTarget, onApplianceAction, getContextActions, commit, onClose }: {
  topology: InventoryTopology
  owner: InventoryOwner
  simulation: Simulation | AzSimulationResult
  selectedId?: string
  selectedTargetId?: string
  boundaries?: DetailBoundary[]
  returnFocus?: Element | null
  onSelect: (id: string) => void
  onSelectTarget?: (target: DetailTarget) => void
  onApplianceAction?: (vnetId: string, applianceId: string, action: 'configure' | 'routes') => void
  getContextActions?: (target: DetailTarget) => ContextAction[]
  commit: (update: (draft: InventoryTopology) => void) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef(document.activeElement)
  const closeButton = useRef<HTMLButtonElement>(null)
  const saveButton = useRef<HTMLButtonElement>(null)
  const pendingAction = useRef<(() => void) | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [subnetQuery, setSubnetQuery] = useState('')
  const [subnetPage, setSubnetPage] = useState(0)
  const [menu, setMenu] = useState<{ title: string; actions: ContextAction[]; x: number; y: number; invoker: HTMLElement }>()
  const [error, setError] = useState('')
  const [declarePublicIp, setDeclarePublicIp] = useState(false)
  const [applicationEvidence, setApplicationEvidence] = useState<{ topology: InventoryTopology; result?: ApplicationResult }>()
  const applicationResult = applicationEvidence?.topology === topology ? applicationEvidence.result : undefined
  const applicationSelection = applicationProjection(topology, owner, applicationResult)
  const network = inventoryOwners(topology).find((entry) => sameInventoryOwner(entry, owner))
  const nics = (topology.inventory?.nics ?? []).filter((nic) => sameInventoryOwner(nic.owner, owner))
  const workloads = (topology.inventory?.workloads ?? []).filter((workload) => workload.nicIds.some((id) => nics.some((nic) => nic.id === id)))
  const matchingWorkloads = workloads.filter((workload) => [workload.name, workload.id,
    ...nics.filter((nic) => workload.nicIds.includes(nic.id)).flatMap((nic) => [nic.name, ...nic.ipConfigurations.map((config) => config.privateIp ?? '')])]
    .join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const selected = workloads.find((workload) => workload.id === selectedId)
  const visible = matchingWorkloads.slice(0, 100)
  if (selected && matchingWorkloads.includes(selected) && !visible.includes(selected)) {
    if (visible.length === 100) visible.pop()
    visible.push(selected)
  }
  const entities = networkDetailProjection(topology, owner)
  const matchingSubnets = (network?.subnets ?? []).filter((subnet) => [subnet.id, subnet.name, subnet.prefix].join(' ').toLocaleLowerCase().includes(subnetQuery.toLocaleLowerCase()))
  const currentSubnetPage = Math.min(subnetPage, Math.max(0, Math.ceil(matchingSubnets.length / 100) - 1))
  const change = (update: (draft: InventoryTopology) => void) => {
    try {
      const candidate = structuredClone(topology)
      update(candidate)
      pruneDeletedInventory(candidate, topology)
      validateInventory(candidate)
      validateApplicationInventory(candidate)
      commit(update)
      setError('')
      return true
    } catch (error) { setError(error instanceof Error ? error.message : t('Inventory edit failed.')); return false }
  }
  useEffect(() => {
    const previous = returnFocus ?? opener.current
    dialog.current?.showModal()
    closeButton.current?.focus()
    return () => {
      if (previous?.isConnected && 'focus' in previous) (previous as HTMLElement).focus({ preventScroll: true })
      const action = pendingAction.current
      pendingAction.current = undefined
      if (action) queueMicrotask(action)
    }
  }, [returnFocus])
  const close = () => dialog.current?.close()
  const leaveFor = (action: () => void) => { pendingAction.current = action; close() }
  const focusEditor = (selector: string) => {
    const element = dialog.current?.querySelector<HTMLElement>(selector)
    if (!element) return
    for (let ancestor: HTMLElement | null = element; ancestor && ancestor !== dialog.current; ancestor = ancestor.parentElement) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
    }
    element.scrollIntoView({ block: 'center' })
    ;(element.matches('button, input, select, summary') ? element : element.querySelector<HTMLElement>('summary, button, input, select'))?.focus()
  }
  const selectWorkload = (id: string) => {
    setQuery('')
    onSelect(id)
    requestAnimationFrame(() => focusEditor('[data-testid="selected-workload-form"] input'))
  }
  const sharedActions = (target: DetailTarget): ContextAction[] => (getContextActions?.(target) ?? []).map(function wrap(action): ContextAction {
    return { ...action, children: action.children?.map(wrap),
      ...(action.run || action.onSelect ? { run: () => {
        // Release the top-layer modal before an overview inspector or another dialog takes focus.
        leaveFor(() => (action.run ?? action.onSelect)?.())
      }, onSelect: undefined } : {}) }
  })
  const openActions = (title: string, actions: ContextAction[], invoker: HTMLElement, x: number, y: number) => {
    setMenu({ title, actions, invoker, x, y })
  }
  const entityActions = (entity: DetailEntity, invoker: HTMLElement, x: number, y: number) => {
    if (entity.target) onSelectTarget?.(entity.target)
    const actions = entity.target ? sharedActions(entity.target) : []
    for (const id of entity.workloadIds) {
      const workload = workloads.find((workload) => workload.id === id)
      if (workload) actions.unshift({ label: t('Edit workload: {0}', workload.name), run: () => selectWorkload(id) })
    }
    if (entity.kind === 'nic') {
      const backingIds = workloads.filter((workload) => entity.workloadIds.includes(workload.id)).flatMap((workload) => workload.backingDeviceId ? [workload.backingDeviceId] : [])
      for (const device of entities.filter((candidate) => backingIds.includes(candidate.id) && candidate.target)) {
        actions.push({ label: `${t(device.label)}: ${device.name}`, children: sharedActions(device.target!) })
      }
    }
    if (entity.kind === 'nic') {
      const workload = workloads.find((workload) => entity.workloadIds.includes(workload.id))
      actions.push({ label: t('NIC NSG'), disabled: !workload, run: workload ? () => {
        setQuery(workload.id)
        onSelect(workload.id)
        requestAnimationFrame(() => focusEditor(`[data-testid=${JSON.stringify(`nsg-editor-nic-${entity.id}`)}]`))
      } : undefined })
    }
    if (entity.kind === 'nat') actions.push({ label: t('Internet egress'), run: () => {
      const subnet = invoker.closest<HTMLElement>('[data-subnet-id]')
        ?? dialog.current?.querySelector<HTMLElement>(`[data-subnet-id=${JSON.stringify(entity.subnetIds[0])}]`)
      const editor = subnet?.querySelector<HTMLDetailsElement>('.nat-gateway-editor')
      if (editor) { editor.open = true; editor.scrollIntoView({ block: 'center' }); editor.querySelector('summary')?.focus() }
    } })
    if (entity.kind === 'load-balancer') actions.push({ label: t('Standard Load Balancers'), run: () => focusEditor('[data-testid="load-balancer-editor"]') })
    if (entity.kind === 'private-endpoint' && entity.subnetIds[0]) {
      const subnetId = entity.subnetIds[0], children = sharedActions({ kind: 'subnet', id: subnetId })
      if (children.length) actions.push({ label: t('Subnet actions: {0}', network?.subnets.find((subnet) => subnet.id === subnetId)?.name ?? subnetId), children })
    }
    if (!actions.length) actions.push({ label: t('Declared association only; no device actions are modeled.'), disabled: true })
    openActions(entity.name, actions, invoker, x, y)
  }
  return <dialog ref={dialog} className="object-dialog network-detail" aria-labelledby="network-detail-title"
    data-testid="network-detail-dialog" onClose={onClose} onCancel={(event) => { event.preventDefault(); close() }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (menu) { menu.invoker.focus(); setMenu(undefined) } else close() }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')]
          .filter((entry) => entry.getClientRects().length > 0)
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
      }
    }}>
    <header className="row dialog-heading"><h2 id="network-detail-title">{t('VNet detail')}: {network?.name ?? t('Unavailable')}</h2>
      <button ref={closeButton} type="button" onClick={close} aria-label={t('Close VNet detail')}>{t('Close')}</button></header>
    {!network ? <p role="status">{t('The original network is no longer available. No replacement network is shown.')}</p> : <>
      <p><code>{owner.id}</code> · {network.prefixes.join(', ')}</p>
      <button type="button" onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        onSelectTarget?.({ kind: 'network', id: owner.id })
        openActions(network.name, sharedActions({ kind: 'network', id: owner.id }), event.currentTarget, bounds.left, bounds.bottom)
      }}>{t('Network actions')}</button>
      <p>{t('This is a view of the original topology. Workloads are endpoints, not extra routers. Declare original NSGs, NAT, ingress and Standard Load Balancers without adding global Internet links.')}</p>
      {error && <p role="alert" className="notice error">{error}</p>}
      {boundaries.length > 0 && <section aria-label={t('Selected flow boundaries')}>
        <h3>{t('Selected flow boundaries')}</h3>
        {boundaries.slice(0, 16).map((boundary, index) => <p key={index}>
          <strong>{t(boundary.direction === 'forward' ? 'Forward routing' : 'Reply routing')}</strong>{' → '}
          <code>{boundary.destination}</code>: {boundary.evidence}
        </p>)}
        <p>{t('External destinations remain boundary references; no global Internet links are added.')}</p>
      </section>}
      <div className="network-detail-graph">
        <section aria-label={t('Subnets and NIC attachments')}>
          <h3>{t('Subnets and NIC attachments')}</h3>
          <p>{t('Containers and arrows show declared attachments, not forwarding links. Right-click or press Shift+F10 for actions.')}</p>
          <label>{t('Search subnets')}<input type="search" value={subnetQuery} onChange={(event) => { setSubnetQuery(event.target.value); setSubnetPage(0) }} /></label>
          {!network.subnets.length && <p>{t('No detailed subnets have been declared. No workload addressing is inferred from VNet prefixes.')}</p>}
          {matchingSubnets.slice(currentSubnetPage * 100, (currentSubnetPage + 1) * 100).map((subnet) => {
            const attached = nics.filter((nic) => nic.ipConfigurations.some((config) => config.subnetId === subnet.id))
            const directions = [...new Set(boundaries.filter((boundary) => boundary.subnetIds.includes(subnet.id)
              || (ipv4(boundary.destination) !== undefined && contains(subnet.prefix, ipv4(boundary.destination)!))).map((boundary) => boundary.direction))]
            const subnetActions = () => { onSelectTarget?.({ kind: 'subnet', id: subnet.id }); return [...sharedActions({ kind: 'subnet', id: subnet.id }),
              { label: t('Subnet NSG'), run: () => focusEditor(`[data-testid=${JSON.stringify(`nsg-editor-subnet-${subnet.id}`)}]`) }]
            }
            return <article className="detail-subnet" key={subnet.id} data-testid="detail-subnet" data-subnet-id={subnet.id}>
              <h4><button type="button" className="detail-subnet-target" aria-label={`${t('Subnet')}: ${subnet.name}`}
                aria-pressed={selectedTargetId === subnet.id}
                onClick={(event) => { const bounds = event.currentTarget.getBoundingClientRect(); openActions(subnet.name, subnetActions(), event.currentTarget, bounds.left, bounds.bottom) }}
                onContextMenu={(event) => { event.preventDefault(); openActions(subnet.name, subnetActions(), event.currentTarget, event.clientX, event.clientY) }}
                onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
                  event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect()
                  openActions(subnet.name, subnetActions(), event.currentTarget, bounds.left, bounds.bottom)
                } }}>{subnet.name}</button></h4><code>{subnet.prefix}</code> · <code>{subnet.id}</code>
              {applicationSelection.subnetIds.has(subnet.id) && <p data-testid="application-subnet-reference"><strong>{t('Selected application reference')}</strong>: <code>{subnet.id}</code></p>}
              {directions.map((direction) => <p key={direction}><strong>{t(direction === 'forward' ? 'Forward routing' : 'Reply routing')}</strong></p>)}
              <p>{t('{0} NIC attachments', attached.length)}</p>
              <p className="detail-attachment-label">{t('Declared attachments')} ↓</p>
              <NetworkDetailAttachments key={subnet.id} entities={entities.filter((entity) => entity.subnetIds.includes(subnet.id))}
                workloads={workloads} selectedId={selectedId} selectedTargetId={selectedTargetId} subnetId={subnet.id} onSelect={selectWorkload} onActions={entityActions} />
              <NatGatewayEditor topology={topology} owner={owner} subnetId={subnet.id} change={change} />
              <NsgEditor topology={topology} owner={owner} target={{ kind: 'subnet', id: subnet.id }} change={change} />
              {topology.version === 2 && topology.vnets.find((vnet) => vnet.id === owner.id)?.appliances
                .filter((device) => device.subnetId === subnet.id && device.kind === 'vnra').map((device) => <div key={device.id} data-testid="detail-vnra">
                  <strong>{t('Managed VNRA')}: {device.name}</strong> · <code>{device.privateIp}</code> · <code>{device.id}</code>
                  {onApplianceAction && <div>
                    <button type="button" onClick={() => leaveFor(() => onApplianceAction(owner.id, device.id, 'configure'))}>{t('Configure Managed VNRA')}</button>
                    <button type="button" onClick={() => leaveFor(() => onApplianceAction(owner.id, device.id, 'routes'))}>{t('Inspect Appliance Subnet Effective Routes')}</button>
                  </div>}
                </div>)}
              {topology.version === 2 && topology.vnets.find((vnet) => vnet.id === owner.id)?.appliances
                .filter((device) => device.subnetId === subnet.id && device.kind !== 'vnra').map((device) => <div key={device.id}>
                  <RouterSnatEditor topology={topology} owner={{ kind: 'appliance', id: device.id }} name={device.name}
                    kind={device.kind === 'azure-firewall' ? 'firewall-network-rules' : 'nva-snat'} change={change} />
                  <DnatEditor topology={topology} owner={{ kind: 'appliance', id: device.id }} name={device.name}
                    kind={device.kind === 'azure-firewall' ? 'firewall-dnat' : 'nva-dnat'} change={change} />
                </div>)}
            </article>
          })}
          {matchingSubnets.length > 100 && <div className="row">
            <button type="button" disabled={currentSubnetPage === 0} onClick={() => setSubnetPage(currentSubnetPage - 1)}>{t('Previous subnets')}</button>
            <span role="status">{t('Subnet page {0} of {1}', currentSubnetPage + 1, Math.ceil(matchingSubnets.length / 100))}</span>
            <button type="button" disabled={(currentSubnetPage + 1) * 100 >= matchingSubnets.length} onClick={() => setSubnetPage(currentSubnetPage + 1)}>{t('Next subnets')}</button>
          </div>}
          {entities.some((entity) => !entity.subnetIds.length) && <section className="detail-network-devices" aria-label={t('Network-level associations')}>
            <h4>{t('Network-level associations')}</h4>
            <p>{t('No subnet association is declared for these entities. Gateway subnets are not inferred.')}</p>
            <NetworkDetailAttachments entities={entities.filter((entity) => !entity.subnetIds.length)}
              workloads={workloads} selectedId={selectedId} selectedTargetId={selectedTargetId} onSelect={selectWorkload} onActions={entityActions} />
          </section>}
          {owner.kind === 'spoke' && <form onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget, data = new FormData(form), id = `subnet-${crypto.randomUUID()}`
            if (change((draft) => {
              if (draft.version !== 1) return
              const spoke = draft.spokes.find((spoke) => spoke.id === owner.id)!
              ;(spoke.subnets ??= []).push({ id, name: String(data.get('name')), prefix: String(data.get('prefix')) })
            })) form.reset()
          }}>
            <h4>{t('Declare subnet')}</h4>
            <label>{t('Subnet name')}<input name="name" required maxLength={120} /></label>
            <label>{t('Subnet prefix')}<input name="prefix" required placeholder="10.1.1.0/24" /></label>
            <button type="submit">{t('Add detailed subnet')}</button>
          </form>}
        </section>
        <section aria-label={t('Named workloads')}>
          <details open className="detail-workload-inventory"><summary>{t('Workload inventory and NIC policies')}</summary>
          <h3>{t('Named workloads')} ({workloads.length})</h3>
          <label>{t('Search workloads')}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <p role="status">{t('Showing {0} of {1} workloads', visible.length, workloads.length)}</p>
          {visible.map((workload) => <article key={workload.id} className="detail-workload" data-selected={selectedId === workload.id}>
            <button type="button" aria-pressed={selectedId === workload.id} onClick={() => onSelect(workload.id)}>{workload.name}</button>
            <code>{workload.id}</code>
            {applicationSelection.workloadIds.has(workload.id) && <p data-testid="application-workload-reference"><strong>{t('Selected application reference')}</strong></p>}
            {workload.backingDeviceId && <p>{t('Existing router backing identity')}: <code>{workload.backingDeviceId}</code></p>}
            {nics.filter((nic) => workload.nicIds.includes(nic.id)).map((nic) => <div key={nic.id}>
              <strong>{nic.name}</strong>
              {nic.ipConfigurations.map((config) => <p key={config.id} className="detail-association">
                <code>{config.privateIp ?? t('Address unknown')}</code>{' → '}
                {network.subnets.find((subnet) => subnet.id === config.subnetId)?.name}
                {config.publicIpId && <> · {t('Public IP')}: <code>{topology.inventory?.publicIps.find((entry) => entry.id === config.publicIpId)?.address ?? t('Address unknown')}</code> ({t('association only; translation not assessed')})</>}
              </p>)}
              <NsgEditor topology={topology} owner={owner} target={{ kind: 'nic', id: nic.id }} change={change} />
            </div>)}
          </article>)}
          {!workloads.length && <p>{t('No named workloads are declared. Legacy subnet probes remain available; they are not discovered VMs.')}</p>}
          </details>
        </section>
      </div>
      <ApplicationFlowPanel key={revisionOf(topology)} topology={topology} owner={owner} result={applicationResult}
        onResult={(result) => setApplicationEvidence({ topology, result })} />
      <LoadBalancerEditor topology={topology} owner={owner} change={change} onSelect={(id) => { setQuery(''); onSelect(id) }} />
      {selected && <form data-testid="selected-workload-form" key={JSON.stringify([selected, nics.filter((nic) => selected.nicIds.includes(nic.id)), topology.inventory?.publicIps])} onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        const saved = change((draft) => {
          const inventory = draft.inventory!
          inventory.workloads.find((workload) => workload.id === selected.id)!.name = String(data.get('name'))
          for (const nic of inventory.nics.filter((nic) => selected.nicIds.includes(nic.id))) {
            nic.name = String(data.get(JSON.stringify(['nicName', nic.id])))
            for (const config of nic.ipConfigurations) {
              const address = String(data.get(JSON.stringify(['privateIp', nic.id, config.id]))).trim()
              if (address) config.privateIp = address
              else delete config.privateIp
              const primary = String(data.get(JSON.stringify(['primary', nic.id, config.id])))
              if (primary === 'unknown') delete config.primary
              else config.primary = primary === 'primary'
              if (config.publicIpId) {
                const publicIp = inventory.publicIps.find((entry) => entry.id === config.publicIpId)!
                const address = String(data.get(JSON.stringify(['publicIp', publicIp.id]))).trim()
                if (address) publicIp.address = address
                else delete publicIp.address
              }
            }
          }
        })
        if (saved) requestAnimationFrame(() => saveButton.current?.focus({ preventScroll: true }))
      }}>
        <h3>{t('Selected workload')}</h3>
        <label>{t('Workload name')}<input name="name" required defaultValue={selected.name} maxLength={120} /></label>
        {nics.filter((nic) => selected.nicIds.includes(nic.id)).map((nic) => <fieldset key={nic.id}>
          <legend>{nic.name}</legend>
          <label>{t('NIC name')}<input name={JSON.stringify(['nicName', nic.id])} required defaultValue={nic.name} maxLength={120} /></label>
          {nic.ipConfigurations.map((config) => <div key={config.id}>
            <label>{config.name} · {t('IPv4 association role')}<select name={JSON.stringify(['primary', nic.id, config.id])}
              aria-label={`${config.name} · ${t('IPv4 association role')}`} defaultValue={config.primary === undefined ? 'unknown' : config.primary ? 'primary' : 'secondary'}>
              <option value="unknown">{t('Unknown')}</option><option value="primary">{t('Primary')}</option><option value="secondary">{t('Secondary')}</option>
            </select></label>
            <label>{config.name} · {t('Private IPv4 address (blank means unknown)')}
              <input name={JSON.stringify(['privateIp', nic.id, config.id])} defaultValue={config.privateIp ?? ''} />
            </label>
            {config.publicIpId && <label>{t('Public IPv4 address (blank means unknown)')}
              <input name={JSON.stringify(['publicIp', config.publicIpId])} defaultValue={topology.inventory?.publicIps.find((entry) => entry.id === config.publicIpId)?.address ?? ''} />
            </label>}
          </div>)}
        </fieldset>)}
        <button ref={saveButton} type="submit">{t('Save workload')}</button>
        <button type="button" onClick={() => {
          if (change((draft) => {
            draft.inventory!.workloads = draft.inventory!.workloads.filter((workload) => workload.id !== selected.id)
            draft.inventory!.nics = draft.inventory!.nics.filter((nic) => !selected.nicIds.includes(nic.id))
          })) { onSelect(''); closeButton.current?.focus() }
        }}>{t('Remove workload and NICs')}</button>
      </form>}
      <form data-testid="add-workload-form" onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget, data = new FormData(form)
        const id = `vm-${crypto.randomUUID()}`, nicId = `nic-${crypto.randomUUID()}`, configId = `ip-${crypto.randomUUID()}`, publicIpId = `pip-${crypto.randomUUID()}`
        const name = String(data.get('name')), address = String(data.get('address')).trim(), publicAddress = String(data.get('publicAddress')).trim()
        if (change((draft) => {
          const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
          inventory.workloads.push({ id, name, nicIds: [nicId] })
          inventory.nics.push({ id: nicId, name: `${name} NIC`, owner, ipConfigurations: [{
            id: configId, name: 'Primary', primary: true, subnetId: String(data.get('subnet')),
            ...(address ? { privateIp: address } : {}), ...(data.get('publicIp') ? { publicIpId } : {}),
          }] })
          if (data.get('publicIp')) inventory.publicIps.push({ id: publicIpId, name: `${name} public IP`, sku: 'Standard', allocation: 'Static', ...(publicAddress ? { address: publicAddress } : {}) })
        })) { form.reset(); setDeclarePublicIp(false); onSelect(id) }
      }}>
        <h3>{t('Add named workload')}</h3>
        <label>{t('Workload name')}<input name="name" required maxLength={120} /></label>
        <label>{t('Subnet')}<select name="subnet" required defaultValue="" aria-label={t('Subnet')}><option value="" disabled>{t('Select subnet')}</option>
          {network.subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.name} · {subnet.prefix}</option>)}
        </select></label>
        <label>{t('Private IPv4 address (blank means unknown)')}<input name="address" /></label>
        <label><input type="checkbox" name="publicIp" checked={declarePublicIp} onChange={(event) => setDeclarePublicIp(event.target.checked)} />{t('Declare public IP association')}</label>
        <label>{t('Public IPv4 address (blank means unknown)')}<input name="publicAddress" disabled={!declarePublicIp} /></label>
        <button type="submit" disabled={!network.subnets.length}>{t('Add workload and NIC')}</button>
      </form>
      <PacketFlowPanel topology={topology} simulation={simulation} guidanceVnetId={owner.kind === 'vnet' ? owner.id : undefined} onHighlight={(id) => {
        if (workloads.some((workload) => workload.id === id)) { setQuery(''); onSelect(id) }
      }} />
    </>}
    {menu && <TopologyContextMenu x={menu.x} y={menu.y} title={menu.title} actions={menu.actions}
      onClose={() => { if (menu.invoker.isConnected) menu.invoker.focus({ preventScroll: true }); setMenu(undefined) }} />}
  </dialog>
}
