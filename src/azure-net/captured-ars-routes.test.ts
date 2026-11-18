import { expect, it } from 'vitest'
import { arsRouteCapture } from '../../tests/fixtures/ars-route-capture'
import { importAzNetCapture } from './azure-import'
import { capturedArsEndpoint, capturedArsRoutes } from './captured-ars-routes'

it('retains the original ARS role, local endpoint, peer scope and direction without changing the source capture', () => {
  const capture = arsRouteCapture()
  const original = structuredClone(capture)
  const observations = importAzNetCapture(capture).observations!
  expect(observations.arsLearnedRoutes).toEqual(capture.arsLearnedRoutes)
  expect(observations.arsAdvertisedRoutes).toEqual(capture.arsAdvertisedRoutes)
  const parsed = capturedArsRoutes(observations.arsLearnedRoutes!['ars-a/same-peer'])
  expect(new Set(parsed.rows.map(capturedArsEndpoint)).size).toBe(3)
  expect(parsed.rejected).toBe(false)
  expect(capture).toEqual(original)
})

it('does not replace a missing source peer with next hop, normalize native AS paths, or erase observed zero weight', () => {
  const route = capturedArsRoutes(arsRouteCapture().arsAdvertisedRoutes['ars-a/same-peer']).rows[0]
  expect(route).toMatchObject({ asPath: '65515-65050', weight: 0, nextHop: '10.1.0.4' })
  expect(route.sourcePeer).toBeUndefined()
  expect(route.localAddress).toBeUndefined()
})

it('keeps legacy endpoint-less observations unassigned and distinguishes missing from an empty AS path', () => {
  const parsed = capturedArsRoutes([{ network: '10.1.0.0/16', asPath: '' }, { network: '10.2.0.0/16' }])
  expect(parsed.rows.map(capturedArsEndpoint)).toEqual(['["",""]', '["",""]'])
  expect(parsed.rows[0].asPath).toBe('')
  expect(parsed.rows[1].asPath).toBeUndefined()
})

it('bounds malformed observations without laundering them into complete empty coverage', () => {
  for (const input of [{ value: [] }, Array(10_001).fill({ network: '10.0.0.0/16' }),
    [{ network: '10.0.0.0/16', weight: -1 }], [{ network: '10.0.0.0/16', localRole: {} }],
    [{ network: '10.0.0.0/16', asPath: '1'.repeat(513) }]]) {
    expect(capturedArsRoutes(input)).toEqual({ rows: [], rejected: true })
  }
  expect(capturedArsRoutes([])).toEqual({ rows: [], rejected: false })
})
