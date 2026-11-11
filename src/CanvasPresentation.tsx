import { useEffect, useId, useState, type ReactNode } from 'react'
import { t } from './i18n'
import { CanvasPresentationContext, useCanvasPresentation, type CanvasStyle } from './useCanvasPresentation'
import './canvas-presentation.css'

const storageKey = 'aznet-canvas-style:v1'

function readStyle(): CanvasStyle {
  try { return localStorage.getItem(storageKey) === 'dots' ? 'dots' : 'grid' }
  catch { return 'grid' }
}

export function CanvasPresentationProvider({ children }: { children: ReactNode }) {
  const [style, setStyle] = useState<CanvasStyle>(readStyle)
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setStyle(readStyle())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  return <CanvasPresentationContext.Provider value={{
    style,
    setStyle: (next) => {
      setStyle(next)
      try { localStorage.setItem(storageKey, next) } catch { /* Keep the in-session choice. */ }
    },
    maximized,
    toggleMaximized: () => setMaximized((value) => !value),
  }}>{children}</CanvasPresentationContext.Provider>
}

export function CanvasBackground({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const { style } = useCanvasPresentation()
  const patternId = useId()
  return <>
    <defs>
      <pattern id={patternId} width="28" height="28" patternUnits="userSpaceOnUse" data-canvas-pattern={style}>
        {style === 'grid'
          ? <path d="M 28 0 L 0 0 0 28" fill="none" stroke="var(--grid)" strokeWidth="1" />
          : <circle cx="1" cy="1" r="1" fill="var(--grid)" />}
      </pattern>
    </defs>
    <rect x={x} y={y} width={width} height={height} fill={`url(#${patternId})`} pointerEvents="none" />
  </>
}

export function CanvasControls({ zoom, onZoom, onResetView, minZoom = 0.75, maxZoom = 1.5, zoomStep = 0.25, children, status }: {
  zoom: number
  onZoom: (zoom: number) => void
  onResetView: () => void
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  children?: ReactNode
  status?: ReactNode
}) {
  const { style, setStyle, maximized, toggleMaximized } = useCanvasPresentation()
  const zoomLevels = [...new Set([minZoom, 0.75, 1, 1.25, 1.5, maxZoom, zoom])]
    .filter((level) => level >= minZoom && level <= maxZoom).sort((a, b) => a - b)
  return <div className="canvas-controls-stack">{status}<div className="canvas-controls" role="group" aria-label={t('Canvas controls')}>
    <div className="canvas-zoom-controls">
      <button type="button" aria-label={t('Zoom out')} title={t('Zoom out')} disabled={zoom <= minZoom}
        onClick={() => onZoom(Math.max(minZoom, +(zoom - zoomStep).toFixed(2)))}>-</button>
      <select aria-label={t('Canvas zoom')} value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>
        {zoomLevels.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}
      </select>
      <button type="button" aria-label={t('Zoom in')} title={t('Zoom in')} disabled={zoom >= maxZoom}
        onClick={() => onZoom(Math.min(maxZoom, +(zoom + zoomStep).toFixed(2)))}>+</button>
    </div>
    <button type="button" onClick={onResetView}>{t('Reset view')}</button>
    {children}
    <select aria-label={t('Canvas style')} value={style} onChange={(event) => setStyle(event.target.value as CanvasStyle)}>
      <option value="grid">{t('Grid / edge-to-edge')}</option>
      <option value="dots">{t('Dots / framed')}</option>
    </select>
    <button type="button" className="canvas-view-toggle" aria-pressed={maximized} onClick={toggleMaximized}>
      {t(maximized ? 'Restore panels' : 'Maximize canvas')}
    </button>
  </div></div>
}
