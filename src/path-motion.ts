import type { NodePosition } from './model'

export interface MotionSegment {
  id: string; from: string; to: string
  start: NodePosition; control: NodePosition; end: NodePosition
}
export interface MotionFlow {
  segments: MotionSegment[]; destinationId: string; direction?: 'forward' | 'return'; stopped?: boolean
}

export function motionTrack(segments: MotionSegment[]) {
  return segments.map((segment, i) => `${i ? 'L' : 'M'} ${segment.start.x} ${segment.start.y} Q ${segment.control.x} ${segment.control.y} ${segment.end.x} ${segment.end.y}`).join(' ')
}

export function motionSamples(segments: MotionSegment[]) {
  const points: (NodePosition & { distance: number })[] = []
  let distance = 0
  const add = (point: NodePosition) => {
    const previous = points.at(-1)
    if (previous) distance += Math.hypot(point.x - previous.x, point.y - previous.y)
    points.push({ ...point, distance })
  }
  for (const segment of segments) {
    add(segment.start)
    for (let i = 1; i <= 32; i++) {
      const t = i / 32, inverse = 1 - t
      add({
        x: inverse ** 2 * segment.start.x + 2 * inverse * t * segment.control.x + t ** 2 * segment.end.x,
        y: inverse ** 2 * segment.start.y + 2 * inverse * t * segment.control.y + t ** 2 * segment.end.y,
      })
    }
  }
  return points
}

export function motionPoint(samples: ReturnType<typeof motionSamples>, fraction: number): NodePosition {
  const distance = (samples.at(-1)?.distance ?? 0) * Math.max(0, Math.min(1, fraction))
  const index = samples.findIndex(point => point.distance >= distance)
  const right = samples[index < 0 ? samples.length - 1 : index]
  if (!right) return { x: 0, y: 0 }
  const left = samples[Math.max(0, index - 1)] ?? right
  const t = right.distance === left.distance ? 0 : (distance - left.distance) / (right.distance - left.distance)
  return { x: left.x + (right.x - left.x) * t, y: left.y + (right.y - left.y) * t }
}
