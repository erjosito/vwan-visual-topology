import { useEffect, useMemo, useRef, useState } from 'react'
import './azure-net.css'
import { SimulatorModeSwitch, type SimulatorMode } from '../SimulatorModeSwitch'
import { TopologyContextMenu, type ContextAction } from '../TopologyContextMenu'
import {
  AzureNetDiagram,
  type AzContextMenuTarget,
  type AzSelectedEntity,
} from './AzureNetDiagram'
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

interface AzNetSampleCatalogEntry {
  id: string
  title: string
  summary: string
  category: 'flagship' | 'validation'
  badges: string[]
}

const FLAGSHIP_BADGES: Record<string, string[]> = {
  'hub-spoke-firewall-udr': ['Hub & Spoke', 'AzFW Inspection', 'GatewaySubnet UDR', 'Private Endpoint /32'],
  'ars-sdwan-nva-coexistence': ['Azure Route Server', 'SD-WAN BGP NVA', 'ER + VPN B2B', 'BGP Propagation'],
  'dual-hub-vnra-global-peering': ['Dual-Region Hubs', 'Managed VNRA', 'Global Peering', 'Chained UDRs'],
  'hybrid-vwan-and-hub-spoke': ['Secured vWAN Hub', 'Classic Hub-and-Spoke', 'Shared ER MSEE', 'Routing Intent'],
  'enterprise-vnet-all-features-showcase': ['All Features', '2 Regional Hubs', 'AzFW + ARS + SD-WAN', 'PE Policies & BGP LPM'],
}

const AZURE_NET_VALIDATION_SCENARIOS: AzNetSampleCatalogEntry[] = [
  {
    id: 'uc1-hub-spoke-nva-ars-baseline',
    title: 'UC1 · Hub & Spoke + NVA + Route Server Baseline',
    summary: 'Symmetric Hub & Spoke inspection through a Linux BGP NVA peering with Azure Route Server (ASN 65515) and Gateway Transit to spokes.',
    category: 'validation',
    badges: ['UC1 Validated', 'Route Server', 'BGP NVA', 'Gateway Transit'],
  },
  {
    id: 'uc2-gateway-subnet-missing-udr-asymmetry',
    title: 'UC2 · GatewaySubnet Missing Return UDR Asymmetry',
    summary: 'Outbound spoke traffic traverses the Hub NVA/Firewall via UDR, while inbound on-premises return traffic from the Gateway bypasses inspection.',
    category: 'validation',
    badges: ['UC2 Validated', 'Asymmetric Inspection', 'GatewaySubnet UDR', 'Auto-Fixable'],
  },
  {
    id: 'uc3-bgp-propagation-and-peering-gates',
    title: 'UC3 · BGP Route Propagation & Peering Gates',
    summary: 'Contrasts disableBgpRoutePropagation true vs false on spoke route tables alongside VNet Peering allowForwardedTraffic and useRemoteGateways gates.',
    category: 'validation',
    badges: ['UC3 Validated', 'BGP Propagation', 'Peering Gates', 'Remote Gateways'],
  },
  {
    id: 'uc4-private-endpoint-udr-override',
    title: 'UC4 · Private Endpoint /32 System Route vs RouteTableEnabled',
    summary: 'Compares PrivateEndpointNetworkPolicies Disabled (/32 InterfaceEndpoint system route overrides /24 UDR) against RouteTableEnabled.',
    category: 'validation',
    badges: ['UC4 Validated', 'Private Endpoint /32', 'RouteTableEnabled', 'LPM Override'],
  },
  {
    id: 'uc5-ars-branch-to-branch-and-bgp-selection',
    title: 'UC5 · ARS Branch-to-Branch & Hub Routing Preference',
    summary: 'Tests Azure Route Server branchToBranchTraffic and hubRoutingPreference (ExpressRoute vs VpnGateway vs ASPath) across multi-homed paths.',
    category: 'validation',
    badges: ['UC5 Validated', 'ARS Preference', 'AS-Path Prepend', 'Branch-to-Branch'],
  },
  {
    id: 'uc6-ars-default-route-self-blackhole',
    title: 'UC6 · ARS 0.0.0.0/0 NVA Self-Loop Blackhole Trap',
    summary: 'When an NVA advertises 0.0.0.0/0 to Azure Route Server and its own subnet leaves BGP propagation enabled, ARS programs 0.0.0.0/0 back to the NVA NIC.',
    category: 'validation',
    badges: ['UC6 Validated', 'ARS Self-Loop', '0.0.0.0/0 Trap', 'Auto-Fixable'],
  },
  {
    id: 'uc7-bgp-lpm-bypasses-summary-udr',
    title: 'UC7 · BGP /16 LPM Bypassing /8 Summary UDR',
    summary: 'A spoke with a 10.0.0.0/8 summary UDR to a Firewall but BGP propagation enabled learns a more-specific /16 BGP route that wins by LPM and bypasses the Firewall.',
    category: 'validation',
    badges: ['UC7 Validated', 'BGP LPM Bypass', 'Summary UDR', 'Asymmetric Drop'],
  },
  {
    id: 'uc8-udr-next-hop-types-and-vng-transit-trap',
    title: 'UC8 · All 5 UDR Next-Hop Types & VNG Transit Trap',
    summary: 'Exercises VirtualAppliance, VnetLocal, Internet, None (Blackhole), and VirtualNetworkGateway UDR next-hop types on one spoke route table.',
    category: 'validation',
    badges: ['UC8 Validated', '5 Next-Hop Types', 'Blackhole Route', 'VnetLocal Override'],
  },
  {
    id: 'uc9-expressroute-hairpin-two-vnets',
    title: 'UC9 · Cross-VNet Transit via Shared ExpressRoute MSEE',
    summary: 'Two independent VNets (no VNet Peering) with standalone ExpressRoute Gateways linked to the same ExpressRoute circuit / MSEE (ASN 12076) exchanging routes via BGP.',
    category: 'validation',
    badges: ['UC9 Validated', 'Shared ER MSEE', 'ASN 12076 Hairpin', 'No VNet Peering'],
  },
]

const ALL_AZURE_NET_CATALOG: AzNetSampleCatalogEntry[] = [
  ...AZURE_NET_SAMPLES.map((s) => ({
    id: s.id,
    title: s.title,
    summary: s.summary ?? '',
    category: 'flagship' as const,
    badges: FLAGSHIP_BADGES[s.id] ?? ['Reference Topology'],
  })),
  ...AZURE_NET_VALIDATION_SCENARIOS,
]

function encodeTopologyToUrlHash(topology: AzNetTopology): string {
  const json = JSON.stringify(topology)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeTopologyFromUrlHash(hash: string): AzNetTopology | null {
  const m = hash.match(/[#&]s=([A-Za-z0-9_-]+)/)
  if (!m) return null
  try {
    let b64 = m[1].replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4 !== 0) b64 += '='
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as AzNetTopology
    if (validateAzNetTopology(parsed).length === 0) {
      return parsed
    }
  } catch {
    // ignore malformed hash
  }
  return null
}

function resolveInitialBuiltInSample() {
  if (typeof window === 'undefined') return AZURE_NET_SAMPLES[0]
  const requested = new URLSearchParams(window.location.search).get('sample')?.trim() ?? ''
  return AZURE_NET_SAMPLES.find((s) => s.id === requested) ?? AZURE_NET_SAMPLES[0]
}

interface AzureNetAppProps {
  simulatorMode?: SimulatorMode
  onChangeSimulatorMode?: (mode: SimulatorMode) => void
}

function defaultSelected(topology: AzNetTopology): AzSelectedEntity {
  const firstVnet = topology.vnets[1] ?? topology.vnets[0]
  if (firstVnet && firstVnet.subnets[0]) {
    return {
      kind: 'subnet',
      vnetId: firstVnet.id,
      subnetId: firstVnet.subnets[0].id,
    }
  }
  return {
    kind: 'vnet',
    vnetId: firstVnet?.id ?? 'vnet-1',
  }
}

export function AzureNetApp({ simulatorMode = 'full', onChangeSimulatorMode }: AzureNetAppProps = {}) {
  const initialSample = resolveInitialBuiltInSample()
  const hashTopology = typeof window !== 'undefined' ? decodeTopologyFromUrlHash(window.location.hash) : null
  const [sampleId, setSampleId] = useState<string>(hashTopology ? 'shared-topology' : initialSample.id)
  const [topology, setTopology] = useState<AzNetTopology>(() =>
    cloneAzNetTopology(hashTopology ?? initialSample.topology),
  )
  const [history, setHistory] = useState<AzNetTopology[]>([])
  const [future, setFuture] = useState<AzNetTopology[]>([])
  const [activeTab, setActiveTab] = useState<InspectorTab>('routes')
  const [selected, setSelected] = useState<AzSelectedEntity>(() =>
    defaultSelected(initialSample.topology),
  )

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
    opts.push({
      key: 'internet:20.50.60.70',
      label: '🌐 Public Internet (20.50.60.70)',
      ref: { kind: 'internet', ip: '20.50.60.70' },
      defaultIp: '20.50.60.70',
    })
    return opts
  }, [topology])

  const [traceSourceKey, setTraceSourceKey] = useState<string>('')
  const [traceDestKey, setTraceDestKey] = useState<string>('')
  const [customDestIp, setCustomDestIp] = useState<string>('')
  const [traceActive, setTraceActive] = useState<boolean>(false)
  const [sampleGalleryOpen, setSampleGalleryOpen] = useState<boolean>(false)
  const [sampleLoadingId, setSampleLoadingId] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState<boolean>(false)
  const [contextMenu, setContextMenu] = useState<AzContextMenuTarget | null>(null)

  const handleChangeSimulatorMode = (nextMode: SimulatorMode) => {
    if (nextMode === 'hub-spoke' && topology.vwanHubs.length > 0) {
      const fallback = AZURE_NET_SAMPLES.find((s) => s.id === 'hub-spoke-firewall-udr') ?? AZURE_NET_SAMPLES[0]
      setSampleId(fallback.id)
      setTopology(cloneAzNetTopology(fallback.topology))
      setHistory([])
      setFuture([])
    }
    onChangeSimulatorMode?.(nextMode)
  }

  const handleShareUrl = () => {
    try {
      const encoded = encodeTopologyToUrlHash(topology)
      const url = new URL(window.location.href)
      url.hash = `s=${encoded}`
      window.history.replaceState(null, '', url.toString())
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(url.toString()).catch(() => {})
      }
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 2500)
    } catch {
      // ignore clipboard errors
    }
  }

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

  const applyLoadedTopology = (id: string, nextTopology: AzNetTopology) => {
    setSampleId(id)
    setTopology(nextTopology)
    setHistory([])
    setFuture([])
    setTraceActive(false)
    setCustomDestIp('')
    setShowDiagnosticBadges(true)
    setSampleGalleryOpen(false)
    const defaultVnet = nextTopology.vnets[1] ?? nextTopology.vnets[0]
    if (defaultVnet && defaultVnet.subnets[0]) {
      setSelected({
        kind: 'subnet',
        vnetId: defaultVnet.id,
        subnetId: defaultVnet.subnets[0].id,
      })
    }
  }

  const loadSample = (id: string) => {
    const found = AZURE_NET_SAMPLES.find((s) => s.id === id)
    if (found) {
      applyLoadedTopology(found.id, cloneAzNetTopology(found.topology))
      return
    }
    if (!/^[a-z0-9-]+$/.test(id)) return
    setSampleLoadingId(id)
    void fetch(`/docs/samples/azure-net/${id}.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sample "${id}" not found.`)
        return (await res.json()) as AzNetTopology
      })
      .then((loaded) => {
        const errs = validateAzNetTopology(loaded)
        if (errs.length > 0) throw new Error(errs.join('; '))
        applyLoadedTopology(id, loaded)
      })
      .catch(() => {
        // Ignore invalid or unreachable sample fetch
      })
      .finally(() => {
        setSampleLoadingId(null)
      })
  }

  const urlSampleLoaded = useRef(false)
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'AzNet Simulator'
    const iconLink = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const prevIconHref = iconLink?.getAttribute('href')
    if (iconLink) {
      iconLink.setAttribute('href', '/favicon-aznet.svg')
    }
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const prevThemeColor = themeMeta?.getAttribute('content')
    if (themeMeta) {
      themeMeta.setAttribute('content', '#0f766e')
    }
    return () => {
      document.title = prevTitle
      if (iconLink && prevIconHref) iconLink.setAttribute('href', prevIconHref)
      if (themeMeta && prevThemeColor) themeMeta.setAttribute('content', prevThemeColor)
    }
  }, [])

  useEffect(() => {
    if (urlSampleLoaded.current) return
    const requested = new URLSearchParams(window.location.search).get('sample')?.trim() ?? ''
    if (!/^[a-z0-9-]+$/.test(requested)) return
    urlSampleLoaded.current = true
    if (AZURE_NET_SAMPLES.some((s) => s.id === requested)) {
      return
    }
    void fetch(`/docs/samples/azure-net/${requested}.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sample "${requested}" not found.`)
        return (await res.json()) as AzNetTopology
      })
      .then((loaded) => {
        const errs = validateAzNetTopology(loaded)
        if (errs.length > 0) throw new Error(errs.join(' '))
        setSampleId(requested)
        setTopology(loaded)
        setHistory([])
        setFuture([])
        const defaultVnet = loaded.vnets[1] ?? loaded.vnets[0]
        if (defaultVnet && defaultVnet.subnets[0]) {
          setSelected({
            kind: 'subnet',
            vnetId: defaultVnet.id,
            subnetId: defaultVnet.subnets[0].id,
          })
        }
      })
      .catch((err) => {
        setCaptureNotices([err instanceof Error ? err.message : String(err)])
      })
  }, [])

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
      } else if (finding.category === 'ars-default-route-self-loop' && finding.vnetId && finding.subnetId) {
        const vnet = draft.vnets.find((v) => v.id === finding.vnetId)
        const sub = vnet?.subnets.find((s) => s.id === finding.subnetId)
        if (!vnet || !sub) return
        let rt = sub.routeTableId
          ? draft.udrTables.find((t) => t.id === sub.routeTableId)
          : undefined
        if (!rt) {
          rt = {
            id: `rt-nva-egress-${sub.id}`,
            name: `RT-${vnet.name}-${sub.name}`,
            disableBgpRoutePropagation: false,
            routes: [],
          }
          draft.udrTables.push(rt)
          sub.routeTableId = rt.id
        }
        const existingDefault = rt.routes.find((r) => r.prefix === '0.0.0.0/0')
        if (existingDefault) {
          existingDefault.enabled = true
          existingDefault.nextHopType = 'Internet'
          existingDefault.nextHopIp = undefined
        } else {
          rt.routes.push({
            id: `udr-autofix-nva-internet-${sub.id}`,
            name: 'default-to-internet',
            prefix: '0.0.0.0/0',
            nextHopType: 'Internet',
            enabled: true,
          })
        }
      } else if (finding.category === 'bgp-lpm-bypasses-udr' && finding.subnetId) {
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) rt.disableBgpRoutePropagation = true
          }
        }
      } else if (finding.category === 'udr-vng-vnet-transit' && finding.subnetId) {
        const hubFw = draft.vnets
          .flatMap((v) => v.appliances)
          .find((a) => a.inspectsTraffic || a.kind === 'azure-firewall' || a.enableIpForwarding)
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) {
              for (const r of rt.routes) {
                if (r.nextHopType === 'VirtualNetworkGateway' && hubFw) {
                  r.nextHopType = 'VirtualAppliance'
                  r.nextHopIp = hubFw.privateIp
                }
              }
            }
          }
        }
      } else if (finding.category === 'peering-lpm-bypasses-udr' && finding.subnetId) {
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (sub?.routeTableId) {
            const rt = draft.udrTables.find((t) => t.id === sub.routeTableId)
            if (rt) rt.disablePeeringRoutePropagation = true
          }
        }
      } else if (finding.category === 'expressroute-msee-hairpin') {
        const parts = finding.id.split(':')
        const vnetAId = parts[3]
        const vnetBId = parts[4]
        const vA = draft.vnets.find((v) => v.id === vnetAId)
        const vB = draft.vnets.find((v) => v.id === vnetBId)
        if (vA && vB) {
          const existing = draft.vnetPeerings.find(
            (p) =>
              (p.vnetAId === vA.id && p.vnetBId === vB.id) ||
              (p.vnetAId === vB.id && p.vnetBId === vA.id),
          )
          if (existing) {
            existing.enabled = true
            existing.aToB.allowVirtualNetworkAccess = true
            existing.bToA.allowVirtualNetworkAccess = true
          } else {
            draft.vnetPeerings.push({
              id: `peer-autofix-${vA.id}-${vB.id}`,
              name: `${vA.name}-to-${vB.name}`,
              vnetAId: vA.id,
              vnetBId: vB.id,
              enabled: true,
              aToB: {
                allowVirtualNetworkAccess: true,
                allowForwardedTraffic: true,
                allowGatewayTransit: false,
                useRemoteGateways: false,
              },
              bToA: {
                allowVirtualNetworkAccess: true,
                allowForwardedTraffic: true,
                allowGatewayTransit: false,
                useRemoteGateways: false,
              },
            })
          }
        }
      } else if (
        (finding.category === 'subnet-default-outbound-disabled' ||
          finding.category === 'subnet-internet-bypasses-firewall') &&
        finding.subnetId
      ) {
        const hubFw = draft.vnets
          .flatMap((v) => v.appliances)
          .find((a) => a.inspectsTraffic || a.kind === 'azure-firewall' || a.enableIpForwarding)
        for (const vnet of draft.vnets) {
          const sub = vnet.subnets.find((s) => s.id === finding.subnetId)
          if (!sub) continue
          if (hubFw) {
            let rt = sub.routeTableId
              ? draft.udrTables.find((t) => t.id === sub.routeTableId)
              : undefined
            if (!rt) {
              rt = {
                id: `rt-egress-${sub.id}`,
                name: `RT-${vnet.name}-${sub.name}`,
                disableBgpRoutePropagation: false,
                routes: [],
              }
              draft.udrTables.push(rt)
              sub.routeTableId = rt.id
            }
            const existingDefault = rt.routes.find((r) => r.prefix === '0.0.0.0/0')
            if (existingDefault) {
              existingDefault.enabled = true
              existingDefault.nextHopType = 'VirtualAppliance'
              existingDefault.nextHopIp = hubFw.privateIp
            } else {
              rt.routes.push({
                id: `udr-autofix-default-${sub.id}`,
                name: `default-via-${hubFw.name}`,
                prefix: '0.0.0.0/0',
                nextHopType: 'VirtualAppliance',
                nextHopIp: hubFw.privateIp,
                enabled: true,
              })
            }
          } else {
            sub.defaultOutboundAccess = true
          }
        }
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

  const visibleFlagshipSamples = useMemo(
    () =>
      simulatorMode === 'hub-spoke'
        ? AZURE_NET_SAMPLES.filter((s) => s.id !== 'hybrid-vwan-and-hub-spoke')
        : AZURE_NET_SAMPLES,
    [simulatorMode],
  )
  const visibleCatalogEntries = useMemo(
    () =>
      simulatorMode === 'hub-spoke'
        ? ALL_AZURE_NET_CATALOG.filter((s) => s.id !== 'hybrid-vwan-and-hub-spoke')
        : ALL_AZURE_NET_CATALOG,
    [simulatorMode],
  )
  const currentSampleMeta = ALL_AZURE_NET_CATALOG.find((s) => s.id === sampleId)

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(topology, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sampleId || 'azure-net-topology'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addSpokeVnet = (x?: number, y?: number) => {
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
        ...(typeof x === 'number' && typeof y === 'number' ? { x, y } : {}),
      })
    })
  }

  const addSiteNode = (x?: number, y?: number) => {
    commitTopology((draft) => {
      const idx = draft.sites.length + 1
      draft.sites.push({
        id: `site-custom-${idx}`,
        name: `Branch-Site-${idx}`,
        asn: 65100 + idx,
        prefixes: [`172.16.${50 + idx}.0/24`],
        ...(typeof x === 'number' && typeof y === 'number' ? { x, y } : {}),
      })
    })
  }

  const addErLocationNode = (x?: number, y?: number) => {
    commitTopology((draft) => {
      const idx = draft.erLocations.length + 1
      draft.erLocations.push({
        id: `erloc-custom-${idx}`,
        name: `ER-MSEE-${idx}`,
        globalReachEnabled: false,
        ...(typeof x === 'number' && typeof y === 'number' ? { x, y } : {}),
      })
    })
  }

  const deleteSiteById = (siteId: string) => {
    commitTopology((draft) => {
      draft.sites = draft.sites.filter((s) => s.id !== siteId)
      draft.vpnConnections = draft.vpnConnections.filter((c) => c.siteId !== siteId)
      draft.erLinks = draft.erLinks.filter(
        (l) => !(l.targetKind === 'site' && l.targetId === siteId),
      )
      draft.siteLinks = draft.siteLinks.filter(
        (l) => l.siteAId !== siteId && l.siteBId !== siteId,
      )
    })
    if (selected?.kind === 'site' && selected.siteId === siteId) {
      setSelected(defaultSelected(topology))
    }
  }

  const deleteErLocationById = (locationId: string) => {
    commitTopology((draft) => {
      draft.erLocations = draft.erLocations.filter((l) => l.id !== locationId)
      draft.erLinks = draft.erLinks.filter((l) => l.locationId !== locationId)
    })
    if (selected?.kind === 'er-location' && selected.locationId === locationId) {
      setSelected(defaultSelected(topology))
    }
  }

  const deleteVnetById = (vnetId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      const gwIds = new Set((target?.gateways ?? []).map((g) => g.id))
      draft.vnets = draft.vnets.filter((v) => v.id !== vnetId)
      draft.vnetPeerings = draft.vnetPeerings.filter(
        (p) => p.vnetAId !== vnetId && p.vnetBId !== vnetId,
      )
      draft.vpnConnections = draft.vpnConnections.filter(
        (c) => !(c.targetKind === 'vnet-gateway' && gwIds.has(c.targetId)),
      )
      draft.erLinks = draft.erLinks.filter(
        (l) => !(l.targetKind === 'vnet-gateway' && gwIds.has(l.targetId)),
      )
    })
    setSelected(defaultSelected(topology))
  }

  const addFirewallToVnet = (vnetId: string, kind: 'azure-firewall' | 'nva-vm' = 'azure-firewall') => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      const baseMatch = (target.prefixes[0] ?? '10.0.0.0/16').match(/^(\d+\.\d+)\./)
      const prefixBase = baseMatch ? baseMatch[1] : '10.0'
      const subnetName = kind === 'azure-firewall' ? 'AzureFirewallSubnet' : 'snet-nva'
      let appSubnet = target.subnets.find((s) => s.name === subnetName)
      if (!appSubnet) {
        appSubnet = {
          id: `${target.id}-${subnetName.toLowerCase()}-${target.subnets.length + 1}`,
          name: subnetName,
          prefix: `${prefixBase}.${200 + target.subnets.length}.0/24`,
        }
        target.subnets.push(appSubnet)
      }
      const idx = target.appliances.length + 1
      const appOctet = 200 + target.subnets.length - 1
      const appId = `${target.id}-${kind === 'azure-firewall' ? 'azfw' : 'nva'}-${idx}`
      target.appliances.push({
        id: appId,
        name: kind === 'azure-firewall' ? `${target.name}-azfw-${idx}` : `${target.name}-nva-${idx}`,
        kind,
        subnetId: appSubnet.id,
        privateIp: `${prefixBase}.${appOctet}.${3 + idx}`,
        asn: kind === 'nva-vm' ? 65010 + idx : undefined,
        bgpEnabled: kind === 'nva-vm',
        enableIpForwarding: true,
        inspectsTraffic: true,
        staticRoutes: [],
      })
      if (kind === 'nva-vm' && target.routeServer) {
        if (!target.routeServer.peerApplianceIds.includes(appId)) {
          target.routeServer.peerApplianceIds.push(appId)
        }
      }
    })
  }

  const removeApplianceFromVnet = (vnetId: string, applianceId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      target.appliances = target.appliances.filter((a) => a.id !== applianceId)
      if (target.routeServer) {
        target.routeServer.peerApplianceIds = target.routeServer.peerApplianceIds.filter(
          (id) => id !== applianceId,
        )
      }
      draft.vpnConnections = draft.vpnConnections.filter(
        (c) => !(c.targetKind === 'appliance' && c.targetId === applianceId),
      )
    })
  }

  const addGatewayToVnet = (vnetId: string, kind: 'ExpressRoute' | 'Vpn') => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      if (target.gateways.some((g) => g.kind === kind)) return
      const baseMatch = (target.prefixes[0] ?? '10.0.0.0/16').match(/^(\d+\.\d+)\./)
      const prefixBase = baseMatch ? baseMatch[1] : '10.0'
      if (!target.subnets.some((s) => s.name === 'GatewaySubnet')) {
        target.subnets.push({
          id: `${target.id}-gw-snet`,
          name: 'GatewaySubnet',
          prefix: `${prefixBase}.250.0/24`,
        })
      }
      target.gateways.push({
        id: `${target.id}-${kind === 'ExpressRoute' ? 'ergw' : 'vpngw'}`,
        name: `${target.name}-${kind === 'ExpressRoute' ? 'er-gw' : 'vpn-gw'}`,
        kind,
        asn: 65515,
        bgpEnabled: true,
        enabled: true,
      })
    })
  }

  const removeGatewayFromVnet = (vnetId: string, gatewayId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      target.gateways = target.gateways.filter((g) => g.id !== gatewayId)
      draft.erLinks = draft.erLinks.filter(
        (l) => !(l.targetKind === 'vnet-gateway' && l.targetId === gatewayId),
      )
      draft.vpnConnections = draft.vpnConnections.filter(
        (c) => !(c.targetKind === 'vnet-gateway' && c.targetId === gatewayId),
      )
    })
  }

  const addRouteServerToVnet = (vnetId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target || target.routeServer) return
      const baseMatch = (target.prefixes[0] ?? '10.0.0.0/16').match(/^(\d+\.\d+)\./)
      const prefixBase = baseMatch ? baseMatch[1] : '10.0'
      let rsSubnet = target.subnets.find((s) => s.name === 'RouteServerSubnet')
      if (!rsSubnet) {
        rsSubnet = {
          id: `${target.id}-rs-snet`,
          name: 'RouteServerSubnet',
          prefix: `${prefixBase}.251.0/24`,
        }
        target.subnets.push(rsSubnet)
      }
      target.routeServer = {
        id: `${target.id}-ars`,
        name: `${target.name}-ars`,
        subnetId: rsSubnet.id,
        enabled: true,
        branchToBranchTraffic: true,
        hubRoutingPreference: 'ExpressRoute',
        peerApplianceIds: target.appliances.filter((a) => a.bgpEnabled).map((a) => a.id),
      }
    })
  }

  const removeRouteServerFromVnet = (vnetId: string) => {
    commitTopology((draft) => {
      const target = draft.vnets.find((v) => v.id === vnetId)
      if (!target) return
      target.routeServer = undefined
    })
  }

  const createAndAssociateRouteTable = (vnetId?: string, subnetId?: string) => {
    commitTopology((draft) => {
      const idx = draft.udrTables.length + 1
      const rtId = `rt-custom-${idx}-${Date.now().toString(36).slice(-4)}`
      const firstApp = draft.vnets.flatMap((v) => v.appliances)[0]
      draft.udrTables.push({
        id: rtId,
        name: `rt-workload-${idx}`,
        disableBgpRoutePropagation: false,
        disablePeeringRoutePropagation: false,
        routes: firstApp
          ? [
              {
                id: `${rtId}-r1`,
                name: 'default-to-fw',
                prefix: '0.0.0.0/0',
                nextHopType: 'VirtualAppliance',
                nextHopIp: firstApp.privateIp,
                enabled: true,
              },
            ]
          : [],
      })
      if (vnetId && subnetId) {
        const vnet = draft.vnets.find((v) => v.id === vnetId)
        const subnet = vnet?.subnets.find((s) => s.id === subnetId)
        if (subnet) {
          subnet.routeTableId = rtId
        }
      }
    })
  }

  const contextMenuSpec: { title: string; actions: ContextAction[] } | null = (() => {
    if (!contextMenu) return null
    const target =
      contextMenu.kind === 'canvas'
        ? { kind: 'canvas' as const, svgX: contextMenu.svgX, svgY: contextMenu.svgY }
        : contextMenu.entity

    if (target.kind === 'canvas') {
      return {
        title: 'Canvas Actions',
        actions: [
          {
            label: 'Add Spoke VNet here',
            onSelect: () => addSpokeVnet(target.svgX, target.svgY),
          },
          ...(simulatorMode === 'full'
            ? [
                {
                  label: 'Add Virtual WAN Hub here',
                  onSelect: () => {
                    commitTopology((draft) => {
                      const idx = draft.vwanHubs.length + 1
                      draft.vwanHubs.push({
                        id: `vhub-custom-${idx}`,
                        name: `vWAN-Hub-${idx}`,
                        region: 'West Europe',
                        prefix: `10.${190 + idx}.0.0/23`,
                        preference: 'ExpressRoute',
                        routingIntent: {
                          private: false,
                          internet: false,
                        },
                        x: target.svgX,
                        y: target.svgY,
                      })
                    })
                  },
                },
              ]
            : []),
          {
            label: 'Add On-Premises Site here',
            onSelect: () => addSiteNode(target.svgX, target.svgY),
          },
          {
            label: 'Add ExpressRoute MSEE Location here',
            onSelect: () => addErLocationNode(target.svgX, target.svgY),
          },
          {
            label: 'Create Independent Route Table',
            onSelect: () => createAndAssociateRouteTable(),
          },
          {
            label: 'Run Root-Cause Diagnostics',
            onSelect: () => {
              setShowDiagnosticBadges(true)
              setActiveTab('diagnostics')
            },
          },
          {
            label: 'Open Sample Topology Gallery',
            onSelect: () => setSampleGalleryOpen(true),
          },
          {
            label: 'Clear Path & Diagnostic Highlights',
            onSelect: () => {
              setTraceActive(false)
              setShowDiagnosticBadges(false)
            },
          },
        ],
      }
    }

    if (target.kind === 'vnet') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      if (!vnet) return null
      const firstSub = vnet.subnets[0]
      const peerableVnets = topology.vnets.filter(
        (other) =>
          other.id !== vnet.id &&
          !topology.vnetPeerings.some(
            (p) =>
              (p.vnetAId === vnet.id && p.vnetBId === other.id) ||
              (p.vnetAId === other.id && p.vnetBId === vnet.id),
          ),
      )
      const hasErGw = vnet.gateways.some((g) => g.kind === 'ExpressRoute')
      const hasVpnGw = vnet.gateways.some((g) => g.kind === 'Vpn')

      return {
        title: `VNet · ${vnet.name} (${vnet.region})`,
        actions: [
          {
            label: 'Inspect Effective Routes',
            disabled: !firstSub,
            onSelect: () => {
              if (!firstSub) return
              setSelected({ kind: 'subnet', vnetId: vnet.id, subnetId: firstSub.id })
              setActiveTab('routes')
            },
          },
          ...(vnet.subnets.length > 1
            ? [
                {
                  label: 'Inspect Subnet',
                  children: vnet.subnets.map((sub) => ({
                    label: `${sub.name} (${sub.prefix})`,
                    onSelect: () => {
                      setSelected({ kind: 'subnet', vnetId: vnet.id, subnetId: sub.id })
                      setActiveTab('routes')
                    },
                  })),
                },
              ]
            : []),
          {
            label: 'Set as Path Trace Source',
            disabled: !firstSub,
            onSelect: () => {
              if (!firstSub) return
              setTraceSourceKey(`subnet:${vnet.id}:${firstSub.id}`)
              setTraceActive(true)
              setActiveTab('tracer')
            },
          },
          {
            label: 'Set as Path Trace Destination',
            disabled: !firstSub,
            onSelect: () => {
              if (!firstSub) return
              setTraceDestKey(`subnet:${vnet.id}:${firstSub.id}`)
              setCustomDestIp('')
              setTraceActive(true)
              setActiveTab('tracer')
            },
          },
          {
            label: 'Add Subnet to VNet',
            onSelect: () => {
              commitTopology((draft) => {
                const v = draft.vnets.find((x) => x.id === vnet.id)
                if (!v) return
                const idx = v.subnets.length + 1
                const baseMatch = (v.prefixes[0] ?? '10.0.0.0/16').match(/^(\d+\.\d+)\./)
                const prefixBase = baseMatch ? baseMatch[1] : '10.99'
                v.subnets.push({
                  id: `${v.id}-snet-${idx}`,
                  name: `snet-tier-${idx}`,
                  prefix: `${prefixBase}.${10 + idx}.0/24`,
                })
              })
            },
          },
          {
            label: 'Add / Remove VNet Elements',
            children: [
              {
                label: '+ Add Azure Firewall',
                onSelect: () => addFirewallToVnet(vnet.id, 'azure-firewall'),
              },
              {
                label: '+ Add BGP NVA Appliance',
                onSelect: () => addFirewallToVnet(vnet.id, 'nva-vm'),
              },
              ...(!hasErGw
                ? [
                    {
                      label: '+ Add ExpressRoute Gateway',
                      onSelect: () => addGatewayToVnet(vnet.id, 'ExpressRoute'),
                    },
                  ]
                : []),
              ...(!hasVpnGw
                ? [
                    {
                      label: '+ Add VPN Gateway',
                      onSelect: () => addGatewayToVnet(vnet.id, 'Vpn'),
                    },
                  ]
                : []),
              ...(!vnet.routeServer
                ? [
                    {
                      label: '+ Add Azure Route Server (ARS)',
                      onSelect: () => addRouteServerToVnet(vnet.id),
                    },
                  ]
                : [
                    {
                      label: 'Remove Azure Route Server (ARS)',
                      danger: true,
                      onSelect: () => removeRouteServerFromVnet(vnet.id),
                    },
                  ]),
              ...vnet.gateways.map((gw) => ({
                label: `Remove ${gw.kind} Gateway (${gw.name})`,
                danger: true,
                onSelect: () => removeGatewayFromVnet(vnet.id, gw.id),
              })),
              ...vnet.appliances.map((app) => ({
                label: `Remove Appliance (${app.name})`,
                danger: true,
                onSelect: () => removeApplianceFromVnet(vnet.id, app.id),
              })),
            ],
          },
          {
            label: 'Peer with VNet',
            disabled: peerableVnets.length === 0,
            children: peerableVnets.map((other) => ({
              label: `${other.name} (${other.region})`,
              onSelect: () => {
                commitTopology((draft) => {
                  const isVnetHub = vnet.role === 'hub' || vnet.role === 'hub-vnet'
                  const isOtherHub = other.role === 'hub' || other.role === 'hub-vnet'
                  draft.vnetPeerings.push({
                    id: `peer-${vnet.id}-${other.id}`,
                    name: `${vnet.name}-to-${other.name}`,
                    vnetAId: vnet.id,
                    vnetBId: other.id,
                    enabled: true,
                    aToB: {
                      allowVirtualNetworkAccess: true,
                      allowForwardedTraffic: true,
                      allowGatewayTransit: isVnetHub,
                      useRemoteGateways: !isVnetHub && isOtherHub,
                    },
                    bToA: {
                      allowVirtualNetworkAccess: true,
                      allowForwardedTraffic: true,
                      allowGatewayTransit: isOtherHub,
                      useRemoteGateways: !isOtherHub && isVnetHub,
                    },
                  })
                })
              },
            })),
          },
          {
            label: 'Configure VNet & Elements',
            onSelect: () => {
              setSelected({ kind: 'vnet', vnetId: vnet.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete VNet',
            danger: true,
            disabled: topology.vnets.length <= 1,
            onSelect: () => {
              commitTopology((draft) => {
                draft.vnets = draft.vnets.filter((v) => v.id !== vnet.id)
                draft.vnetPeerings = draft.vnetPeerings.filter(
                  (p) => p.vnetAId !== vnet.id && p.vnetBId !== vnet.id,
                )
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'subnet') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const subnet = vnet?.subnets.find((s) => s.id === target.subnetId)
      if (!vnet || !subnet) return null
      const rt = subnet.routeTableId
        ? topology.udrTables.find((t) => t.id === subnet.routeTableId)
        : undefined
      return {
        title: `Subnet · ${vnet.name} / ${subnet.name}`,
        actions: [
          {
            label: 'Inspect Subnet Effective Routes',
            onSelect: () => {
              setSelected({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })
              setActiveTab('routes')
            },
          },
          {
            label: 'Set as Path Trace Source',
            onSelect: () => {
              setTraceSourceKey(`subnet:${vnet.id}:${subnet.id}`)
              setTraceActive(true)
              setActiveTab('tracer')
            },
          },
          {
            label: 'Set as Path Trace Destination',
            onSelect: () => {
              setTraceDestKey(`subnet:${vnet.id}:${subnet.id}`)
              setCustomDestIp('')
              setTraceActive(true)
              setActiveTab('tracer')
            },
          },
          {
            label: rt ? `Route Table (${rt.name})` : 'Associate Route Table',
            children: [
              {
                label: `+ Create & Associate New Route Table`,
                onSelect: () => createAndAssociateRouteTable(vnet.id, subnet.id),
              },
              ...(rt
                ? [
                    {
                      label: 'Detach Route Table (None)',
                      danger: true,
                      onSelect: () => {
                        commitTopology((draft) => {
                          const targetV = draft.vnets.find((v) => v.id === vnet.id)
                          const targetS = targetV?.subnets.find((s) => s.id === subnet.id)
                          if (targetS) targetS.routeTableId = undefined
                        })
                      },
                    },
                  ]
                : []),
              ...topology.udrTables.map((candidateRt) => ({
                label: `${candidateRt.name}${candidateRt.id === subnet.routeTableId ? ' (Associated)' : ''}`,
                onSelect: () => {
                  commitTopology((draft) => {
                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                    const targetS = targetV?.subnets.find((s) => s.id === subnet.id)
                    if (targetS) targetS.routeTableId = candidateRt.id
                  })
                },
              })),
            ],
          },
          ...(rt
            ? [
                {
                  label: rt.disableBgpRoutePropagation
                    ? 'Enable GWroutes Propagation on Route Table'
                    : 'Disable GWroutes Propagation on Route Table (GWroutes:OFF)',
                  onSelect: () => {
                    commitTopology((draft) => {
                      const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                      if (targetRt) {
                        targetRt.disableBgpRoutePropagation = !targetRt.disableBgpRoutePropagation
                      }
                    })
                  },
                },
                {
                  label: rt.disablePeeringRoutePropagation
                    ? 'Enable Peering Route Propagation on Route Table'
                    : 'Disable Peering Route Propagation on Route Table',
                  onSelect: () => {
                    commitTopology((draft) => {
                      const targetRt = draft.udrTables.find((t) => t.id === rt.id)
                      if (targetRt) {
                        targetRt.disablePeeringRoutePropagation =
                          !targetRt.disablePeeringRoutePropagation
                      }
                    })
                  },
                },
              ]
            : []),
          {
            label:
              subnet.defaultOutboundAccess === false
                ? 'Enable Default Outbound Access'
                : 'Disable Default Outbound Access (Private Subnet)',
            onSelect: () => {
              commitTopology((draft) => {
                const targetV = draft.vnets.find((v) => v.id === vnet.id)
                const targetS = targetV?.subnets.find((s) => s.id === subnet.id)
                if (targetS) {
                  targetS.defaultOutboundAccess = targetS.defaultOutboundAccess === false
                }
              })
            },
          },
          {
            label: 'Configure Route Table & Subnet Policies',
            onSelect: () => {
              setSelected({ kind: 'subnet', vnetId: vnet.id, subnetId: subnet.id })
              setActiveTab('editor')
            },
          },
        ],
      }
    }

    if (target.kind === 'gateway') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const gw = vnet?.gateways.find((g) => g.id === target.gatewayId)
      if (!vnet || !gw) return null
      return {
        title: `Gateway · ${gw.name} (${gw.kind.toUpperCase()})`,
        actions: [
          {
            label: 'Inspect Gateway BGP RIB',
            onSelect: () => {
              setSelected({ kind: 'gateway', vnetId: vnet.id, gatewayId: gw.id })
              setActiveTab('routes')
            },
          },
          {
            label: 'Configure Gateway & Peerings',
            onSelect: () => {
              setSelected({ kind: 'gateway', vnetId: vnet.id, gatewayId: gw.id })
              setActiveTab('editor')
            },
          },
          {
            label: `Remove ${gw.kind} Gateway`,
            danger: true,
            onSelect: () => removeGatewayFromVnet(vnet.id, gw.id),
          },
        ],
      }
    }

    if (target.kind === 'route-server') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const ars = vnet?.routeServer
      if (!vnet || !ars) return null
      return {
        title: `Azure Route Server · ${ars.name}`,
        actions: [
          {
            label: 'Inspect Route Server RIB (ASN 65515)',
            onSelect: () => {
              setSelected({ kind: 'route-server', vnetId: vnet.id, routeServerId: ars.id })
              setActiveTab('routes')
            },
          },
          {
            label: ars.branchToBranchTraffic
              ? 'Disable Branch-to-Branch Traffic'
              : 'Enable Branch-to-Branch Traffic',
            onSelect: () => {
              commitTopology((draft) => {
                const targetV = draft.vnets.find((v) => v.id === vnet.id)
                if (targetV?.routeServer) {
                  targetV.routeServer.branchToBranchTraffic =
                    !targetV.routeServer.branchToBranchTraffic
                }
              })
            },
          },
          {
            label: 'Set Routing Preference',
            children: (['ExpressRoute', 'VpnGateway', 'ASPath'] as const).map((pref) => ({
              label: `${pref}${ars.hubRoutingPreference === pref ? ' (Current)' : ''}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const targetV = draft.vnets.find((v) => v.id === vnet.id)
                  if (targetV?.routeServer) {
                    targetV.routeServer.hubRoutingPreference = pref
                  }
                })
              },
            })),
          },
          {
            label: 'Configure Route Server',
            onSelect: () => {
              setSelected({ kind: 'route-server', vnetId: vnet.id, routeServerId: ars.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Remove Azure Route Server',
            danger: true,
            onSelect: () => removeRouteServerFromVnet(vnet.id),
          },
        ],
      }
    }

    if (target.kind === 'appliance') {
      const vnet = topology.vnets.find((v) => v.id === target.vnetId)
      const app = vnet?.appliances.find((a) => a.id === target.applianceId)
      if (!vnet || !app) return null
      return {
        title: `Appliance · ${app.name} (${app.privateIp})`,
        actions: [
          {
            label: 'Inspect Appliance Subnet Effective Routes',
            onSelect: () => {
              setSelected({ kind: 'appliance', vnetId: vnet.id, applianceId: app.id })
              setActiveTab('routes')
            },
          },
          {
            label: app.enableIpForwarding
              ? 'Disable NIC IP Forwarding'
              : 'Enable NIC IP Forwarding',
            onSelect: () => {
              commitTopology((draft) => {
                const targetV = draft.vnets.find((v) => v.id === vnet.id)
                const targetA = targetV?.appliances.find((a) => a.id === app.id)
                if (targetA) targetA.enableIpForwarding = !targetA.enableIpForwarding
              })
            },
          },
          {
            label: 'Configure Appliance',
            onSelect: () => {
              setSelected({ kind: 'appliance', vnetId: vnet.id, applianceId: app.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Remove Appliance',
            danger: true,
            onSelect: () => removeApplianceFromVnet(vnet.id, app.id),
          },
        ],
      }
    }

    if (target.kind === 'peering') {
      const peering = topology.vnetPeerings.find((p) => p.id === target.peeringId)
      if (!peering) return null
      const vA = topology.vnets.find((v) => v.id === peering.vnetAId)
      const vB = topology.vnets.find((v) => v.id === peering.vnetBId)
      return {
        title: `VNet Peering · ${vA?.name ?? peering.vnetAId} ↔ ${vB?.name ?? peering.vnetBId}`,
        actions: [
          {
            label: 'Configure Peering State & Flags',
            onSelect: () => {
              setSelected({ kind: 'peering', peeringId: peering.id })
              setActiveTab('editor')
            },
          },
          {
            label: peering.enabled ? 'Disable VNet Peering' : 'Enable VNet Peering',
            onSelect: () => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                if (p) p.enabled = !p.enabled
              })
            },
          },
          {
            label: `${vA?.name ?? 'VNet A'} → ${vB?.name ?? 'VNet B'} Flags`,
            children: (
              [
                ['allowVirtualNetworkAccess', 'Allow VNet Access'],
                ['allowForwardedTraffic', 'Allow Forwarded Traffic'],
                ['allowGatewayTransit', 'Allow Gateway Transit'],
                ['useRemoteGateways', 'Use Remote Gateways'],
              ] as const
            ).map(([flagKey, flagLabel]) => ({
              label: `${peering.aToB[flagKey] ? '✓ ' : ''}${flagLabel}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                  if (p) p.aToB[flagKey] = !p.aToB[flagKey]
                })
              },
            })),
          },
          {
            label: `${vB?.name ?? 'VNet B'} → ${vA?.name ?? 'VNet A'} Flags`,
            children: (
              [
                ['allowVirtualNetworkAccess', 'Allow VNet Access'],
                ['allowForwardedTraffic', 'Allow Forwarded Traffic'],
                ['allowGatewayTransit', 'Allow Gateway Transit'],
                ['useRemoteGateways', 'Use Remote Gateways'],
              ] as const
            ).map(([flagKey, flagLabel]) => ({
              label: `${peering.bToA[flagKey] ? '✓ ' : ''}${flagLabel}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                  if (p) p.bToA[flagKey] = !p.bToA[flagKey]
                })
              },
            })),
          },
          {
            label: 'Enable Forwarded Traffic (Both Directions)',
            onSelect: () => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peering.id)
                if (p) {
                  p.aToB.allowForwardedTraffic = true
                  p.bToA.allowForwardedTraffic = true
                }
              })
            },
          },
          {
            label: 'Delete VNet Peering',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.vnetPeerings = draft.vnetPeerings.filter((p) => p.id !== peering.id)
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'vwan-hub') {
      const hub = topology.vwanHubs.find((h) => h.id === target.hubId)
      if (!hub) return null
      return {
        title: `Virtual WAN Hub · ${hub.name}`,
        actions: [
          {
            label: 'Inspect Virtual WAN Hub Effective RIB',
            onSelect: () => {
              setSelected({ kind: 'vwan-hub', hubId: hub.id })
              setActiveTab('routes')
            },
          },
          {
            label: hub.routingIntent.private
              ? 'Disable Private Traffic Routing Intent'
              : 'Enable Private Traffic Routing Intent',
            onSelect: () => {
              commitTopology((draft) => {
                const h = draft.vwanHubs.find((x) => x.id === hub.id)
                if (h) h.routingIntent.private = !h.routingIntent.private
              })
            },
          },
          {
            label: hub.routingIntent.internet
              ? 'Disable Internet Traffic Routing Intent'
              : 'Enable Internet Traffic Routing Intent',
            onSelect: () => {
              commitTopology((draft) => {
                const h = draft.vwanHubs.find((x) => x.id === hub.id)
                if (h) h.routingIntent.internet = !h.routingIntent.internet
              })
            },
          },
          {
            label: 'Set Hub Routing Preference',
            children: (['ExpressRoute', 'VPN', 'ASPath'] as const).map((pref) => ({
              label: `${pref}${hub.preference === pref ? ' (Current)' : ''}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const h = draft.vwanHubs.find((x) => x.id === hub.id)
                  if (h) h.preference = pref
                })
              },
            })),
          },
          {
            label: 'Configure Hub & Labels',
            onSelect: () => {
              setSelected({ kind: 'vwan-hub', hubId: hub.id })
              setActiveTab('editor')
            },
          },
        ],
      }
    }

    if (target.kind === 'er-location') {
      const loc = topology.erLocations.find((l) => l.id === target.locationId)
      if (!loc) return null
      return {
        title: `ExpressRoute MSEE · ${loc.name}`,
        actions: [
          {
            label: 'Inspect ExpressRoute MSEE BGP RIB',
            onSelect: () => {
              setSelected({ kind: 'er-location', locationId: loc.id })
              setActiveTab('routes')
            },
          },
          {
            label: loc.globalReachEnabled
              ? 'Disable ExpressRoute Global Reach'
              : 'Enable ExpressRoute Global Reach',
            onSelect: () => {
              commitTopology((draft) => {
                const l = draft.erLocations.find((x) => x.id === loc.id)
                if (l) l.globalReachEnabled = !l.globalReachEnabled
              })
            },
          },
          {
            label: 'Configure ER Location & Labels',
            onSelect: () => {
              setSelected({ kind: 'er-location', locationId: loc.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Connect ExpressRoute Link to...',
            children: [
              ...topology.sites
                .filter(
                  (site) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'site' &&
                        l.targetId === site.id,
                    ),
                )
                .map((site) => ({
                  label: `Site: ${site.name} (ASN ${site.asn})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${site.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${site.name}`,
                        locationId: loc.id,
                        targetKind: 'site',
                        targetId: site.id,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vnets
                .flatMap((v) =>
                  v.gateways
                    .filter((g) => g.kind === 'ExpressRoute')
                    .map((g) => ({ vnet: v, gw: g })),
                )
                .filter(
                  ({ gw }) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'vnet-gateway' &&
                        l.targetId === gw.id,
                    ),
                )
                .map(({ vnet, gw }) => ({
                  label: `VNet ER Gateway: ${vnet.name} (${gw.name})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${gw.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${gw.name}`,
                        locationId: loc.id,
                        targetKind: 'vnet-gateway',
                        targetId: gw.id,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vwanHubs
                .filter(
                  (hub) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'vwan-hub' &&
                        l.targetId === hub.id,
                    ),
                )
                .map((hub) => ({
                  label: `vWAN Hub: ${hub.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${hub.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${hub.name}`,
                        locationId: loc.id,
                        targetKind: 'vwan-hub',
                        targetId: hub.id,
                        enabled: true,
                      })
                    })
                  },
                })),
            ],
          },
          {
            label: 'Delete ExpressRoute MSEE Location',
            danger: true,
            onSelect: () => deleteErLocationById(loc.id),
          },
        ],
      }
    }

    if (target.kind === 'site') {
      const site = topology.sites.find((s) => s.id === target.siteId)
      if (!site) return null
      return {
        title: `On-Premises Site · ${site.name} (ASN ${site.asn})`,
        actions: [
          {
            label: 'Inspect Site BGP Route Table',
            onSelect: () => {
              setSelected({ kind: 'site', siteId: site.id })
              setActiveTab('routes')
            },
          },
          {
            label: 'Set as Path Trace Source',
            onSelect: () => {
              setTraceSourceKey(`site:${site.id}`)
              setTraceActive(true)
              setActiveTab('tracer')
            },
          },
          {
            label: 'Set as Path Trace Destination',
            onSelect: () => {
              setTraceDestKey(`site:${site.id}`)
              setCustomDestIp('')
              setTraceActive(true)
              setActiveTab('tracer')
            },
          },
          {
            label: 'Connect Site to...',
            children: [
              ...topology.erLocations
                .filter(
                  (loc) =>
                    !topology.erLinks.some(
                      (l) =>
                        l.locationId === loc.id &&
                        l.targetKind === 'site' &&
                        l.targetId === site.id,
                    ),
                )
                .map((loc) => ({
                  label: `ExpressRoute MSEE: ${loc.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.erLinks.push({
                        id: `erlink-${loc.id}-${site.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${loc.name}-to-${site.name}`,
                        locationId: loc.id,
                        targetKind: 'site',
                        targetId: site.id,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vnets
                .flatMap((v) =>
                  v.gateways
                    .filter((g) => g.kind === 'Vpn')
                    .map((g) => ({ vnet: v, gw: g })),
                )
                .filter(
                  ({ gw }) =>
                    !topology.vpnConnections.some(
                      (c) =>
                        c.siteId === site.id &&
                        c.targetKind === 'vnet-gateway' &&
                        c.targetId === gw.id,
                    ),
                )
                .map(({ vnet, gw }) => ({
                  label: `S2S VPN to VNet GW: ${vnet.name} (${gw.name})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.vpnConnections.push({
                        id: `vpn-${site.id}-${gw.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${site.name}-to-${gw.name}`,
                        siteId: site.id,
                        targetKind: 'vnet-gateway',
                        targetId: gw.id,
                        bgpEnabled: true,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vnets
                .flatMap((v) => v.appliances.map((a) => ({ vnet: v, app: a })))
                .filter(
                  ({ app }) =>
                    !topology.vpnConnections.some(
                      (c) =>
                        c.siteId === site.id &&
                        c.targetKind === 'appliance' &&
                        c.targetId === app.id,
                    ),
                )
                .map(({ vnet, app }) => ({
                  label: `S2S VPN to NVA/Firewall: ${vnet.name} (${app.name})`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.vpnConnections.push({
                        id: `vpn-${site.id}-${app.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${site.name}-to-${app.name}`,
                        siteId: site.id,
                        targetKind: 'appliance',
                        targetId: app.id,
                        bgpEnabled: Boolean(app.bgpEnabled),
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.vwanHubs
                .filter(
                  (hub) =>
                    !topology.vpnConnections.some(
                      (c) =>
                        c.siteId === site.id &&
                        c.targetKind === 'vwan-hub' &&
                        c.targetId === hub.id,
                    ),
                )
                .map((hub) => ({
                  label: `S2S VPN to vWAN Hub: ${hub.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.vpnConnections.push({
                        id: `vpn-${site.id}-${hub.id}-${Date.now().toString(36).slice(-3)}`,
                        name: `${site.name}-to-${hub.name}`,
                        siteId: site.id,
                        targetKind: 'vwan-hub',
                        targetId: hub.id,
                        bgpEnabled: true,
                        enabled: true,
                      })
                    })
                  },
                })),
              ...topology.sites
                .filter(
                  (other) =>
                    other.id !== site.id &&
                    !topology.siteLinks.some(
                      (l) =>
                        (l.siteAId === site.id && l.siteBId === other.id) ||
                        (l.siteAId === other.id && l.siteBId === site.id),
                    ),
                )
                .map((other) => ({
                  label: `Site-to-Site WAN Link: ${other.name}`,
                  onSelect: () => {
                    commitTopology((draft) => {
                      draft.siteLinks.push({
                        id: `sitelink-${site.id}-${other.id}`,
                        name: `${site.name}-to-${other.name}`,
                        siteAId: site.id,
                        siteBId: other.id,
                        enabled: true,
                      })
                    })
                  },
                })),
            ],
          },
          {
            label: 'Configure Site & Labels',
            onSelect: () => {
              setSelected({ kind: 'site', siteId: site.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete On-Premises Site',
            danger: true,
            onSelect: () => deleteSiteById(site.id),
          },
        ],
      }
    }

    if (target.kind === 'er-link') {
      const link = topology.erLinks.find((l) => l.id === target.linkId)
      if (!link) return null
      const loc = topology.erLocations.find((l) => l.id === link.locationId)
      return {
        title: `ExpressRoute Link · ${link.name}`,
        actions: [
          {
            label: link.enabled ? 'Disable ExpressRoute Link' : 'Enable ExpressRoute Link',
            onSelect: () => {
              commitTopology((draft) => {
                const l = draft.erLinks.find((x) => x.id === link.id)
                if (l) l.enabled = !l.enabled
              })
            },
          },
          {
            label: 'Set Routing Weight',
            children: [0, 10, 50, 100, 200].map((w) => ({
              label: `Weight ${w}${(link.weight ?? 0) === w ? ' (Current)' : ''}`,
              onSelect: () => {
                commitTopology((draft) => {
                  const l = draft.erLinks.find((x) => x.id === link.id)
                  if (l) l.weight = w || undefined
                })
              },
            })),
          },
          {
            label: `Configure ExpressRoute Link (${loc?.name ?? link.locationId})`,
            onSelect: () => {
              setSelected({ kind: 'er-link', linkId: link.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete ExpressRoute Link',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.erLinks = draft.erLinks.filter((l) => l.id !== link.id)
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'vpn-connection') {
      const conn = topology.vpnConnections.find((c) => c.id === target.connectionId)
      if (!conn) return null
      return {
        title: `S2S VPN Connection · ${conn.name}`,
        actions: [
          {
            label: conn.enabled ? 'Disable VPN Connection' : 'Enable VPN Connection',
            onSelect: () => {
              commitTopology((draft) => {
                const c = draft.vpnConnections.find((x) => x.id === conn.id)
                if (c) c.enabled = !c.enabled
              })
            },
          },
          {
            label: conn.bgpEnabled ? 'Switch to Static Routing (BGP Off)' : 'Enable BGP on VPN Connection',
            onSelect: () => {
              commitTopology((draft) => {
                const c = draft.vpnConnections.find((x) => x.id === conn.id)
                if (c) c.bgpEnabled = !c.bgpEnabled
              })
            },
          },
          {
            label: 'Configure VPN Connection',
            onSelect: () => {
              setSelected({ kind: 'vpn-connection', connectionId: conn.id })
              setActiveTab('editor')
            },
          },
          {
            label: 'Delete VPN Connection',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.vpnConnections = draft.vpnConnections.filter((c) => c.id !== conn.id)
              })
            },
          },
        ],
      }
    }

    if (target.kind === 'site-link') {
      const sLink = topology.siteLinks.find((l) => l.id === target.siteLinkId)
      if (!sLink) return null
      return {
        title: `Site-to-Site Link · ${sLink.name}`,
        actions: [
          {
            label: sLink.enabled ? 'Disable Site-to-Site Link' : 'Enable Site-to-Site Link',
            onSelect: () => {
              commitTopology((draft) => {
                const l = draft.siteLinks.find((x) => x.id === sLink.id)
                if (l) l.enabled = !l.enabled
              })
            },
          },
          {
            label: 'Delete Site-to-Site Link',
            danger: true,
            onSelect: () => {
              commitTopology((draft) => {
                draft.siteLinks = draft.siteLinks.filter((l) => l.id !== sLink.id)
              })
            },
          },
        ],
      }
    }

    return null
  })()

  return (
    <div className="aznet-app" data-testid="aznet-app">
      {/* Top Navigation & Actions Bar */}
      <header
        className={`aznet-topbar ${
          simulatorMode === 'hub-spoke' ? 'aznet-topbar-hubspoke' : 'aznet-topbar-full'
        }`}
      >
        <div className="unified-topbar-left">
          <div className="aznet-brand unified-brand">
            <div className="aznet-brand-icon" aria-hidden="true">
              Az
            </div>
            <h1>AzNet Simulator</h1>
            <span className="aznet-preview-pill" data-testid="unified-mode-pill">
              {simulatorMode === 'hub-spoke' ? 'Hub & Spoke' : 'Full Hybrid'}
            </span>
          </div>

          {onChangeSimulatorMode && (
            <SimulatorModeSwitch
              mode={simulatorMode}
              onChange={handleChangeSimulatorMode}
              variant="aznet"
            />
          )}
        </div>

        <div className="aznet-topbar-controls">

          <button
            type="button"
            className="aznet-btn aznet-btn-gallery"
            data-testid="aznet-open-sample-gallery-btn"
            onClick={() => setSampleGalleryOpen(true)}
            title="Browse built-in Azure VNet & Hybrid sample topologies"
          >
            📚 Sample Gallery ({visibleCatalogEntries.length})
          </button>

          <label style={{ fontSize: 12, color: '#cbd5e1' }} htmlFor="aznet-sample-select">
            Sample Topology:
          </label>
          <select
            id="aznet-sample-select"
            data-testid="aznet-sample-select"
            className="aznet-select"
            value={sampleId}
            onChange={(e) => loadSample(e.target.value)}
          >
            {sampleId === 'shared-topology' && (
              <option value="shared-topology">🔗 Shared URL Topology</option>
            )}
            <optgroup label={`Flagship Reference Topologies (${visibleFlagshipSamples.length})`}>
              {visibleFlagshipSamples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Empirical Validation Scenarios (UC1–UC9)">
              {AZURE_NET_VALIDATION_SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
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
            onClick={() => addSiteNode()}
            data-testid="aznet-add-site-btn"
            title="Add On-Premises Site"
          >
            + Site
          </button>

          <button
            type="button"
            className="aznet-btn"
            onClick={() => addErLocationNode()}
            data-testid="aznet-add-erloc-btn"
            title="Add ExpressRoute MSEE Location"
          >
            + ER MSEE
          </button>

          <button
            type="button"
            className="aznet-btn"
            onClick={() => {
              createAndAssociateRouteTable()
              setActiveTab('editor')
            }}
            data-testid="aznet-add-rt-topbar-btn"
            title="Create Independent Route Table"
          >
            + Route Table
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

          <button
            type="button"
            className="aznet-btn"
            data-testid="aznet-share-url-btn"
            onClick={handleShareUrl}
            title="Encode current topology into URL #s=... and copy shareable link"
          >
            {shareCopied ? '✓ Link Copied' : '🔗 Share Link'}
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
            onContextMenu={(target) => setContextMenu(target)}
            onTogglePeeringEnabled={(peeringId, enabled) => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peeringId)
                if (p) p.enabled = enabled
              })
            }}
            onUpdatePeeringFlag={(peeringId, direction, flag, value) => {
              commitTopology((draft) => {
                const p = draft.vnetPeerings.find((x) => x.id === peeringId)
                if (p) p[direction][flag] = value
              })
            }}
            onUpdateRouteTable={(routeTableId, patch) => {
              commitTopology((draft) => {
                const rt = draft.udrTables.find((t) => t.id === routeTableId)
                if (!rt) return
                if (patch.disableBgpRoutePropagation !== undefined) {
                  rt.disableBgpRoutePropagation = patch.disableBgpRoutePropagation
                }
                if (patch.disablePeeringRoutePropagation !== undefined) {
                  rt.disablePeeringRoutePropagation = patch.disablePeeringRoutePropagation
                }
              })
            }}
            onAssociateSubnetRouteTable={(vnetId, subnetId, routeTableId) => {
              commitTopology((draft) => {
                const vnet = draft.vnets.find((v) => v.id === vnetId)
                const subnet = vnet?.subnets.find((s) => s.id === subnetId)
                if (subnet) {
                  subnet.routeTableId = routeTableId
                }
              })
            }}
            onOpenEditorForEntity={(entity) => {
              setSelected(entity)
              setActiveTab('editor')
            }}
          />

          {contextMenu && contextMenuSpec && (
            <TopologyContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              title={contextMenuSpec.title}
              actions={contextMenuSpec.actions}
              onClose={() => setContextMenu(null)}
            />
          )}
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
                          flexWrap: 'wrap',
                          gap: 6,
                          marginBottom: 8,
                          fontSize: 11.5,
                        }}
                      >
                        <span>
                          Route Table:{' '}
                          <strong>{inspectedSubnetTable.udrTableName ?? 'None (System + BGP)'}</strong>
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span
                            className={`aznet-badge ${
                              inspectedSubnetTable.bgpPropagationDisabled ? 'error' : 'active'
                            }`}
                          >
                            BGP Propagation:{' '}
                            {inspectedSubnetTable.bgpPropagationDisabled ? 'Disabled' : 'Enabled'}
                          </span>
                          {inspectedSubnetTable.peeringPropagationDisabled && (
                            <span
                              className="aznet-badge warning"
                              data-testid="aznet-peering-propagation-badge"
                            >
                              Peering Propagation: Disabled (Preview)
                            </span>
                          )}
                        </div>
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
                            const fwdFlow = singleFlowForCustomIp ?? pairAnalysis?.forward
                            const retFlow = singleFlowForCustomIp ? null : pairAnalysis?.reverse
                            const isFwdMatch = Boolean(
                              fwdFlow?.hops.some(
                                (h) =>
                                  h.subnetId === inspectedSubnetTable.subnetId &&
                                  h.matchedRoute?.id === route.id,
                              ),
                            )
                            const isRetMatch = Boolean(
                              retFlow?.hops.some(
                                (h) =>
                                  h.subnetId === inspectedSubnetTable.subnetId &&
                                  h.matchedRoute?.id === route.id,
                              ),
                            )
                            return (
                              <tr
                                key={route.id}
                                className={`aznet-route-row ${
                                  route.active ? '' : 'suppressed'
                                } ${isLpmWinner || isFwdMatch || isRetMatch ? 'lpm-winner' : ''}`}
                                data-testid={`aznet-route-row-${route.prefix}-${route.source}`}
                              >
                                <td>
                                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
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
                                    {isFwdMatch && (
                                      <span
                                        className="aznet-badge info"
                                        data-testid="aznet-route-trace-badge-fwd"
                                        title="Matched by active Forward Trace on this subnet"
                                      >
                                        FWD
                                      </span>
                                    )}
                                    {isRetMatch && (
                                      <span
                                        className="aznet-badge warning"
                                        data-testid="aznet-route-trace-badge-ret"
                                        title="Matched by active Return Trace on this subnet"
                                      >
                                        RET
                                      </span>
                                    )}
                                  </div>
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

                      {inspectedSubnetTable.suppressedPeeringRoutes.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 8,
                            borderRadius: 6,
                            background: '#fffbeb',
                            border: '1px solid #fde68a',
                            fontSize: 11.5,
                          }}
                          data-testid="aznet-suppressed-peering-banner"
                        >
                          <strong style={{ color: '#92400e' }}>
                            {inspectedSubnetTable.suppressedPeeringRoutes.length} VNetPeering
                            route(s) suppressed by disablePeeringRoutePropagation=true (Preview):
                          </strong>
                          <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                            {inspectedSubnetTable.suppressedPeeringRoutes.map((sr) => (
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
                                      : sf.source.kind === 'internet'
                                        ? 'internet:20.50.60.70'
                                        : sf.source.kind === 'site'
                                          ? `site:${sf.source.siteId}`
                                          : ''
                                  const dKey =
                                    sf.destination.kind === 'subnet'
                                      ? `subnet:${sf.destination.vnetId}:${sf.destination.subnetId}`
                                      : sf.destination.kind === 'internet'
                                        ? 'internet:20.50.60.70'
                                        : sf.destination.kind === 'site'
                                          ? `site:${sf.destination.siteId}`
                                          : ''
                                  setTraceSourceKey(sKey)
                                  setTraceDestKey(dKey)
                                  setCustomDestIp(sf.destinationIp === '8.8.8.8' ? '8.8.8.8' : '')
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

            {/* TAB 4: CONFIGURATION EDITOR (PEERING FLAGS, UDR TABLES, SUBNETS, ARS, SITES, VNET ELEMENTS) */}
            {activeTab === 'editor' && (
              <>
                {/* VNet Peerings & Connections Editor (#38, #42) */}
                <div className="aznet-card" data-testid="aznet-peering-editor">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginBottom: 8,
                    }}
                  >
                    <h3 style={{ margin: 0 }}>VNet Peerings & Hybrid Connections</h3>
                    {topology.vnets.length >= 2 && (
                      <button
                        type="button"
                        className="aznet-btn"
                        data-testid="aznet-create-peering-btn"
                        onClick={() => {
                          commitTopology((draft) => {
                            for (let i = 0; i < draft.vnets.length; i++) {
                              for (let j = i + 1; j < draft.vnets.length; j++) {
                                const a = draft.vnets[i]
                                const b = draft.vnets[j]
                                const exists = draft.vnetPeerings.some(
                                  (p) =>
                                    (p.vnetAId === a.id && p.vnetBId === b.id) ||
                                    (p.vnetAId === b.id && p.vnetBId === a.id),
                                )
                                if (!exists) {
                                  const newId = `peer-${a.id}-${b.id}-${Date.now().toString(36).slice(-3)}`
                                  draft.vnetPeerings.push({
                                    id: newId,
                                    name: `${a.name}-to-${b.name}`,
                                    vnetAId: a.id,
                                    vnetBId: b.id,
                                    enabled: true,
                                    aToB: {
                                      allowVirtualNetworkAccess: true,
                                      allowForwardedTraffic: true,
                                      allowGatewayTransit: a.role === 'hub' && a.gateways.length > 0,
                                      useRemoteGateways: b.role === 'hub' && b.gateways.length > 0,
                                    },
                                    bToA: {
                                      allowVirtualNetworkAccess: true,
                                      allowForwardedTraffic: true,
                                      allowGatewayTransit: b.role === 'hub' && b.gateways.length > 0,
                                      useRemoteGateways: a.role === 'hub' && a.gateways.length > 0,
                                    },
                                  })
                                  setSelected({ kind: 'peering', peeringId: newId })
                                  return
                                }
                              }
                            }
                          })
                        }}
                      >
                        + Add VNet Peering
                      </button>
                    )}
                  </div>

                  <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: '#475569' }}>
                    💡 Hover over, click, or right-click any VNet peering line on the diagram to
                    inspect and toggle directional flags directly on the line, or select a peering
                    below:
                  </p>

                  {topology.vnetPeerings.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      No VNet peerings configured. Right-click a VNet on the diagram and choose{' '}
                      <strong>Create VNet Peering to...</strong>
                    </div>
                  ) : (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          flexWrap: 'wrap',
                          marginBottom: 8,
                        }}
                      >
                        {topology.vnetPeerings.map((p) => {
                          const vA = topology.vnets.find((v) => v.id === p.vnetAId)
                          const vB = topology.vnets.find((v) => v.id === p.vnetBId)
                          const isFocused =
                            (selected.kind === 'peering' && selected.peeringId === p.id) ||
                            (selected.kind !== 'peering' &&
                              topology.vnetPeerings[0]?.id === p.id)
                          return (
                            <button
                              key={p.id}
                              type="button"
                              className={`aznet-btn ${isFocused ? 'aznet-btn-primary' : ''}`}
                              data-testid={`aznet-select-peering-${p.id}`}
                              onClick={() => setSelected({ kind: 'peering', peeringId: p.id })}
                              style={{ fontSize: 11.5, padding: '4px 8px' }}
                            >
                              {vA?.name ?? p.vnetAId} ↔ {vB?.name ?? p.vnetBId}
                              {!p.enabled ? ' (OFF)' : ''}
                            </button>
                          )
                        })}
                      </div>

                      {(() => {
                        const activePeering =
                          (selected.kind === 'peering'
                            ? topology.vnetPeerings.find((p) => p.id === selected.peeringId)
                            : undefined) ?? topology.vnetPeerings[0]
                        if (!activePeering) return null
                        const vA = topology.vnets.find((v) => v.id === activePeering.vnetAId)
                        const vB = topology.vnets.find((v) => v.id === activePeering.vnetBId)
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
                                      const p = draft.vnetPeerings.find(
                                        (x) => x.id === activePeering.id,
                                      )
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
                            key={activePeering.id}
                            data-testid={`aznet-peering-card-${activePeering.id}`}
                            style={{
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
                                flexWrap: 'wrap',
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <strong>
                                {activePeering.name} ({vA?.name} ↔ {vB?.name})
                              </strong>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <label className="aznet-checkbox-row">
                                  <input
                                    type="checkbox"
                                    checked={activePeering.enabled}
                                    onChange={(e) => {
                                      const checked = e.target.checked
                                      commitTopology((draft) => {
                                        const p = draft.vnetPeerings.find(
                                          (x) => x.id === activePeering.id,
                                        )
                                        if (p) p.enabled = checked
                                      })
                                    }}
                                  />
                                  <span>Peering Enabled</span>
                                </label>
                                <button
                                  type="button"
                                  className="aznet-btn"
                                  data-testid={`aznet-delete-peering-${activePeering.id}`}
                                  style={{
                                    padding: '2px 8px',
                                    fontSize: 11,
                                    color: '#b91c1c',
                                    borderColor: '#fecaca',
                                  }}
                                  onClick={() => {
                                    commitTopology((draft) => {
                                      draft.vnetPeerings = draft.vnetPeerings.filter(
                                        (p) => p.id !== activePeering.id,
                                      )
                                    })
                                  }}
                                >
                                  Delete Peering
                                </button>
                              </div>
                            </div>
                            <div className="aznet-field-grid">
                              {renderDirFlags(
                                `${vA?.name} → ${vB?.name}`,
                                'aToB',
                                activePeering.aToB,
                              )}
                              {renderDirFlags(
                                `${vB?.name} → ${vA?.name}`,
                                'bToA',
                                activePeering.bToA,
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )}
                </div>

                {/* VNets & VNet Elements Editor (#39, #42) */}
                <div className="aznet-card" data-testid="aznet-vnet-elements-editor">
                  <h3>VNets & VNet Elements (Firewall/NVA, Gateways, ARS, Subnets)</h3>
                  {topology.vnets.map((vnet) => {
                    const hasErGw = vnet.gateways.some((g) => g.kind === 'ExpressRoute')
                    const hasVpnGw = vnet.gateways.some((g) => g.kind === 'Vpn')
                    return (
                      <div
                        key={vnet.id}
                        data-testid={`aznet-vnet-config-${vnet.id}`}
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
                            flexWrap: 'wrap',
                            gap: 8,
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              className="aznet-input"
                              value={vnet.name}
                              aria-label={`VNet name ${vnet.name}`}
                              onChange={(e) => {
                                const val = e.target.value
                                commitTopology((draft) => {
                                  const v = draft.vnets.find((x) => x.id === vnet.id)
                                  if (v) v.name = val
                                })
                              }}
                              style={{ fontWeight: 700, width: 155 }}
                            />
                            <input
                              type="text"
                              className="aznet-input"
                              value={vnet.prefixes.join(', ')}
                              title="VNet CIDR prefixes (comma-separated)"
                              onChange={(e) => {
                                const raw = e.target.value
                                commitTopology((draft) => {
                                  const v = draft.vnets.find((x) => x.id === vnet.id)
                                  if (v) {
                                    const parsed = raw
                                      .split(',')
                                      .map((p) => p.trim())
                                      .filter(Boolean)
                                    if (parsed.length > 0) v.prefixes = parsed
                                  }
                                })
                              }}
                              style={{ width: 130, fontSize: 11.5 }}
                            />
                            <select
                              className="aznet-select"
                              value={vnet.role}
                              onChange={(e) => {
                                const role = e.target.value as 'hub' | 'spoke'
                                commitTopology((draft) => {
                                  const v = draft.vnets.find((x) => x.id === vnet.id)
                                  if (v) v.role = role
                                })
                              }}
                            >
                              <option value="hub">Hub VNet</option>
                              <option value="spoke">Spoke VNet</option>
                            </select>
                          </div>
                          <button
                            type="button"
                            className="aznet-btn"
                            data-testid={`aznet-delete-vnet-${vnet.id}`}
                            style={{
                              padding: '2px 8px',
                              fontSize: 11,
                              color: '#b91c1c',
                              borderColor: '#fecaca',
                            }}
                            onClick={() => deleteVnetById(vnet.id)}
                          >
                            Delete VNet
                          </button>
                        </div>

                        {/* Quick Add/Remove VNet Elements (#39) */}
                        <div
                          style={{
                            display: 'flex',
                            gap: 6,
                            flexWrap: 'wrap',
                            marginBottom: 8,
                            padding: '6px 8px',
                            background: '#f8fafc',
                            borderRadius: 6,
                            border: '1px solid #e2e8f0',
                          }}
                        >
                          <button
                            type="button"
                            className="aznet-btn"
                            data-testid={`aznet-add-fw-${vnet.id}`}
                            style={{ fontSize: 11, padding: '3px 8px' }}
                            onClick={() => addFirewallToVnet(vnet.id)}
                          >
                            + Firewall / NVA
                          </button>
                          {!hasErGw ? (
                            <button
                              type="button"
                              className="aznet-btn"
                              data-testid={`aznet-add-ergw-${vnet.id}`}
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => addGatewayToVnet(vnet.id, 'ExpressRoute')}
                            >
                              + ER Gateway
                            </button>
                          ) : (
                            vnet.gateways
                              .filter((g) => g.kind === 'ExpressRoute')
                              .map((gw) => (
                                <button
                                  key={gw.id}
                                  type="button"
                                  className="aznet-btn"
                                  data-testid={`aznet-remove-gw-${gw.id}`}
                                  style={{
                                    fontSize: 11,
                                    padding: '3px 8px',
                                    color: '#b91c1c',
                                    borderColor: '#fecaca',
                                  }}
                                  onClick={() => removeGatewayFromVnet(vnet.id, gw.id)}
                                >
                                  ✕ ER GW ({gw.name})
                                </button>
                              ))
                          )}
                          {!hasVpnGw ? (
                            <button
                              type="button"
                              className="aznet-btn"
                              data-testid={`aznet-add-vpngw-${vnet.id}`}
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => addGatewayToVnet(vnet.id, 'Vpn')}
                            >
                              + VPN Gateway
                            </button>
                          ) : (
                            vnet.gateways
                              .filter((g) => g.kind === 'Vpn')
                              .map((gw) => (
                                <button
                                  key={gw.id}
                                  type="button"
                                  className="aznet-btn"
                                  data-testid={`aznet-remove-gw-${gw.id}`}
                                  style={{
                                    fontSize: 11,
                                    padding: '3px 8px',
                                    color: '#b91c1c',
                                    borderColor: '#fecaca',
                                  }}
                                  onClick={() => removeGatewayFromVnet(vnet.id, gw.id)}
                                >
                                  ✕ VPN GW ({gw.name})
                                </button>
                              ))
                          )}
                          {!vnet.routeServer ? (
                            <button
                              type="button"
                              className="aznet-btn"
                              data-testid={`aznet-add-ars-${vnet.id}`}
                              style={{ fontSize: 11, padding: '3px 8px' }}
                              onClick={() => addRouteServerToVnet(vnet.id)}
                            >
                              + Route Server (ARS)
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="aznet-btn"
                              data-testid={`aznet-remove-ars-${vnet.id}`}
                              style={{
                                fontSize: 11,
                                padding: '3px 8px',
                                color: '#b91c1c',
                                borderColor: '#fecaca',
                              }}
                              onClick={() => removeRouteServerFromVnet(vnet.id)}
                            >
                              ✕ Remove ARS ({vnet.routeServer.name})
                            </button>
                          )}
                        </div>

                        {/* ARS settings if present */}
                        {vnet.routeServer && (
                          <div style={{ marginTop: 6, marginBottom: 6 }} className="aznet-field-grid">
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

                        {/* Appliances list */}
                        {vnet.appliances.map((app) => (
                          <div
                            key={app.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                              marginTop: 6,
                              fontSize: 12,
                            }}
                          >
                            <span>
                              🔥 {app.name} (<code>{app.privateIp}</code>)
                            </span>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <label className="aznet-checkbox-row">
                                <input
                                  type="checkbox"
                                  checked={app.enableIpForwarding}
                                  onChange={(e) => {
                                    const checked = e.target.checked
                                    commitTopology((draft) => {
                                      const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                      const targetA = targetV?.appliances.find(
                                        (a) => a.id === app.id,
                                      )
                                      if (targetA) targetA.enableIpForwarding = checked
                                    })
                                  }}
                                />
                                <span>NIC IP Forwarding</span>
                              </label>
                              <button
                                type="button"
                                className="aznet-btn"
                                data-testid={`aznet-remove-app-${app.id}`}
                                style={{
                                  fontSize: 11,
                                  padding: '2px 6px',
                                  color: '#b91c1c',
                                  borderColor: '#fecaca',
                                }}
                                onClick={() => removeApplianceFromVnet(vnet.id, app.id)}
                              >
                                ✕ Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>

                {/* Independent Route Tables Editor (#40, #41) */}
                <div className="aznet-card" data-testid="aznet-udr-editor">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginBottom: 8,
                    }}
                  >
                    <h3 style={{ margin: 0 }}>Independent Route Tables (UDRs)</h3>
                    <button
                      type="button"
                      className="aznet-btn aznet-btn-primary"
                      data-testid="aznet-create-rt-btn"
                      onClick={() => createAndAssociateRouteTable()}
                    >
                      + Create Route Table
                    </button>
                  </div>
                  <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: '#475569' }}>
                    Route tables are independent objects that can be associated with any subnet via
                    the subnet&apos;s right-click menu, hover badge, or the subnet association
                    selector below.
                  </p>
                  {topology.udrTables.map((rt) => {
                    const associatedSubnets = topology.vnets.flatMap((v) =>
                      v.subnets
                        .filter((s) => s.routeTableId === rt.id)
                        .map((s) => `${v.name}/${s.name}`),
                    )
                    return (
                      <div
                        key={rt.id}
                        data-testid={`aznet-rt-card-${rt.id}`}
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
                            flexWrap: 'wrap',
                            gap: 8,
                            marginBottom: 6,
                          }}
                        >
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              className="aznet-input"
                              value={rt.name}
                              aria-label={`Route Table name ${rt.name}`}
                              onChange={(e) => {
                                const val = e.target.value
                                commitTopology((draft) => {
                                  const target = draft.udrTables.find((t) => t.id === rt.id)
                                  if (target) target.name = val
                                })
                              }}
                              style={{ fontWeight: 700, width: 175 }}
                            />
                            <span style={{ fontSize: 11, color: '#64748b' }}>
                              {associatedSubnets.length > 0
                                ? `Associated: ${associatedSubnets.join(', ')}`
                                : 'Unassociated'}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
                              <span>Disable Gateway routes (GWroutes:OFF)</span>
                            </label>
                            <label className="aznet-checkbox-row">
                              <input
                                type="checkbox"
                                data-testid={`aznet-rt-disable-peering-${rt.id}`}
                                checked={Boolean(rt.disablePeeringRoutePropagation)}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  commitTopology((draft) => {
                                    const target = draft.udrTables.find((t) => t.id === rt.id)
                                    if (target) target.disablePeeringRoutePropagation = checked
                                  })
                                }}
                              />
                              <span>Disable Peering route propagation (Preview)</span>
                            </label>
                            <button
                              type="button"
                              className="aznet-btn"
                              data-testid={`aznet-delete-rt-${rt.id}`}
                              style={{
                                padding: '2px 8px',
                                fontSize: 11,
                                color: '#b91c1c',
                                borderColor: '#fecaca',
                              }}
                              onClick={() => {
                                commitTopology((draft) => {
                                  draft.udrTables = draft.udrTables.filter((t) => t.id !== rt.id)
                                  for (const v of draft.vnets) {
                                    for (const s of v.subnets) {
                                      if (s.routeTableId === rt.id) {
                                        s.routeTableId = undefined
                                      }
                                    }
                                  }
                                })
                              }}
                            >
                              Delete RT
                            </button>
                          </div>
                        </div>

                        <table className="aznet-route-table">
                          <thead>
                            <tr>
                              <th>On</th>
                              <th>Name</th>
                              <th>Prefix</th>
                              <th>Next Hop Type</th>
                              <th>Next Hop IP</th>
                              <th></th>
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
                                        const targetRt = draft.udrTables.find(
                                          (t) => t.id === rt.id,
                                        )
                                        const targetR = targetRt?.routes.find(
                                          (x) => x.id === r.id,
                                        )
                                        if (targetR) targetR.enabled = checked
                                      })
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="aznet-input"
                                    style={{ width: 110 }}
                                    value={r.name}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      commitTopology((draft) => {
                                        const targetRt = draft.udrTables.find(
                                          (t) => t.id === rt.id,
                                        )
                                        const targetR = targetRt?.routes.find(
                                          (x) => x.id === r.id,
                                        )
                                        if (targetR) targetR.name = val
                                      })
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="text"
                                    className="aznet-input"
                                    style={{ width: 105, fontFamily: 'monospace' }}
                                    value={r.prefix}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      commitTopology((draft) => {
                                        const targetRt = draft.udrTables.find(
                                          (t) => t.id === rt.id,
                                        )
                                        const targetR = targetRt?.routes.find(
                                          (x) => x.id === r.id,
                                        )
                                        if (targetR) targetR.prefix = val
                                      })
                                    }}
                                  />
                                </td>
                                <td>
                                  <select
                                    className="aznet-select"
                                    value={r.nextHopType}
                                    onChange={(e) => {
                                      const val = e.target.value as AzUdrNextHopType
                                      commitTopology((draft) => {
                                        const targetRt = draft.udrTables.find(
                                          (t) => t.id === rt.id,
                                        )
                                        const targetR = targetRt?.routes.find(
                                          (x) => x.id === r.id,
                                        )
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
                                          const targetRt = draft.udrTables.find(
                                            (t) => t.id === rt.id,
                                          )
                                          const targetR = targetRt?.routes.find(
                                            (x) => x.id === r.id,
                                          )
                                          if (targetR) targetR.nextHopIp = val
                                        })
                                      }}
                                    />
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="aznet-btn"
                                    style={{ padding: '1px 6px', fontSize: 10.5, color: '#b91c1c' }}
                                    onClick={() => {
                                      commitTopology((draft) => {
                                        const targetRt = draft.udrTables.find(
                                          (t) => t.id === rt.id,
                                        )
                                        if (targetRt) {
                                          targetRt.routes = targetRt.routes.filter(
                                            (x) => x.id !== r.id,
                                          )
                                        }
                                      })
                                    }}
                                  >
                                    ✕
                                  </button>
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
                    )
                  })}
                </div>

                {/* Subnet Route Table Associations & Outbound Policies (#41) */}
                <div className="aznet-card" data-testid="aznet-subnet-security-editor">
                  <h3>Subnets: Route Table Associations & Outbound Policies</h3>
                  {topology.vnets.map((vnet) => (
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
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <strong>{vnet.name}</strong>
                        <button
                          type="button"
                          className="aznet-btn"
                          style={{ fontSize: 11, padding: '2px 8px' }}
                          onClick={() => {
                            commitTopology((draft) => {
                              const v = draft.vnets.find((x) => x.id === vnet.id)
                              if (!v) return
                              const idx = v.subnets.length + 1
                              const baseOctets =
                                (v.prefixes[0] ?? '10.0.0.0/16').split('/')[0].split('.')
                              const prefixBase = `${baseOctets[0] ?? '10'}.${baseOctets[1] ?? '0'}`
                              v.subnets.push({
                                id: `${v.id}-snet-${idx}`,
                                name: `snet-app-${idx}`,
                                prefix: `${prefixBase}.${10 + idx}.0/24`,
                              })
                            })
                          }}
                        >
                          + Add Subnet
                        </button>
                      </div>
                      {vnet.subnets.map((subnet) => (
                        <div
                          key={subnet.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 8,
                            marginTop: 6,
                            fontSize: 12,
                          }}
                        >
                          <span>
                            {subnet.name} (<code>{subnet.prefix}</code>)
                          </span>
                          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                            <label
                              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5 }}
                            >
                              <span>Route Table:</span>
                              <select
                                className="aznet-select"
                                data-testid={`aznet-subnet-rt-select-${subnet.id}`}
                                value={subnet.routeTableId ?? ''}
                                onChange={(e) => {
                                  const nextVal = e.target.value
                                  if (nextVal === '__create__') {
                                    createAndAssociateRouteTable(vnet.id, subnet.id)
                                    return
                                  }
                                  commitTopology((draft) => {
                                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                    const targetS = targetV?.subnets.find(
                                      (s) => s.id === subnet.id,
                                    )
                                    if (targetS) {
                                      targetS.routeTableId = nextVal || undefined
                                    }
                                  })
                                }}
                              >
                                <option value="">None (No Route Table)</option>
                                {topology.udrTables.map((rt) => (
                                  <option key={rt.id} value={rt.id}>
                                    {rt.name}
                                  </option>
                                ))}
                                <option value="__create__">+ Create & Associate New RT...</option>
                              </select>
                            </label>
                            <label className="aznet-checkbox-row">
                              <input
                                type="checkbox"
                                data-testid={`aznet-subnet-outbound-${subnet.id}`}
                                checked={subnet.defaultOutboundAccess !== false}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  commitTopology((draft) => {
                                    const targetV = draft.vnets.find((v) => v.id === vnet.id)
                                    const targetS = targetV?.subnets.find(
                                      (s) => s.id === subnet.id,
                                    )
                                    if (targetS) targetS.defaultOutboundAccess = checked
                                  })
                                }}
                              />
                              <span>Default Outbound Access</span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* On-Premises Sites & ExpressRoute MSEE Locations Editor (#37, #42) */}
                <div className="aznet-card" data-testid="aznet-sites-er-editor">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <h3 style={{ margin: 0 }}>On-Premises Sites & ExpressRoute Locations</h3>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="aznet-btn"
                        data-testid="aznet-editor-add-site-btn"
                        onClick={() => addSiteNode()}
                      >
                        + Add Site
                      </button>
                      <button
                        type="button"
                        className="aznet-btn"
                        data-testid="aznet-editor-add-erloc-btn"
                        onClick={() => addErLocationNode()}
                      >
                        + Add ER MSEE
                      </button>
                    </div>
                  </div>

                  {topology.sites.map((site) => (
                    <div
                      key={site.id}
                      data-testid={`aznet-site-config-${site.id}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                        padding: 8,
                        marginBottom: 6,
                        background: '#ffffff',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          className="aznet-input"
                          value={site.name}
                          aria-label={`Site name ${site.name}`}
                          onChange={(e) => {
                            const val = e.target.value
                            commitTopology((draft) => {
                              const s = draft.sites.find((x) => x.id === site.id)
                              if (s) s.name = val
                            })
                          }}
                          style={{ fontWeight: 700, width: 145 }}
                        />
                        <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                          ASN:
                          <input
                            type="number"
                            className="aznet-input"
                            value={site.asn}
                            onChange={(e) => {
                              const asn = Number(e.target.value)
                              commitTopology((draft) => {
                                const s = draft.sites.find((x) => x.id === site.id)
                                if (s && Number.isFinite(asn) && asn > 0) s.asn = asn
                              })
                            }}
                            style={{ width: 75 }}
                          />
                        </label>
                        <input
                          type="text"
                          className="aznet-input"
                          value={site.prefixes.join(', ')}
                          title="Advertised prefixes (comma-separated)"
                          onChange={(e) => {
                            const raw = e.target.value
                            commitTopology((draft) => {
                              const s = draft.sites.find((x) => x.id === site.id)
                              if (s) {
                                const parsed = raw
                                  .split(',')
                                  .map((p) => p.trim())
                                  .filter(Boolean)
                                if (parsed.length > 0) s.prefixes = parsed
                              }
                            })
                          }}
                          style={{ width: 150, fontSize: 11.5 }}
                        />
                      </div>
                      <button
                        type="button"
                        className="aznet-btn"
                        data-testid={`aznet-delete-site-${site.id}`}
                        style={{
                          padding: '2px 8px',
                          fontSize: 11,
                          color: '#b91c1c',
                          borderColor: '#fecaca',
                        }}
                        onClick={() => deleteSiteById(site.id)}
                      >
                        Delete Site
                      </button>
                    </div>
                  ))}

                  {topology.erLocations.map((loc) => (
                    <div
                      key={loc.id}
                      data-testid={`aznet-erloc-config-${loc.id}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 8,
                        padding: 8,
                        marginBottom: 6,
                        background: '#f8fafc',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          className="aznet-input"
                          value={loc.name}
                          aria-label={`ER Location name ${loc.name}`}
                          onChange={(e) => {
                            const val = e.target.value
                            commitTopology((draft) => {
                              const l = draft.erLocations.find((x) => x.id === loc.id)
                              if (l) l.name = val
                            })
                          }}
                          style={{ fontWeight: 700, width: 165 }}
                        />
                        <label className="aznet-checkbox-row">
                          <input
                            type="checkbox"
                            checked={loc.globalReachEnabled}
                            onChange={(e) => {
                              const checked = e.target.checked
                              commitTopology((draft) => {
                                const l = draft.erLocations.find((x) => x.id === loc.id)
                                if (l) l.globalReachEnabled = checked
                              })
                            }}
                          />
                          <span>Global Reach Enabled</span>
                        </label>
                      </div>
                      <button
                        type="button"
                        className="aznet-btn"
                        data-testid={`aznet-delete-erloc-${loc.id}`}
                        style={{
                          padding: '2px 8px',
                          fontSize: 11,
                          color: '#b91c1c',
                          borderColor: '#fecaca',
                        }}
                        onClick={() => deleteErLocationById(loc.id)}
                      >
                        Delete ER MSEE
                      </button>
                    </div>
                  ))}
                </div>

                {/* Node Labels & Annotations */}
                <div className="aznet-card" data-testid="aznet-node-labels-editor">
                  <h3>Node Labels & Annotations</h3>
                  <p style={{ margin: '0 0 8px 0', fontSize: 12, color: '#475569' }}>
                    Optional text labels displayed as annotation badges below diagram nodes.
                  </p>
                  {[
                    ...topology.vnets.map((n) => ({ kind: 'vnet' as const, id: n.id, name: `VNet: ${n.name}`, label: n.label ?? '' })),
                    ...topology.vwanHubs.map((n) => ({ kind: 'vwanHub' as const, id: n.id, name: `vWAN Hub: ${n.name}`, label: n.label ?? '' })),
                    ...topology.erLocations.map((n) => ({ kind: 'erLocation' as const, id: n.id, name: `ER MSEE: ${n.name}`, label: n.label ?? '' })),
                    ...topology.sites.map((n) => ({ kind: 'site' as const, id: n.id, name: `Site: ${n.name}`, label: n.label ?? '' })),
                  ].map((item) => (
                    <div key={`${item.kind}-${item.id}`} className="aznet-toggle-row" style={{ gap: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 160 }}>{item.name}</span>
                      <input
                        type="text"
                        maxLength={120}
                        placeholder="Optional diagram label..."
                        data-testid={`aznet-node-label-input-${item.id}`}
                        value={item.label}
                        onChange={(e) => {
                          const nextVal = e.target.value
                          commitTopology((draft) => {
                            const cleaned = nextVal.trim() ? nextVal : undefined
                            if (item.kind === 'vnet') {
                              const target = draft.vnets.find((v) => v.id === item.id)
                              if (target) target.label = cleaned
                            } else if (item.kind === 'vwanHub') {
                              const target = draft.vwanHubs.find((h) => h.id === item.id)
                              if (target) target.label = cleaned
                            } else if (item.kind === 'erLocation') {
                              const target = draft.erLocations.find((l) => l.id === item.id)
                              if (target) target.label = cleaned
                            } else if (item.kind === 'site') {
                              const target = draft.sites.find((s) => s.id === item.id)
                              if (target) target.label = cleaned
                            }
                          })
                        }}
                        style={{
                          flex: 1,
                          padding: '4px 8px',
                          fontSize: 12,
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                        }}
                      />
                    </div>
                  ))}
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

      {sampleGalleryOpen && (
        <div
          data-testid="aznet-sample-gallery-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 24,
          }}
          onClick={() => setSampleGalleryOpen(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: 12,
              maxWidth: 1040,
              width: '100%',
              maxHeight: '86vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: '16px 20px',
                background: '#0f172a',
                color: '#f8fafc',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 17 }}>
                  📚 Azure VNet & Hybrid Sample Topologies Gallery ({visibleCatalogEntries.length})
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#94a3b8' }}>
                  Click any reference architecture or live-Azure validated scenario below to load it
                  immediately into the simulator.
                </p>
              </div>
              <button
                type="button"
                className="aznet-btn"
                data-testid="aznet-close-sample-gallery-btn"
                onClick={() => setSampleGalleryOpen(false)}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h3 style={{ margin: '0 0 10px 0', fontSize: 14, color: '#0f172a' }}>
                  Flagship Reference Topologies ({visibleCatalogEntries.filter((s) => s.category === 'flagship').length})
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(295px, 1fr))',
                    gap: 12,
                  }}
                >
                  {visibleCatalogEntries.filter((s) => s.category === 'flagship').map((entry) => {
                    const isCurrent = entry.id === sampleId
                    return (
                      <div
                        key={entry.id}
                        data-testid={`aznet-gallery-card-${entry.id}`}
                        style={{
                          border: isCurrent ? '2px solid #2563eb' : '1px solid #cbd5e1',
                          background: isCurrent ? '#eff6ff' : '#f8fafc',
                          borderRadius: 8,
                          padding: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 4 }}>
                            {entry.title}
                          </div>
                          <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: '#334155', lineHeight: 1.45 }}>
                            {entry.summary}
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {entry.badges.map((badge) => (
                              <span key={badge} className="aznet-badge info">
                                {badge}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <code style={{ fontSize: 10.5, color: '#64748b' }}>{entry.id}.json</code>
                          <button
                            type="button"
                            className="aznet-btn aznet-btn-primary"
                            data-testid={`aznet-gallery-load-${entry.id}`}
                            disabled={sampleLoadingId === entry.id}
                            onClick={() => loadSample(entry.id)}
                          >
                            {isCurrent ? '✓ Loaded (Reload)' : 'Load Topology'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <h3 style={{ margin: '0 0 10px 0', fontSize: 14, color: '#0f172a' }}>
                  Live-Azure Empirical Validation Scenarios (UC1–UC9)
                </h3>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(295px, 1fr))',
                    gap: 12,
                  }}
                >
                  {ALL_AZURE_NET_CATALOG.filter((s) => s.category === 'validation').map((entry) => {
                    const isCurrent = entry.id === sampleId
                    return (
                      <div
                        key={entry.id}
                        data-testid={`aznet-gallery-card-${entry.id}`}
                        style={{
                          border: isCurrent ? '2px solid #2563eb' : '1px solid #cbd5e1',
                          background: isCurrent ? '#eff6ff' : '#ffffff',
                          borderRadius: 8,
                          padding: 12,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', marginBottom: 4 }}>
                            {entry.title}
                          </div>
                          <p style={{ margin: '0 0 8px 0', fontSize: 11.5, color: '#334155', lineHeight: 1.45 }}>
                            {entry.summary}
                          </p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {entry.badges.map((badge) => (
                              <span key={badge} className="aznet-badge ok">
                                {badge}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <code style={{ fontSize: 10.5, color: '#64748b' }}>{entry.id}.json</code>
                          <button
                            type="button"
                            className="aznet-btn aznet-btn-primary"
                            data-testid={`aznet-gallery-load-${entry.id}`}
                            disabled={sampleLoadingId === entry.id}
                            onClick={() => loadSample(entry.id)}
                          >
                            {sampleLoadingId === entry.id
                              ? 'Loading…'
                              : isCurrent
                                ? '✓ Loaded (Reload)'
                                : 'Load Scenario'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
