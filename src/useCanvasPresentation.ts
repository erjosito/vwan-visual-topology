import { createContext, useContext } from 'react'

export type CanvasStyle = 'grid' | 'dots'
export const CanvasPresentationContext = createContext({
  style: 'grid' as CanvasStyle,
  setStyle: (_style: CanvasStyle) => {},
  maximized: false,
  toggleMaximized: () => {},
})

export function useCanvasPresentation() {
  return useContext(CanvasPresentationContext)
}
