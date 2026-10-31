import { t, localizeDiagnostic } from './i18n'
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
  const modeName = mode === 'static' ? t('static') : 'BGP'
  const title = t("Change VPN to {0} · {1}", modeName, connection?.name ?? t('Connection unavailable'))
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
    {!connection || !site || !hub ? <><p className="notice">{t("This S2S VPN connection is no longer available. No changes were applied.")}</p><button onClick={onClose}>{t("Close wizard")}</button></> : completed ? <>
      <p role="status">{t("VPN routing changed to")} {modeName}{t(". The connection and site settings were updated together.")}</p>
      <p className="muted">{t("Other connections, site ownership, route maps, layouts and enabled state were preserved.")}</p>
      <button className="primary" onClick={onClose}>{t("Done")}</button>
    </> : <form onSubmit={submit} className="static-routes-form">
      <p><strong>{review ? t("2. Review changes") : t("1. Configure destinations")}</strong>  {t("· Current routing:")} {vpnRoutingMode(topology, connection) === 'mixed' ? t("mixed BGP/static") : vpnRoutingMode(topology, connection) === 'bgp' ? 'BGP' : t('static')}</p>
      <p>{t("Azure side:")} <strong>{hub.name}</strong>  {t("· Source prefixes:")} {topology.spokes.filter((spoke) => spoke.hubId === hub.id).flatMap((spoke) => spoke.prefixes).join(', ') || t("No attached-spoke prefixes configured")}</p>
      <p>{t("On-premises side:")} <strong>{site.name}</strong>  {t("· Site prefix:")} {site.prefixes.length ? site.prefixes.join(', ') : t("Not assigned")}{!connection.enabled && t(" · VPN connection is down and will remain down")}</p>
      {!review ? <>
        <p className="muted">{t("Destinations are seeded from this site's prefix, this VPN's existing static routes, and learned site routes when enabled. Edit them before continuing. Azure-side prefixes are source context, not on-premises destinations.")}</p>
        {mode === 'static' ? <label className="field"><span>{t("Static destination prefixes")}</span><textarea aria-label={t("Static destination prefixes")} rows={6} value={prefixes} onChange={(event) => setPrefixes(event.target.value)} placeholder="10.80.0.0/16" /></label> : <>
          <p className="muted">{t("Converting to BGP enables advertising site-originated and learned routes on this connection. Any prefixes listed below that are not already learned from linked sites are added to this site's originated prefixes (AS")} {site.asn}{t(").")}</p>
          {bgpRoutes.map((route, index) => <div className="vpn-bgp-draft" key={index}>
            <label className="field"><span>{t("Destination prefix")}</span><input aria-label={t("BGP destination prefix {0}", index + 1)} value={route.prefix} onChange={(event) => setBgpRoutes((routes) => routes.map((route, i) => i === index ? { ...route, prefix: event.target.value } : route))} /></label>
            <button type="button" className="danger" aria-label={t("Remove BGP destination {0}", index + 1)} onClick={() => setBgpRoutes((routes) => routes.filter((_, i) => i !== index))}>{t("Remove")}</button>
          </div>)}
          <button type="button" disabled={bgpRoutes.length >= 100} onClick={() => setBgpRoutes((routes) => [...routes, { prefix: '', asPath: String(site.asn) }])}>{t("Add BGP destination")}</button>
          <label className="checkbox-field"><input type="checkbox" aria-label={t("Also advertise site-originated and learned routes")} checked={learnSiteRoutes} onChange={(event) => setLearnSiteRoutes(event.target.checked)} />{t("Also advertise site-originated and learned routes")}</label>
        </>}
        <p className="muted">{t("Use IPv4 network CIDRs, up to 100 destinations. This models Azure-to-site destinations; separate on-premises return static routes and tunnel endpoint IP addresses are not modeled.")}</p>
      </> : <>
        {mode === 'static' ? <>
          <p>{t("Save")} {proposedStatics.length}  {t("static destination(s) on")} <strong>{site.name}</strong>{t(", associated only with")} <strong>{connection.name}</strong>.</p>
          <p>{t("Disable site-originated and learned BGP route import on this VPN.")}</p>
          <div className="table-scroll"><table aria-label={t("Reviewed static destinations")}><thead><tr><th>{t("Destination prefix")}</th></tr></thead><tbody>{proposedStatics.map((route) => <tr key={route.id}><td>{route.prefix}</td></tr>)}</tbody></table></div>
        </> : <>
          <p>{t("Remove")} {currentStatics.length}  {t("site-owned static destination(s) for this VPN and enable BGP route advertisements on this connection.")}</p>
          <p>{t("Site-originated/learned BGP import will be")} {t(proposed?.learnSiteRoutes ? 'enabled' : 'disabled')}{t(". Other connections' static destinations are unchanged.")}</p>
          <div className="table-scroll"><table aria-label={t("Reviewed BGP destinations")}><thead><tr><th>{t("Site originated prefix")}</th><th>{t("Site ASN")}</th></tr></thead><tbody>{(review?.topology.sites.find((s) => s.id === site.id)?.prefixes ?? []).map((prefix) => <tr key={prefix}><td>{prefix}</td><td className="as-path">{site.asn}</td></tr>)}</tbody></table></div>
        </>}
        <p className="notice">{t("Route maps remain assigned. Static VPN routes bypass them; BGP routes are subject to those policies. Connection state, site prefix/ASN, other connections and saved layouts are not changed.")}</p>
      </>}
      {error && <p role="alert" className="notice error">{localizeDiagnostic(error)}</p>}
      <div className="row dialog-actions"><button type="button" onClick={onClose}>{t("Cancel conversion")}</button>{review && <button type="button" onClick={() => { setReview(undefined); setError('') }}>{t("Back to destinations")}</button>}<button className="primary">{review ? t("Apply {0} routing", modeName) : t("Review routing changes")}</button></div>
    </form>}
  </CanvasOverlay>
}
