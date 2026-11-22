import { describe, expect, it } from 'vitest'
import { defaultPeeringFlags, peeringFlagUnavailableReason, type AzVNet } from './model'

function vnet(id: string): AzVNet {
  return { id, name: id, role: 'hub-vnet', region: 'swedencentral', prefixes: ['10.0.0.0/16'],
    subnets: [], gateways: [], appliances: [] }
}

function withGateway(vnet: AzVNet, enabled = true): AzVNet {
  return { ...vnet, gateways: [{ id: `${vnet.id}-gw`, name: 'VPN', kind: 'Vpn',
    asn: 65515, bgpEnabled: true, enabled }] }
}

function withRouteServer(vnet: AzVNet, enabled = true): AzVNet {
  return { ...vnet, routeServer: { id: `${vnet.id}-ars`, name: 'ARS', enabled,
    branchToBranchTraffic: false, hubRoutingPreference: 'ExpressRoute', peerApplianceIds: [] } }
}

describe('peering gateway settings', () => {
  it('does not infer gateway sharing from hub roles', () => {
    const a = vnet('a')
    const b = vnet('b')
    expect(defaultPeeringFlags(a, b)).toMatchObject({ allowGatewayTransit: false, useRemoteGateways: false })
    expect(peeringFlagUnavailableReason(a, b, defaultPeeringFlags(b, a), 'allowGatewayTransit')).toContain('Requires')
    expect(peeringFlagUnavailableReason(a, b, defaultPeeringFlags(b, a), 'useRemoteGateways')).toContain('no Gateway')
  })

  for (const [name, provider] of [['Gateway', withGateway], ['Route Server', withRouteServer]] as const) {
    it(`defaults to valid sharing with a ${name}, regardless of the provider's role`, () => {
      const hub = { ...provider(vnet('hub')), role: 'spoke' as const }
      const spoke = vnet('spoke')
      const hubFlags = defaultPeeringFlags(hub, spoke)
      expect(hubFlags).toMatchObject({ allowGatewayTransit: true, useRemoteGateways: false })
      expect(defaultPeeringFlags(spoke, hub)).toMatchObject({ allowGatewayTransit: false, useRemoteGateways: true })
      expect(peeringFlagUnavailableReason(spoke, hub, hubFlags, 'useRemoteGateways')).toBeUndefined()
      expect(peeringFlagUnavailableReason(spoke, hub, { ...hubFlags, allowGatewayTransit: false }, 'useRemoteGateways'))
        .toContain('Requires Allow Gateway Transit')
    })

    it(`blocks remote use with a configured but disabled local ${name}`, () => {
      const local = provider(vnet('local'), false)
      const remote = withGateway(vnet('remote'))
      const remoteFlags = { ...defaultPeeringFlags(remote, local), allowGatewayTransit: true }
      expect(defaultPeeringFlags(local, remote)).toMatchObject({ allowGatewayTransit: false, useRemoteGateways: false })
      expect(peeringFlagUnavailableReason(local, remote, remoteFlags, 'useRemoteGateways')).toContain('its own')
    })
  }

  it('does not enable sharing between two providers, but does not forbid AllowGatewayTransit alone', () => {
    const a = withGateway(vnet('a'))
    const b = withRouteServer(vnet('b'))
    const aFlags = defaultPeeringFlags(a, b)
    const bFlags = defaultPeeringFlags(b, a)
    for (const flags of [aFlags, bFlags]) {
      expect(flags).toMatchObject({ allowGatewayTransit: false, useRemoteGateways: false })
    }
    expect(peeringFlagUnavailableReason(a, b, bFlags, 'useRemoteGateways')).toContain('its own')
    expect(peeringFlagUnavailableReason(b, a, aFlags, 'useRemoteGateways')).toContain('its own')
    expect(peeringFlagUnavailableReason(a, b, bFlags, 'allowGatewayTransit')).toBeUndefined()
  })
})
