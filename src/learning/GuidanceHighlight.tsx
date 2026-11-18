import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { registeredGuidanceAnchors, visibleGuidanceBox } from './guidance-anchors'

export function GuidanceHighlight({ anchors, onVisibility }: { anchors: string[]; onVisibility: (visible: boolean) => void }) {
  const [boxes, setBoxes] = useState<ReturnType<typeof visibleGuidanceBox>[]>([])
  const [dialog, setDialog] = useState<Element | null>(null)
  const anchorKey = JSON.stringify(anchors)
  useEffect(() => {
    const scopedAnchors: string[] = JSON.parse(anchorKey)
    let frame = 0, last = '', alive = true, lastTick = 0, lastDialog: Element | null | undefined
    const scrolled = new WeakSet<Element>()
    const update = (time: number) => {
      if (!alive) return
      frame = requestAnimationFrame(update)
      if (time - lastTick < 100) return
      lastTick = time
      const registered = registeredGuidanceAnchors()
      let next: ReturnType<typeof visibleGuidanceBox>[] = []
      let nextDialog: Element | null = null
      for (const key of scopedAnchors) {
        const candidates = registered.filter((element) => element.getAttribute('data-learning-anchor') === key)
        for (const element of candidates) {
          if (!scrolled.has(element)) {
            scrolled.add(element)
            if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
          }
        }
        next = candidates.map(visibleGuidanceBox).filter(Boolean)
        if (next.length) {
          nextDialog = candidates.find((element) => visibleGuidanceBox(element))?.closest('dialog[open]') ?? null
          break
        }
      }
      const serialized = JSON.stringify(next)
      if (last !== serialized) { last = serialized; setBoxes(next); onVisibility(next.length > 0) }
      if (lastDialog !== nextDialog) { lastDialog = nextDialog; setDialog(nextDialog) }
    }
    frame = requestAnimationFrame(update)
    return () => { alive = false; cancelAnimationFrame(frame) }
  }, [anchorKey, onVisibility])
  const overlay = <div className="learning-cue-layer" aria-hidden="true" data-testid="learning-cue-layer">
    {boxes.map((box, index) => box && <div key={index} className="learning-cue" style={box} />)}
  </div>
  return dialog ? createPortal(overlay, dialog) : overlay
}

