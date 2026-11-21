import type { Hub, Topology } from './model'

export function sameWan(a: Pick<Hub, 'wanId'>, b: Pick<Hub, 'wanId'>): boolean {
  return a.wanId === b.wanId
}

export function wanBranchTransit(topology: Topology, hubId: string): boolean {
  const hub = topology.hubs.find((entry) => entry.id === hubId)
  return (topology.wans?.find((wan) => wan.id === hub?.wanId)?.allowBranchToBranchTraffic
    ?? topology.allowBranchToBranchTraffic) !== false
}
