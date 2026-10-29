import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Topology } from './model'
import { parseAsPath } from './validation'
import { convertVpnRouting, suggestVpnRoutes, vpnRoutingMode } from './vpn-routing'
import type { VpnRoutingMode } from './vpn-routing'
import { CanvasOverlay } from './CanvasOverlay'

export function VpnRoutingWizard({ topology, connectionId, mode, onSave, onClose }: {
  topology: Topology; connectionId: string; mode: VpnRoutingMode; onSave: (topology: Topology) => void; onClose: () => void
}) {
  const connection = topology.connections.find((connection) => connection.id === connectionId && connection.transport === 'VPN')
  const site = topology.sites.find((site) => site.id === connection?.siteId)
  const hub = topology.hubs.find((hub) => hub.id === connection?.hubId)
  const currentStatics = site?.vpnStaticRoutes?.filter((route) => route.connectionId === connectionId) ?? []
  const [suggestions] = useState(() => connection ? suggestVpnRoutes(topology, connection) : [])
  const [prefixes, setPrefixes] = useState(suggestions.map((route) => route.prefix).join('\n'))
  const [bgpRoutes, setBgpRoutes] = useState(suggestions.map((route) => ({ prefix: route.prefix, asPath: route.asPath.join(' ') })))
  const [learnSiteRoutes, setLearnSiteRoutes] = useState(connection?.learnSiteRoutes ?? false)
  const [review, setReview] = useState<{ topology: Topology; signature: string }>()
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const modeName = mode === 'static' ? 'static' : 'BGP'
  const title = `Change VPN to ${modeName} · ${connection?.name ?? 'Connection unavailable'}`
  const signature = JSON.stringify([connection, site?.id, site?.asn, site?.prefixes, currentStatics])
  const draft = () => mode === 'static' ? prefixes.split(/[,\s]+/).filter(Boolean).map((prefix) => ({ prefix, asPath: [] }))
    : bgpRoutes.map((route) => ({ prefix: route.prefix.trim(), asPath: parseAsPath(route.asPath) }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      if (review && signature !== review.signature) throw new Error('The VPN configuration changed after review. Go back and review the current changes again.')
      const next = convertVpnRouting(topology, connectionId, mode, draft(), learnSiteRoutes)
      if (!review) setReview({ topology: next, signature })
      else { onSave(next); setCompleted(true) }
      setError('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to convert VPN routing.') }
  }
  const proposed = review?.topology.connections.find((connection) => connection.id === connectionId)
  const proposedStatics = review?.topology.sites.find((site) => site.id === connection?.siteId)?.vpnStaticRoutes?.filter((route) => route.connectionId === connectionId) ?? []
  return <CanvasOverlay title={title} className="vpn-routing-wizard" onClose={onClose}>
    {!connection || !site || !hub ? <><p className="notice">This S2S VPN connection is no longer available. No changes were applied.</p><button onClick={onClose}>Close wizard</button></> : completed ? <>
      <p role="status">VPN routing changed to {modeName}. The connection and site settings were updated together.</p>
      <p className="muted">Other connections, site ownership, route maps, layouts and enabled state were preserved.</p>
      <button className="primary" onClick={onClose}>Done</button>
    </> : <form onSubmit={submit} className="static-routes-form">
      <p><strong>{review ? '2. Review changes' : '1. Configure destinations'}</strong> · Current routing: {vpnRoutingMode(topology, connection) === 'mixed' ? 'mixed BGP/static' : vpnRoutingMode(topology, connection) === 'bgp' ? 'BGP' : 'static'}</p>
      <p>Azure side: <strong>{hub.name}</strong> · Source prefixes: {topology.spokes.filter((spoke) => spoke.hubId === hub.id).flatMap((spoke) => spoke.prefixes).join(', ') || 'No attached-spoke prefixes configured'}</p>
      <p>On-premises side: <strong>{site.name}</strong> · Site prefix: {site.prefixes[0] ?? 'Not assigned'}{!connection.enabled && ' · VPN connection is down and will remain down'}</p>
      {!review ? <>
        <p className="muted">Destinations are seeded from this site's prefix, this VPN's existing advertisements/static routes, and learned site routes when enabled. Edit them before continuing. Azure-side prefixes are source context, not on-premises destinations.</p>
        {mode === 'static' ? <label className="field"><span>Static destination prefixes</span><textarea aria-label="Static destination prefixes" rows={6} value={prefixes} onChange={(event) => setPrefixes(event.target.value)} placeholder="10.80.0.0/16" /></label> : <>
          <p className="muted">Static routes have no AS paths to restore. Their initial BGP path uses site ASN {site.asn}; edit it for transit routes or prepending.</p>
          {bgpRoutes.map((route, index) => <div className="vpn-bgp-draft" key={index}>
            <label className="field"><span>Destination prefix</span><input aria-label={`BGP destination prefix ${index + 1}`} value={route.prefix} onChange={(event) => setBgpRoutes((routes) => routes.map((route, i) => i === index ? { ...route, prefix: event.target.value } : route))} /></label>
            <label className="field"><span>Received AS path</span><input aria-label={`BGP AS path ${index + 1}`} value={route.asPath} onChange={(event) => setBgpRoutes((routes) => routes.map((route, i) => i === index ? { ...route, asPath: event.target.value } : route))} /></label>
            <button type="button" className="danger" aria-label={`Remove BGP destination ${index + 1}`} onClick={() => setBgpRoutes((routes) => routes.filter((_, i) => i !== index))}>Remove</button>
          </div>)}
          <button type="button" disabled={bgpRoutes.length >= 100} onClick={() => setBgpRoutes((routes) => [...routes, { prefix: '', asPath: String(site.asn) }])}>Add BGP destination</button>
          <label className="checkbox-field"><input type="checkbox" aria-label="Also advertise site-originated and learned routes" checked={learnSiteRoutes} onChange={(event) => setLearnSiteRoutes(event.target.checked)} />Also advertise site-originated and learned routes</label>
        </>}
        <p className="muted">Use IPv4 network CIDRs, up to 100 destinations. The site prefix itself is not changed. This models Azure-to-site destinations; separate on-premises return static routes and tunnel endpoint IP addresses are not modeled.</p>
      </> : <>
        {mode === 'static' ? <>
          <p>Save {proposedStatics.length} static destination(s) on <strong>{site.name}</strong>, associated only with <strong>{connection.name}</strong>.</p>
          <p>Remove {connection.routes.length} explicit BGP advertisement(s) and disable site-originated/learned BGP import on this VPN. AS paths are discarded; they can be configured again when converting to BGP.</p>
          <div className="table-scroll"><table aria-label="Reviewed static destinations"><thead><tr><th>Destination prefix</th></tr></thead><tbody>{proposedStatics.map((route) => <tr key={route.id}><td>{route.prefix}</td></tr>)}</tbody></table></div>
        </> : <>
          <p>Remove {currentStatics.length} site-owned static destination(s) for this VPN and save {proposed?.routes.length} explicit BGP advertisement(s).</p>
          <p>Site-originated/learned BGP import will be {learnSiteRoutes ? 'enabled' : 'disabled'}. Other connections' static destinations are unchanged.</p>
          <div className="table-scroll"><table aria-label="Reviewed BGP destinations"><thead><tr><th>Destination prefix</th><th>Received AS path</th></tr></thead><tbody>{proposed?.routes.map((route) => <tr key={route.id}><td>{route.prefix}</td><td className="as-path">{route.asPath.join(' ')}</td></tr>)}</tbody></table></div>
        </>}
        <p className="notice">Route maps remain assigned. Static VPN routes bypass them; BGP routes are subject to those policies. Connection state, site prefix/ASN, other connections and saved layouts are not changed.</p>
      </>}
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="row dialog-actions"><button type="button" onClick={onClose}>Cancel conversion</button>{review && <button type="button" onClick={() => { setReview(undefined); setError('') }}>Back to destinations</button>}<button className="primary">{review ? `Apply ${modeName} routing` : 'Review routing changes'}</button></div>
    </form>}
  </CanvasOverlay>
}
