import { describe, expect, it } from 'vitest'
import { parseVnetBgpCommunities } from './vnet-communities'
import { example } from './model'
import { validateTopology } from './validation'
import { simulate } from './routing'
import { parseAzNetTopology } from './azure-net/admission'
import { createEmptyAzNetTopology } from './azure-net/model'
import { generateAzNetBicep } from './azure-net/bicep-export'
import { importAzNetCapture } from './azure-net/azure-import'

const communities = { virtualNetworkCommunity: '12076:20001', regionalCommunity: '12076:50004' }

describe('VNet community contracts', () => {
  it('accepts 16-bit boundary values and rejects malformed metadata objects', () => {
    expect(parseVnetBgpCommunities({ virtualNetworkCommunity: '12076:0' })).toEqual({ virtualNetworkCommunity: '12076:0' })
    expect(parseVnetBgpCommunities({ virtualNetworkCommunity: '12076:65535' })).toEqual({ virtualNetworkCommunity: '12076:65535' })
    for (const value of [null, [], { regionalCommunity: '12076:65536' }, { virtualNetworkCommunity: '12076:1', generated: true }]) {
      expect(() => parseVnetBgpCommunities(value)).toThrow()
    }
  })
  it.each(['65001:20001', '12076:65536', '12076:-1', '12076:01', '12076:1 12076:2', '12076:1,12076:2', '12076:1\n', '', 12076, [], {}])('rejects invalid community %j', (value) => {
    expect(() => parseVnetBgpCommunities({ virtualNetworkCommunity: value })).toThrow()
    const vwan = structuredClone(example)
    Object.assign(vwan.spokes[0], { bgpCommunities: { virtualNetworkCommunity: value } })
    expect(() => validateTopology(vwan)).toThrow()
    const full = createEmptyAzNetTopology()
    full.vnets = [{ id: 'v', name: 'VNet', role: 'spoke', region: 'westeurope', prefixes: ['10.0.0.0/16'], subnets: [], gateways: [], appliances: [] }]
    Object.assign(full.vnets[0], { bgpCommunities: { virtualNetworkCommunity: value } })
    expect(() => parseAzNetTopology(full)).toThrow()
    expect(() => generateAzNetBicep(full)).toThrow()
  })

  it('round-trips VNet metadata without generating tags in VWAN', () => {
    const value = structuredClone(example)
    value.spokes[0].bgpCommunities = communities
    value.layout = { mode: 'layered', positions: { layered: { [value.spokes[0].id]: { x: 120, y: 200 } } } }
    const imported = validateTopology(JSON.parse(JSON.stringify(value)))
    expect(imported.spokes[0].bgpCommunities).toEqual(communities)
    expect(imported.layout).toEqual(value.layout)
    expect(simulate(imported).warnings.join(' ')).toContain('not Virtual WAN')
    const before = simulate(example)
    expect({ ...simulate(imported), warnings: [] }).toEqual({ ...before, warnings: [] })
  })

  it.each([false, true])('imports captured communities (ARM properties wrapper: %s), preserves native data and exports only writable configuration', (wrapped) => {
    const addressSpace = { addressPrefixes: ['10.0.0.0/16'] }
    const capture = { kind: 'azure-network-capture', version: 2, vnets: [{
      id: '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/network/providers/Microsoft.Network/virtualNetworks/vnet',
      name: 'Original VNet', location: 'westeurope',
      ...(wrapped ? { properties: { addressSpace, bgpCommunities: communities } } : { addressSpace, bgpCommunities: communities }),
    }] }
    const topology = importAzNetCapture(capture).topology
    expect(topology.vnets[0].bgpCommunities).toEqual(communities)
    expect(parseAzNetTopology(JSON.parse(JSON.stringify(topology))).vnets[0].bgpCommunities).toEqual(communities)
    const bicep = generateAzNetBicep(topology)
    expect(bicep.text).toContain("bgpCommunities: { virtualNetworkCommunity: '12076:20001' }")
    expect(bicep.text).not.toContain('regionalCommunity:')
    expect(bicep.warnings.join(' ')).toContain('no regional tag is generated')
  })
})
