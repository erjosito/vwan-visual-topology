import { createContext, useContext } from 'react'

export type CanvasStyle = 'grid' | 'dots'
export type ConnectionStyle = 'default' | 'curved' | 'straight'
export const CanvasPresentationContext = createContext({
  style: 'grid' as CanvasStyle,
  setStyle: (_style: CanvasStyle) => {},
  maximized: false,
  toggleMaximized: () => {},
  connectionStyle: 'default' as ConnectionStyle,
  setConnectionStyle: (_style: ConnectionStyle) => {},
})

export function useCanvasPresentation() {
  return useContext(CanvasPresentationContext)
}
