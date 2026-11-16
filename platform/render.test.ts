import { describe, expect, it } from 'vitest'
import { hubFirewallTopology } from '../tests/fixtures/hub-firewall'
import { executePlatform } from '../src/platform/service'
import { renderFlow } from './render'

export function renderFixture() {
  return executePlatform({
    contractVersion: 1, operation: 'evaluate', document: { mode: 'vwan', topology: hubFirewallTopology() },
    requirements: [{
      id: 'trusted-bypass', kind: 'flow', source: { kind: 'spoke', id: 'trusted-a' }, target: { kind: 'site', id: 'branch-a' },
      sourceAddress: '10.10.0.4', destinationAddress: '10.50.0.4', expectation: 'allow',
      firewallPolicy: { hubId: 'hub-local', forward: 'bypassed', reverse: 'bypassed' },
    }],
  })
}

export function gifFrames(bytes: Uint8Array) {
  const word = (offset: number) => bytes[offset] + bytes[offset + 1] * 256
  let offset = 13 + (bytes[10] & 128 ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0)
  const frames: { delay: number; image: number[] }[] = []
  let delay = 0
  const blocks = () => { while (bytes[offset]) { const size = bytes[offset++]; offset += size } offset++ }
  while (offset < bytes.length && bytes[offset] !== 59) {
    const marker = bytes[offset++]
    if (marker === 33) {
      const label = bytes[offset++]
      if (label === 249) delay = word(offset + 2) * 10
      blocks()
    } else if (marker === 44) {
      const flags = bytes[offset + 8]
      offset += 9
      if (flags & 128) offset += 3 * (2 ** ((flags & 7) + 1))
      const start = offset++
      blocks()
      frames.push({ delay, image: [...bytes.slice(start, offset)] })
    } else throw new Error(`Unknown GIF block ${marker}`)
  }
  expect(bytes[offset]).toBe(59)
  return { width: word(6), height: word(8), frames }
}

describe('local GIF/SVG/PNG flow encoding', () => {
  it.each([1500, 2000] as const)('encodes a real %i ms loop with moving frames', async durationMs => {
    const result = await renderFlow(renderFixture(), 'trusted-bypass', { durationMs, width: 640 })
    expect(new TextDecoder().decode(result.bytes.slice(0, 6))).toBe('GIF89a')
    const gif = gifFrames(result.bytes)
    expect(gif.width).toBe(640)
    expect(gif.height).toBe(result.scene.height)
    expect(gif.frames.reduce((sum, frame) => sum + frame.delay, 0)).toBe(durationMs)
    expect(gif.frames).toHaveLength(durationMs / 50)
    expect(gif.frames[0].image).not.toEqual(gif.frames[5].image)
  }, 30000)

  it('exports animated SVG and a raster PNG from the same scene', async () => {
    const source = renderFixture()
    const svg = await renderFlow(source, 'trusted-bypass', { format: 'svg' })
    const png = await renderFlow(source, 'trusted-bypass', { format: 'png' })
    expect(new TextDecoder().decode(svg.bytes)).toContain('animateMotion')
    expect([...png.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(svg.scene).toEqual(png.scene)
  }, 30000)
})
