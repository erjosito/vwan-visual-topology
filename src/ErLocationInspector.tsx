import type { Topology } from './model'
import type { Candidate, Simulation } from './routing'
import { CanvasOverlay } from './CanvasOverlay'

export function ErLocationInspector({ topology, simulation, locationId, onClose }: {
  topology: Topology; simulation: Simulation; locationId: string; onClose: () => void
}) {
  const location = topology.erLocations?.find((location) => location.id === locationId)
  const links = (topology.erLinks ?? []).filter((link) => link.locationId === locationId)
  const table = (routes: Candidate[]) => routes.length ? <div className="table-scroll"><table><thead><tr><th>Prefix</th><th>AS path</th><th>Origin</th></tr></thead><tbody>{routes.map((route, index) => <tr key={`${route.key}:${index}`}><td>{route.prefix}</td><td className="as-path">{route.asPath.join(' ') || 'Local'}</td><td>{topology.sites.find((site) => site.id === route.siteId)?.name ?? topology.spokes.find((spoke) => spoke.id === route.siteId)?.name ?? topology.hubs.find((hub) => hub.id === route.originHubId)?.name}</td></tr>)}</tbody></table></div> : <p className="muted">No advertisements.</p>
  return <CanvasOverlay title={`BGP advertisements · ${location?.name ?? 'ER location'}`} className="effective-routes" onClose={onClose}>
    <p className="muted">Per-attachment advertisements, not a single merged forwarding table. Each site attachment is an independent private-peering circuit. Virtual WAN does not export ER-learned routes to ER circuits by default, including routes from remote hubs. Global Reach and shared-circuit hub reflection are not modeled.</p>
    {links.map((link) => {
      const received = !link.enabled ? [] : link.hubId
        ? (simulation.firewallTables[link.hubId] ?? []).flatMap((decision) => decision.candidates).filter((route) => !route.remote && route.erHubLinkId === link.id)
        : simulation.outbound[link.id] ?? []
      return <section key={link.id} aria-label={`ER advertisements on ${link.name}`}>
        <h3>{link.name}{!link.enabled && ' (down)'}</h3>
        <h4>Advertised to ER location</h4>{table(simulation.erAdvertisements[link.id] ?? [])}
        <h4>Received from ER location</h4>{table(received)}
      </section>
    })}
    {!links.length && <p className="empty">Connect this ER location to hubs and on-premises sites to exchange routes.</p>}
  </CanvasOverlay>
}
