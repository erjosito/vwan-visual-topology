import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AzureNetApp } from './azure-net/AzureNetApp.tsx'
import type { SimulatorMode } from './SimulatorModeSwitch.tsx'
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

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', mode === 'full' ? 'azure-net' : mode)
    window.history.replaceState(null, '', url.toString())
  }, [mode])

  if (mode === 'vwan') {
    return <App simulatorMode={mode} onChangeSimulatorMode={setMode} />
  }

  return <AzureNetApp simulatorMode={mode} onChangeSimulatorMode={setMode} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UnifiedSimulatorRoot />
  </StrictMode>,
)

