import VwanVnetConnectionPanel from '../VwanVnetConnectionPanel'
import { hubRouteTables } from '../hub-routing'
import { azHubRouting } from './hub-routing'
import { ConnectionStaticRoutesEditor } from './ConnectionStaticRoutesEditor'
import type { AzNetTopology } from './model'
import { routingIntentConfiguration, routingIntentManaged } from '../routing-intent'

export default function VnetConnectionEditor({ topology, vnetId, commit, onClose }: {
  topology: AzNetTopology
  vnetId: string
  commit: (update: (draft: AzNetTopology) => void) => void
  onClose: () => void
}) {
  const vnet = topology.vnets.find((entry) => entry.id === vnetId)
  const attachment = vnet?.vwanHubAttachment
  const hub = topology.vwanHubs.find((entry) => entry.id === attachment?.hubId)
  if (!vnet || !attachment || !hub) return null
  return <VwanVnetConnectionPanel vnetName={vnet.name} hubName={hub.name} tables={hubRouteTables(hub)}
    managedConfig={routingIntentManaged(hub) ? routingIntentConfiguration(hub) : undefined}
    config={azHubRouting(attachment.hubRouting)} propagateDefaultRoute={attachment.propagateDefaultRoute === true}
    enabled={attachment.enabled} conflict={!!(vnet.gateways.length || vnet.routeServer) || topology.vnetPeerings.some((peering) =>
      peering.vnetAId === vnet.id && peering.aToB.useRemoteGateways || peering.vnetBId === vnet.id && peering.bToA.useRemoteGateways)}
    onRoutingChange={(config) => commit((draft) => { draft.vnets.find((entry) => entry.id === vnetId)!.vwanHubAttachment!.hubRouting = config })}
    onDefaultRouteChange={(enabled) => commit((draft) => { draft.vnets.find((entry) => entry.id === vnetId)!.vwanHubAttachment!.propagateDefaultRoute = enabled })}
    onEnabledChange={(enabled) => commit((draft) => { draft.vnets.find((entry) => entry.id === vnetId)!.vwanHubAttachment!.enabled = enabled })}
    onClose={onClose}>
    <ConnectionStaticRoutesEditor vnet={vnet} topology={topology} commit={commit} />
  </VwanVnetConnectionPanel>
}
