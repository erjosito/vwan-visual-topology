import { describe, expect, it } from 'vitest'
import { example } from './model'
import { diagramCurve, diagramLayout } from './diagram-layout'
import { simulate } from './routing'
import { validateTopology } from './validation'
import { connectionBend, fitDiagram, reverseCurve } from './connection-geometry'

describe('saved diagram layouts', () => {
  it('round-trips independent positions without changing routing, and drops deleted-node positions', () => {
    const topology = structuredClone(example)
    topology.layout = { mode: 'constellation', positions: { layered: { eu: { x: 310, y: 280 } }, constellation: { eu: { x: 460, y: 330 } } } }
    const saved = validateTopology(JSON.parse(JSON.stringify(topology)))
    expect(saved.layout).toEqual(topology.layout)
    expect(diagramLayout(saved, 'layered').positions.get('eu')).toEqual({ x: 310, y: 280 })
    expect(diagramLayout(saved, 'constellation').positions.get('eu')).toEqual({ x: 460, y: 330 })
    expect(simulate(saved)).toEqual(simulate(validateTopology(example)))
    saved.layout!.positions.layered!.deleted = { x: 310, y: 280 }
    expect(validateTopology(saved).layout!.positions.layered).not.toHaveProperty('deleted')
  })

  it.each([NaN, Infinity, -1, 20001, '300', null])('rejects invalid coordinates: %s', (x) => {
    expect(() => validateTopology({ ...example, layout: { mode: 'layered', positions: { layered: { eu: { x, y: 300 } } } } })).toThrow(/coordinates/)
  })

  it('rejects unsupported views and preserves old files without visual metadata', () => {
    expect(() => validateTopology({ ...example, layout: { mode: 'regional', positions: {} } })).toThrow(/visualization/)
    expect(validateTopology(example)).not.toHaveProperty('layout')
  })

  it('expands the canvas to retain imported positions instead of clipping them', () => {
    const topology = structuredClone(example)
    topology.layout = { mode: 'layered', positions: { layered: { eu: { x: 1800, y: 1200 } } } }
    const { width, height, positions } = diagramLayout(topology, 'layered')
    expect(width).toBeGreaterThan(1800 + 112)
    expect(height).toBeGreaterThan(1200 + 100)
    expect(positions.get('eu')).toEqual({ x: 1800, y: 1200 })
  })

  it('anchors curves at moved cards in any direction, including vertical and coincident nodes', () => {
    const size = { x: 100, y: 40 }
    const a = { x: 200, y: 100 }, b = { x: 200, y: 300 }
    expect(diagramCurve(a, b, size, size).d).toBe('M 200 140 Q 200 200 200 260')
    expect(diagramCurve(b, a, size, size).d).toBe('M 200 260 Q 200 200 200 140')
    expect(diagramCurve(a, { x: 500, y: 100 }, size, size).d).toBe('M 300 100 Q 350 100 400 100')
    expect(diagramCurve(a, a, size, size).d).not.toMatch(/NaN|Infinity/)
  })

  it('keeps reversed parallel links separated and reverses the marker tangent on the same curve', () => {
    const size = { x: 100, y: 40 }
    const a = { x: 200, y: 100 }, b = { x: 500, y: 400 }
    for (const style of ['curved', 'straight'] as const) {
      const first = diagramCurve(a, b, size, size, connectionBend(style, 0, 0, 2))
      const second = diagramCurve(b, a, size, size, -connectionBend(style, 0, 1, 2))
      expect(first.label).not.toEqual(second.label)
      const point = first.at(0.75), reversed = reverseCurve(first).at(0.25)
      expect(reversed).toEqual({ x: point.x, y: point.y, dx: -point.dx, dy: -point.dy })
    }
  })

  it('fits distant and negative-coordinate nodes without changing their saved layout', () => {
    const boxes = [{ x: -300, y: -200, width: 315, height: 190 }, { x: 1800, y: 1200, width: 235, height: 76 }]
    const original = structuredClone(boxes)
    for (const aspect of [360 / 600, 1180 / 790, 1400 / 600]) {
      const bounds = fitDiagram(boxes, aspect)
      expect(bounds.width / bounds.height).toBeCloseTo(aspect)
      for (const box of boxes) {
        expect(box.x).toBeGreaterThan(bounds.x)
        expect(box.y).toBeGreaterThan(bounds.y)
        expect(box.x + box.width).toBeLessThan(bounds.x + bounds.width)
        expect(box.y + box.height).toBeLessThan(bounds.y + bounds.height)
      }
    }
    expect(boxes).toEqual(original)
  })
})
