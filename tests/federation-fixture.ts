import { largeVwanCapture } from './large-vwan-fixture'

export function federationFixture() {
  const a = largeVwanCapture(2, 2, 1)
  const b = JSON.parse(JSON.stringify(a).replaceAll('/synthetic-', '/remote-').replaceAll('/wan"', '/remote-wan"')
    .replaceAll('10.1.0.0/24', '10.101.0.0/24').replaceAll('10.2.0.0/24', '10.102.0.0/24')) as typeof a
  b.wan.name = 'Remote WAN'
  return {
    kind: 'azure-vwan-federation', version: 1, name: 'Two synthetic WANs', captures: [a, b],
    interWanVpns: [{ id: 'wan-vpn', name: 'Explicit tunnel', aHubId: a.hubs[0].id, bHubId: b.hubs[0].id,
      enabled: true, status: 'configured', aToB: ['10.0.0.0/8'], bToA: ['10.0.0.0/8'] }],
  }
}
