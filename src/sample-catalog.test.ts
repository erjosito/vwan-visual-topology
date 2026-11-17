import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AZURE_NET_SAMPLE_GALLERY, SAMPLE_TRACKS, VWAN_SAMPLE_GALLERY, resolveSampleIdAlias } from './sample-catalog'
import { example } from './model'
import { validateTopology } from './validation'
import { simulate } from './routing'
import { AZURE_NET_SAMPLES } from './azure-net/model'
import { parseAzNetTopology } from './azure-net/admission'
import { simulateAzNet } from './azure-net/engine'
import { exampleCourse } from './learning/course-examples'
import { ja } from './i18n-ja'

const entries = [...VWAN_SAMPLE_GALLERY, ...AZURE_NET_SAMPLE_GALLERY]
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

describe('curated sample catalog integration', () => {
  it('covers the runnable sample inventory without dropping a stable ID', () => {
    const files = (directory: string) => readdirSync(directory).filter((file) => file.endsWith('.json')).map((file) => file.slice(0, -5))
    expect(VWAN_SAMPLE_GALLERY.map((entry) => entry.id).sort())
      .toEqual(['default-example', ...files(resolve('public', 'docs', 'samples'))].sort())
    expect(AZURE_NET_SAMPLE_GALLERY.map((entry) => entry.id).sort())
      .toEqual(files(resolve('public', 'docs', 'samples', 'azure-net')).sort())
    const identifiers = entries.flatMap((entry) => [entry.id, ...entry.aliases ?? []])
    expect(new Set(identifiers).size).toBe(identifiers.length)
    for (const entry of entries) {
      expect(SAMPLE_TRACKS.some((track) => track.id === entry.track), entry.id).toBe(true)
      for (const alias of [entry.id, ...entry.aliases ?? []]) expect(resolveSampleIdAlias(alias)).toBe(entry.id)
      if (entry.curriculum) {
        expect(exampleCourse.lessons.find((lesson) => lesson.id === entry.curriculum!.lessonId)?.title.en)
          .toBe(entry.curriculum.title)
      }
    }
    expect(resolveSampleIdAlias('  HRP  ')).toBe('hub-routing-preferences')
    expect(resolveSampleIdAlias('  future-sample  ')).toBe('future-sample')
  })

  it.each(VWAN_SAMPLE_GALLERY)('admits and computes hub routes for $id', (entry) => {
    const topology = validateTopology(entry.file ? json(resolve('public', ...entry.file.split('/'))) : structuredClone(example))
    expect(Object.keys(simulate(topology).tables).sort()).toEqual(topology.hubs.map((hub) => hub.id).sort())
  })

  it.each(AZURE_NET_SAMPLE_GALLERY)('admits and computes subnet routes for $id', (entry) => {
    const embedded = AZURE_NET_SAMPLES.find((sample) => sample.id === entry.id)
    const topology = parseAzNetTopology(embedded ? structuredClone(embedded.topology)
      : json(resolve('public', 'docs', 'samples', 'azure-net', `${entry.id}.json`)))
    const result = simulateAzNet(topology)
    for (const vnet of topology.vnets) for (const subnet of vnet.subnets) {
      expect(result.subnetTables[subnet.id], `${entry.id}: ${subnet.id}`).toBeDefined()
    }
  })

  it('localizes every curated description and study guide, not only the filter controls', () => {
    const messages = [...SAMPLE_TRACKS.flatMap((track) => [track.label, track.description]),
      ...entries.flatMap((entry) => [entry.title, entry.summary, entry.purpose, entry.prerequisites,
        ...entry.concepts, ...entry.capabilities, ...entry.limitations, entry.suggestedExperiment,
        ...entry.curriculum ? [entry.curriculum.title] : []])]
    expect(messages.filter((message) => !ja[message])).toEqual([])
  })
})
