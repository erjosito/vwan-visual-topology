export type SimulatorMode = 'full' | 'hub-spoke' | 'vwan'

interface SimulatorModeSwitchProps {
  mode: SimulatorMode
  onChange: (mode: SimulatorMode) => void
  variant?: 'aznet' | 'vwan'
}

const ACTIVE_MODE_THEME: Record<SimulatorMode, { bg: string; color: string; shadow: string }> = {
  vwan: {
    bg: 'linear-gradient(135deg, #0284c7, #2563eb)',
    color: '#ffffff',
    shadow: '0 1px 4px rgba(37, 99, 235, 0.45)',
  },
  'hub-spoke': {
    bg: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    color: '#ffffff',
    shadow: '0 1px 4px rgba(99, 102, 241, 0.45)',
  },
  full: {
    bg: 'linear-gradient(135deg, #10b981, #059669)',
    color: '#042f2e',
    shadow: '0 1px 4px rgba(16, 185, 129, 0.45)',
  },
}

export function SimulatorModeSwitch({ mode, onChange }: SimulatorModeSwitchProps) {
  const pillBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: 8,
    background: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    flexShrink: 0,
  }

  const getBtnStyle = (targetMode: SimulatorMode): React.CSSProperties => {
    const active = mode === targetMode
    const accent = ACTIVE_MODE_THEME[targetMode]
    return {
      padding: '4px 10px',
      fontSize: 11.5,
      fontWeight: 700,
      borderRadius: 6,
      border: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      transition: 'all 0.12s ease',
      background: active ? accent.bg : 'transparent',
      color: active ? accent.color : '#cbd5e1',
      boxShadow: active ? accent.shadow : 'none',
    }
  }

  return (
    <div
      style={pillBase}
      className="simulator-mode-switch"
      role="group"
      aria-label="Simulator Architecture Mode"
      data-testid="simulator-mode-switch"
    >
      <button
        type="button"
        style={getBtnStyle('vwan')}
        aria-pressed={mode === 'vwan'}
        data-testid="simulator-mode-vwan"
        onClick={() => onChange('vwan')}
        title="Virtual WAN-Only Mode (Dedicated Virtual WAN Hubs, Route Maps, Routing Intent & Branch Lab)"
      >
        Virtual WAN-Only
      </button>
      <button
        type="button"
        style={getBtnStyle('hub-spoke')}
        aria-pressed={mode === 'hub-spoke'}
        data-testid="simulator-mode-hub-spoke"
        onClick={() => onChange('hub-spoke')}
        title="Hub-and-Spoke-Only Mode (Standalone VNets, VNet Peerings, UDRs, Route Server, ER/VPN Gateways & NVAs)"
      >
        Hub & Spoke-Only
      </button>
      <button
        type="button"
        style={getBtnStyle('full')}
        aria-pressed={mode === 'full'}
        data-testid="simulator-mode-full"
        onClick={() => onChange('full')}
        title="Full Hybrid Mode (VNets, Peerings, UDRs, Route Server, NVAs + Virtual WAN Hubs)"
      >
        Full Hybrid Mode
      </button>
    </div>
  )
}

