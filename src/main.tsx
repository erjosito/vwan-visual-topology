import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AzureNetApp } from './azure-net/AzureNetApp.tsx'
import type { SimulatorMode } from './SimulatorModeSwitch.tsx'
import { useLanguage } from './i18n'
import { CanvasPresentationProvider } from './CanvasPresentation'
import { useCanvasPresentation } from './useCanvasPresentation'
import './theme.css'

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
    {mode === 'vwan'
      ? <App simulatorMode={mode} onChangeSimulatorMode={setMode} />
      : <AzureNetApp simulatorMode={mode} onChangeSimulatorMode={setMode} />}
  </div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CanvasPresentationProvider><UnifiedSimulatorRoot /></CanvasPresentationProvider>
  </StrictMode>,
)

