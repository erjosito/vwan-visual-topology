import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import './azure-net/azure-net.css'
import { CanvasPresentationProvider } from './CanvasPresentation'
import './theme.css'
export const UnifiedSimulatorRoot = lazy(() => import('./WorkspaceRoot').then((module) => ({ default: module.UnifiedSimulatorRoot })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CanvasPresentationProvider><Suspense fallback={<p role="status">Loading workspace…</p>}><UnifiedSimulatorRoot /></Suspense></CanvasPresentationProvider>
  </StrictMode>,
)

