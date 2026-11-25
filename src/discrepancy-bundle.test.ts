import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { comparisonDesign, contextObservationFixture, hubArm, observationFixture, spokeArm } from '../tests/azure-observation-fixture'
import { armKey, parseAzureObservation } from './azure-observation'
import { compareAzure, defaultComparisonProfile } from './azure-comparison'
import { createDiscrepancyBundle, discrepancyFiles, discrepancyIssueUrl, DISCREPANCY_MAX_BYTES, readDiscrepancyBundle } from './discrepancy-bundle'
import type { DiscrepancySource } from './discrepancy-bundle'
import { createEmptyAzNetTopology } from './azure-net/model'
import { compareAzNetWithObservations } from './azure-net/azure-import'
import { simulateAzNet } from './azure-net/engine'
import type { AzCapturedObservations } from './azure-net/azure-import'
import { importAzureCapture } from './azure-import'
import { validateTopology } from './validation'

const app = { version: '0.9.2', revision: 'original-commit', engineRevision: 'original-commit', host: 'web' as const }
const description = { summary: 'An unexpected route', expected: 'The exact prefix uses the VNet.', actual: 'Azure returned a different next hop.' }
function vwan() {
  const topology = validateTopology(comparisonDesign()), capture = observationFixture(), observation = parseAzureObservation(capture)
  const profile = { ...defaultComparisonProfile(topology, observation), hubs: { [armKey(hubArm)]: 'h' },
    spokes: { [armKey(spokeArm('a'))]: 'a', [armKey(spokeArm('b'))]: 'b' }, prefixes: ['10.2.0.0/24'], completeDesign: true }
  const report = compareAzure(topology, observation, profile, Date.parse(capture.capturedAt))
  return { mode: 'vwan' as const, topology, session: { observation, profile, report, capture } }
}
function network(): Extract<DiscrepancySource, { mode: 'azure-network' }> {
  const topology = createEmptyAzNetTopology()
  topology.vnets.push({ id: 'a', name: 'vnet', region: 'westeurope', role: 'spoke-vnet', prefixes: ['10.1.0.0/16'],
    subnets: [{ id: 's', name: 'work', prefix: '10.1.0.0/24' }], gateways: [], appliances: [] })
  const observations: AzCapturedObservations = {
    capturedAt: '2026-01-01T00:00:00.000Z', collectorVersion: 'test', resourceGroup: 'network', observationVersion: 1,
    configurationComplete: false, sections: { nicEffectiveRoutes: { state: 'denied', complete: false } },
    nicEffectiveRoutes: [{ nicName: 'vm-nic', nicId: '/nic', vnetName: 'vnet', subnetName: 'work',
      effectiveRoutes: [], observation: { state: 'denied', complete: false } }],
    vngLearnedRoutes: { gateway: [{ network: '172.16.0.0/16', asPath: '65001 65001', nextHop: '10.0.0.4' }] },
    vngBgpPeerStatus: { gateway: [{ neighbor: '10.0.0.4', asn: 65001, state: 'Connected' }] },
  }
  return { mode: 'azure-network', topology, observations, comparison: compareAzNetWithObservations(topology, simulateAzNet(topology), observations),
    notices: ['Incomplete capture'], comparisonCurrent: true }
}
const encode = (source: DiscrepancySource) => createDiscrepancyBundle(source, description, app)
const editArchive = (bytes: Uint8Array, name: string, value: unknown) => zipSync({ ...unzipSync(bytes), [name]: strToU8(JSON.stringify(value)) }, { level: 0 })

describe('offline discrepancy bundles', () => {
  it('retains the complete design, observation, mappings, original results and provenance without mutation', async () => {
    const source = vwan(), before = JSON.stringify(source), bytes = encode(source)
    const files = unzipSync(bytes), result = await readDiscrepancyBundle(bytes)
    expect(Object.keys(files).sort()).toEqual([...discrepancyFiles].sort())
    expect(JSON.parse(strFromU8(files['topology.json']))).toEqual(source.topology)
    expect(JSON.parse(strFromU8(files['evidence.json'])).observation).toEqual(source.session.observation)
    expect(result.manifest).toMatchObject({ version: 1, mode: 'vwan', app, ...description })
    expect(result.originalReport).toEqual(source.session.report)
    expect(result.source.mode).toBe('vwan')
    if (result.source.mode !== 'vwan') throw new Error('Wrong mode')
    expect(result.source.session?.report).toEqual(source.session.report)
    expect(result.source.session?.profile).toEqual(source.session.profile)
    expect(result.source.session?.capture).toEqual(source.session.capture)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('replays at the original comparison time rather than making historical routes stale', async () => {
    const source = vwan(), comparisonAt = source.session.report.generatedAt
    const reportNow = compareAzure(source.topology, source.session.observation, source.session.profile, Date.parse(comparisonAt) + 7 * 86400_000)
    expect(reportNow.rows.some(row => row.status === 'unknown')).toBe(true)
    const result = await readDiscrepancyBundle(encode(source))
    if (result.source.mode !== 'vwan') throw new Error('Wrong mode')
    expect(result.source.session?.replayAt).toBe(comparisonAt)
    expect(result.source.session?.report).toEqual(source.session.report)
  })

  it('preserves custom route-table context, warnings and denied capture status', async () => {
    const capture = contextObservationFixture(), topology = importAzureCapture({ ...capture, version: 1 })
    capture.observations.tables[1].status = 'denied'; capture.observations.tables[1].routes = []
    const observation = parseAzureObservation(capture), profile = { ...defaultComparisonProfile(topology, observation), routeTableId: 'business' }
    observation.warnings.push('This capture is incomplete.')
    const report = compareAzure(topology, observation, profile)
    const result = await readDiscrepancyBundle(encode({ mode: 'vwan', topology, session: { observation, profile, report } }))
    if (result.source.mode !== 'vwan') throw new Error('Wrong mode')
    expect(result.source.session?.observation).toEqual(observation)
    expect(result.source.session?.profile.routeTableId).toBe('business')
    expect(result.source.session?.report?.rows.some(row => row.status === 'design-only')).toBe(false)
  })

  it('restores full-network NIC, BGP and partial-capture evidence and reruns the current engine', async () => {
    const source = network()
    source.capture = { kind: 'azure-network-capture', version: 2, originalConfigurationField: 'retained for importer investigation' }
    const result = await readDiscrepancyBundle(encode(source))
    if (result.source.mode !== 'azure-network') throw new Error('Wrong mode')
    expect(result.source.topology).toEqual(source.topology)
    expect(result.source.observations).toEqual(source.observations)
    expect(result.source.comparison).toEqual(source.comparison)
    expect(result.source.notices).toEqual(source.notices)
    expect(result.source.capture).toEqual(source.capture)
    expect(result.originalReport).toEqual(source.comparison)
  })

  it('does not present stale reports as current, but retains evidence for another comparison', async () => {
    const source = vwan()
    source.topology.hubs[0].preference = 'ExpressRoute'
    const result = await readDiscrepancyBundle(encode(source))
    expect(result.manifest.comparisonAt).toBeNull()
    expect(result.originalReport).toBeNull()
    if (result.source.mode !== 'vwan') throw new Error('Wrong mode')
    expect(result.source.session?.report).toBeUndefined()
    expect(result.source.session?.observation).toEqual(source.session.observation)
    const full = network(); full.comparisonCurrent = false
    const fullResult = await readDiscrepancyBundle(encode(full))
    expect(fullResult.originalReport).toBeNull()
    if (fullResult.source.mode !== 'azure-network') throw new Error('Wrong mode')
    expect(fullResult.source.comparison).toBeNull()
    expect(fullResult.source.observations).toEqual(full.observations)
  })

  it('packages designs without a capture, without inventing Azure evidence', async () => {
    const result = await readDiscrepancyBundle(encode({ mode: 'vwan', topology: comparisonDesign() }))
    expect(result.source).toMatchObject({ mode: 'vwan', session: undefined })
    expect(result.originalReport).toBeNull()
  })

  it('does not trust serialized findings and keeps issue URLs free of user evidence', async () => {
    const source = vwan(), bytes = editArchive(encode(source), 'report.json', { maliciousClaim: 'Everything matches' })
    const result = await readDiscrepancyBundle(bytes)
    expect(result.originalReport).toEqual({ maliciousClaim: 'Everything matches' })
    if (result.source.mode !== 'vwan') throw new Error('Wrong mode')
    expect(result.source.session?.report).toEqual(source.session.report)
    const url = discrepancyIssueUrl()
    for (const sensitive of [description.summary, description.expected, hubArm, source.topology.name, app.revision]) {
      expect(decodeURIComponent(url)).not.toContain(sensitive)
    }
  })

  it('rejects unsupported versions, modes, malformed evidence, invalid profiles and invalid topologies', async () => {
    const bytes = encode(vwan()), files = unzipSync(bytes)
    const manifest = JSON.parse(strFromU8(files['manifest.json'])), evidence = JSON.parse(strFromU8(files['evidence.json']))
    for (const [file, value] of [
      ['manifest.json', { ...manifest, version: 99 }], ['manifest.json', { ...manifest, mode: 'unknown' }],
      ['evidence.json', { ...evidence, observation: { ...evidence.observation, tables: 'not an array' } }],
      ['evidence.json', { ...evidence, profile: { ...evidence.profile, prefixes: ['invalid-prefix'] } }],
      ['topology.json', { version: 1, hubs: [] }],
    ] as const) {
      await expect(readDiscrepancyBundle(editArchive(bytes, file, value))).rejects.toThrow()
    }
  })

  it('rejects expanded work beyond the observation safety budget', async () => {
    const bytes = encode(vwan()), files = unzipSync(bytes), evidence = JSON.parse(strFromU8(files['evidence.json']))
    const row = { ...evidence.observation.tables[0].routes[0], addressPrefixes: Array(100).fill('10.1.0.0/24'), nextHops: Array(128).fill('hop') }
    evidence.observation.tables[0].routes = Array(8).fill(row)
    await expect(readDiscrepancyBundle(editArchive(bytes, 'evidence.json', evidence))).rejects.toThrow()
  })

  it('rejects arbitrary paths, extra or missing files, compressed entries and oversized archives', async () => {
    const files = unzipSync(encode(vwan())), missing = { ...files }; delete missing['report.json']
    for (const bytes of [
      zipSync({ ...files, '../outside.json': strToU8('{}') }, { level: 0 }),
      zipSync({ ...files, 'extra.json': strToU8('{}') }, { level: 0 }),
      zipSync(missing, { level: 0 }), zipSync(files, { level: 6 }), strToU8('not a ZIP'),
      new Uint8Array(DISCREPANCY_MAX_BYTES + 1),
    ]) await expect(readDiscrepancyBundle(bytes)).rejects.toThrow()
  })

  it('rejects unsafe object keys and deeply nested imported report data', async () => {
    const bytes = encode(vwan()), files = unzipSync(bytes)
    for (const report of ['{"__proto__":{}}', `${'['.repeat(70)}0${']'.repeat(70)}`]) {
      await expect(readDiscrepancyBundle(zipSync({ ...files, 'report.json': strToU8(report) }, { level: 0 }))).rejects.toThrow()
    }
  })

  it('refuses oversized exports instead of truncating evidence', () => {
    const source = vwan(); source.topology.name = 'x'.repeat(DISCREPANCY_MAX_BYTES)
    expect(() => encode(source)).toThrow('25 MB')
  })
})
