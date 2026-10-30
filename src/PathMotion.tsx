import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NodePosition } from './model'

export interface MotionSegment {
  id: string; from: string; to: string
  start: NodePosition; control: NodePosition; end: NodePosition
}
export interface MotionFlow {
  segments: MotionSegment[]; destinationId: string; direction?: 'forward' | 'return'; stopped?: boolean
}

function PathStream({ flow, pixelsPerUnit, color }: { flow: MotionFlow; pixelsPerUnit: number; color: string }) {
  const { segments } = flow
  const track = useRef<SVGPathElement>(null)
  const group = useRef<SVGGElement>(null)
  const [count, setCount] = useState(2)
  // Straight joins cross the intervening node underneath its card.
  const d = segments.map((segment, i) => `${i ? 'L' : 'M'} ${segment.start.x} ${segment.start.y} Q ${segment.control.x} ${segment.control.y} ${segment.end.x} ${segment.end.y}`).join(' ')
  useLayoutEffect(() => {
    const duration = Math.max(track.current!.getTotalLength() * pixelsPerUnit / 200, 0.001)
    setCount(Math.max(2, Math.ceil(duration / 0.65)))
    group.current!.querySelectorAll('animateMotion').forEach((animation, i) => {
      animation.setAttribute('dur', `${duration}s`)
      animation.beginElementAt(-i * duration / count)
    })
  }, [d, pixelsPerUnit, count])
  return <g ref={group} className="path-flow" style={{ color }} aria-hidden="true" data-destination-id={flow.destinationId} data-direction={flow.direction} data-stop-node-id={flow.stopped ? segments.at(-1)!.to : undefined} data-segments={JSON.stringify(segments.map(({ id, from, to }) => ({ id, from, to })))}>
    <path ref={track} className="path-flow-track" d={d} fill="none" stroke="none" />
    {Array.from({ length: count }, (_, i) => <circle key={i} className="path-flow-circle" r="7">
      <animateMotion path={d} begin="indefinite" calcMode="paced" repeatCount="indefinite" />
    </circle>)}
  </g>
}

export function PathMotion({ flows, pixelsPerUnit, colors }: { flows: MotionFlow[]; pixelsPerUnit: number; colors: Map<string, string> }) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  if (reducedMotion) return null
  const distinct = new Map(flows.filter((flow) => flow.segments.length).map((flow) => [
    JSON.stringify([flow.destinationId, flow.direction, flow.stopped, flow.segments.map(({ id, from }) => [id, from])]), flow,
  ]))
  return [...distinct].map(([key, flow]) => <PathStream key={key} flow={flow} pixelsPerUnit={pixelsPerUnit} color={colors.get(flow.destinationId)!} />)
}
