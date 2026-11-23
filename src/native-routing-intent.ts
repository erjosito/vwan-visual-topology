import type { Topology } from './model'
import { applyHubRoutingIntentEdit } from './routing-intent'

function scope(topology: Topology) {
  return {
    hubs: topology.hubs,
    attachments: [...topology.spokes, ...topology.connections, ...(topology.erLinks ?? [])]
      .filter((entry) => entry.hubId).map((owner) => ({ key: owner.id, hubId: owner.hubId!, owner })),
  }
}

export function applyRoutingIntentEdit(previous: Topology, next: Topology): void {
  applyHubRoutingIntentEdit(scope(previous), scope(next))
}
