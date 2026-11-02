import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AzureNetApp } from './azure-net/AzureNetApp.tsx'

const modeParam = new URLSearchParams(window.location.search).get('mode')
const isAzureNetMode =
  modeParam === 'azure-net' ||
  (modeParam !== 'vwan' && import.meta.env.VITE_APP_MODE === 'azure-net')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAzureNetMode ? <AzureNetApp /> : <App />}
  </StrictMode>,
)
