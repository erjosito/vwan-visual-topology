import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { BgpRouteTable } from './azure-net/BgpRouteTable'
import type { AzBgpRibEntry } from './azure-net/engine'
import { simulateAzNet } from './azure-net/engine'
import NvaBgpPanel from './azure-net/NvaBgpPanel'
import { nvaBgpTopology } from '../tests/fixtures/nva-bgp'

it('renders compact rows in numeric prefix/selection/ID order without discarding equal-cost or alternate evidence', () => {
  const base: AzBgpRibEntry = {
    id: 'alternate', prefix: '10.20.0.0/16', asPath: [65002], preferred: false,
    nextHopName: 'Forwarding NVA', nextHopId: 'original-nva', nextHopIp: '10.0.0.4',
    nextHopKind: 'appliance', originProtocol: 'BGP-NVA', connectionId: 'original-connection',
    communities: ['65002:42'], explanation: 'Azure selection reason.',
    natOriginalPrefix: '192.168.0.0/16', natRuleId: 'original-nat', routeMapTrace: ['Original policy trace.'],
  }
  const entries = [
    base, { ...base, id: 'selected-b', asPath: [65515], preferred: true },
    { ...base, id: 'selected-a', asPath: [12076], preferred: true },
    { ...base, id: 'unique-prefix', prefix: '10.3.0.0/16', preferred: true },
    { ...base, id: 'earlier-prefix', prefix: '10.2.0.0/16' },
  ]
  const before = structuredClone(entries)
  const html = renderToStaticMarkup(createElement(BgpRouteTable, { entries, available: true }))
  const ids = [...html.matchAll(/data-route-id="([^"]+)"/g)].map((match) => match[1])
  expect(ids).toEqual(['earlier-prefix', 'unique-prefix', 'selected-a', 'selected-b', 'alternate'])
  expect(html.match(/data-preferred="true"/g)).toHaveLength(3)
  expect(html.match(/aria-label="Model tie"/g)).toHaveLength(2)
  expect(html.match(/aria-label="Preferred"/g)).toHaveLength(1)
  expect(html.match(/aria-label="Alternative"/g)).toHaveLength(2)
  expect(html).toContain('=\t10.20.0.0/16\tForwarding NVA (10.0.0.4)\t12076')
  expect(html).toContain('=\t10.20.0.0/16\tForwarding NVA (10.0.0.4)\t65515')
  expect(html).toContain('*\t10.3.0.0/16\t')
  expect(html).toContain('Ties do not confirm a unique BGP best path or real-router ECMP.')
  expect(html).toContain('<th scope="col">Network</th>')
  expect(html).not.toContain('route-prefix-heading')
  expect(html).toContain('Forwarding NVA (10.0.0.4)')
  for (const evidence of ['original-connection', 'original-nva', 'original-nat', '65002:42', 'Original policy trace.', '192.168.0.0/16']) {
    expect(html).toContain(evidence)
  }
  expect(html).toContain('<details><summary aria-label="Evidence')
  expect(html).toContain('<textarea readOnly=""')
  expect(entries).toEqual(before)
})

it('keeps NVA duplicates scoped to original ARS and leaves per-peer unassessed warnings outside route disclosures', () => {
  const topology = nvaBgpTopology()
  topology.vnets[0].summarizedGatewayPrefixes = ['203.0.113.0/24']
  const simulation = simulateAzNet(topology)
  const before = structuredClone({ topology, simulation })
  const host = topology.vnets.find((vnet) => vnet.appliances.some((app) => app.id === 'reader'))!
  const hostedHtml = renderToStaticMarkup(createElement(NvaBgpPanel, {
    topology, simulation, vnetId: host.id, applianceId: 'reader', onPeerChange() {}, onClose() {},
  }))
  expect(hostedHtml.match(/data-prefix="198.18.0.0\/24"/g)).toHaveLength(2)
  expect(hostedHtml).toContain('data-ars-id="west-ars"')
  expect(hostedHtml).toContain('data-ars-id="east-ars"')
  expect(hostedHtml).toContain('NVA best-path selection is not modeled')
  expect(hostedHtml).not.toContain('data-preferred=')
  expect(hostedHtml).toContain('<p role="status" data-testid="nva-gateway-summary-boundary">')
  expect(hostedHtml).not.toContain('data-prefix="203.0.113.0/24"')
  expect({ topology, simulation }).toEqual(before)
})

it('renders unqualified same-VNet wire attributes as not assessed, preserving learned-source evidence separately', () => {
  const topology = nvaBgpTopology()
  const west = topology.vnets[0]
  west.appliances.push({
    ...topology.vnets[2].appliances[0], id: 'local-reader', name: 'Local reader',
    subnetId: 'west-nvas', privateIp: '10.10.1.5', advertisedPrefixes: [],
  })
  west.routeServer!.peerApplianceIds.push('local-reader')
  west.routeServer!.branchToBranchTraffic = false
  const simulation = simulateAzNet(topology)
  const html = renderToStaticMarkup(createElement(NvaBgpPanel, {
    topology, simulation, vnetId: 'west', applianceId: 'local-reader', onPeerChange() {}, onClose() {},
  }))
  expect(html).toContain('<td>Wire next-hop IP not assessed</td><td class="as-path">Not assessed</td>')
  expect(html).toContain('ARS-learned source route (not receiver wire attributes)')
  expect(html).toContain('10.10.1.4')
  expect(html).toContain('Same-VNet flag behavior and wire attributes are not assessed')
})
