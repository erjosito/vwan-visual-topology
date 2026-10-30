import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NodePosition } from './model'

export interface MotionSegment {
  id: string; from: string; to: string
  start: NodePosition; control: NodePosition; end: NodePosition
}

function PathCircle({ segments, pixelsPerUnit }: { segments: MotionSegment[]; pixelsPerUnit: number }) {
  const track = useRef<SVGPathElement>(null)
  const animation = useRef<SVGAnimateMotionElement>(null)
  // Straight joins cross the intervening node underneath its card.
  const d = segments.map((segment, i) => `${i ? 'L' : 'M'} ${segment.start.x} ${segment.start.y} Q ${segment.control.x} ${segment.control.y} ${segment.end.x} ${segment.end.y}`).join(' ')
  useLayoutEffect(() => {
    const duration = track.current!.getTotalLength() * pixelsPerUnit / 200
    animation.current!.setAttribute('dur', `${Math.max(duration, 0.001)}s`)
    animation.current!.beginElement()
  }, [d, pixelsPerUnit])
  return <g className="path-flow" aria-hidden="true" data-segments={JSON.stringify(segments.map(({ id, from, to }) => ({ id, from, to })))}>
    <path ref={track} className="path-flow-track" d={d} fill="none" stroke="none" />
    <circle className="path-flow-circle" r="7">
      <animateMotion ref={animation} path={d} begin="indefinite" calcMode="paced" repeatCount="indefinite" />
    </circle>
  </g>
}

export function PathMotion({ flows, pixelsPerUnit }: { flows: MotionSegment[][]; pixelsPerUnit: number }) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  if (reducedMotion) return null
  const distinct = new Map(flows.filter((flow) => flow.length).map((flow) => [
    JSON.stringify(flow.map(({ id, from }) => [id, from])), flow,
  ]))
  return [...distinct].map(([key, segments]) => <PathCircle key={key} segments={segments} pixelsPerUnit={pixelsPerUnit} />)
}
