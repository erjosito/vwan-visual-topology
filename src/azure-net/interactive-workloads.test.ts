import { describe, expect, it } from 'vitest'
import { parseAzNetTopology } from './admission'
import { validateTopology } from '../validation'
import { interactiveTiers, mixedInteractiveTopology, vwanInteractiveTopology } from '../../tests/fixtures/interactive-workloads'

describe('native interactive benchmark scope', () => {
  for (const tier of interactiveTiers) {
    it(`${tier} fixtures retain their complete native workload through admission`, () => {
      const classic = vwanInteractiveTopology(tier)
      const mixed = mixedInteractiveTopology(tier)
      const original = JSON.stringify({ classic, mixed })
      const admittedClassic = validateTopology(JSON.parse(JSON.stringify(classic)))
      const admittedMixed = parseAzNetTopology(JSON.parse(JSON.stringify(mixed)))
      expect(admittedClassic.spokes.map(node => node.id)).toEqual(classic.spokes.map(node => node.id))
      expect(admittedMixed.vnets.map(node => node.id)).toEqual(mixed.vnets.map(node => node.id))
      expect(admittedClassic.spokes.at(-1)?.prefixes).toEqual(classic.spokes.at(-1)?.prefixes)
      expect(admittedMixed.vnets.at(-1)?.subnets).toEqual(mixed.vnets.at(-1)?.subnets)
      expect(JSON.stringify({ classic, mixed })).toBe(original)
      if (tier === 'near-limit') {
        expect(admittedClassic.spokes.length).toBeGreaterThan(512)
        expect(admittedMixed.vnets.length).toBeGreaterThan(512)
      }
    })
  }
})
