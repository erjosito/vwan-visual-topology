import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AzureNetDiagram, type AzRouteMapSelection, type AzSelectedEntity } from '../src/azure-net/AzureNetDiagram'
import { CanvasPresentationProvider } from '../src/CanvasPresentation'
import { denseVisualizationTopology, visualizationLayout, visualizationVariants, type VisualizationVariant } from '../tests/fixtures/dense-visualization'
import '../src/index.css'
import '../src/App.css'
import '../src/azure-net/azure-net.css'
import '../src/theme.css'
import './dense-topology-comparison.css'

export function Comparison() {
  const [original, setOriginal] = useState(() => denseVisualizationTopology())
  const [variant, setVariant] = useState<VisualizationVariant>('saved')
  const [scope, setScope] = useState('hub')
  const [theme, setTheme] = useState('light')
  const [scenario, setScenario] = useState('complete')
  const [selected, setSelected] = useState<AzSelectedEntity>()
  const [policy, setPolicy] = useState<AzRouteMapSelection>()
  const canvas = useRef<HTMLDivElement>(null)
  const topology = visualizationLayout(original, variant)
  const emphasized = new Set(scope === 'chain' ? ['spoke-peering-0', 'mesh-0-1', 'spoke-peering-1']
    : original.vnetPeerings.filter(p => p.vnetAId === 'hub-0' || p.vnetBId === 'hub-0').map(p => p.id))
  emphasized.add('er-hub-0')
  // An OFF transport is never de-emphasized, even outside the selected scope.
  emphasized.add('er-site-0')
  const actualIds = new Set([...original.vnetPeerings, ...original.erLinks].map(link => link.id))
  const total = original.vnetPeerings.length + original.erLinks.length
  const strong = variant === 'focus' ? [...emphasized].filter(id => actualIds.has(id)).length : total
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    for (const group of canvas.current?.querySelectorAll<SVGGElement>('.aznet-edge-group') ?? []) {
      const id = group.dataset.testid!.replace(/^aznet-(peering|erlink)-/, '')
      group.classList.toggle('research-muted', variant === 'focus' && !emphasized.has(id))
      group.classList.toggle('research-chain', variant === 'focus' && scope === 'chain' && emphasized.has(id))
    }
  })
  return <main>
    <h1>Dense topology comparison</h1>
    <p>Research only; coordinates read-only. Independently authored synthetic identities. No routing results or production-layout changes.</p>
    <div className="research-toolbar">
      <label>Workload<select aria-label="Workload" onChange={e => { setOriginal(denseVisualizationTopology(Number(e.target.value))); setScenario('complete') }} defaultValue="8">
        <option value="8">Eight regions</option><option value="2">Two-region control</option>
      </select></label>
      <label>Fixture scenario<select aria-label="Fixture scenario" value={scenario} onChange={e => {
        setScenario(e.target.value)
        const next = denseVisualizationTopology(original.erLocations.length)
        if (e.target.value === 'missing') next.vnetPeerings = next.vnetPeerings.filter(p => p.id !== `mesh-0-${next.erLocations.length - 1}`)
        setOriginal(next)
      }}><option value="complete">Complete hub mesh</option><option value="missing">One absent hub peering</option></select></label>
      <label>Alternative<select aria-label="Alternative" value={variant} onChange={e => setVariant(e.target.value as VisualizationVariant)}>
        {visualizationVariants.map(v => <option key={v}>{v}</option>)}
      </select></label>
      <label>Theme<select aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value)}><option>light</option><option>dark</option></select></label>
      <label>Focus scope<select aria-label="Focus scope" value={scope} onChange={e => setScope(e.target.value)}>
        <option value="hub">Hub 1 neighborhood</option><option value="chain">Connection chain: spoke 1 - hub 1 - hub 2 - spoke 2</option>
      </select></label>
      <button onClick={() => { setVariant('saved'); setScope('hub') }}>Restore saved overview</button>
    </div>
    <p role="status">{total} connections retained; {strong} emphasized; {total - strong} dimmed; 0 hidden.
      {' '}One administratively OFF ER link remains prominent. Dimmed links regain full emphasis on hover or keyboard focus.</p>
    <p>Chain emphasis is a connection-inspection aid, not an assessed forwarding path. Policy IN/OUT direction and all devices remain available.</p>
    <div ref={canvas} className="research-canvas simulator-shell" data-variant={variant}>
      <AzureNetDiagram key={`${variant}-${original.vnets.length}`} topology={topology} selected={selected}
        onSelect={setSelected} onClearSelection={() => setSelected(undefined)} onMoveNode={() => {}}
        diagnostics={[]} showDiagnosticBadges={false} onShowIssues={() => {}} onClearHighlights={() => setSelected(undefined)}
        onShowRouteMapRules={setPolicy} onOpenEditorForEntity={setSelected} />
    </div>
    <details><summary>Exact inspection and configured BGP relationships</summary>
      <p data-testid="research-selected">Selected: {JSON.stringify(selected ?? null)}</p>
      <p data-testid="research-policy">Policy attachment: {JSON.stringify(policy ?? null)}</p>
      <p>Hub 1 local peers: {original.vnets[0].routeServer!.peerApplianceIds.filter(id => id.startsWith('nva-0-')).join(', ')}</p>
      <p>Hub 1 remote peers: {original.vnets[0].routeServer!.peerApplianceIds.filter(id => !id.startsWith('nva-0-')).join(', ')}</p>
      <p data-testid="research-peerings">Hub 1 remote-hub peerings: {original.vnetPeerings.filter(p => p.id.startsWith('mesh-') && (p.vnetAId === 'hub-0' || p.vnetBId === 'hub-0')).length} / {original.erLocations.length - 1}.
        {' '}{original.vnetPeerings.filter(p => p.id.startsWith('mesh-') && (p.vnetAId === 'hub-0' || p.vnetBId === 'hub-0')).map(p => p.id).join(', ')}</p>
      <p>Configured BGP relationships are not individual rendered edges, and do not certify supported forwarding.</p>
    </details>
    <details><summary>Original native JSON (unchanged by view controls)</summary><pre data-testid="research-original">{JSON.stringify(original, null, 2)}</pre></details>
  </main>
}

createRoot(document.getElementById('root')!).render(<CanvasPresentationProvider><Comparison /></CanvasPresentationProvider>)
