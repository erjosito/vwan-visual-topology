export type SimulatorMode = 'full' | 'hub-spoke' | 'vwan'

interface SimulatorModeSwitchProps {
  mode: SimulatorMode
  onChange: (mode: SimulatorMode) => void
  variant?: 'aznet' | 'vwan'
}

export function SimulatorModeSwitch({ mode, onChange, variant = 'aznet' }: SimulatorModeSwitchProps) {
  const isVwanTheme = variant === 'vwan'
  const pillBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: 8,
    background: isVwanTheme ? '#f1f5f9' : '#0f172a',
    border: isVwanTheme ? '1px solid #cbd5e1' : '1px solid #334155',
  }

  const getBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px',
    fontSize: 11.5,
    fontWeight: 700,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.12s ease',
    background: active
      ? isVwanTheme
        ? '#0f172a'
        : '#10b981'
      : 'transparent',
    color: active
      ? isVwanTheme
        ? '#ffffff'
        : '#042f2e'
      : isVwanTheme
        ? '#475569'
        : '#cbd5e1',
  })

  return (
    <div
      style={pillBase}
      role="group"
      aria-label="Simulator Architecture Mode"
      data-testid="simulator-mode-switch"
    >
      <button
        type="button"
        style={getBtnStyle(mode === 'vwan')}
        data-testid="simulator-mode-vwan"
        onClick={() => onChange('vwan')}
        title="Virtual WAN-Only Mode (Dedicated Virtual WAN Hubs, Route Maps, Routing Intent & Branch Lab)"
      >
        Virtual WAN-Only
      </button>
      <button
        type="button"
        style={getBtnStyle(mode === 'hub-spoke')}
        data-testid="simulator-mode-hub-spoke"
        onClick={() => onChange('hub-spoke')}
        title="Hub-and-Spoke-Only Mode (Standalone VNets, VNet Peerings, UDRs, Route Server, ER/VPN Gateways & NVAs)"
      >
        Hub & Spoke-Only
      </button>
      <button
        type="button"
        style={getBtnStyle(mode === 'full')}
        data-testid="simulator-mode-full"
        onClick={() => onChange('full')}
        title="Full Hybrid Mode (VNets, Peerings, UDRs, Route Server, NVAs + Virtual WAN Hubs)"
      >
        Full Hybrid Mode
      </button>
    </div>
  )
}
