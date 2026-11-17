import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

interface Anchor { x: number; y: number }

export function useCanvasZoom({ svgRef, zoom, onZoom, onPan, minZoom, maxZoom, zoomStep, isDragging }: {
  svgRef: RefObject<SVGSVGElement | null>
  zoom: number
  onZoom: (zoom: number) => void
  onPan: (delta: Anchor) => void
  minZoom: number
  maxZoom: number
  zoomStep: number
  isDragging: () => boolean
}) {
  const pending = useRef<{ client: Anchor; world: DOMPoint } | undefined>(undefined)
  const changeZoom = useCallback((value: number, anchor?: Anchor) => {
    const element = svgRef.current
    const next = Math.max(minZoom, Math.min(maxZoom, +value.toFixed(4)))
    if (!element || (next === zoom && !pending.current)) return
    const bounds = element.getBoundingClientRect()
    // The VWAN SVG can overflow its scrolling viewport; center the visible portion.
    const viewport = element.parentElement!.getBoundingClientRect()
    const client = anchor ?? {
      x: (Math.max(bounds.left, viewport.left) + Math.min(bounds.right, viewport.right)) / 2,
      y: (Math.max(bounds.top, viewport.top) + Math.min(bounds.bottom, viewport.bottom)) / 2,
    }
    const matrix = element.getScreenCTM()
    if (matrix) pending.current = { client, world: new DOMPoint(client.x, client.y).matrixTransform(matrix.inverse()) }
    onZoom(next)
  }, [svgRef, zoom, minZoom, maxZoom, onZoom])

  useLayoutEffect(() => {
    const anchor = pending.current
    pending.current = undefined
    const matrix = svgRef.current?.getScreenCTM()
    if (!anchor || !matrix) return
    const after = new DOMPoint(anchor.client.x, anchor.client.y).matrixTransform(matrix.inverse())
    onPan({ x: anchor.world.x - after.x, y: anchor.world.y - after.y })
  }, [svgRef, zoom, onPan])

  useEffect(() => {
    const element = svgRef.current
    if (!element) return
    let currentZoom = zoom
    const excluded = (target: EventTarget | null) => target instanceof Element &&
      !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]')
    const blocked = (target: EventTarget | null) => isDragging() || excluded(target) || !!document.querySelector('dialog[open], [role="menu"]')
    const wheel = (event: WheelEvent) => {
      if (blocked(event.target) || event.altKey || event.metaKey || event.shiftKey || !event.deltaY) return
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1)
      const next = Math.max(minZoom, Math.min(maxZoom, +(currentZoom * Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.002)).toFixed(4)))
      if (next === currentZoom) return
      event.preventDefault()
      currentZoom = next
      changeZoom(next, { x: event.clientX, y: event.clientY })
    }
    const keydown = (event: KeyboardEvent) => {
      if (blocked(event.target) || event.isComposing || !event.ctrlKey || event.altKey || event.metaKey) return
      const plus = ['+', '='].includes(event.key) || event.code === 'NumpadAdd'
      const minus = ['-', '_'].includes(event.key) || event.code === 'NumpadSubtract'
      if (!plus && !minus) return
      event.preventDefault()
      event.stopPropagation()
      currentZoom = Math.max(minZoom, Math.min(maxZoom, +(currentZoom + (plus ? zoomStep : -zoomStep)).toFixed(4)))
      changeZoom(currentZoom)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('keydown', keydown)
    return () => {
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', keydown)
    }
  }, [svgRef, zoom, minZoom, maxZoom, zoomStep, changeZoom, isDragging])
}
