import { ThemeSelector } from './ThemeSelector'

export type SimulatorMode = 'full' | 'hub-spoke' | 'vwan'

interface SimulatorModeSwitchProps {
  mode: SimulatorMode
  onChange: (mode: SimulatorMode) => void
  variant?: 'aznet' | 'vwan'
}

export function SimulatorModeSwitch({ mode, onChange }: SimulatorModeSwitchProps) {
  return (
    <>
    <div
      className="simulator-mode-switch"
      role="group"
      aria-label="Simulator Architecture Mode"
      data-testid="simulator-mode-switch"
    >
      <button
        type="button"
        aria-pressed={mode === 'vwan'}
        data-testid="simulator-mode-vwan"
        onClick={() => onChange('vwan')}
        title="Virtual WAN-Only Mode (Dedicated Virtual WAN Hubs, Route Maps, Routing Intent & Branch Lab)"
      >
        Virtual WAN-Only
      </button>
      <button
        type="button"
        aria-pressed={mode === 'hub-spoke'}
        data-testid="simulator-mode-hub-spoke"
        onClick={() => onChange('hub-spoke')}
        title="Hub-and-Spoke-Only Mode (Standalone VNets, VNet Peerings, UDRs, Route Server, ER/VPN Gateways & NVAs)"
      >
        Hub & Spoke-Only
      </button>
      <button
        type="button"
        aria-pressed={mode === 'full'}
        data-testid="simulator-mode-full"
        onClick={() => onChange('full')}
        title="Full Hybrid Mode (VNets, Peerings, UDRs, Route Server, NVAs + Virtual WAN Hubs)"
      >
        Full Hybrid Mode
      </button>
    </div>
    <ThemeSelector />
    </>
  )
}

