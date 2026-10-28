import type { FormEvent } from 'react'
import type { Connection, PrependRule, Topology } from './model'
import type { Simulation } from './routing'
import { parseAsPath } from './validation'

interface Props {
  topology: Topology
  hubId: string
  connectionId?: string
  simulation: Simulation
  update: (mutate: (next: Topology) => void) => void
  onError: (message: string) => void
}

const prefixes = (value: string) => value.trim() === '*' ? [] : value.split(/[,\s]+/).filter(Boolean)

export function AdvancedEditor({ topology, hubId, connectionId, simulation, update, onError }: Props) {
  const hub = topology.hubs.find((h) => h.id === hubId)
  const connection = topology.connections.find((c) => c.id === connectionId)
  const safe = (action: () => void) => {
    try { action() } catch (error) { onError(error instanceof Error ? error.message : 'Invalid input.') }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    update((next) => { next.siteLinks.push({
      id: crypto.randomUUID(), name: String(data.get('name')), a: String(data.get('a')), b: String(data.get('b')), enabled: true,
      aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] },
    }) })
  }
  const changeRule = (direction: 'inbound' | 'outbound', rule: PrependRule, mutate: (r: PrependRule) => void) => update((next) => {
    mutate(next.connections.find((c) => c.id === connection!.id)![direction].find((r) => r.id === rule.id)!)
  })
  const mapEditor = (item: Connection, direction: 'inbound' | 'outbound') => <div className="map-direction" key={direction}>
    <h3>{direction === 'inbound' ? 'Inbound: site → hub' : 'Outbound: hub → site'}</h3>
    {item[direction].map((rule, index) => <div className="map-rule" key={rule.id}>
      <strong>Rule {index + 1}</strong>
      <label className="field"><span>Match prefixes (* = all)</span><input aria-label={`${direction} match prefixes ${index + 1}`} key={rule.prefixes.join(',')} defaultValue={rule.prefixes.join(', ') || '*'} onBlur={(e) => changeRule(direction, rule, (r) => { r.prefixes = prefixes(e.target.value) })} /></label>
      <label className="field"><span>Match mode</span><select value={rule.match} onChange={(e) => changeRule(direction, rule, (r) => { r.match = e.target.value as 'equals' | 'contains' })}><option value="equals">Equals</option><option value="contains">Contains (including more specific)</option></select></label>
      <label className="field"><span>Prepend ASNs</span><input aria-label={`${direction} prepend ASNs ${index + 1}`} key={rule.prepend.join(' ')} defaultValue={rule.prepend.join(' ')} onBlur={(e) => safe(() => {
        const path = parseAsPath(e.target.value)
        changeRule(direction, rule, (r) => { r.prepend = path })
      })} /></label>
      <button className="danger small" onClick={() => update((next) => { const c = next.connections.find((c) => c.id === item.id)!; c[direction] = c[direction].filter((r) => r.id !== rule.id) })}>Remove rule</button>
    </div>)}
    <button onClick={() => update((next) => { next.connections.find((c) => c.id === item.id)![direction].push({ id: crypto.randomUUID(), prefixes: [], match: 'equals', prepend: [64496] }) })}>Add {direction} rule</button>
  </div>
  return <section className="panel advanced-panel">
    <div className="panel-heading"><div><p className="eyebrow">ROUTING POLICIES</p><h2>Intent, route maps & on-premises transit</h2></div></div>
    <div className="advanced-content">
      {hub && <details open><summary>Routing intent · {hub.name}</summary><div className="policy-settings">
        <label><input type="checkbox" aria-label="Private traffic routing intent" checked={hub.routingIntent.private} onChange={(e) => update((next) => { next.hubs.find((h) => h.id === hubId)!.routingIntent.private = e.target.checked })} /> Private traffic → Azure Firewall</label>
        <label><input type="checkbox" aria-label="Internet traffic routing intent" checked={hub.routingIntent.internet} onChange={(e) => update((next) => { next.hubs.find((h) => h.id === hubId)!.routingIntent.internet = e.target.checked })} /> Internet traffic → Azure Firewall (direct egress)</label>
        <label className="field"><span>Additional private traffic prefixes (RFC1918 is automatic)</span><input aria-label="Additional private traffic prefixes" key={`${hub.id}:${hub.routingIntent.privatePrefixes.join(',')}`} defaultValue={hub.routingIntent.privatePrefixes.join(', ')} placeholder="100.64.0.0/10" onBlur={(e) => update((next) => { next.hubs.find((h) => h.id === hubId)!.routingIntent.privatePrefixes = prefixes(e.target.value) })} /></label>
        <p className="muted">Private intent replaces the hub table with firewall policy aggregates. The firewall retains the selected forwarding routes. Add non-RFC1918 destinations explicitly on every secured hub. Internet intent adds 0/0 → Firewall and direct Internet egress; forced tunneling is not modeled. Firewall allow/deny rules are assumed permissive.</p>
      </div></details>}
      {connection && <details open><summary>Route maps · {connection.name}</summary>
        <div className="policy-settings">
          <label><input type="checkbox" aria-label="Import site mesh routes" checked={connection.learnSiteRoutes} onChange={(e) => update((next) => { next.connections.find((c) => c.id === connection.id)!.learnSiteRoutes = e.target.checked })} /> Advertise site-originated and learned on-premises routes to this hub</label>
          {connection.transport === 'SDWAN' ? <p className="notice">Azure route maps are unsupported on integrated SD-WAN NVA branch connections. Use on-premises peer export prepends or edit the received AS path instead.</p> : <>
            <p className="muted">One map per direction; ordered rules terminate on the first prefix match. Unmatched routes are unchanged. Use public 2-byte ASNs, not Azure-reserved or private ASNs. 64496 is a simulation-only documentation ASN. Static routes are not processed by route maps.</p>
            <div className="map-editors">{mapEditor(connection, 'inbound')}{mapEditor(connection, 'outbound')}</div>
            <details><summary>Outbound advertisement preview ({simulation.outbound[connection.id]?.length ?? 0})</summary><p className="muted">Post-map AS paths sent toward the site. Outbound prepends do not change hub or firewall best paths. Azure-originated advertisements are not reimported via the on-premises mesh.</p><div className="table-scroll"><table><thead><tr><th>Prefix</th><th>Post-map AS path</th></tr></thead><tbody>{simulation.outbound[connection.id]?.map((r, i) => <tr key={`${r.key}:${i}`}><td>{r.prefix}</td><td className="as-path">{r.asPath.join(' ') || '—'}</td></tr>)}</tbody></table></div></details>
          </>}
        </div>
      </details>}
      <details><summary>On-premises sites & BGP links ({topology.siteLinks.length})</summary>
        <p className="muted">Site prefixes originate on-premises. Explicit connection BGP advertisements are also available for on-premises export. Enable “Advertise site-originated and learned routes” on a hub connection to import the mesh. Peer export allowlists match exact prefixes; * means all. On-premises prepend ASNs may be private or 32-bit.</p>
        <div className="site-settings">
          {topology.sites.map((site) => <div className="entity-card" key={site.id}><strong>{site.name}</strong>
            <label className="field"><span>Site ASN</span><input aria-label={`Site ASN ${site.name}`} key={site.asn} defaultValue={site.asn} onBlur={(e) => update((next) => { next.sites.find((s) => s.id === site.id)!.asn = Number(e.target.value) })} /></label>
            <label className="field"><span>Originated prefixes (one per line)</span><textarea rows={3} aria-label={`Originated prefixes ${site.name}`} key={site.prefixes.join(',')} defaultValue={site.prefixes.join('\n')} placeholder={'10.80.0.0/16\n10.81.0.0/16'} onBlur={(e) => update((next) => { next.sites.find((s) => s.id === site.id)!.prefixes = prefixes(e.target.value) })} /></label>
            <details><summary>Learned site routes ({simulation.siteTables[site.id]?.length ?? 0})</summary>{simulation.siteTables[site.id]?.map((r, i) => <p className="muted" key={i}>{r.prefix} · AS {r.asPath.join(' ') || 'local'} · {r.sitePath.map((id) => topology.sites.find((s) => s.id === id)?.name).join(' → ')}</p>)}</details>
          </div>)}
        </div>
        {topology.siteLinks.map((link) => <div className="entity-card" key={link.id}>
          <div className="row"><strong>{link.name}</strong><label className="switch"><input type="checkbox" checked={link.enabled} aria-label={`Enable ${link.name}`} onChange={(e) => update((next) => { next.siteLinks.find((l) => l.id === link.id)!.enabled = e.target.checked })} />{link.enabled ? 'Up' : 'Down'}</label></div>
          <div className="map-editors">{(['aToB', 'bToA'] as const).map((direction) => <div key={direction}>
            <h3>{topology.sites.find((s) => s.id === (direction === 'aToB' ? link.a : link.b))?.name} → {topology.sites.find((s) => s.id === (direction === 'aToB' ? link.b : link.a))?.name}</h3>
            <label className="field"><span>Export prefixes (* = all)</span><input aria-label={`${link.name} ${direction} export prefixes`} key={link[direction].prefixes.join(',')} defaultValue={link[direction].prefixes.join(', ') || '*'} onBlur={(e) => update((next) => { next.siteLinks.find((l) => l.id === link.id)![direction].prefixes = prefixes(e.target.value) })} /></label>
            <label className="field"><span>Outbound prepend ASNs</span><input aria-label={`${link.name} ${direction} prepend ASNs`} key={link[direction].prepend.join(' ')} defaultValue={link[direction].prepend.join(' ')} onBlur={(e) => safe(() => {
              const path = parseAsPath(e.target.value)
              update((next) => { next.siteLinks.find((l) => l.id === link.id)![direction].prepend = path })
            })} /></label>
            <label className="field"><span>Inbound prepend ASNs at receiving site</span><input aria-label={`${link.name} ${direction} inbound prepend ASNs`} key={(link[direction].receivePrepend ?? []).join(' ')} defaultValue={(link[direction].receivePrepend ?? []).join(' ')} onBlur={(e) => safe(() => {
              const path = parseAsPath(e.target.value)
              update((next) => { next.siteLinks.find((l) => l.id === link.id)![direction].receivePrepend = path })
            })} /></label>
          </div>)}</div>
          <button className="danger small" onClick={() => update((next) => { next.siteLinks = next.siteLinks.filter((l) => l.id !== link.id) })}>Remove on-premises link</button>
        </div>)}
        <form className="peer-form" onSubmit={submit}><h3>Add an on-premises BGP link</h3>
          <label className="field"><span>Link name</span><input name="name" aria-label="On-premises link name" required maxLength={120} placeholder="Datacenter WAN" /></label>
          <label className="field"><span>Site A</span><select name="a" aria-label="Peer site A" required>{topology.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="field"><span>Site B</span><select name="b" aria-label="Peer site B" required defaultValue={topology.sites[1]?.id}>{topology.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <button className="primary" disabled={topology.sites.length < 2}>Add on-premises link</button>
        </form>
      </details>
    </div>
  </section>
}
