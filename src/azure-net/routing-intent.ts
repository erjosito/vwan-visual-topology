import type { AzNetTopology } from './model'
import { applyHubRoutingIntentEdit } from '../routing-intent'

function scope(topology: AzNetTopology) {
  return {
    hubs: topology.vwanHubs,
    attachments: [
      ...topology.vnets.filter((vnet) => vnet.vwanHubAttachment).map((vnet) =>
        ({ key: `vnet:${vnet.id}`, hubId: vnet.vwanHubAttachment!.hubId, owner: vnet.vwanHubAttachment! })),
      ...(['erLinks', 'vpnConnections'] as const).flatMap((kind) =>
        topology[kind].filter((link) => link.targetKind === 'vwan-hub')
          .map((owner) => ({ key: `${kind}:${owner.id}`, hubId: owner.targetId, owner }))),
    ],
  }
}

export function applyAzRoutingIntentEdit(previous: AzNetTopology, next: AzNetTopology): void {
  applyHubRoutingIntentEdit(scope(previous), scope(next))
}
