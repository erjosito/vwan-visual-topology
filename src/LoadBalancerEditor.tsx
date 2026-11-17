import { useState } from 'react'
import './packet-messages-ja'
import { t } from './i18n'
import { inventoryOwners, namedEndpoints, sameInventoryOwner, workloadEndpointKey, type InventoryOwner, type InventoryTopology,
  type LoadBalancerFrontend, type LoadBalancerRule, type NetworkLoadBalancer, type WorkloadIpReference } from './inventory'

export function LoadBalancerEditor({ topology, owner, change, onSelect }: {
  topology: InventoryTopology; owner: InventoryOwner; change: (update: (draft: InventoryTopology) => void) => boolean; onSelect: (id: string) => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const [kind, setKind] = useState<'public' | 'private'>('public')
  const [query, setQuery] = useState('')
  const [serviceQuery, setServiceQuery] = useState('')
  const [ruleId, setRuleId] = useState('')
  const [haRule, setHaRule] = useState(false)
  const [frontendId, setFrontendId] = useState('')
  const [probeId, setProbeId] = useState('')
  const [inboundId, setInboundId] = useState('')
  const [outboundId, setOutboundId] = useState('')
  const lbs = (topology.inventory?.loadBalancers ?? []).filter((lb) => sameInventoryOwner(lb.owner, owner))
  const lb = lbs.find((lb) => lb.id === selectedId)
  const visibleLbs = lbs.filter((lb) => `${lb.name} ${lb.id}`.toLocaleLowerCase().includes(serviceQuery.toLocaleLowerCase())).slice(0, 100)
  const network = inventoryOwners(topology).find((entry) => sameInventoryOwner(entry, owner))!
  const endpoints = namedEndpoints(topology).filter((entry) => sameInventoryOwner(entry.nic.owner, owner))
    .map(({ workload, nic, config }) => ({ target: { workloadId: workload.id, nicId: nic.id, ipConfigurationId: config.id },
      label: `${workload.name} / ${nic.name} / ${config.name} (${config.privateIp ?? t('Address unknown')})` }))
  const key = (target: WorkloadIpReference) => workloadEndpointKey({ kind: 'workload', ...target })
  const label = (target: WorkloadIpReference) => endpoints.find((entry) => key(entry.target) === key(target))?.label ?? key(target)
  const update = (edit: (lb: NetworkLoadBalancer, draft: InventoryTopology) => void) => change((draft) => {
    edit(draft.inventory!.loadBalancers!.find((entry) => entry.id === lb!.id)!, draft)
  })
  const frontend = (draft: InventoryTopology, data: FormData, frontendKind: 'public' | 'private'): LoadBalancerFrontend => {
    const inventory = draft.inventory ??= { workloads: [], nics: [], publicIps: [] }
    const id = `lb-front-${crypto.randomUUID()}`, name = String(data.get('frontendName') ?? data.get('name'))
    const address = String(data.get('address')).trim()
    if (frontendKind === 'private') return { id, name, kind: frontendKind, subnetId: String(data.get('subnet')), ...(address ? { privateIp: address } : {}) }
    let ip = address ? inventory.publicIps.find((ip) => ip.address === address) : undefined
    if (!ip) {
      ip = { id: `lb-pip-${crypto.randomUUID()}`, name: `${name} public IP`, sku: 'Standard', allocation: 'Static', ...(address ? { address } : {}) }
      inventory.publicIps.push(ip)
    }
    return { id, name, kind: frontendKind, publicIpId: ip.id }
  }
  const addressFields = (frontendKind: 'public' | 'private', selected?: LoadBalancerFrontend) => <>
    {frontendKind === 'private' && <label>{t('LB frontend subnet')}<select name="subnet" aria-label={t('LB frontend subnet')} required defaultValue={selected?.kind === 'private' ? selected.subnetId : undefined}>
      {network.subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.name} · {subnet.prefix}</option>)}
    </select></label>}
    <label>{t('LB frontend IPv4 (blank means unknown)')}<input name="address" defaultValue={selected?.kind === 'private' ? selected.privateIp
      : selected?.kind === 'public' ? topology.inventory?.publicIps.find((ip) => ip.id === selected.publicIpId)?.address : undefined} /></label>
  </>
  const selectedRule = lb?.rules.find((rule) => rule.id === ruleId)
  const selectedFrontend = lb?.frontends.find((entry) => entry.id === frontendId)
  const selectedProbe = lb?.probes.find((entry) => entry.id === probeId)
  const selectedInbound = lb?.inboundNatRules.find((entry) => entry.id === inboundId)
  const selectedOutbound = lb?.outboundRules.find((entry) => entry.id === outboundId)
  const natKey = (poolId: string, target: WorkloadIpReference) => JSON.stringify([poolId, key(target)])
  const natTargets = (lb?.pools ?? []).flatMap((pool) => pool.members.map((target) => ({ pool, target })))
  const visibleNatTargets = natTargets.filter(({ target }) => label(target).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100)
  const retainedNatTarget = selectedInbound && natTargets.find(({ pool, target }) =>
    pool.id === selectedInbound.poolId && key(target) === key(selectedInbound.target))
  if (retainedNatTarget && !visibleNatTargets.includes(retainedNatTarget)) visibleNatTargets.push(retainedNatTarget)
  return <details data-testid="load-balancer-editor">
    <summary>{t('Standard Load Balancers')} ({lbs.length})</summary>
    <p>{t('Original regional frontends and NIC backends only. Declared health is unverified; probe permission and client data permission are independent. No guest, live session or proprietary hashing is simulated.')}</p>
    <form data-testid="create-lb-form" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget, data = new FormData(form), id = `lb-${crypto.randomUUID()}`
      if (change((draft) => {
        const initial = frontend(draft, data, kind)
        ;(draft.inventory!.loadBalancers ??= []).push({ id, name: String(data.get('name')), sku: 'Standard', owner,
          frontends: [initial], pools: [], probes: [], rules: [], inboundNatRules: [], outboundRules: [] })
      })) { setSelectedId(id); setRuleId(''); setHaRule(false); form.reset() }
    }}>
      <h4>{t('Declare Standard LB')}</h4>
      <label>{t('LB name')}<input name="name" required maxLength={120} /></label>
      <label>{t('LB frontend kind')}<select aria-label={t('LB frontend kind')} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
        <option value="public">{t('Public')}</option><option value="private">{t('Internal')}</option>
      </select></label>
      {addressFields(kind)}
      <button type="submit">{t('Add Standard LB')}</button>
    </form>
    <label>{t('Search original LBs')}<input type="search" value={serviceQuery} onChange={(event) => setServiceQuery(event.target.value)} /></label>
    <label>{t('Select original LB')}<select aria-label={t('Select original LB')} value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setRuleId(''); setHaRule(false) }}>
      <option value="">{t('Select')}</option>{visibleLbs.map((lb) => <option key={lb.id} value={lb.id}>{lb.name}</option>)}
      {lb && !visibleLbs.includes(lb) && <option value={lb.id}>{lb.name}</option>}
    </select></label>
    {lb && <section key={lb.id} data-testid="selected-lb">
      <form key={JSON.stringify([lb.id, lb.name, lb.rulesStatus])} onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        update((lb) => { lb.name = String(data.get('name')); if (data.has('complete')) delete lb.rulesStatus })
      }}>
        <label>{t('Original LB name')}<input name="name" required maxLength={120} defaultValue={lb.name} /></label>
        {lb.rulesStatus === 'unknown' && <label><input name="complete" type="checkbox" />{t('Declare this edited LB rule set complete')}</label>}
        <button type="submit">{t('Save LB')}</button>
        <button type="button" onClick={() => {
          if (change((draft) => { draft.inventory!.loadBalancers = draft.inventory!.loadBalancers!.filter((entry) => entry.id !== lb.id) })) setSelectedId('')
        }}>{t('Remove LB declaration')}</button>
      </form>
      <details><summary>{t('LB frontends')} ({lb.frontends.length})</summary>
        {lb.frontends.map((entry) => <p key={entry.id}><code>{entry.id}</code> · {entry.name} · {entry.kind === 'private' ? entry.privateIp ?? '?' : topology.inventory?.publicIps.find((ip) => ip.id === entry.publicIpId)?.address ?? '?'}
          <button type="button" onClick={() => setFrontendId(entry.id)}>{t('Edit frontend')}</button>
          <button type="button" onClick={() => update((lb) => {
            lb.frontends = lb.frontends.filter((frontend) => frontend.id !== entry.id)
            lb.rules = lb.rules.filter((rule) => rule.frontendId !== entry.id)
            lb.inboundNatRules = lb.inboundNatRules.filter((rule) => rule.frontendId !== entry.id)
            for (const rule of lb.outboundRules) rule.frontendIds = rule.frontendIds.filter((id) => id !== entry.id)
            lb.outboundRules = lb.outboundRules.filter((rule) => rule.frontendIds.length)
          })}>{t('Remove frontend')}</button>
        </p>)}
        <button type="button" onClick={() => setFrontendId('')}>{t('New frontend')}</button>
        <form data-testid="lb-frontend-form" key={JSON.stringify([selectedFrontend, selectedFrontend?.kind === 'public'
          ? topology.inventory?.publicIps.find((ip) => ip.id === selectedFrontend.publicIpId) : undefined, lb.frontends[0]?.kind ?? kind])} onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget, data = new FormData(form)
          if (update((lb, draft) => {
            if (!selectedFrontend) { lb.frontends.push(frontend(draft, data, lb.frontends[0]?.kind ?? kind)); return }
            const current = lb.frontends.find((entry) => entry.id === selectedFrontend.id)!, address = String(data.get('address')).trim()
            current.name = String(data.get('frontendName'))
            if (current.kind === 'private') {
              current.subnetId = String(data.get('subnet'))
              if (address) current.privateIp = address; else delete current.privateIp
            } else {
              const allocation = draft.inventory!.publicIps.find((ip) => ip.id === current.publicIpId)!
              if (address) allocation.address = address; else delete allocation.address
            }
          }) && !selectedFrontend) form.reset()
        }}>
          <label>{t('LB frontend name')}<input name="frontendName" required maxLength={120} defaultValue={selectedFrontend?.name ?? ''} /></label>
          {addressFields(selectedFrontend?.kind ?? lb.frontends[0]?.kind ?? kind, selectedFrontend)}
          <button type="submit">{t(selectedFrontend ? 'Save frontend' : 'Add frontend')}</button>
        </form>
      </details>
      <details open><summary>{t('Original LB backend pools')} ({lb.pools.length})</summary>
        <label>{t('Search LB backends')}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {lb.pools.map((pool) => <fieldset key={pool.id}>
          <legend>{pool.name}</legend>
          <form key={JSON.stringify([pool.id, pool.name, pool.membersStatus])} onSubmit={(event) => {
            event.preventDefault(); const data = new FormData(event.currentTarget)
            update((lb) => { const current = lb.pools.find((entry) => entry.id === pool.id)!; current.name = String(data.get('name')); if (data.has('complete')) delete current.membersStatus })
          }}>
            <label>{t('LB pool name')}<input name="name" required defaultValue={pool.name} maxLength={120} /></label>
            {pool.membersStatus === 'unknown' && <label><input name="complete" type="checkbox" />{t('Declare this edited backend pool complete')}</label>}
            <button type="submit">{t('Save pool')}</button>
            <button type="button" onClick={() => update((lb) => {
              lb.pools = lb.pools.filter((entry) => entry.id !== pool.id)
              lb.rules = lb.rules.filter((rule) => rule.poolId !== pool.id)
              lb.inboundNatRules = lb.inboundNatRules.filter((rule) => rule.poolId !== pool.id)
              lb.outboundRules = lb.outboundRules.filter((rule) => rule.poolId !== pool.id)
            })}>{t('Remove pool')}</button>
          </form>
          {pool.members.filter((target) => label(target).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100).map((target) => <p key={key(target)}>
            <button type="button" onClick={() => onSelect(target.workloadId)}>{label(target)}</button>
            <button type="button" onClick={() => update((lb) => {
              const current = lb.pools.find((entry) => entry.id === pool.id)!
              current.members = current.members.filter((entry) => key(entry) !== key(target))
              lb.inboundNatRules = lb.inboundNatRules.filter((rule) => rule.poolId !== pool.id || key(rule.target) !== key(target))
            })}>{t('Remove backend association')}</button>
          </p>)}
          <form onSubmit={(event) => {
            event.preventDefault(); const data = new FormData(event.currentTarget)
            const target = endpoints.find((entry) => key(entry.target) === data.get('target'))?.target
            if (target) update((lb) => { lb.pools.find((entry) => entry.id === pool.id)!.members.push(target) })
          }}>
            <label>{t('LB original backend')}<select name="target" aria-label={t('LB original backend')} required defaultValue="">
              <option value="">{t('Select an IP configuration')}</option>
              {endpoints.filter((entry) => !pool.members.some((target) => key(target) === key(entry.target))
                && entry.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100).map((entry) => <option key={key(entry.target)} value={key(entry.target)}>{entry.label}</option>)}
            </select></label>
            <button type="submit">{t('Add original backend')}</button>
          </form>
        </fieldset>)}
        <form data-testid="create-lb-pool-form" onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget, data = new FormData(form)
          if (update((lb) => { lb.pools.push({ id: `lb-pool-${crypto.randomUUID()}`, name: String(data.get('name')), members: [] }) })) form.reset()
        }}><label>{t('New LB pool name')}<input name="name" required maxLength={120} /></label><button type="submit">{t('Add backend pool')}</button></form>
      </details>
      <details><summary>{t('Independent LB health probes')} ({lb.probes.length})</summary>
        {lb.probes.map((probe) => <fieldset key={probe.id}>
          <legend>{probe.name} · {probe.protocol.toUpperCase()}:{probe.port}</legend>
          <button type="button" onClick={() => setProbeId(probe.id)}>{t('Edit probe')}</button>
          {[...new Map(lb.pools.flatMap((pool) => pool.members).map((target) => [key(target), target])).values()]
            .filter((target) => label(target).toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100).map((target) => <label key={key(target)}>
              {label(target)} · {t('Declared backend health (unverified)')}
              <select aria-label={`${label(target)} · ${t('Declared backend health (unverified)')}`} value={probe.health.find((entry) => key(entry.target) === key(target))?.status ?? 'unknown'}
                onChange={(event) => update((lb) => {
                  const current = lb.probes.find((entry) => entry.id === probe.id)!
                  current.health = [...current.health.filter((entry) => key(entry.target) !== key(target)), { target, status: event.target.value as 'healthy' | 'unhealthy' | 'unknown' }]
                })}><option value="unknown">{t('Unknown')}</option><option value="healthy">{t('Declared healthy')}</option><option value="unhealthy">{t('Declared unhealthy')}</option></select>
            </label>)}
          <button type="button" onClick={() => update((lb) => { lb.probes = lb.probes.filter((entry) => entry.id !== probe.id); lb.rules = lb.rules.filter((rule) => rule.probeId !== probe.id) })}>{t('Remove probe')}</button>
        </fieldset>)}
        <p>{t('Changing probe protocol, port or path resets declared health to unknown.')}</p>
        <button type="button" onClick={() => setProbeId('')}>{t('New probe')}</button>
        <form data-testid="create-lb-probe-form" key={JSON.stringify(selectedProbe ? [selectedProbe.id, selectedProbe.name, selectedProbe.protocol, selectedProbe.port, selectedProbe.requestPath] : [lb.id])} onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget, data = new FormData(form)
          if (update((lb) => {
            const protocol = String(data.get('protocol')) as 'tcp' | 'http' | 'https', port = Number(data.get('port')), path = String(data.get('path')).trim()
            const current = lb.probes.find((entry) => entry.id === selectedProbe?.id)
            if (current) {
              if (current.protocol !== protocol || current.port !== port || (current.requestPath ?? '') !== path) current.health = []
              current.name = String(data.get('name')); current.protocol = protocol; current.port = port
              if (path) current.requestPath = path; else delete current.requestPath
            } else lb.probes.push({ id: `lb-probe-${crypto.randomUUID()}`, name: String(data.get('name')), protocol, port,
              ...(path ? { requestPath: path } : {}), health: [] })
          }) && !selectedProbe) form.reset()
        }}>
          <label>{t('LB probe name')}<input name="name" required maxLength={120} defaultValue={selectedProbe?.name ?? ''} /></label>
          <label>{t('LB probe protocol')}<select name="protocol" aria-label={t('LB probe protocol')} defaultValue={selectedProbe?.protocol ?? 'tcp'}><option value="tcp">TCP</option><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
          <label>{t('LB probe port')}<input name="port" type="number" min="1" max="65535" required defaultValue={selectedProbe?.port ?? 8080} /></label>
          <label>{t('HTTP probe path (optional)')}<input name="path" defaultValue={selectedProbe?.requestPath ?? ''} /></label>
          <button type="submit">{t(selectedProbe ? 'Save probe' : 'Add health probe')}</button>
        </form>
      </details>
      <details><summary>{t('Ordinary LB rules')} ({lb.rules.length})</summary>
        {lb.rules.map((rule) => <p key={rule.id}><code>{rule.name} · {rule.protocol} · {rule.frontendPort} → {rule.backendPort}</code>
          <button type="button" onClick={() => { setRuleId(rule.id); setHaRule(rule.haPorts === true && rule.floatingIp === true) }}>{t('Edit LB rule')}</button>
          <button type="button" onClick={() => { if (update((lb) => { lb.rules = lb.rules.filter((entry) => entry.id !== rule.id) })) setRuleId('') }}>{t('Remove LB rule')}</button>
        </p>)}
        <button type="button" onClick={() => { setRuleId(''); setHaRule(false) }}>{t('New LB rule')}</button>
        <p>{t('HA ports is a UDR next-hop service, not a destination mapping. Select the original workloads when tracing a packet. Only the declared single-LB, single-NIC NVA layout is assessed; live health and guest readiness are not verified.')}</p>
        {selectedRule && (selectedRule.floatingIp || selectedRule.haPorts) && !(selectedRule.haPorts && selectedRule.floatingIp) && <p role="status">{t('HA ports and Floating IP are retained but unsupported. Remove the declaration and explicitly create an ordinary replacement; original destination semantics are not silently changed.')}</p>}
        <form key={JSON.stringify(selectedRule ?? [lb.id, lb.frontends, lb.pools, lb.probes])} data-testid="lb-rule-form" onSubmit={(event) => {
          event.preventDefault()
          if (selectedRule && (selectedRule.floatingIp || selectedRule.haPorts) && !(selectedRule.haPorts && selectedRule.floatingIp)) return
          const data = new FormData(event.currentTarget)
          const rule: LoadBalancerRule = { id: selectedRule?.id ?? `lb-rule-${crypto.randomUUID()}`, name: String(data.get('name')),
            frontendId: String(data.get('frontend')), poolId: String(data.get('pool')), probeId: String(data.get('probe')),
            protocol: haRule ? 'all' : String(data.get('protocol')) as 'tcp' | 'udp',
            frontendPort: haRule ? 0 : Number(data.get('frontendPort')), backendPort: haRule ? 0 : Number(data.get('backendPort')),
            affinity: haRule ? 'none' : String(data.get('affinity')) as LoadBalancerRule['affinity'], disableOutboundSnat: haRule || data.has('disableSnat'),
            ...(haRule ? { haPorts: true, floatingIp: true, ...(data.has('preserveTuple') ? { haPortsForwarding: 'preserve-tuple' as const } : {}) } : {}) }
          if (update((lb) => { lb.rules = [...lb.rules.filter((entry) => entry.id !== rule.id), rule] })) setRuleId(rule.id)
        }}>
          <label>{t('LB rule name')}<input name="name" required maxLength={120} defaultValue={selectedRule?.name ?? ''} /></label>
          <label>{t('LB rule frontend')}<select name="frontend" aria-label={t('LB rule frontend')} required defaultValue={selectedRule?.frontendId}>{lb.frontends.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>{t('LB rule pool')}<select name="pool" aria-label={t('LB rule pool')} required defaultValue={selectedRule?.poolId}>{lb.pools.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>{t('LB rule probe')}<select name="probe" aria-label={t('LB rule probe')} required defaultValue={selectedRule?.probeId}>{lb.probes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label><input type="checkbox" checked={haRule} disabled={lb.frontends.some((frontend) => frontend.kind !== 'private')
            || !!selectedRule && !!(selectedRule.haPorts || selectedRule.floatingIp)} onChange={(event) => setHaRule(event.target.checked)} />{t('Internal HA ports with Floating IP')}</label>
          {haRule && <label><input name="preserveTuple" type="checkbox" defaultChecked={selectedRule?.haPortsForwarding === 'preserve-tuple'} />{t('Declare tuple-preserving NVA forwarding (unverified)')}</label>}
          <label>{t('LB rule protocol')}<select key={String(haRule)} name="protocol" aria-label={t('LB rule protocol')} disabled={haRule} defaultValue={haRule ? 'all' : selectedRule?.protocol === 'udp' ? 'udp' : 'tcp'}><option value="tcp">TCP</option><option value="udp">UDP</option>{haRule && <option value="all">{t('All')}</option>}</select></label>
          <label>{t('LB frontend port')}<input key={String(haRule)} name="frontendPort" type="number" min={haRule ? 0 : 1} max="65535" required disabled={haRule} defaultValue={haRule ? 0 : selectedRule?.frontendPort || 443} /></label>
          <label>{t('LB backend port')}<input key={String(haRule)} name="backendPort" type="number" min={haRule ? 0 : 1} max="65535" required disabled={haRule} defaultValue={haRule ? 0 : selectedRule?.backendPort || 8443} /></label>
          <label>{t('Illustrative LB affinity')}<select name="affinity" disabled={haRule} aria-label={t('Illustrative LB affinity')} defaultValue={selectedRule?.affinity ?? 'none'}>
            <option value="none">{t('Five tuple')}</option><option value="client-ip">{t('Client IP')}</option><option value="client-ip-protocol">{t('Client IP and protocol')}</option>
          </select></label>
          <label><input name="disableSnat" type="checkbox" defaultChecked={selectedRule ? selectedRule.disableOutboundSnat === true : true} />{t('Disable rule outbound SNAT')}</label>
          <button type="submit" disabled={!lb.frontends.length || !lb.pools.length || !lb.probes.length
            || !!selectedRule && !!(selectedRule.floatingIp || selectedRule.haPorts) && !(selectedRule.haPorts && selectedRule.floatingIp)}>{t('Save LB rule')}</button>
        </form>
      </details>
      <details><summary>{t('Specific LB inbound NAT')} ({lb.inboundNatRules.length})</summary>
        {lb.inboundNatRules.map((rule) => <p key={rule.id}>{rule.name} · {rule.frontendPort} → {label(rule.target)}:{rule.backendPort}
          <button type="button" onClick={() => setInboundId(rule.id)}>{t('Edit inbound NAT')}</button>
          <button type="button" onClick={() => update((lb) => { lb.inboundNatRules = lb.inboundNatRules.filter((entry) => entry.id !== rule.id) })}>{t('Remove inbound NAT')}</button>
        </p>)}
        <button type="button" onClick={() => setInboundId('')}>{t('New inbound NAT')}</button>
        <form data-testid="lb-inbound-nat-form" key={JSON.stringify(selectedInbound ?? [lb.id, visibleNatTargets.map(({ pool, target }) => natKey(pool.id, target))])} onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget, data = new FormData(form)
          const target = natTargets.find((entry) => natKey(entry.pool.id, entry.target) === data.get('target'))
          if (target && update((lb) => {
            const rule = { id: selectedInbound?.id ?? `lb-inbound-${crypto.randomUUID()}`, name: String(data.get('name')),
            frontendId: String(data.get('frontend')), poolId: target.pool.id, target: target.target, protocol: String(data.get('protocol')) as 'tcp' | 'udp',
            frontendPort: Number(data.get('frontendPort')), backendPort: Number(data.get('backendPort')) }
            lb.inboundNatRules = [...lb.inboundNatRules.filter((entry) => entry.id !== rule.id), rule]
          }) && !selectedInbound) form.reset()
        }}>
          <label>{t('LB inbound NAT name')}<input name="name" required maxLength={120} defaultValue={selectedInbound?.name ?? ''} /></label>
          <label>{t('LB NAT frontend')}<select name="frontend" aria-label={t('LB NAT frontend')} required defaultValue={selectedInbound?.frontendId}>{lb.frontends.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>{t('LB NAT specific backend')}<select name="target" aria-label={t('LB NAT specific backend')} required defaultValue={selectedInbound ? natKey(selectedInbound.poolId, selectedInbound.target) : undefined}>{visibleNatTargets.map(({ pool, target }) =>
            <option key={natKey(pool.id, target)} value={natKey(pool.id, target)}>{pool.name} · {label(target)}</option>)}</select></label>
          <label>{t('LB NAT protocol')}<select name="protocol" aria-label={t('LB NAT protocol')} defaultValue={selectedInbound?.protocol ?? 'tcp'}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
          <label>{t('LB NAT frontend port')}<input name="frontendPort" type="number" min="1" max="65535" required defaultValue={selectedInbound?.frontendPort ?? 50022} /></label>
          <label>{t('LB NAT backend port')}<input name="backendPort" type="number" min="1" max="65535" required defaultValue={selectedInbound?.backendPort ?? 22} /></label>
          <button type="submit" disabled={!lb.frontends.length || !visibleNatTargets.length}>{t(selectedInbound ? 'Save inbound NAT' : 'Add specific inbound NAT')}</button>
        </form>
      </details>
      <details><summary>{t('Public LB outbound rules')} ({lb.outboundRules.length})</summary>
        <p>{t('Only original primary IPv4 NIC associations are supported. NAT Gateway and instance public IP take precedence; internal LB and inbound NAT alone supply no Internet outbound method.')}</p>
        {lb.outboundRules.map((rule) => <p key={rule.id}>{rule.name} · {rule.protocol}
          <button type="button" onClick={() => setOutboundId(rule.id)}>{t('Edit outbound rule')}</button>
          <button type="button" onClick={() => update((lb) => { lb.outboundRules = lb.outboundRules.filter((entry) => entry.id !== rule.id) })}>{t('Remove outbound rule')}</button>
        </p>)}
        <button type="button" onClick={() => setOutboundId('')}>{t('New outbound rule')}</button>
        <form data-testid="lb-outbound-form" key={JSON.stringify(selectedOutbound ?? [lb.id, lb.frontends, lb.pools])} onSubmit={(event) => {
          event.preventDefault(); const form = event.currentTarget, data = new FormData(form)
          if (update((lb) => {
            const rule = { id: selectedOutbound?.id ?? `lb-outbound-${crypto.randomUUID()}`, name: String(data.get('name')),
              poolId: String(data.get('pool')), frontendIds: data.getAll('frontends').map(String), protocol: String(data.get('protocol')) as 'tcp' | 'udp' | 'any' }
            lb.outboundRules = [...lb.outboundRules.filter((entry) => entry.id !== rule.id), rule]
          }) && !selectedOutbound) form.reset()
        }}>
          <label>{t('LB outbound name')}<input name="name" required maxLength={120} defaultValue={selectedOutbound?.name ?? ''} /></label>
          <label>{t('LB outbound pool')}<select name="pool" aria-label={t('LB outbound pool')} required defaultValue={selectedOutbound?.poolId}>{lb.pools.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>{t('LB outbound protocol')}<select name="protocol" aria-label={t('LB outbound protocol')} defaultValue={selectedOutbound?.protocol ?? 'any'}><option value="any">TCP/UDP</option><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
          {lb.frontends.filter((entry) => entry.kind === 'public').map((entry) => <label key={entry.id}><input name="frontends" type="checkbox" value={entry.id} defaultChecked={selectedOutbound ? selectedOutbound.frontendIds.includes(entry.id) : true} />{entry.name}</label>)}
          <button type="submit" disabled={!lb.pools.length || !lb.frontends.some((entry) => entry.kind === 'public')}>{t(selectedOutbound ? 'Save outbound rule' : 'Add public outbound rule')}</button>
        </form>
      </details>
    </section>}
  </details>
}
