import { diagramCurve } from './diagram-layout'
import type { NodePosition } from './model'
import type { ConnectionStyle } from './useCanvasPresentation'

export function connectionBend(style: ConnectionStyle, defaultBend: number, parallelIndex = 0, parallelCount = 1) {
  if (style === 'default') return defaultBend
  if (parallelCount > 1) return (parallelIndex - (parallelCount - 1) / 2) * 70
  return style === 'straight' ? 0 : defaultBend || 35
}

export function reverseCurve(curve: ReturnType<typeof diagramCurve>) {
  return {
    ...curve, start: curve.end, end: curve.start,
    at: (t: number) => {
      const point = curve.at(1 - t)
      return { x: point.x, y: point.y, dx: -point.dx, dy: -point.dy }
    },
  }
}

export function fitDiagram(boxes: { x: number; y: number; width: number; height: number }[], aspect: number) {
  if (!boxes.length) return { x: 0, y: 0, width: 1180, height: 790 }
  const x = Math.min(...boxes.map((box) => box.x)) - 40
  const y = Math.min(...boxes.map((box) => box.y)) - 40
  const width = Math.max(...boxes.map((box) => box.x + box.width)) - x + 40
  const height = Math.max(...boxes.map((box) => box.y + box.height)) - y + 60
  const viewWidth = Math.max(width, height * aspect)
  const viewHeight = viewWidth / aspect
  return { x: x - (viewWidth - width) / 2, y: y - (viewHeight - height) / 2, width: viewWidth, height: viewHeight }
}

export function centerOfBox(box: { x: number; y: number; width: number; height: number }): NodePosition {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
