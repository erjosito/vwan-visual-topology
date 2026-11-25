import type { Hub } from './model'
import type { Candidate, Decision } from './routing'

export const RFC1918_PREFIXES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']

export function chooseVwanHubRoutes(hub: Pick<Hub, 'preference'>, prefix: string, candidates: Candidate[]): Decision {
  let selected = candidates
  const explanation: string[] = []
  const filter = (reason: string, predicate: (route: Candidate) => boolean) => {
    const next = selected.filter(predicate)
    if (next.length && next.length < selected.length) {
      selected = next
      explanation.push(reason)
    }
  }
  filter('Static hub routes override learned routes for the same prefix.', (r) => r.kind === 'hub-static')
  filter('Directly connected spoke system routes override BGP routes for the same prefix.', (r) => r.kind === 'system' && !r.remote)
  if (selected.some((r) => r.remote && r.secureOrigin)) {
    filter('Remote routes from private-routing-intent hubs take precedence over unsecured remote ExpressRoute paths.',
      (r) => !r.remote || r.secureOrigin || r.transport !== 'ExpressRoute')
  }
  if (hub.preference === 'ASPath') {
    const shortest = Math.min(...selected.map((r) => r.asPath.length))
    filter(`Shortest learned AS path (${shortest} ASNs, including inter-hub prepends).`, (r) => r.asPath.length === shortest)
  }
  filter('Local connections are preferred over remote-hub connections.', (r) => !r.remote)
  // HRP compares ER and S2S VPN explicitly. An NVA is not classified as a VPN gateway.
  if (selected.some((r) => r.transport === 'ExpressRoute') && selected.some((r) => r.transport === 'VPN')) {
    const preferred = hub.preference === 'VPN' || selected.every((r) => r.remote) ? 'VPN' : 'ExpressRoute'
    filter(`${preferred} wins the ExpressRoute versus S2S VPN comparison.`, (r) => r.transport !== (preferred === 'VPN' ? 'ExpressRoute' : 'VPN'))
  }
  if (hub.preference !== 'ASPath') {
    const er = selected.filter((route) => route.transport === 'ExpressRoute')
    if (er.length) {
      const maxWeight = Math.max(...er.map((route) => route.weight ?? 0))
      filter(`Higher ExpressRoute link weight (${maxWeight}).`, (route) =>
        route.transport !== 'ExpressRoute' || (route.weight ?? 0) === maxWeight)
    }
    const shortest = Math.min(...selected.map((r) => r.asPath.length))
    filter(`Shortest learned AS path (${shortest} ASNs).`, (r) => r.asPath.length === shortest)
  }
  if (explanation.length === 0) explanation.push('Only available path, or all paths have equal modeled preference.')
  if (selected.length > 1) explanation.push(`${selected.length} equal-cost paths remain; no single traffic hash is predicted.`)
  return { prefix, candidates, selected, explanation }
}
