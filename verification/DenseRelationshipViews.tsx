import { useState } from 'react'
import type { AzNetTopology } from '../src/azure-net/model'
import type { AzRouteMapSelection, AzSelectedEntity } from '../src/azure-net/AzureNetDiagram'

interface Props {
  topology: AzNetTopology
  onSelect: (selection: AzSelectedEntity) => void
  onPolicy: (selection: AzRouteMapSelection) => void
}

export function RelationshipMatrix({ topology, onSelect }: Props) {
  const [relation, setRelation] = useState('peering')
  const hubs = topology.vnets.filter(vnet => vnet.role === 'hub')
  const appliances = topology.vnets.flatMap(vnet => vnet.appliances.map(appliance => ({ ...appliance, vnetId: vnet.id })))
  const peerIds = [...new Set(hubs.flatMap(vnet => vnet.routeServer?.peerApplianceIds ?? []))]
  return <section className="research-relationship-view" aria-label="Configured relationship matrix">
    <h2>Configured relationships, not forwarding evidence</h2>
    <label>Relationship<select aria-label="Relationship" value={relation} onChange={event => setRelation(event.target.value)}>
      <option value="peering">Hub VNet peerings</option><option value="bgp">ARS configured appliance peers</option>
    </select></label>
    <p>Empty cells mean no configured relationship in this document, not a failed probe.
      {' '}ON/OFF is administrative configuration, not assessed connectivity. Transport and policies remain available in the regional view and original canvas.</p>
    <div className="research-table-scroll" tabIndex={0} aria-label="Scrollable relationship table">
      {relation === 'peering' ? <table>
        <caption>{topology.vnetPeerings.filter(link => hubs.some(h => h.id === link.vnetAId) && hubs.some(h => h.id === link.vnetBId)).length} hub-peering records; symmetric cells repeat each record, not additional links.</caption>
        <thead><tr><th scope="col">Hub</th>{hubs.map(hub => <th scope="col" key={hub.id}>{hub.name}</th>)}</tr></thead>
        <tbody>{hubs.map(row => <tr key={row.id}><th scope="row">{row.name}</th>{hubs.map(column => {
          const links = topology.vnetPeerings.filter(link => (link.vnetAId === row.id && link.vnetBId === column.id)
            || (link.vnetBId === row.id && link.vnetAId === column.id))
          return <td key={column.id} data-testid={`matrix-${row.id}-${column.id}`}>
            {row.id === column.id ? 'Self' : links.length ? links.map(link => <button key={link.id}
              aria-label={`${link.enabled === false ? 'OFF' : 'ON'}: ${row.name} to ${column.name}; ${link.id}; inspect original peering`}
              onClick={() => onSelect({ kind: 'peering', peeringId: link.id })}>{link.enabled === false ? 'OFF' : 'ON'}</button>)
              : <span aria-label={`${row.name} to ${column.name}: no configured peering`}>Absent</span>}
          </td>
        })}</tr>)}</tbody>
      </table> : <table>
        <caption>{hubs.reduce((sum, hub) => sum + (hub.routeServer?.peerApplianceIds.length ?? 0), 0)} configured peer references; remote ownership does not establish supported BGP sessions.</caption>
        <thead><tr><th scope="col">ARS owner</th>{peerIds.map(id => <th scope="col" key={id}>{appliances.find(a => a.id === id)?.name ?? `Unresolved ${id}`}</th>)}</tr></thead>
        <tbody>{hubs.map(hub => <tr key={hub.id}><th scope="row">{hub.name}{hub.routeServer?.enabled === false && ' (ARS OFF)'}</th>
          {peerIds.map(id => {
            const appliance = appliances.find(a => a.id === id)
            return <td key={id}>{hub.routeServer?.peerApplianceIds.includes(id) ? appliance
              ? <button aria-label={`Configured: ${hub.name} ARS to ${appliance.name}; inspect original appliance`}
                onClick={() => onSelect({ kind: 'appliance', vnetId: appliance.vnetId, applianceId: id })}>Configured</button>
              : 'Unresolved reference' : 'Absent'}</td>
          })}
        </tr>)}</tbody>
      </table>}
    </div>
    <p>Every table action selects an original object. There is no derived routing grade or topology edit.</p>
  </section>
}

export function RegionalOverview({ topology, onSelect, onPolicy }: Props) {
  const regions = [...new Set(topology.vnets.map(vnet => vnet.region || 'Unspecified region'))]
  return <section className="research-relationship-view" aria-label="Regional overview">
    <h2>Regional overview with explicit disclosure</h2>
    <p>Devices and policy attachments are summarized, not removed. Expand a region to inspect original identities.
      {' '}Administrative OFF transport remains visible while collapsed. This is configuration inventory, not a forwarding diagram.</p>
    <div className="research-region-grid">{regions.map(region => {
      const vnets = topology.vnets.filter(vnet => (vnet.region || 'Unspecified region') === region)
      const gateways = new Set(vnets.flatMap(vnet => vnet.gateways.map(gateway => gateway.id)))
      const locations = topology.erLocations.filter(location => topology.erLinks.some(link =>
        link.locationId === location.id && link.targetKind === 'vnet-gateway' && gateways.has(link.targetId)))
      const links = topology.erLinks.filter(link => locations.some(location => location.id === link.locationId))
      const assignments = vnets.flatMap(vnet => (vnet.routeServer?.routeMapAssignments ?? []).flatMap(assignment =>
        (['inbound', 'outbound'] as const).flatMap(direction => {
          const mapId = direction === 'inbound' ? assignment.inboundMapId : assignment.outboundMapId
          return mapId ? [{ vnet, assignment, direction, mapId }] : []
        })))
      return <article key={region} className="research-region" data-testid={`region-${region}`}>
        <h3>{region}</h3>
        <p>{vnets.length} VNets; {vnets.reduce((sum, vnet) => sum + vnet.subnets.length, 0)} subnets;
          {' '}{vnets.reduce((sum, vnet) => sum + vnet.appliances.length, 0)} appliances; {assignments.length} directional policy attachments.</p>
        <p>{links.length} ER attachments; {links.filter(link => link.enabled === false).length} administratively OFF.</p>
        {links.filter(link => link.enabled === false).map(link => <button key={link.id}
          onClick={() => onSelect({ kind: 'er-link', linkId: link.id })}>OFF: {link.name}</button>)}
        <details><summary>Inspect {region} objects and policies</summary>
          {vnets.map(vnet => <div key={vnet.id}>
            <button onClick={() => onSelect({ kind: 'vnet', vnetId: vnet.id })}>{vnet.name}</button>
            {vnet.subnets.map(subnet => <button key={subnet.id}
              onClick={() => onSelect({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })}>{subnet.name} ({subnet.id})</button>)}
            {vnet.gateways.map(gateway => <button key={gateway.id}
              onClick={() => onSelect({ kind: 'gateway', vnetId: vnet.id, gatewayId: gateway.id })}>{gateway.name}</button>)}
            {vnet.appliances.map(appliance => <button key={appliance.id}
              onClick={() => onSelect({ kind: 'appliance', vnetId: vnet.id, applianceId: appliance.id })}>{appliance.name}</button>)}
            {vnet.routeServer && <button onClick={() => onSelect({ kind: 'route-server', vnetId: vnet.id, routeServerId: vnet.routeServer!.id })}>{vnet.routeServer.name}</button>}
          </div>)}
          {locations.map(location => <button key={location.id}
            onClick={() => onSelect({ kind: 'er-location', locationId: location.id })}>{location.name}</button>)}
          {links.filter(link => link.enabled !== false).map(link => <button key={link.id}
            onClick={() => onSelect({ kind: 'er-link', linkId: link.id })}>{link.name}</button>)}
          {assignments.map(({ vnet, assignment, direction, mapId }) => <button
            key={`${vnet.id}-${assignment.connectionId}-${direction}`}
            onClick={() => onPolicy({ owner: { kind: 'route-server', vnetId: vnet.id, routeServerId: vnet.routeServer!.id },
              connectionId: assignment.connectionId, direction })}>
            {direction === 'inbound' ? 'IN' : 'OUT'}: {mapId} on {assignment.connectionId}
          </button>)}
        </details>
      </article>
    })}</div>
    <details><summary>All configured VNet peerings and shared sites</summary>
      {topology.vnetPeerings.map(link => <button key={link.id}
        onClick={() => onSelect({ kind: 'peering', peeringId: link.id })}>{link.name} ({link.enabled === false ? 'OFF' : 'ON'})</button>)}
      {topology.sites.map(site => <button key={site.id} onClick={() => onSelect({ kind: 'site', siteId: site.id })}>{site.name}</button>)}
    </details>
  </section>
}
