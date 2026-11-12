import virtualWanHubIcon from './assets/azure/virtual-wan-hub.svg'
import securedHubIcon from './assets/azure/secured-virtual-hub.png'
import virtualNetworkIcon from './assets/azure/virtual-network.svg'
import expressRouteIcon from './assets/azure/expressroute.svg'

export function NetworkNodeIcon({ kind, secured = false, x = -79, y = -21, size = 28 }: {
  kind: 'hub' | 'spoke' | 'site' | 'erLocation'; secured?: boolean; x?: number; y?: number; size?: number
}) {
  return <g className={`node-icon ${kind}${secured ? ' secured' : ''}`} aria-hidden="true"
    transform={`translate(${x},${y}) scale(${size / 28})`} style={{ pointerEvents: 'none' }}>
    {kind === 'site' ? <><circle r="13" /><path d="M -7 7 V -7 H 2 V -2 H 7 V 7 Z M -3 -3 H -1 M -3 1 H -1 M -3 5 H -1 M 3 2 H 5" /></>
      : <image href={kind === 'hub' ? secured ? securedHubIcon : virtualWanHubIcon : kind === 'erLocation' ? expressRouteIcon : virtualNetworkIcon}
        x="-14" y="-14" width="28" height="28" preserveAspectRatio="xMidYMid meet" />}
  </g>
}
