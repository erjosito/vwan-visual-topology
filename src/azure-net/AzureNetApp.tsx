import { useMemo, useRef, useState } from 'react'
import './azure-net.css'
import { AzureNetDiagram, type AzSelectedEntity } from './AzureNetDiagram'
import {
  compareAzNetWithObservations,
  importAzNetCapture,
  type AzNetComparisonReport,
} from './azure-import'
import { generateAzNetBicep } from './bicep-export'
import { runAzNetDiagnostics, type AzDiagnosticFinding } from './diagnostics'
import {
  firstUsableIp,
  lookupSubnetEffectiveRoute,
  simulateAzNet,
  traceAzNetFlow,
  traceAzNetPair,
  type AzBgpRibEntry,
  type AzEndpointRef,
} from './engine'
import {
  AZURE_NET_SAMPLES,
  cloneAzNetTopology,
  validateAzNetTopology,
  type AzArsPreference,
  type AzNetTopology,
  type AzPeeringDirectionFlags,
  type AzUdrNextHopType,
} from './model'

type InspectorTab = 'routes' | 'tracer' | 'diagnostics' | 'editor' | 'azure'

interface EndpointOption {
  key: string
  label: string
  ref: AzEndpointRef
  defaultIp: string
}

export function AzureNetApp() {
  const [sampleId, setSampleId] = useState<string>(AZURE_NET_SAMPLES[0].id)
  const [topology, setTopology] = useState<AzNetTopology>(() =>
    cloneAzNetTopology(AZURE_NET_SAMPLES[0].topology),
  )
  const [history, setHistory] = useState<AzNetTopology[]>([])
  const [future, setFuture] = useState<AzNetTopology[]>([])
  const [activeTab, setActiveTab] = useState<InspectorTab>('routes')
  const [selected, setSelected] = useState<AzSelectedEntity>(() => {
    const firstVnet = AZURE_NET_SAMPLES[0].topology.vnets[1] ?? AZURE_NET_SAMPLES[0].topology.vnets[0]
    return {
      kind: 'subnet',
      vnetId: firstVnet.id,
      subnetId: firstVnet.subnets[0].id,
    }
  })

  const [testIpQuery, setTestIpQuery] = useState<string>('')
  const [showDiagnosticBadges, setShowDiagnosticBadges] = useState<boolean>(true)
  const [captureComparison, setCaptureComparison] = useState<AzNetComparisonReport | null>(null)
  const [captureNotices, setCaptureNotices] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const compareFileInputRef = useRef<HTMLInputElement | null>(null)

  const commitTopology = (updater: (draft: AzNetTopology) => void) => {
    setHistory((prev) => [...prev.slice(-24), cloneAzNetTopology(topology)])
    setFuture([])
    const next = cloneAzNetTopology(topology)
    updater(next)
    setTopology(next)
  }

  const handleUndo = () => {
    if (!history.length) return
    const previous = history[history.length - 1]
    setFuture((f) => [cloneAzNetTopology(topology), ...f])
    setHistory((h) => h.slice(0, -1))
    setTopology(previous)
  }

  const handleRedo = () => {
    if (!future.length) return
    const next = future[0]
    setHistory((h) => [...h, cloneAzNetTopology(topology)])
    setFuture((f) => f.slice(1))
    setTopology(next)
  }

  const simulation = useMemo(() => simulateAzNet(topology), [topology])
  const diagnostics = useMemo(
    () => runAzNetDiagnostics(topology, simulation),
    [topology, simulation],
  )
  const validationErrors = useMemo(() => validateAzNetTopology(topology), [topology])
  const bicepExport = useMemo(() => generateAzNetBicep(topology), [topology])

  // Build endpoint list for Path Tracer
  const endpointOptions = useMemo<EndpointOption[]>(() => {
    const opts: EndpointOption[] = []
    for (const vnet of topology.vnets) {
      for (const subnet of vnet.subnets) {
        opts.push({
          key: `subnet:${vnet.id}:${subnet.id}`,
          label: `VNet Subnet · ${vnet.name} / ${subnet.name} (${subnet.prefix})`,
          ref: { kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id },
          defaultIp: firstUsableIp(subnet.prefix),
        })
      }
    }
    for (const site of topology.sites) {
      opts.push({
        key: `site:${site.id}`,
        label: `On-Prem Site · ${site.name} (${site.prefixes[0] ?? ''})`,
        ref: { kind: 'site', siteId: site.id },
        defaultIp: firstUsableIp(site.prefixes[0] ?? '172.16.1.0/24'),
      })
    }
    return opts
  }, [topology])

  const [traceSourceKey, setTraceSourceKey] = useState<string>('')
  const [traceDestKey, setTraceDestKey] = useState<string>('')
  const [customDestIp, setCustomDestIp] = useState<string>('')
  const [traceActive, setTraceActive] = useState<boolean>(false)

  const resolvedSourceOpt =
    endpointOptions.find((o) => o.key === traceSourceKey) ?? endpointOptions[1] ?? endpointOptions[0]
  const resolvedDestOpt =
    endpointOptions.find((o) => o.key === traceDestKey) ??
    endpointOptions[endpointOptions.length - 1] ??
    endpointOptions[0]

  const pairAnalysis = useMemo(() => {
    if (!traceActive || !resolvedSourceOpt || !resolvedDestOpt) return null
    const destIp = customDestIp.trim() || resolvedDestOpt.defaultIp
    return traceAzNetPair(
      topology,
      simulation,
      resolvedSourceOpt.ref,
      resolvedSourceOpt.defaultIp,
      resolvedDestOpt.ref,
      destIp,
    )
  }, [traceActive, resolvedSourceOpt, resolvedDestOpt, customDestIp, topology, simulation])

  const singleFlowForCustomIp = useMemo(() => {
    if (!traceActive || !resolvedSourceOpt || !customDestIp.trim()) return null
    return traceAzNetFlow(topology, simulation, resolvedSourceOpt.ref, customDestIp.trim())
  }, [traceActive, resolvedSourceOpt, customDestIp, topology, simulation])

  const loadSample = (id: string) => {
    const found = AZURE_NET_SAMPLES.find((s) => s.id === id)
    if (!found) return
    setSampleId(found.id)
    const cloned = cloneAzNetTopology(found.topology)
    setTopology(cloned)
    setHistory([])
    setFuture([])
    setTraceActive(false)
    setCustomDestIp('')
    setShowDiagnosticBadges(true)
    const defaultVnet = cloned.vnets[1] ?? cloned.vnets[0]
    if (defaultVnet && defaultVnet.subnets[0]) {
      setSelected({
        kind: 'subnet',
        vnetId: defaultVnet.id,
        subnetId: defaultVnet.subnets[0].id,
      })
    }
  }

  // One-click Auto-Remediation for diagnostic findings
  const applyAutoFix = (finding: AzDiagnosticFinding) => {
    commitTopology((draft) => {
      if (finding.category === 'gateway-subnet-missing-udr' && finding.vnetId) {
        const hubVnet = draft.vnets.find((v) => v.id === finding.vnetId)
        const gwSubnet = hubVnet?.subnets.find((s) => s.name === 'GatewaySubnet')
        const fw = hubVnet?.appliances.find(
          (a) => a.inspectsTraffic || a.kind === 'azure-firewall',
        )
        if (!hubVnet || !gwSubnet || !fw) return
        let rt = gwSubnet.routeTableId
          ? draft.udrTables.find((t) => t.id === gwSubnet.routeTableId)
          : undefined
        if (!rt) {
          rt = {
            id: `rt-gw-${hubVnet.id}`,
            name: `RT-${hubVnet.name}-GatewaySubnet`,
            disableBgpRoutePropagation: false,
            routes: [],
          }
          draft.udrTables.push(rt)
          gwSubnet.routeTableId = rt.id
        }
        for (const spoke of draft.vnets) {
          if (spoke.id === hubVnet.id) continue
          for (const prefix of spoke.prefixes) {
            const existing = rt.routes.find((r) => r.prefix === prefix)
            if (existing) {
              existing.enabled = true
              existing.nextHopType = 'VirtualAppliance'
              existing.nextHopIp = fw.privateIp
            } else {
              rt.routes.push({
                id: `udr-autofix-${spoke.id}-${prefix}`,
                name: `to-${spoke.name}-via-${fw.name}`,
                prefix,
                nextHopType: 'VirtualAppliance',
                nextHopIp: fw.privateIp,
                enabled: true,
              })
            }
          }
        }
      } else if (
        (finding.category === 'bgp-propagation-blackhole' ||
          finding.category === 'gateway-subnet-bgp-disabled') &&
        finding.subnetId
      ) {
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) rt.disableBgpRoutePropagation = false
          }
        }
      } else if (finding.category === 'vnra-peering-access-disabled' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          p.aToB.allowVirtualNetworkAccess = true
          p.bToA.allowVirtualNetworkAccess = true
        }
      } else if (finding.category === 'peering-forwarded-traffic-blocked' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          p.aToB.allowForwardedTraffic = true
          p.bToA.allowForwardedTraffic = true
        }
      } else if (finding.category === 'remote-gateway-transit-mismatch' && finding.peeringId) {
        const p = draft.vnetPeerings.find((pr) => pr.id === finding.peeringId)
        if (p) {
          if (p.aToB.useRemoteGateways) p.bToA.allowGatewayTransit = true
          if (p.bToA.useRemoteGateways) p.aToB.allowGatewayTransit = true
        }
      } else if (finding.category === 'appliance-ip-forwarding-disabled' && finding.applianceId) {
        for (const v of draft.vnets) {
          const app = v.appliances.find((a) => a.id === finding.applianceId)
          if (app) app.enableIpForwarding = true
        }
      } else if (finding.category === 'ars-configuration' && finding.vnetId) {
        const v = draft.vnets.find((vn) => vn.id === finding.vnetId)
        if (v?.routeServer) v.routeServer.branchToBranchTraffic = true
      }
    })
  }

  // Resolve currently viewed Subnet Effective Route table (defaulting to selected subnet or first subnet of selected VNet)
  const inspectedSubnetTable = useMemo(() => {
    if (selected.kind === 'subnet') {
      return simulation.subnetTables[selected.subnetId]
    }
    if (selected.kind === 'vnet') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const sub = vnet?.subnets[0]
      return sub ? simulation.subnetTables[sub.id] : undefined
    }
    if (selected.kind === 'appliance') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const app = vnet?.appliances.find((a) => a.id === selected.applianceId)
      return app ? simulation.subnetTables[app.subnetId] : undefined
    }
    const fallbackVnet = topology.vnets[0]
    const fallbackSub = fallbackVnet?.subnets[0]
    return fallbackSub ? simulation.subnetTables[fallbackSub.id] : undefined
  }, [selected, simulation, topology])

  const lpmMatchedRouteId = useMemo(() => {
    if (!inspectedSubnetTable || !testIpQuery.trim()) return undefined
    return lookupSubnetEffectiveRoute(inspectedSubnetTable, testIpQuery.trim())?.id
  }, [inspectedSubnetTable, testIpQuery])

  // Resolve control-plane RIB if a Gateway, Route Server, vWAN Hub, ER Location, or Site is selected
  const inspectedControlRib = useMemo<{ title: string; entries: AzBgpRibEntry[] } | null>(() => {
    if (selected.kind === 'gateway') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const gw = vnet?.gateways.find((g) => g.id === selected.gatewayId)
      return {
        title: `Virtual Network Gateway BGP RIB · ${gw?.name ?? selected.gatewayId}`,
        entries: simulation.gatewayRibs[selected.gatewayId] ?? [],
      }
    }
    if (selected.kind === 'route-server') {
      const vnet = topology.vnets.find((v) => v.id === selected.vnetId)
      const ars = vnet?.routeServer
      return {
        title: `Azure Route Server (ASN 65515) RIB · ${ars?.name ?? selected.routeServerId}`,
        entries: simulation.routeServerRibs[selected.routeServerId] ?? [],
      }
    }
    if (selected.kind === 'vwan-hub') {
      const hub = topology.vwanHubs.find((h) => h.id === selected.hubId)
      return {
        title: `Virtual WAN Hub Effective RIB · ${hub?.name ?? selected.hubId}`,
        entries: simulation.vwanHubRibs[selected.hubId] ?? [],
      }
    }
    if (selected.kind === 'er-location') {
      const loc = topology.erLocations.find((l) => l.id === selected.locationId)
      return {
        title: `ExpressRoute MSEE (ASN 12076) RIB · ${loc?.name ?? selected.locationId}`,
        entries: simulation.erLocationRibs[selected.locationId] ?? [],
      }
    }
    if (selected.kind === 'site') {
      const site = topology.sites.find((s) => s.id === selected.siteId)
      return {
        title: `On-Premises Site BGP Table · ${site?.name ?? selected.siteId}`,
        entries: simulation.siteRibs[selected.siteId] ?? [],
      }
    }
    return null
  }, [selected, topology, simulation])

  const currentSampleMeta = AZURE_NET_SAMPLES.find((s) => s.id === sampleId)

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(topology, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sampleId || 'azure-net-topology'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="aznet-app" data-testid="aznet-app">
      {/* Top Navigation & Actions Bar */}
      <header className="aznet-topbar">
        <div className="aznet-brand">
          <span className="aznet-preview-pill">Preview SWA</span>
          <h1>Azure Networking Simulator</h1>
        </div>

        <div className="aznet-topbar-controls">
          <label style={{ fontSize: 12, color: '#cbd5e1' }} htmlFor="aznet-sample-select">
            Reference Topology:
          </label>
          <select
            id="aznet-sample-select"
            data-testid="aznet-sample-select"
            className="aznet-select"
            value={sampleId}
            onChange={(e) => loadSample(e.target.value)}
          >
            {AZURE_NET_SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="aznet-btn"
            onClick={() => {
              commitTopology((draft) => {
                const idx = draft.vnets.length + 1
                const vId = `vnet-custom-${idx}`
                const sId = `snet-custom-${idx}`
                draft.vnets.push({
                  id: vId,
                  name: `Spoke-VNet-${idx}`,
                  region: 'West Europe',
                  role: 'spoke',
                  prefixes: [`10.${50 + idx}.0.0/16`],
                  subnets: [
                    {
                      id: sId,
                      name: 'snet-workload',
                      prefix: `10.${50 + idx}.1.0/24`,
                    },
                  ],
                  gateways: [],
                  appliances: [],
                })
              })
            }}
            data-testid="aznet-add-vnet-btn"
          >
            + VNet
          </button>

          <button
            type="button"
            className="aznet-btn"
            onClick={handleUndo}
            disabled={!history.length}
            title="Undo"
          >
            ↶ Undo
          </button>
          <button
            type="button"
            className="aznet-btn"
            onClick={handleRedo}
            disabled={!future.length}
            title="Redo"
          >
            ↷ Redo
          </button>

          <button
            type="button"
            className="aznet-btn aznet-btn-primary"
            data-testid="aznet-run-diagnostics-btn"
            onClick={() => {
              setShowDiagnosticBadges(true)
              setActiveTab('diagnostics')
            }}
          >
            🩺 Diagnostics ({diagnostics.length})
          </button>

          <button
            type="button"
            className="aznet-btn"
            data-testid="aznet-open-azure-tab-btn"
            onClick={() => setActiveTab('azure')}
          >
            ☁ Azure & Bicep
          </button>

          <button type="button" className="aznet-btn" onClick={handleExportJson}>
            ⬇ Export JSON
          </button>
          <button
            type="button"
            className="aznet-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            ⬆ Import JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                const raw = JSON.parse(await file.text()) as Record<string, unknown>
                if (raw.kind === 'azure-network-capture') {
                  const imported = importAzNetCapture(raw)
                  setTopology(imported.topology)
                  setHistory([])
                  setFuture([])
                  setCaptureNotices(imported.warnings)
                  if (imported.observations) {
                    const importedSim = simulateAzNet(imported.topology)
                    setCaptureComparison(
                      compareAzNetWithObservations(
                        imported.topology,
                        importedSim,
                        imported.observations,
                      ),
                    )
                  } else {
                    setCaptureComparison(null)
                  }
                  setActiveTab('azure')
                  return
                }
                const parsed = raw as unknown as AzNetTopology
                const errs = validateAzNetTopology(parsed)
                if (errs.length === 0) {
                  setTopology(parsed)
                  setHistory([])
                  setFuture([])
                }
              } catch {
                // ignore invalid json
              }
            }}
          />
          <input
            ref={compareFileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                const raw = JSON.parse(await file.text()) as Record<string, unknown>
                if (raw.kind === 'azure-network-capture') {
                  const imported = importAzNetCapture(raw)
                  setCaptureNotices(imported.warnings)
                  if (imported.observations) {
                    const report = compareAzNetWithObservations(
                      topology,
                      simulation,
                      imported.observations,
                    )
                    setCaptureComparison(report)
                    setActiveTab('azure')
                  }
                }
              } catch {
                // ignore invalid json
              }
            }}
          />
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="aznet-workspace">
        {/* Left: Interactive Compound Topology Canvas */}
        <section className="aznet-canvas-column">
          <div className="aznet-scenario-banner">
            <div>
              <strong>{topology.name}</strong> —{' '}
              <span>{currentSampleMeta?.summary ?? topology.subtitle}</span>
            </div>
            <div style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#2563eb' }}>
              Click any subnet pill to inspect its Effective Routes
            </div>
          </div>

          <AzureNetDiagram
            topology={topology}
            selected={selected}
            onSelect={(entity) => {
              setSelected(entity)
              if (entity.kind === 'peering') {
                setActiveTab('editor')
              } else if (
                entity.kind === 'subnet' ||
                entity.kind === 'gateway' ||
                entity.kind === 'route-server' ||
                entity.kind === 'vwan-hub' ||
                entity.kind === 'er-location' ||
                entity.kind === 'site'
              ) {
                setActiveTab('routes')
              }
            }}
            onMoveNode={(nodeKind, nodeId, x, y) => {
              setTopology((prev) => {
                const next = cloneAzNetTopology(prev)
                if (nodeKind === 'vnet') {
                  const v = next.vnets.find((n) => n.id === nodeId)
                  if (v) {
                    v.x = x
                    v.y = y
                  }
                } else if (nodeKind === 'vwan-hub') {
                  const h = next.vwanHubs.find((n) => n.id === nodeId)
                  if (h) {
                    h.x = x
                    h.y = y
                  }
                } else if (nodeKind === 'er-location') {
                  const l = next.erLocations.find((n) => n.id === nodeId)
                  if (l) {
                    l.x = x
                    l.y = y
                  }
                } else if (nodeKind === 'site') {
                  const s = next.sites.find((n) => n.id === nodeId)
                  if (s) {
                    s.x = x
                    s.y = y
                  }
                }
                return next
              })
            }}
            forwardTrace={singleFlowForCustomIp ?? pairAnalysis?.forward ?? null}
            reverseTrace={singleFlowForCustomIp ? null : (pairAnalysis?.reverse ?? null)}
            diagnostics={diagnostics}
            showDiagnosticBadges={showDiagnosticBadges}
            onClearHighlights={() => {
              setTraceActive(false)
              setShowDiagnosticBadges(false)
            }}
          />
        </section>

        {/* Right: Docked Multi-Plane Inspector & Editor */}
        <aside className="aznet-inspector-column">
          <nav className="aznet-tabs">
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'routes' ? 'active' : ''}`}
              data-testid="aznet-tab-routes"
              onClick={() => setActiveTab('routes')}
            >
              Effective Routes
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'tracer' ? 'active' : ''}`}
              data-testid="aznet-tab-tracer"
              onClick={() => setActiveTab('tracer')}
            >
              Path & Symmetry
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'diagnostics' ? 'active' : ''}`}
              data-testid="aznet-tab-diagnostics"
              onClick={() => setActiveTab('diagnostics')}
            >
              Diagnostics ({diagnostics.length})
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'editor' ? 'active' : ''}`}
              data-testid="aznet-tab-editor"
              onClick={() => setActiveTab('editor')}
            >
              Configure
            </button>
            <button
              type="button"
              className={`aznet-tab ${activeTab === 'azure' ? 'active' : ''}`}
              data-testid="aznet-tab-azure"
              onClick={() => setActiveTab('azure')}
            >
              ☁ Azure & Bicep
            </button>
          </nav>

          <div className="aznet-panel-body">
            {/* TAB 1: SUBNET EFFECTIVE ROUTES & BGP CONTROL-PLANE RIBS */}
            {activeTab === 'routes' && (
              <>
                <div className="aznet-card">
                  <h3>Inspect Subnet Effective Route Table</h3>
                  <div className="aznet-field-grid">
                    <label className="aznet-field">
                      <span>Subnet</span>
                      <select
                        className="aznet-select"
                        data-testid="aznet-subnet-selector"
                        value={inspectedSubnetTable?.subnetId ?? ''}
                        onChange={(e) => {
                          const subId = e.target.value
                          const vnet = topology.vnets.find((v) =>
                            v.subnets.some((s) => s.id === subId),
                          )
                          if (vnet) {
                            setSelected({ kind: 'subnet', vnetId: vnet.id, subnetId: subId })
                          }
                        }}
                      >
                        {topology.vnets.map((v) => (
                          <optgroup key={v.id} label={`${v.name} (${v.region})`}>
                            {v.subnets.map((s) => (
                              <option key={s.id} value={s.id}>
                                {v.name} / {s.name} ({s.prefix})
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>

                    <label className="aznet-field">
                      <span>Test Destination IP (LPM Winner)</span>
                      <input
                        type="text"
                        className="aznet-input"
                        data-testid="aznet-lpm-input"
                        placeholder="e.g. 10.10.2.25 or 172.16.1.10"
                        value={testIpQuery}
                        onChange={(e) => setTestIpQuery(e.target.value)}
                      />
                    </label>
                  </div>

                  {inspectedSubnetTable && (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 8,
                          fontSize: 11.5,
                        }}
                      >
                        <span>
                          Route Table:{' '}
                          <strong>{inspectedSubnetTable.udrTableName ?? 'None (System + BGP)'}</strong>
                        </span>
                        <span
                          className={`aznet-badge ${
                            inspectedSubnetTable.bgpPropagationDisabled ? 'error' : 'active'
                          }`}
                        >
                          BGP Propagation:{' '}
                          {inspectedSubnetTable.bgpPropagationDisabled ? 'Disabled' : 'Enabled'}
                        </span>
                      </div>

                      <table className="aznet-route-table" data-testid="aznet-effective-route-table">
                        <thead>
                          <tr>
                            <th>State</th>
                            <th>Source</th>
                            <th>Prefix</th>
                            <th>Next Hop</th>
                            <th>Origin / Tie-Breaker</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inspectedSubnetTable.routes.map((route) => {
                            const isLpmWinner = lpmMatchedRouteId === route.id
                            return (
                              <tr
                                key={route.id}
                                className={`aznet-route-row ${
                                  route.active ? '' : 'suppressed'
                                } ${isLpmWinner ? 'lpm-winner' : ''}`}
                                data-testid={`aznet-route-row-${route.prefix}-${route.source}`}
                              >
                                <td>
                                  <span
                                    className={`aznet-badge ${
                                      route.active ? 'active' : 'suppressed'
                                    }`}
                                  >
                                    {isLpmWinner
                                      ? '★ LPM Winner'
                                      : route.active
                                        ? 'Active'
                                        : 'Invalid'}
                                  </span>
                                </td>
                                <td>{route.source}</td>
                                <td>
                                  <code>{route.prefix}</code>
                                </td>
                                <td>
                                  <strong>{route.nextHopType}</strong>
                                  {route.nextHopName && route.nextHopName !== route.nextHopType ? (
                                    <div style={{ fontSize: 10.5, color: '#475569' }}>
                                      {route.nextHopName}
                                    </div>
                                  ) : null}
                                </td>
                                <td>
                                  <div>{route.originLabel}</div>
                                  {route.asPath.length > 0 && (
                                    <div style={{ fontSize: 10.5, color: '#0369a1' }}>
                                      AS Path: [{route.asPath.join(' → ')}]
                                    </div>
                                  )}
                                  {route.suppressedReason && (
                                    <div style={{ fontSize: 10.5, color: '#dc2626' }}>
                                      {route.suppressedReason}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>

                      {inspectedSubnetTable.suppressedBgpRoutes.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 8,
                            borderRadius: 6,
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            fontSize: 11.5,
                          }}
                          data-testid="aznet-suppressed-bgp-banner"
                        >
                          <strong style={{ color: '#991b1b' }}>
                            {inspectedSubnetTable.suppressedBgpRoutes.length} BGP route(s) blocked by
                            disableBgpRoutePropagation=true:
                          </strong>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {inspectedSubnetTable.suppressedBgpRoutes.map((sr) => (
                              <li key={sr.id}>
                                <code>{sr.prefix}</code> via {sr.nextHopName} ({sr.originLabel})
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {inspectedControlRib && (
                  <div className="aznet-card" data-testid="aznet-control-rib-card">
                    <h3>{inspectedControlRib.title}</h3>
                    <table className="aznet-route-table">
                      <thead>
                        <tr>
                          <th>Status</th>
                          <th>Prefix</th>
                          <th>Protocol</th>
                          <th>AS Path</th>
                          <th>Next Hop & Decision</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspectedControlRib.entries.map((entry) => (
                          <tr
                            key={entry.id}
                            className={`aznet-route-row ${entry.preferred ? '' : 'suppressed'}`}
                          >
                            <td>
                              <span
                                className={`aznet-badge ${
                                  entry.preferred ? 'active' : 'suppressed'
                                }`}
                              >
                                {entry.preferred ? 'Best' : 'Backup'}
                              </span>
                            </td>
                            <td>
                              <code>{entry.prefix}</code>
                            </td>
                            <td>{entry.originProtocol}</td>
                            <td>
                              <code>[{entry.asPath.join(' ')}]</code>
                            </td>
                            <td>
                              <strong>{entry.nextHopName}</strong>
                              <div style={{ fontSize: 10.5, color: '#475569' }}>
                                {entry.explanation}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* TAB 2: HOP-BY-HOP PACKET & STATEFUL SYMMETRY TRACER */}
            {activeTab === 'tracer' && (
              <div className="aznet-card" data-testid="aznet-path-tracer-panel">
                <h3>End-to-End Packet & Stateful Symmetry Tracer</h3>
                <div className="aznet-field-grid">
                  <label className="aznet-field">
                    <span>Source Endpoint</span>
                    <select
                      className="aznet-select"
                      data-testid="aznet-trace-source-select"
                      value={resolvedSourceOpt?.key ?? ''}
                      onChange={(e) => {
                        setTraceSourceKey(e.target.value)
                        setTraceActive(true)
                      }}
                    >
                      {endpointOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="aznet-field">
                    <span>Destination Endpoint</span>
                    <select
                      className="aznet-select"
                      data-testid="aznet-trace-dest-select"
                      value={resolvedDestOpt?.key ?? ''}
                      onChange={(e) => {
                        setTraceDestKey(e.target.value)
                        setCustomDestIp('')
                        setTraceActive(true)
                      }}
                    >
                      {endpointOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-end',
                    marginTop: 8,
                  }}
                >
                  <label className="aznet-field" style={{ flex: 1 }}>
                    <span>Optional Override Destination IP (e.g. Private Endpoint /32)</span>
                    <input
                      type="text"
                      className="aznet-input"
                      data-testid="aznet-trace-custom-ip"
                      placeholder="Leave blank to use selected endpoint IP"
                      value={customDestIp}
                      onChange={(e) => setCustomDestIp(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="aznet-btn aznet-btn-primary"
                    data-testid="aznet-run-trace-btn"
                    onClick={() => setTraceActive(true)}
                  >
                    ▶ Trace Flow
                  </button>
                </div>

                {pairAnalysis && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Symmetry Banner */}
                    {!singleFlowForCustomIp && (
                      <div
                        data-testid="aznet-symmetry-verdict"
                        style={{
                          padding: 10,
                          borderRadius: 6,
                          fontWeight: 600,
                          fontSize: 12,
                          background:
                            pairAnalysis.forward.status !== 'delivered' ||
                            pairAnalysis.reverse.status !== 'delivered'
                              ? '#fef2f2'
                              : pairAnalysis.symmetricInspection
                                ? '#ecfdf5'
                                : '#fffbeb',
                          color:
                            pairAnalysis.forward.status !== 'delivered' ||
                            pairAnalysis.reverse.status !== 'delivered'
                              ? '#991b1b'
                              : pairAnalysis.symmetricInspection
                                ? '#065f46'
                                : '#92400e',
                          border: '1px solid currentColor',
                        }}
                      >
                        {pairAnalysis.forward.status !== 'delivered' ||
                        pairAnalysis.reverse.status !== 'delivered'
                          ? `✕ Flow Blocked — Forward: ${pairAnalysis.forward.status}, Reverse: ${pairAnalysis.reverse.status}`
                          : pairAnalysis.symmetricInspection
                            ? '✓ Symmetric Path — Forward and Return flows traverse identical stateful inspection appliances.'
                            : `⚠ Asymmetric Firewall Bypass Detected — ${pairAnalysis.asymmetricBypassApplianceNames.join(', ')} is traversed in only one direction!`}
                      </div>
                    )}

                    {/* Forward Hops */}
                    <div>
                      <h4 style={{ margin: '4px 0 6px 0', fontSize: 12.5 }}>
                        Forward Path ({resolvedSourceOpt.defaultIp} →{' '}
                        { (singleFlowForCustomIp ?? pairAnalysis.forward).destinationIp })
                      </h4>
                      <div className="aznet-hop-list" data-testid="aznet-forward-hops">
                        {(singleFlowForCustomIp ?? pairAnalysis.forward).hops.map((hop) => (
                          <div
                            key={hop.index}
                            className={`aznet-hop-item ${
                              hop.action === 'dropped'
                                ? 'dropped'
                                : hop.action === 'delivered'
                                  ? 'delivered'
                                  : ''
                            }`}
                          >
                            <strong>
                              Hop {hop.index}: {hop.nodeName}
                              {hop.subnetName ? ` / ${hop.subnetName}` : ''}
                            </strong>
                            <div style={{ marginTop: 2 }}>{hop.detail}</div>
                            {hop.matchedRoute && (
                              <div style={{ fontSize: 10.5, color: '#475569', marginTop: 2 }}>
                                Matched: <code>{hop.matchedRoute.prefix}</code> →{' '}
                                {hop.matchedRoute.nextHopType} ({hop.matchedRoute.source})
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Reverse Hops */}
                    {!singleFlowForCustomIp && (
                      <div>
                        <h4 style={{ margin: '6px 0 6px 0', fontSize: 12.5 }}>
                          Return Path ({pairAnalysis.forward.destinationIp} →{' '}
                          {resolvedSourceOpt.defaultIp})
                        </h4>
                        <div className="aznet-hop-list" data-testid="aznet-reverse-hops">
                          {pairAnalysis.reverse.hops.map((hop) => (
                            <div
                              key={hop.index}
                              className={`aznet-hop-item ${
                                hop.action === 'dropped'
                                  ? 'dropped'
                                  : hop.action === 'delivered'
                                    ? 'delivered'
                                    : ''
                              }`}
                            >
                              <strong>
                                Hop {hop.index}: {hop.nodeName}
                                {hop.subnetName ? ` / ${hop.subnetName}` : ''}
                              </strong>
                              <div style={{ marginTop: 2 }}>{hop.detail}</div>
                              {hop.matchedRoute && (
                                <div style={{ fontSize: 10.5, color: '#475569', marginTop: 2 }}>
                                  Matched: <code>{hop.matchedRoute.prefix}</code> →{' '}
                                  {hop.matchedRoute.nextHopType} ({hop.matchedRoute.source})
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: AUTOMATED ROOT-CAUSE DIAGNOSTICS */}
            {activeTab === 'diagnostics' && (
              <div className="aznet-card" data-testid="aznet-diagnostics-panel">
                <h3>Root-Cause Azure Networking Diagnostics ({diagnostics.length})</h3>
                {validationErrors.length > 0 && (
                  <div
                    style={{
                      padding: 8,
                      marginBottom: 8,
                      background: '#fef2f2',
                      color: '#991b1b',
                      borderRadius: 6,
                      fontSize: 11.5,
                    }}
                  >
                    {validationErrors.map((err, idx) => (
                      <div key={idx}>• {err}</div>
                    ))}
                  </div>
                )}
                {diagnostics.length === 0 ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 6,
                      background: '#ecfdf5',
                      color: '#065f46',
                      fontWeight: 600,
                      fontSize: 12.5,
                    }}
                    data-testid="aznet-diagnostics-clean"
                  >
                    ✓ No routing blackholes, peering flag traps, or asymmetric firewall bypasses
                    detected!
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {diagnostics.map((finding) => (
                      <div
                        key={finding.id}
                        className="aznet-card"
                        data-testid={`aznet-finding-${finding.category}`}
                        style={{ background: '#ffffff' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                          }}
                        >
                          <span className={`aznet-badge ${finding.severity}`}>
                            {finding.severity.toUpperCase()} · {finding.category}
                          </span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {finding.sampleFlow && (
                              <button
                                type="button"
                                className="aznet-btn"
                                onClick={() => {
                                  const sf = finding.sampleFlow!
                                  const sKey =
                                    sf.source.kind === 'subnet'
                                      ? `subnet:${sf.source.vnetId}:${sf.source.subnetId}`
                                      : `site:${(sf.source as { siteId: string }).siteId}`
                                  const dKey =
                                    sf.destination.kind === 'subnet'
                                      ? `subnet:${sf.destination.vnetId}:${sf.destination.subnetId}`
                                      : `site:${(sf.destination as { siteId: string }).siteId}`
                                  setTraceSourceKey(sKey)
                                  setTraceDestKey(dKey)
                                  setCustomDestIp('')
                                  setTraceActive(true)
                                  setActiveTab('tracer')
                                }}
                              >
                                🔍 Trace Flow
                              </button>
                            )}
                            {finding.category !== 'private-endpoint-udr-bypass' &&
                              finding.category !== 'peering-non-transitive-next-hop' &&
                              finding.category !== 'asymmetric-firewall-bypass' && (
                                <button
                                  type="button"
                                  className="aznet-btn aznet-btn-fix"
                                  data-testid={`aznet-autofix-${finding.category}`}
                                  onClick={() => applyAutoFix(finding)}
                                >
                                  ⚡ Auto-Fix
                                </button>
                              )}
                          </div>
                        </div>
                        <h4 style={{ margin: '8px 0 4px 0', fontSize: 13 }}>{finding.title}</h4>
                        <p style={{ margin: '0 0 6px 0', fontSize: 11.5, color: '#334155' }}>
                          {finding.summary}
                        </p>
                        <div
                          style={{
                            fontSize: 11.5,
                            color: '#0369a1',
                            background: '#f0f9ff',
                            padding: '6px 8px',
                            borderRadius: 5,
                          }}
                        >
                          <strong>Remediation:</strong> {finding.remediation}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CONFIGURATION EDITOR (PEERING FLAGS, UDR TABLES, SUBNETS, ARS) */}
            {activeTab === 'editor' && (
              <>
                {/* VNet Peerings Editor */}
                <div className="aznet-card" data-testid="aznet-peering-editor">
                  <h3>VNet Peering Matrix & State Flags</h3>
                  {topology.vnetPeerings.map((peering) => {
                    const vA = topology.vnets.find((v) => v.id === peering.vnetAId)
                    const vB = topology.vnets.find((v) => v.id === peering.vnetBId)
                    const renderDirFlags = (
                      label: string,
                      dirKey: 'aToB' | 'bToA',
                      flags: AzPeeringDirectionFlags,
                    ) => (
                      <div
                        style={{
                          padding: 8,
                          background: '#f8fafc',
                          borderRadius: 6,
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        <div style={{ fontWeight: 700, fontSize: 11.5, marginBottom: 4 }}>
                          {label}
                        </div>
                        {(
                          [
                            ['allowVirtualNetworkAccess', 'Allow VNet Access'],
                            ['allowForwardedTraffic', 'Allow Forwarded Traffic'],
                            ['allowGatewayTransit', 'Allow Gateway Transit'],
                            ['useRemoteGateways', 'Use Remote Gateways'],
                          ] as const
                        ).map(([flagName, flagLabel]) => (
                          <label key={flagName} className="aznet-checkbox-row">
                            <input
                              type="checkbox"
                              checked={flags[flagName]}
                              onChange={(e) => {
                                const checked = e.target.checked
                                commitTopology((draft) => {
                                  const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                                  if (p) p[dirKey][flagName] = checked
                                })
                              }}
                            />
                            <span>{flagLabel}</span>
                          </label>
                        ))}
                      </div>
                    )
                    return (
                      <div
                        key={peering.id}
                        style={{
                          marginBottom: 10,
                          padding: 10,
                          background: '#ffffff',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 6,
                          }}
                        >
                          <strong>
                            {peering.name} ({vA?.name} ↔ {vB?.name})
                          </strong>
                          <label className="aznet-checkbox-row">
                            <input
                              type="checkbox"
                              checked={peering.enabled}
                              onChange={(e) => {
                                const checked = e.target.checked
                                commitTopology((draft) => {
                                  const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                                  if (p) p.enabled = checked
                                })
                              }}
                            />
                            <span>Peering Enabled</span>
                          </label>
                        </div>
                        <div className="aznet-field-grid">
                          {renderDirFlags(`${vA?.name} → ${vB?.name}`, 'aToB', peering.aToB)}
                          {renderDirFlags(`${vB?.name} → ${vA?.name}`, 'bToA', peering.bToA)}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* UDR Route Tables Editor */}
                <div className="aznet-card" data-testid="aznet-udr-editor">
                  <h3>User-Defined Route Tables (UDRs)</h3>
                  {topology.udrTables.map((rt) => (
                    <div
                      key={rt.id}
                      style={{
                        marginBottom: 10,
                        padding: 10,
                        background: '#ffffff',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <strong>{rt.name}</strong>
                        <label className="aznet-checkbox-row">
                          <input
                            type="checkbox"
                            data-testid={`aznet-rt-disable-bgp-${rt.id}`}
                            checked={rt.disableBgpRoutePropagation}
                            onChange={(e) => {
                              const checked = e.target.checked
                              commitTopology((draft) => {
                                const target = draft.udrTables.find((t) => t.id === rt.id)
                                if (target) target.disableBgpRoutePropagation = checked
                              })
                            }}
                          />
                          <span>Disable BGP route propagation</span>
                        </label>
                      </div>

                      <table className="aznet-route-table">
                        <thead>
                          <tr>
                            <th>On</th>
                            <th>Name</th>
                            <th>Prefix</th>
                            <th>Next Hop Type</th>
                            <th>Next Hop IP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rt.routes.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <input
                                  type="checkbox"
                                  checked={r.enabled}
                                  onChange={(e) => {
                                    const checked = e.target.checked
                                    commitTopology((draft) => {
                                      const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                                      const targetR = targetRt?.routes.find((x) => x.id === r.id)
                                      if (targetR) targetR.enabled = checked
                                    })
                                  }}
                                />
                              </td>
                              <td>{r.name}</td>
                              <td>
                                <code>{r.prefix}</code>
                              </td>
                              <td>
                                <select
                                  className="aznet-select"
                                  value={r.nextHopType}
                                  onChange={(e) => {
                                    const val = e.target.value as AzUdrNextHopType
                                    commitTopology((draft) => {
                                      const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                                      const targetR = targetRt?.routes.find((x) => x.id === r.id)
                                      if (targetR) targetR.nextHopType = val
                                    })
                                  }}
                                >
                                  <option value="VirtualAppliance">VirtualAppliance</option>
                                  <option value="VirtualNetworkGateway">
                                    VirtualNetworkGateway
                                  </option>
                                  <option value="VnetLocal">VnetLocal</option>
                                  <option value="Internet">Internet</option>
                                  <option value="None">None (Blackhole)</option>
                                </select>
                              </td>
                              <td>
                                {r.nextHopType === 'VirtualAppliance' ? (
                                  <input
                                    type="text"
                                    className="aznet-input"
                                    style={{ width: 105 }}
                                    value={r.nextHopIp ?? ''}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      commitTopology((draft) => {
                                        const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                                        const targetR = targetRt?.routes.find((x) => x.id === r.id)
                                        if (targetR) targetR.nextHopIp = val
                                      })
                                    }}
                                  />
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <button
                        type="button"
                        className="aznet-btn"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          commitTopology((draft) => {
                            const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                            if (!targetRt) return
                            const firstApp = draft.vnets.flatMap((v) => v.appliances)[0]
                            targetRt.routes.push({
                              id: `udr-custom-${Date.now()}`,
                              name: `custom-route-${targetRt.routes.length + 1}`,
                              prefix: '10.2.0.0/16',
                              nextHopType: firstApp ? 'VirtualAppliance' : 'Internet',
                              nextHopIp: firstApp?.privateIp,
                              enabled: true,
                            })
                          })
                        }}
                      >
                        + Add UDR Row
                      </button>
                    </div>
                  ))}
                </div>

                {/* Azure Route Server & Appliance Controls */}
                <div className="aznet-card">
                  <h3>Azure Route Server & NVA / Firewall Controls</h3>
                  {topology.vnets.map((vnet) => {
                    if (!vnet.routeServer && vnet.appliances.length === 0) return null
                    return (
                      <div
                        key={vnet.id}
                        style={{
                          marginBottom: 8,
                          padding: 8,
                          background: '#ffffff',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                        }}
                      >
                        <strong>{vnet.name}</strong>
                        {vnet.routeServer && (
                          <div style={{ marginTop: 6 }} className="aznet-field-grid">
                            <label className="aznet-checkbox-row">
                              <input
                                type="checkbox"
                                checked={vnet.routeServer.branchToBranchTraffic}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  commitTopology((draft) => {
                                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                    if (targetV?.routeServer) {
                                      targetV.routeServer.branchToBranchTraffic = checked
                                    }
                                  })
                                }}
                              />
                              <span>ARS Branch-to-Branch (ER/VPN ↔ NVA)</span>
                            </label>
                            <label className="aznet-field">
                              <span>ARS Hub Routing Preference</span>
                              <select
                                className="aznet-select"
                                value={vnet.routeServer.hubRoutingPreference}
                                onChange={(e) => {
                                  const pref = e.target.value as AzArsPreference
                                  commitTopology((draft) => {
                                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                    if (targetV?.routeServer) {
                                      targetV.routeServer.hubRoutingPreference = pref
                                    }
                                  })
                                }}
                              >
                                <option value="ExpressRoute">ExpressRoute (Default)</option>
                                <option value="VpnGateway">VpnGateway</option>
                                <option value="ASPath">ASPath</option>
                              </select>
                            </label>
                          </div>
                        )}
                        {vnet.appliances.map((app) => (
                          <div
                            key={app.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginTop: 6,
                              fontSize: 12,
                            }}
                          >
                            <span>
                              {app.name} (<code>{app.privateIp}</code>)
                            </span>
                            <label className="aznet-checkbox-row">
                              <input
                                type="checkbox"
                                checked={app.enableIpForwarding}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  commitTopology((draft) => {
                                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                    const targetA = targetV?.appliances.find((a) => a.id === app.id)
                                    if (targetA) targetA.enableIpForwarding = checked
                                  })
                                }}
                              />
                              <span>NIC IP Forwarding</span>
                            </label>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* TAB 5: AZURE CAPTURE IMPORT, EFFECTIVE-ROUTE COMPARISON & BICEP EXPORT */}
            {activeTab === 'azure' && (
              <>
                <div className="aznet-card" data-testid="aznet-azure-capture-card">
                  <h3>1. Azure Live Capture & Effective-Route Comparison</h3>
                  <p style={{ margin: '0 0 8px 0', fontSize: 12, color: '#334155' }}>
                    Capture a live Azure resource group (VNets, Subnets, Peerings, UDRs, Route
                    Server, Gateways, and NIC Effective Routes — including a proxy subnet sharing{' '}
                    <code>GatewaySubnet</code>&apos;s route table) using the read-only PowerShell
                    collector:
                  </p>
                  <pre
                    style={{
                      margin: '0 0 8px 0',
                      padding: 8,
                      background: '#0f172a',
                      color: '#e2e8f0',
                      borderRadius: 6,
                      fontSize: 11,
                      overflowX: 'auto',
                    }}
                  >
                    {`pwsh ./scripts/collect-azure-network.ps1 -ResourceGroupName <rg> -IncludeEffectiveRoutes -OutputPath azure-network-capture.json`}
                  </pre>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      className="aznet-btn"
                      href="/scripts/collect-azure-network.ps1"
                      download="collect-azure-network.ps1"
                      style={{ textDecoration: 'none' }}
                    >
                      ⬇ Download Collector Script (.ps1)
                    </a>
                    <button
                      type="button"
                      className="aznet-btn aznet-btn-primary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      ⬆ Import Capture as Topology + Compare
                    </button>
                    <button
                      type="button"
                      className="aznet-btn"
                      onClick={() => compareFileInputRef.current?.click()}
                    >
                      🔍 Compare Capture Against Current Topology
                    </button>
                  </div>

                  {captureNotices.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 8,
                        background: '#f8fafc',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        fontSize: 11.5,
                      }}
                    >
                      <strong>Import Notices:</strong>
                      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                        {captureNotices.map((n, idx) => (
                          <li key={idx}>{n}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {captureComparison && (
                    <div style={{ marginTop: 10 }} data-testid="aznet-comparison-report">
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <strong>
                          NIC Effective Route Comparison ({captureComparison.totalMatchedRoutes}{' '}
                          matched, {captureComparison.totalMismatchedRoutes} mismatched)
                        </strong>
                      </div>
                      {captureComparison.subnetComparisons.map((nic) => (
                        <div
                          key={nic.nicName}
                          style={{
                            marginBottom: 8,
                            padding: 8,
                            background: '#ffffff',
                            borderRadius: 6,
                            border: `1px solid ${nic.mismatchCount === 0 ? '#86efac' : '#fca5a5'}`,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 4,
                              fontSize: 12,
                            }}
                          >
                            <span>
                              <strong>{nic.nicName}</strong> · {nic.vnetName}/{nic.subnetName}{' '}
                              {nic.proxyForGatewaySubnet && (
                                <span className="aznet-badge info">GatewaySubnet Proxy</span>
                              )}
                            </span>
                            <span
                              className={`aznet-badge ${nic.mismatchCount === 0 ? 'ok' : 'error'}`}
                            >
                              {nic.mismatchCount === 0
                                ? `MATCHED (${nic.matchedCount})`
                                : `${nic.mismatchCount} DIFF`}
                            </span>
                          </div>
                          <table className="aznet-route-table">
                            <thead>
                              <tr>
                                <th>Status</th>
                                <th>Prefix</th>
                                <th>Azure Observed</th>
                                <th>Simulator Predicted</th>
                              </tr>
                            </thead>
                            <tbody>
                              {nic.rows.map((d, idx) => (
                                <tr key={idx}>
                                  <td>
                                    <span className={`aznet-badge ${d.matched ? 'ok' : 'error'}`}>
                                      {d.matched ? 'match' : 'diff'}
                                    </span>
                                  </td>
                                  <td>
                                    <code>{d.prefix}</code>
                                  </td>
                                  <td>
                                    {`${d.azureSource} → ${d.azureNextHopType}${
                                      d.azureNextHopIp ? ` (${d.azureNextHopIp})` : ''
                                    } [${d.azureState}]`}
                                  </td>
                                  <td>
                                    {`${d.simSource} → ${d.simNextHopType}${
                                      d.simNextHopIp ? ` (${d.simNextHopIp})` : ''
                                    } [${d.simState}]`}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="aznet-card" data-testid="aznet-bicep-export-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <h3 style={{ margin: 0 }}>
                      2. Deployable Azure Bicep Template ({bicepExport.resourceCount} resources)
                    </h3>
                    <button
                      type="button"
                      className="aznet-btn aznet-btn-primary"
                      data-testid="aznet-download-bicep-btn"
                      disabled={!bicepExport.text}
                      onClick={() => {
                        const blob = new Blob([bicepExport.text], { type: 'text/plain' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `${topology.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'azure-net-topology'}.bicep`
                        a.click()
                        URL.revokeObjectURL(url)
                      }}
                    >
                      ⬇ Download .bicep
                    </button>
                  </div>
                  {bicepExport.warnings.length > 0 && (
                    <div
                      style={{
                        marginBottom: 8,
                        padding: 8,
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: 6,
                        fontSize: 11.5,
                        color: '#92400e',
                      }}
                    >
                      <strong>Deployment Notes:</strong>
                      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                        {bicepExport.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <pre
                    data-testid="aznet-bicep-code"
                    style={{
                      maxHeight: 360,
                      overflow: 'auto',
                      padding: 10,
                      background: '#0f172a',
                      color: '#f8fafc',
                      borderRadius: 6,
                      fontSize: 11,
                      margin: 0,
                    }}
                  >
                    {bicepExport.text || '// Fix topology validation errors to generate Bicep'}
                  </pre>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
