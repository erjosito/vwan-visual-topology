import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Connection, RouterSelection, Topology } from './model'
import { validateTopology } from './validation'
import { CanvasOverlay } from './CanvasOverlay'

function StaticRoutesForm({ topology, connection, onSave }: {
  topology: Topology; connection: Connection; onSave: (topology: Topology) => void
}) {
  const site = topology.sites.find((s) => s.id === connection.siteId)!
  const current = site.vpnStaticRoutes?.filter((r) => r.connectionId === connection.id) ?? []
  const [prefixes, setPrefixes] = useState(current.map((r) => r.prefix).join('\n'))
  const [staticOnly, setStaticOnly] = useState(!connection.routes.length && !connection.learnSiteRoutes)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const save = (event: FormEvent) => {
    event.preventDefault()
    try {
      const next = structuredClone(topology)
      const owner = next.sites.find((s) => s.id === site.id)!
      const routes = prefixes.split(/[,\s]+/).filter(Boolean).map((prefix, index) => ({
        id: current[index]?.prefix === prefix ? current[index].id : crypto.randomUUID(), prefix, connectionId: connection.id,
      }))
      owner.vpnStaticRoutes = [...(owner.vpnStaticRoutes ?? []).filter((r) => r.connectionId !== connection.id), ...routes]
      if (staticOnly) {
        const link = next.connections.find((c) => c.id === connection.id)!
        link.routes = []; link.learnSiteRoutes = false
      }
      onSave(validateTopology(next)); setError(''); setSaved(true)
    } catch (error) { setSaved(false); setError(error instanceof Error ? error.message : 'Invalid static routes.') }
  }
  return <form className="static-routes-form" onSubmit={save} onChange={() => setSaved(false)}>
    <p className="muted">Owned by <strong>{site.name}</strong> · Reachable from {topology.hubs.find((h) => h.id === connection.hubId)?.name} through {connection.name}{!connection.enabled && ' (connection down)'}.</p>
    <label className="field"><span>Site VPN static prefixes</span><textarea aria-label="Site VPN static prefixes" rows={5} value={prefixes} onChange={(e) => setPrefixes(e.target.value)} placeholder={site.prefixes[0] ?? '10.80.0.0/16'} /></label>
    {site.prefixes[0] && <button type="button" onClick={() => { setPrefixes(site.prefixes[0]); setSaved(false) }}>Use site's originated prefix</button>}
    <label className="checkbox-field"><input type="checkbox" aria-label="Static-only VPN" checked={staticOnly} onChange={(e) => setStaticOnly(e.target.checked)} />Static-only VPN (remove BGP advertisements)</label>
    <p className="muted">{staticOnly ? `Saving removes ${connection.routes.length} explicit BGP advertisement(s) and disables site-originated/learned BGP import on this connection.` : `This connection also has ${connection.routes.length} explicit BGP advertisement(s); site-mesh BGP import is ${connection.learnSiteRoutes ? 'enabled' : 'disabled'}. Select static-only to disable both.`} Static prefixes have no AS path and bypass BGP route maps.</p>
    <p className="muted">One network CIDR per line or comma-separated, up to 100. Leave empty and save to remove this connection's static prefixes. These may include transit destinations; they do not add originated networks to the site.</p>
    <button className="primary">Save static routing</button>
    {saved && <p role="status" className="muted">Static routing saved.</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
  </form>
}

export function StaticRoutingPanel({ topology, router, onSave, onClose }: {
  topology: Topology; router: RouterSelection; onSave: (topology: Topology) => void; onClose: () => void
}) {
  const node = (router.kind === 'hub' ? topology.hubs : topology.sites).find((n) => n.id === router.id)
  const connections = topology.connections.filter((c) => c.transport === 'VPN' && (router.kind === 'hub' ? c.hubId : c.siteId) === router.id)
  const [connectionId, setConnectionId] = useState('')
  const connection = connections.find((c) => c.id === connectionId) ?? connections[0]
  return <CanvasOverlay title={`Static routing · ${node?.name ?? 'Router'}`} className="static-routing-panel" onClose={onClose}>
    <p className="muted">Non-BGP S2S VPN prefixes belong to the on-premises site, not to the tunnel's BGP advertisements. Associate them with the VPN connection that reaches that site. These define Azure-to-site destinations, not hub-table overrides or on-premises return static routes.</p>
    {connection ? <>
      <label className="field"><span>VPN connection</span><select aria-label="Static routing VPN connection" value={connection.id} onChange={(e) => setConnectionId(e.target.value)}>{connections.map((c) => <option key={c.id} value={c.id}>{c.name} · {topology.sites.find((s) => s.id === c.siteId)?.name} / {topology.hubs.find((h) => h.id === c.hubId)?.name}</option>)}</select></label>
      <StaticRoutesForm key={connection.id} topology={topology} connection={connection} onSave={onSave} />
    </> : <p className="empty">No S2S VPN connections attached. Add a VPN connection to configure site static routing.</p>}
  </CanvasOverlay>
}
