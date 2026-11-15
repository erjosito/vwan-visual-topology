import { Component, lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { SimulatorModeSwitch } from './SimulatorModeSwitch.tsx'
import type { SimulatorMode } from './SimulatorModeSwitch.tsx'
import { t, useLanguage } from './i18n'
import { CanvasMaximizeButton, CanvasPresentationProvider } from './CanvasPresentation'
import { useCanvasPresentation } from './useCanvasPresentation'
import './theme.css'
import { DesktopTools } from './DesktopTools'

const App = lazy(() => import('./App.tsx'))
const AzureNetApp = lazy(() => import('./azure-net/AzureNetApp.tsx').then((module) => ({ default: module.AzureNetApp })))

class WorkspaceBoundary extends Component<{ children: ReactNode; mode: SimulatorMode; onChange: (mode: SimulatorMode) => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert">
      <p>{t('Workspace could not load. Your saved design has not been replaced.')}</p>
      <button onClick={() => window.location.reload()}>{t('Reload workspace')}</button>
      <SimulatorModeSwitch mode={this.props.mode} onChange={this.props.onChange} />
    </section>
  }
}

function resolveInitialMode(): SimulatorMode {
  const params = new URLSearchParams(window.location.search)
  const modeParam = (params.get('mode') ?? '').toLowerCase()
  if (modeParam === 'vwan' || modeParam === 'vwan-only') return 'vwan'
  if (modeParam === 'hub-spoke' || modeParam === 'hub-and-spoke' || modeParam === 'vnet') return 'hub-spoke'
  if (modeParam === 'full' || modeParam === 'aznet' || modeParam === 'azure-net') return 'full'

  const sampleParam = (params.get('sample') ?? '').trim()
  if (
    sampleParam &&
    !sampleParam.startsWith('azure-vnet-') &&
    !sampleParam.startsWith('uc')
  ) {
    if (import.meta.env.VITE_APP_MODE === 'azure-net') return 'full'
    return 'vwan'
  }

  const hostname = window.location.hostname.toLowerCase()
  if (hostname === 'aznet-simulator.com' || hostname === 'www.aznet-simulator.com') return 'hub-spoke'
  if (hostname === 'vwan-simulator.com' || hostname === 'www.vwan-simulator.com') return 'vwan'

  if (import.meta.env.VITE_APP_MODE === 'azure-net') {
    return 'full'
  }

  return 'vwan'
}

export function UnifiedSimulatorRoot() {
  const [mode, setMode] = useState<SimulatorMode>(resolveInitialMode)
  const { style, maximized } = useCanvasPresentation()
  useLanguage()

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', mode === 'full' ? 'azure-net' : mode)
    window.history.replaceState(null, '', url.toString())
  }, [mode])

  return <div className={`simulator-shell${maximized ? ' canvas-maximized' : ''}`} data-canvas-style={style}>
    <DesktopTools key={`tools:${mode}`} mode={mode} />
    <CanvasMaximizeButton />
    <WorkspaceBoundary key={`workspace:${mode === 'vwan' ? 'vwan' : 'azure-net'}`} mode={mode} onChange={setMode}>
      <Suspense fallback={<section aria-label={t('Workspace loading')}>
        <p role="status">{t('Loading workspace…')}</p>
        <SimulatorModeSwitch mode={mode} onChange={setMode} />
      </section>}>
        {mode === 'vwan'
          ? <App simulatorMode={mode} onChangeSimulatorMode={setMode} />
          : <AzureNetApp simulatorMode={mode} onChangeSimulatorMode={setMode} />}
      </Suspense>
    </WorkspaceBoundary>
  </div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CanvasPresentationProvider><UnifiedSimulatorRoot /></CanvasPresentationProvider>
  </StrictMode>,
)

