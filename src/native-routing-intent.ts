import type { Topology } from './model'
import { applyHubRoutingIntentEdit } from './routing-intent'

function scope(topology: Topology) {
  return {
    hubs: topology.hubs,
    attachments: (['spokes', 'connections', 'erLinks'] as const).flatMap((kind) =>
      (topology[kind] ?? []).filter((entry) => entry.hubId && (!('transport' in entry) || entry.transport !== 'SpokeNVA'))
        .map((owner) => ({ key: `${kind}:${owner.id}`, hubId: owner.hubId!, owner }))),
  }
}

export function applyRoutingIntentEdit(previous: Topology, next: Topology): void {
  applyHubRoutingIntentEdit(scope(previous), scope(next))
}
