import { describe, expect, it } from 'vitest'
import { example } from './model'
import { nodePrefixes, traceNodePath } from './paths'
import { simulate } from './routing'

describe('contextual node paths', () => {
  it('uses the selected hub routes for a spoke-to-site path', () => {
    const t = structuredClone(example)
    const paths = traceNodePath(t, simulate(t), { kind: 'spoke', id: 'eu-apps' }, '10.30.0.5')
    expect(paths[0]).toMatchObject({ hubs: ['eu', 'us'], connectionId: 'vpn-us', status: 'delivered' })
  })
  it('does not send traffic inside a source spoke through the hub', () => {
    const t = structuredClone(example)
    expect(traceNodePath(t, simulate(t), { kind: 'spoke', id: 'eu-apps' }, '10.1.0.5')[0]).toMatchObject({
      hubs: [], siteId: 'eu-apps', status: 'delivered',
    })
  })
  it('follows advertisements from a site into Azure toward a spoke', () => {
    const t = structuredClone(example)
    const paths = traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.2.0.5')
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.every((p) => p.status === 'delivered' && p.connectionId === 'us-apps' && !!p.sourceConnectionId)).toBe(true)
    expect(paths[0].sourceSiteHops).toEqual(['dc'])
  })
  it('uses on-premises best paths and withdraws a failed peer link', () => {
    const t = structuredClone(example)
    t.sites[1].prefixes = ['10.90.0.0/16']
    t.siteLinks.push({ id: 'wan', name: 'WAN', a: 'dc', b: 'ny', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } })
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.1')[0]).toMatchObject({ siteHops: ['dc', 'ny'], status: 'delivered' })
    t.siteLinks[0].enabled = false
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.1')[0].status).toBe('unreachable')
  })
  it('does not highlight a nonexistent route or trace provisional calculations', () => {
    const t = structuredClone(example)
    const simulation = simulate(t)
    expect(traceNodePath(t, simulation, { kind: 'hub', id: 'eu' }, '203.0.113.1')[0].status).toBe('unreachable')
    expect(traceNodePath(t, { ...simulation, converged: false }, { kind: 'site', id: 'dc' }, '10.1.0.1')).toEqual([])
  })
  it('uses assigned prefixes rather than treating transit advertisements as site ownership', () => {
    const t = structuredClone(example)
    t.sites[1].prefixes = ['10.30.0.0/16']
    expect(nodePrefixes(t, { kind: 'site', id: 'ny' })).toEqual(['10.30.0.0/16'])
    expect(nodePrefixes(t, { kind: 'hub', id: 'eu' })).toEqual(['10.1.0.0/16'])
  })
  it('retains the exact preferred parallel on-premises link in a site-origin path', () => {
    const t = structuredClone(example)
    t.sites[1].prefixes = ['10.90.0.0/16']
    const link = { id: 'primary', name: 'Primary', a: 'dc', b: 'ny', enabled: true, aToB: { prefixes: [], prepend: [] }, bToA: { prefixes: [], prepend: [] } }
    t.siteLinks.push(link, { ...structuredClone(link), id: 'backup', name: 'Backup', bToA: { prefixes: [], prepend: [65020] } })
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.5')[0].siteLinkIds).toEqual(['primary'])
    t.siteLinks[0].enabled = false
    expect(traceNodePath(t, simulate(t), { kind: 'site', id: 'dc' }, '10.90.0.5')[0].siteLinkIds).toEqual(['backup'])
  })
})
