import { useEffect, useId, useState, type ReactNode } from 'react'
import { t } from './i18n'
import { CanvasPresentationContext, useCanvasPresentation, type CanvasStyle, type ConnectionStyle } from './useCanvasPresentation'
import { useWorkspaceSession } from './workspace-context'
import './canvas-presentation.css'

const storageKey = 'aznet-canvas-style:v1'
const connectionStorageKey = 'aznet-connection-style:v1'

function readConnectionStyle(): ConnectionStyle {
  try {
    const value = localStorage.getItem(connectionStorageKey)
    if (value === 'curved' || value === 'straight') return value
  } catch { /* Keep mode defaults when storage is unavailable. */ }
  return 'default'
}

function readStyle(): CanvasStyle {
  try { return localStorage.getItem(storageKey) === 'dots' ? 'dots' : 'grid' }
  catch { return 'grid' }
}

export function CanvasPresentationProvider({ children }: { children: ReactNode }) {
  const [style, setStyle] = useState<CanvasStyle>(readStyle)
  const [maximized, setMaximized] = useState(false)
  const [connectionStyle, setConnectionStyle] = useState(readConnectionStyle)
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setStyle(readStyle())
      if (event.key === connectionStorageKey || event.key === null) setConnectionStyle(readConnectionStyle())
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
    connectionStyle,
    setConnectionStyle: (next) => {
      setConnectionStyle(next)
      try { localStorage.setItem(connectionStorageKey, next) } catch { /* Keep the in-session choice. */ }
    },
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

export function CanvasEdgeSelection({ selected, path }: { selected: boolean; path: string }) {
  return selected ? <path className="canvas-edge-selection" d={path} fill="none" stroke="var(--focus)"
    strokeWidth={8} strokeDasharray="1 5" strokeLinecap="round" vectorEffect="non-scaling-stroke"
    pointerEvents="none" aria-hidden="true" /> : null
}

export function CanvasControls({ zoom, onZoom, onResetView, onFitView, minZoom = 0.75, maxZoom = 1.5, zoomStep = 0.25, children, status }: {
  zoom: number
  onZoom: (zoom: number) => void
  onResetView: () => void
  onFitView?: () => void
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  children?: ReactNode
  status?: ReactNode
}) {
  const preview = useWorkspaceSession()?.presentationPreview
  const zoomLevels = [...new Set([minZoom, 0.75, 1, 1.25, 1.5, maxZoom, zoom])]
    .filter((level) => level === zoom || (level >= minZoom && level <= maxZoom)).sort((a, b) => a - b)
  return <div className="canvas-controls-stack">{status}<div className="canvas-controls" role="group" aria-label={t('Canvas controls')}>
    <div className="canvas-zoom-controls">
      <button type="button" aria-label={t('Zoom out')} title={t('Zoom out')} aria-keyshortcuts="Control+-" disabled={zoom <= minZoom}
        onClick={() => onZoom(Math.max(minZoom, +(zoom - zoomStep).toFixed(2)))}>-</button>
      <select aria-label={t('Canvas zoom')} title={t('Canvas zoom shortcuts: Ctrl+plus/minus or mouse wheel. Gestures apply only inside the canvas.')} value={zoom} onChange={(event) => onZoom(Number(event.target.value))}>
        {zoomLevels.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}
      </select>
      <button type="button" aria-label={t('Zoom in')} title={t('Zoom in')} aria-keyshortcuts="Control+=" disabled={zoom >= maxZoom}
        onClick={() => onZoom(Math.min(maxZoom, +(zoom + zoomStep).toFixed(2)))}>+</button>
    </div>
    <button type="button" onClick={onResetView}>{t('Reset view')}</button>
    {onFitView && <button type="button" onClick={onFitView}>{t('Fit view')}</button>}
    {children}
    {!preview && <CanvasStyleSettings labeled={false} />}
  </div></div>
}

export function CanvasStyleSettings({ labeled = true }: { labeled?: boolean }) {
  const { style, setStyle, connectionStyle, setConnectionStyle } = useCanvasPresentation()
  return <>
    <label>{labeled && t('Canvas style')}<select aria-label={t('Canvas style')} value={style} onChange={(event) => setStyle(event.target.value as CanvasStyle)}>
      <option value="grid">{t('Grid / edge-to-edge')}</option>
      <option value="dots">{t('Dots / framed')}</option>
    </select></label>
    <label>{labeled && t('Connection style')}<select aria-label={t('Connection style')} title={t('Parallel connections stay separated in every style.')}
      value={connectionStyle} onChange={(event) => setConnectionStyle(event.target.value as ConnectionStyle)}>
      <option value="default">{t('Mode-default links')}</option>
      <option value="curved">{t('Curved links')}</option>
      <option value="straight">{t('Straight links')}</option>
    </select></label>
  </>
}

export function CanvasMaximizeButton() {
  const { maximized, toggleMaximized } = useCanvasPresentation()
  const label = t(maximized ? 'Restore panels' : 'Maximize canvas')
  return <button type="button" className="canvas-view-toggle" aria-label={label} title={label} aria-pressed={maximized} onClick={toggleMaximized}>
    <span className="canvas-maximize-label">{label}</span>
    <span className="canvas-maximize-icon" aria-hidden="true">[ ]</span>
  </button>
}
