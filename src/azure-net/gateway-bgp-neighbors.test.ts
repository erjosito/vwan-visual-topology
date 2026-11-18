import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { importAzNetCapture } from './azure-import'

const fixture = () => JSON.parse(readFileSync(resolve('tests', 'fixtures', 'gateway-bgp-capture.json'), 'utf8'))

it('retains independently captured local BGP endpoints, distinct remote peers and actual zero counters without NIC observations', () => {
  const capture = fixture()
  const original = JSON.stringify(capture)
  const result = importAzNetCapture(capture)
  expect(result.observations?.vngBgpPeerStatus).toEqual(capture.vngBgpPeerStatus)
  expect(result.observations?.nicEffectiveRoutes).toEqual([])
  expect(result.observations?.capturedAt).toBe(capture.capturedAt)
  expect(result.observations?.observationVersion).toBeUndefined()
  expect(result.observations?.vngBgpPeerStatus?.['vpn-as'][0].routesReceived).toBeUndefined()
  expect(result.observations?.vngBgpPeerStatus?.['vpn-aa'][3].localAddress).toBeUndefined()
  expect(JSON.stringify(capture)).toBe(original)
  delete capture.capturedAt
  expect(importAzNetCapture(capture).observations?.capturedAt).toBe('')
  delete capture.vngBgpPeerStatus
  expect(importAzNetCapture(capture).observations).toBeUndefined()
})

it('rejects malformed or oversized neighbor observations rather than turning them into a successful empty table', () => {
  for (const value of [[], { 'vpn-aa': {} }, { 'vpn-aa': [null] },
    { 'vpn-aa': [{ asn: 4294967296 }] }, { 'vpn-aa': [{ routesReceived: -1 }] },
    { 'vpn-aa': [{ messagesSent: 0.1 }] }, { 'vpn-aa': [{ state: {} }] },
    { 'vpn-aa': Array.from({ length: 10001 }, () => ({})) }]) {
    const capture = fixture()
    capture.vngBgpPeerStatus = value
    expect(() => importAzNetCapture(capture)).toThrow(/BGP peer observation/)
  }
})

it.each(['arsLearnedRoutes', 'vngLearnedRoutes', 'arsAdvertisedRoutes'] as const)(
  'retains a BGP-only %s capture without depending on NIC routes or neighbor observations',
  (field) => {
    const capture = fixture()
    delete capture.vngBgpPeerStatus
    const routes = [
      { localAddress: '10.1.0.4', network: '203.0.113.0/24', nextHop: '10.1.0.4', asPath: '65515-65001', origin: 'Igp', weight: 0 },
      { localAddress: '10.1.0.5', network: '203.0.113.0/24', nextHop: '10.1.0.5', asPath: '65515-65001', origin: 'Igp', weight: 0 },
    ]
    capture[field] = { 'ars-a/same-peer': routes, 'ars-b/same-peer': [] }
    const original = JSON.stringify(capture)
    const result = importAzNetCapture(capture)
    expect(result.observations?.[field]).toEqual(capture[field])
    expect(result.observations?.nicEffectiveRoutes).toEqual([])
    expect(result.observations?.arsAdvertisedRoutes?.['ars-a/same-peer'][0].sourcePeer).toBeUndefined()
    expect(JSON.stringify(capture)).toBe(original)
  },
)
