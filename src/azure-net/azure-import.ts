import { azureObjectId } from '../azure-import'
import type { AzSimulationResult } from './engine'
import {
  validateAzNetTopology,
  validateAdvertisedGatewayPrefixes,
  type AzAppliance,
  type AzArsPreference,
  type AzNetTopology,
  type AzPrivateEndpoint,
  type AzPrivateEndpointPolicy,
  type AzSubnet,
  type AzUdrNextHopType,
  type AzUdrRoute,
  type AzUdrTable,
  type AzVNet,
  type AzVnetGateway,
  type AzVnetPeering,
  type AzVnetRole,
} from './model'

export interface AzCapturedEffectiveRoute {
  addressPrefix: string[]
  source: string
  state: string
  nextHopType: string
  nextHopIpAddress?: string[]
  name?: string
}

export interface AzCapturedNicObservation {
  nicName: string
  nicId: string
  vnetName: string
  subnetName: string
  privateIp?: string
  enableIPForwarding?: boolean
  effectiveRoutes: AzCapturedEffectiveRoute[]
}

export interface AzCapturedBgpPeerRoute {
  localAddress?: string
  network: string
  nextHop?: string
  sourcePeer?: string
  origin?: string
  asPath?: string
  weight?: number
}

export interface AzCapturedObservations {
  capturedAt: string
  collectorVersion: string
  resourceGroup: string
  subscriptionId?: string
  nicEffectiveRoutes: AzCapturedNicObservation[]
  arsLearnedRoutes?: Record<string, AzCapturedBgpPeerRoute[]>
  vngLearnedRoutes?: Record<string, AzCapturedBgpPeerRoute[]>
  arsAdvertisedRoutes?: Record<string, AzCapturedBgpPeerRoute[]>
  gatewayLearnedRoutes?: Record<string, AzCapturedBgpPeerRoute[]>
  gatewayAdvertisedRoutes?: Record<string, AzCapturedBgpPeerRoute[]>
}

export interface AzNetImportResult {
  topology: AzNetTopology
  warnings: string[]
  observations?: AzCapturedObservations
}

export interface AzSubnetRouteComparisonRow {
  prefix: string
  azureSource: string
  simSource: string
  azureNextHopType: string
  simNextHopType: string
  azureNextHopIp?: string
  simNextHopIp?: string
  azureState: string
  simState: string
  matched: boolean
  note?: string
}

export interface AzSubnetComparisonSummary {
  vnetName: string
  subnetName: string
  nicName: string
  proxyForGatewaySubnet: boolean
  matchedCount: number
  mismatchCount: number
  rows: AzSubnetRouteComparisonRow[]
}

export interface AzNetComparisonReport {
  resourceGroup: string
  capturedAt: string
  subnetComparisons: AzSubnetComparisonSummary[]
  totalMatchedRoutes: number
  totalMismatchedRoutes: number
}

function asObject(val: unknown, label: string): Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return val as Record<string, unknown>
}

function asArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : []
}

function asString(val: unknown, fallback = ''): string {
  return typeof val === 'string' ? val : fallback
}

function armResourceName(armId: string): string {
  const parts = armId.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? armId
}

function normalizeNextHopType(raw: string): AzUdrNextHopType {
  switch (raw) {
    case 'VirtualAppliance':
    case 'VirtualNetworkGateway':
    case 'VnetLocal':
    case 'Internet':
    case 'None':
      return raw
    default:
      return 'None'
  }
}

function inferVnetRole(
  vnetName: string,
  subnetNames: string[],
  hasGateways: boolean,
  hasArs: boolean,
): AzVnetRole {
  if (
    hasGateways ||
    hasArs ||
    subnetNames.includes('GatewaySubnet') ||
    subnetNames.includes('RouteServerSubnet') ||
    subnetNames.includes('AzureFirewallSubnet') ||
    /hub/i.test(vnetName)
  ) {
    return 'hub-vnet'
  }
  if (/transit/i.test(vnetName)) return 'transit-vnet'
  return 'spoke-vnet'
}

export function importAzNetCapture(input: unknown): AzNetImportResult {
  const parsedInput =
    typeof input === 'string' ? (JSON.parse(input.replace(/^\uFEFF/, '')) as unknown) : input
  const root = asObject(parsedInput, 'Azure Network capture')
  if (root.kind !== 'azure-network-capture' || root.version !== 2) {
    throw new Error(
      'Unsupported Azure Network capture format. Expected kind="azure-network-capture" and version=2.',
    )
  }

  const warnings: string[] = asArray(root.warnings).map((w) => String(w))
  const rgName = asString(root.resourceGroup, 'azure-rg')

  // 1. Parse Route Tables
  const udrTables: AzUdrTable[] = []
  const rtIdByArmId = new Map<string, string>()

  for (const rawRt of asArray(root.routeTables)) {
    const rt = asObject(rawRt, 'RouteTable')
    const armId = asString(rt.id)
    const name = asString(rt.name, armResourceName(armId))
    const id = armId ? azureObjectId('rt', armId) : `rt-${name.toLowerCase()}`
    if (armId) rtIdByArmId.set(armId.toLowerCase(), id)

    const props = rt.properties && typeof rt.properties === 'object' ? (rt.properties as Record<string, unknown>) : rt
    const disableBgp = Boolean(props.disableBgpRoutePropagation ?? rt.disableBgpRoutePropagation)
    const rawRoutes = asArray(props.routes ?? rt.routes)

    const routes: AzUdrRoute[] = rawRoutes.map((rawRoute, idx) => {
      const r = asObject(rawRoute, 'Route')
      const rProps = r.properties && typeof r.properties === 'object' ? (r.properties as Record<string, unknown>) : r
      const rName = asString(r.name, `route-${idx + 1}`)
      const prefix = asString(rProps.addressPrefix, '0.0.0.0/0')
      const nextHopType = normalizeNextHopType(asString(rProps.nextHopType, 'None'))
      const nextHopIp = asString(rProps.nextHopIpAddress) || undefined
      return {
        id: `${id}-r-${idx + 1}`,
        name: rName,
        prefix,
        nextHopType,
        nextHopIp,
        enabled: true,
      }
    })

    udrTables.push({
      id,
      name,
      disableBgpRoutePropagation: disableBgp,
      routes,
    })
  }

  // 2. Parse Private Endpoints by subnet ARM ID
  const pesBySubnetArmId = new Map<string, AzPrivateEndpoint[]>()
  for (const rawPe of asArray(root.privateEndpoints)) {
    const pe = asObject(rawPe, 'PrivateEndpoint')
    const peName = asString(pe.name, 'pe')
    const props = pe.properties && typeof pe.properties === 'object' ? (pe.properties as Record<string, unknown>) : pe
    const subRef = props.subnet && typeof props.subnet === 'object' ? (props.subnet as Record<string, unknown>) : undefined
    const subArmId = asString(subRef?.id ?? pe.subnetId).toLowerCase()
    if (!subArmId) continue

    const customConfigs = asArray(props.customDnsConfigs)
    const firstIp =
      asString(pe.privateIp) ||
      asString((customConfigs[0] as Record<string, unknown> | undefined)?.ipAddresses?.[0 as never]) ||
      '10.0.0.4'
    const serviceName = asString(pe.serviceName, 'privatelink.azure.net')
    const list = pesBySubnetArmId.get(subArmId) ?? []
    list.push({
      id: `pe-${peName.toLowerCase()}`,
      name: peName,
      ipAddress: firstIp,
      serviceName,
    })
    pesBySubnetArmId.set(subArmId, list)
  }

  // 3. Parse Gateways by VNet name / subnet ARM ID
  const gatewaysByVnetName = new Map<string, AzVnetGateway[]>()
  for (const rawGw of asArray(root.vnetGateways)) {
    const gw = asObject(rawGw, 'VirtualNetworkGateway')
    const name = asString(gw.name, 'vng')
    const props = gw.properties && typeof gw.properties === 'object' ? (gw.properties as Record<string, unknown>) : gw
    const gwType = asString(props.gatewayType ?? gw.gatewayType, 'Vpn')
    const kind: 'ExpressRoute' | 'Vpn' = gwType === 'ExpressRoute' ? 'ExpressRoute' : 'Vpn'
    const bgpSettings =
      props.bgpSettings && typeof props.bgpSettings === 'object'
        ? (props.bgpSettings as Record<string, unknown>)
        : undefined
    const asn = Number(bgpSettings?.asn ?? gw.asn ?? 65515)
    const bgpEnabled = Boolean(props.enableBgp ?? gw.enableBgp ?? true)
    const activeActive = Boolean(props.activeActive ?? gw.activeActive ?? false)

    // Determine parent VNet from ipConfigurations[0].subnet.id
    let vnetName = asString(gw.vnetName)
    if (!vnetName) {
      const ipConfigs = asArray(props.ipConfigurations)
      const firstCfg = ipConfigs[0] && typeof ipConfigs[0] === 'object' ? (ipConfigs[0] as Record<string, unknown>) : undefined
      const cfgProps =
        firstCfg?.properties && typeof firstCfg.properties === 'object'
          ? (firstCfg.properties as Record<string, unknown>)
          : firstCfg
      const subObj =
        cfgProps?.subnet && typeof cfgProps.subnet === 'object'
          ? (cfgProps.subnet as Record<string, unknown>)
          : undefined
      const subId = asString(subObj?.id)
      const match = /\/virtualNetworks\/([^/]+)\/subnets\//i.exec(subId)
      if (match) vnetName = match[1]
    }
    if (!vnetName) continue
    const list = gatewaysByVnetName.get(vnetName.toLowerCase()) ?? []
    list.push({
      id: `vng-${name.toLowerCase()}`,
      name,
      kind,
      asn,
      bgpEnabled,
      activeActive,
      enabled: true,
    })
    gatewaysByVnetName.set(vnetName.toLowerCase(), list)
  }

  // 4. Parse Route Servers by VNet name
  interface ParsedArs {
    name: string
    branchToBranchTraffic: boolean
    hubRoutingPreference: AzArsPreference
    peers: Array<{ name: string; peerIp: string; peerAsn: number }>
  }
  const arsByVnetName = new Map<string, ParsedArs>()
  for (const rawArs of asArray(root.routeServers)) {
    const ars = asObject(rawArs, 'RouteServer')
    const name = asString(ars.name, 'ars')
    const props = ars.properties && typeof ars.properties === 'object' ? (ars.properties as Record<string, unknown>) : ars
    const branchToBranchTraffic = Boolean(
      props.allowBranchToBranchTraffic ?? ars.allowBranchToBranchTraffic ?? true,
    )
    const rawPref = asString(props.hubRoutingPreference ?? ars.hubRoutingPreference, 'ExpressRoute')
    const hubRoutingPreference: AzArsPreference =
      rawPref === 'VpnGateway' || rawPref === 'ASPath' ? rawPref : 'ExpressRoute'

    let vnetName = asString(ars.vnetName)
    if (!vnetName) {
      const subId = asString(ars.subnetId)
      const match = /\/virtualNetworks\/([^/]+)\/subnets\//i.exec(subId)
      if (match) vnetName = match[1]
    }
    if (!vnetName) {
      // Fallback: inspect VNets for a RouteServerSubnet whose ipConfigurations reference this ARS
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const arsRegex = new RegExp(`/virtualHubs/${escapedName}/`, 'i')
      let fallbackRsVnetName = ''
      for (const rawVnet of asArray(root.vnets)) {
        const v = asObject(rawVnet, 'VirtualNetwork')
        const vName = asString(v.name, armResourceName(asString(v.id)))
        const vProps = v.properties && typeof v.properties === 'object' ? (v.properties as Record<string, unknown>) : v
        for (const rawSub of asArray(vProps.subnets ?? v.subnets)) {
          const s = asObject(rawSub, 'Subnet')
          if (asString(s.name) === 'RouteServerSubnet') {
            if (!fallbackRsVnetName) fallbackRsVnetName = vName
            const sProps = s.properties && typeof s.properties === 'object' ? (s.properties as Record<string, unknown>) : s
            for (const rawIpc of asArray(sProps.ipConfigurations ?? s.ipConfigurations)) {
              const ipc = asObject(rawIpc, 'IpConfig')
              if (arsRegex.test(asString(ipc.id))) {
                vnetName = vName
                break
              }
            }
          }
          if (vnetName) break
        }
        if (vnetName) break
      }
      if (!vnetName && fallbackRsVnetName) {
        vnetName = fallbackRsVnetName
      }
    }
    const peers = asArray(ars.peerings ?? props.bgpConnections).map((rawPeer) => {
      const p = asObject(rawPeer, 'ArsPeer')
      const pProps = p.properties && typeof p.properties === 'object' ? (p.properties as Record<string, unknown>) : p
      return {
        name: asString(p.name, 'nva-peer'),
        peerIp: asString(pProps.peerIp ?? p.peerIp),
        peerAsn: Number(pProps.peerAsn ?? p.peerAsn ?? 65010),
      }
    })
    if (vnetName) {
      arsByVnetName.set(vnetName.toLowerCase(), {
        name,
        branchToBranchTraffic,
        hubRoutingPreference,
        peers,
      })
    }
  }

  // 5. Parse NICs to discover forwarding NVA appliances and Private Endpoint IPs
  const nics = asArray(root.networkInterfaces).map((rawNic) => asObject(rawNic, 'NetworkInterface'))

  // 6. Parse VNets, Subnets, and Peerings
  const vnets: AzVNet[] = []
  const vnetIdByArmId = new Map<string, string>()
  const vnetIdByName = new Map<string, string>()
  const subnetIdByArmId = new Map<string, string>()
  const rawPeeringsToResolve: Array<{
    sourceVnetId: string
    sourceVnetName: string
    rawPeering: Record<string, unknown>
  }> = []

  for (const rawVnet of asArray(root.vnets)) {
    const v = asObject(rawVnet, 'VirtualNetwork')
    const armId = asString(v.id)
    const name = asString(v.name, armResourceName(armId))
    const id = armId ? azureObjectId('vnet', armId) : `vnet-${name.toLowerCase()}`
    if (armId) vnetIdByArmId.set(armId.toLowerCase(), id)
    vnetIdByName.set(name.toLowerCase(), id)

    const props = v.properties && typeof v.properties === 'object' ? (v.properties as Record<string, unknown>) : v
    const addrSpace =
      props.addressSpace && typeof props.addressSpace === 'object'
        ? (props.addressSpace as Record<string, unknown>)
        : undefined
    const prefixes = asArray(addrSpace?.addressPrefixes ?? v.addressPrefixes).map((p) => String(p))

    const rawSubnets = asArray(props.subnets ?? v.subnets)
    const subnets: AzSubnet[] = rawSubnets.map((rawSub) => {
      const s = asObject(rawSub, 'Subnet')
      const sArmId = asString(s.id)
      const sName = asString(s.name, armResourceName(sArmId))
      const sId = sArmId ? azureObjectId('sub', sArmId) : `${id}-sub-${sName.toLowerCase()}`
      if (sArmId) subnetIdByArmId.set(sArmId.toLowerCase(), sId)

      const sProps = s.properties && typeof s.properties === 'object' ? (s.properties as Record<string, unknown>) : s
      const prefix =
        asString(sProps.addressPrefix) ||
        asString(asArray(sProps.addressPrefixes)[0]) ||
        '10.0.0.0/24'
      const rtRef =
        sProps.routeTable && typeof sProps.routeTable === 'object'
          ? (sProps.routeTable as Record<string, unknown>)
          : undefined
      const rtArmId = asString(rtRef?.id ?? s.routeTableId).toLowerCase()
      const routeTableId = rtArmId ? rtIdByArmId.get(rtArmId) : undefined

      const rawPePolicy = asString(
        sProps.privateEndpointNetworkPolicies ?? s.privateEndpointNetworkPolicies,
      )
      const privateEndpointNetworkPolicies: AzPrivateEndpointPolicy | undefined =
        rawPePolicy === 'Enabled' || rawPePolicy === 'RouteTableEnabled' || rawPePolicy === 'Disabled'
          ? rawPePolicy
          : undefined

      const pes = sArmId ? pesBySubnetArmId.get(sArmId.toLowerCase()) : undefined

      return {
        id: sId,
        name: sName,
        prefix,
        ...(routeTableId ? { routeTableId } : {}),
        ...(privateEndpointNetworkPolicies ? { privateEndpointNetworkPolicies } : {}),
        ...(pes && pes.length > 0 ? { privateEndpoints: pes } : {}),
      }
    })

    const gateways = gatewaysByVnetName.get(name.toLowerCase()) ?? []
    const parsedArs = arsByVnetName.get(name.toLowerCase())
    const appliances: AzAppliance[] = []
    const peerApplianceIds: string[] = []

    // Reconstruct NVA appliances from NICs with enableIPForwarding=true or ARS BGP peers
    for (const nic of nics) {
      const nicProps =
        nic.properties && typeof nic.properties === 'object'
          ? (nic.properties as Record<string, unknown>)
          : nic
      const ipForwarding = Boolean(nicProps.enableIPForwarding ?? nic.enableIPForwarding)
      const ipConfigs = asArray(nicProps.ipConfigurations ?? nic.ipConfigurations)
      const firstCfg =
        ipConfigs[0] && typeof ipConfigs[0] === 'object'
          ? (ipConfigs[0] as Record<string, unknown>)
          : undefined
      const cfgProps =
        firstCfg?.properties && typeof firstCfg.properties === 'object'
          ? (firstCfg.properties as Record<string, unknown>)
          : firstCfg
      const privateIp = asString(cfgProps?.privateIPAddress ?? nic.privateIp)
      const subObj =
        cfgProps?.subnet && typeof cfgProps.subnet === 'object'
          ? (cfgProps.subnet as Record<string, unknown>)
          : undefined
      const subArmId = asString(subObj?.id ?? nic.subnetId).toLowerCase()
      const matchedSubnetId = subnetIdByArmId.get(subArmId)
      const belongsToVnet = subnets.some((s) => s.id === matchedSubnetId)
      if (!belongsToVnet || !matchedSubnetId || !privateIp) continue

      const arsPeer = parsedArs?.peers.find((p) => p.peerIp === privateIp)
      if (!ipForwarding && !arsPeer) continue

      const nicName = asString(nic.name, 'nva')
      const appId = `app-${nicName.toLowerCase()}`
      if (arsPeer) peerApplianceIds.push(appId)
      appliances.push({
        id: appId,
        name: nicName,
        kind: 'nva-vm',
        subnetId: matchedSubnetId,
        privateIp,
        ...(arsPeer ? { asn: arsPeer.peerAsn, bgpEnabled: true } : {}),
        enableIpForwarding: ipForwarding,
        inspectsTraffic: true,
        advertisedPrefixes: [],
        staticRoutes: [],
      })
    }

    const arsSubnet = subnets.find((s) => s.name === 'RouteServerSubnet')
    const routeServer = parsedArs
      ? {
          id: `ars-${parsedArs.name.toLowerCase()}`,
          name: parsedArs.name,
          subnetId: arsSubnet?.id,
          enabled: true,
          branchToBranchTraffic: parsedArs.branchToBranchTraffic,
          hubRoutingPreference: parsedArs.hubRoutingPreference,
          peerApplianceIds,
        }
      : undefined

    const role = inferVnetRole(
      name,
      subnets.map((s) => s.name),
      gateways.length > 0,
      Boolean(routeServer),
    )

    const rawSummaries = props.summarizedGatewayPrefixes ?? v.summarizedGatewayPrefixes
    const summaries = rawSummaries === undefined ? undefined : asObject(rawSummaries, 'summarizedGatewayPrefixes').addressPrefixes
    if (rawSummaries !== undefined && (!Array.isArray(summaries) || summaries.some((prefix) => typeof prefix !== 'string'))) {
      throw new Error(`VNet "${name}" summarizedGatewayPrefixes.addressPrefixes must be an array of IPv4 CIDR strings.`)
    }
    const summaryErrors = validateAdvertisedGatewayPrefixes(summaries)
    if (summaryErrors.length) throw new Error(`VNet "${name}" ${summaryErrors.join(' ')}`)
    vnets.push({
      id,
      name,
      region: asString(v.location, 'swedencentral'),
      prefixes: prefixes.length > 0 ? prefixes : ['10.0.0.0/16'],
      role,
      subnets,
      gateways,
      ...(routeServer ? { routeServer } : {}),
      appliances,
      ...(summaries !== undefined ? { summarizedGatewayPrefixes: summaries as string[] } : {}),
    })

    for (const rawPeer of asArray(props.virtualNetworkPeerings ?? v.virtualNetworkPeerings)) {
      rawPeeringsToResolve.push({
        sourceVnetId: id,
        sourceVnetName: name,
        rawPeering: asObject(rawPeer, 'VNetPeering'),
      })
    }
  }

  // Consolidate bidirectional VNet peerings into AzVnetPeering pairs
  const vnetPeerings: AzVnetPeering[] = []
  const pairMap = new Map<string, AzVnetPeering>()

  for (const item of rawPeeringsToResolve) {
    const p = item.rawPeering
    const props = p.properties && typeof p.properties === 'object' ? (p.properties as Record<string, unknown>) : p
    const remoteRef =
      props.remoteVirtualNetwork && typeof props.remoteVirtualNetwork === 'object'
        ? (props.remoteVirtualNetwork as Record<string, unknown>)
        : undefined
    const remoteArmId = asString(remoteRef?.id ?? p.remoteVirtualNetworkId).toLowerCase()
    const targetVnetId = vnetIdByArmId.get(remoteArmId)
    if (!targetVnetId) continue

    const [firstId, secondId] =
      item.sourceVnetId < targetVnetId
        ? [item.sourceVnetId, targetVnetId]
        : [targetVnetId, item.sourceVnetId]
    const pairKey = `${firstId}::${secondId}`
    const flags = {
      allowVirtualNetworkAccess: Boolean(props.allowVirtualNetworkAccess ?? true),
      allowForwardedTraffic: Boolean(props.allowForwardedTraffic ?? false),
      allowGatewayTransit: Boolean(props.allowGatewayTransit ?? false),
      useRemoteGateways: Boolean(props.useRemoteGateways ?? false),
    }

    const existing = pairMap.get(pairKey)
    if (!existing) {
      const created: AzVnetPeering = {
        id: `peer-${firstId}-${secondId}`,
        name: asString(p.name, `peer-${item.sourceVnetName}`),
        vnetAId: firstId,
        vnetBId: secondId,
        enabled: true,
        aToB: item.sourceVnetId === firstId ? flags : {
          allowVirtualNetworkAccess: true,
          allowForwardedTraffic: false,
          allowGatewayTransit: false,
          useRemoteGateways: false,
        },
        bToA: item.sourceVnetId === secondId ? flags : {
          allowVirtualNetworkAccess: true,
          allowForwardedTraffic: false,
          allowGatewayTransit: false,
          useRemoteGateways: false,
        },
      }
      pairMap.set(pairKey, created)
      vnetPeerings.push(created)
    } else {
      if (item.sourceVnetId === existing.vnetAId) {
        existing.aToB = flags
      } else {
        existing.bToA = flags
      }
    }
  }

  // Parse optional observations (NIC effective route tables & ARS/VNG BGP routes)
  const arsLearned =
    root.arsLearnedRoutes && typeof root.arsLearnedRoutes === 'object'
      ? (root.arsLearnedRoutes as Record<string, AzCapturedBgpPeerRoute[]>)
      : undefined
  const vngLearned =
    root.vngLearnedRoutes && typeof root.vngLearnedRoutes === 'object'
      ? (root.vngLearnedRoutes as Record<string, AzCapturedBgpPeerRoute[]>)
      : undefined

  if (arsLearned) {
    for (const vnet of vnets) {
      for (const app of vnet.appliances) {
        const learnedFromApp = Object.values(arsLearned)
          .flat()
          .filter((r) => r.sourcePeer === app.privateIp && r.network)
          .map((r) => r.network)
        if (learnedFromApp.length > 0) {
          app.advertisedPrefixes = Array.from(new Set(learnedFromApp))
        }
      }
    }
  }

  // Reconstruct on-premises sites & VPN connections from localNetworkGateways and vpnConnections
  const sites: AzNetTopology['sites'] = []
  const siteIdByArmId = new Map<string, string>()
  for (const rawLgw of asArray(root.localNetworkGateways)) {
    const lgw = asObject(rawLgw, 'LocalNetworkGateway')
    const armId = asString(lgw.id)
    const name = asString(lgw.name, armResourceName(armId) || 'site-branch')
    const props = lgw.properties && typeof lgw.properties === 'object' ? (lgw.properties as Record<string, unknown>) : lgw
    const bgp =
      props.bgpSettings && typeof props.bgpSettings === 'object'
        ? (props.bgpSettings as Record<string, unknown>)
        : undefined
    const asn = Number(bgp?.asn ?? lgw.asn ?? 65100)
    const peerIp = asString(bgp?.bgpPeeringAddress ?? lgw.bgpPeeringAddress)
    const addrSpace =
      props.localNetworkAddressSpace && typeof props.localNetworkAddressSpace === 'object'
        ? (props.localNetworkAddressSpace as Record<string, unknown>)
        : undefined
    const staticPrefixes = asArray(addrSpace?.addressPrefixes ?? lgw.addressPrefixes)
      .map((p) => String(p))
      .filter((p) => !p.endsWith('/32') || p !== `${peerIp}/32`)

    const learnedPrefixes = vngLearned
      ? Object.values(vngLearned)
          .flat()
          .filter(
            (r) =>
              r.network &&
              ((peerIp && r.sourcePeer === peerIp) ||
                (asn && String(r.asPath ?? '').split(/[\s_-]+/).includes(String(asn)))),
          )
          .map((r) => r.network)
      : []

    const mergedPrefixes = Array.from(new Set([...staticPrefixes, ...learnedPrefixes]))
    const siteId = `site-${name.toLowerCase()}`
    if (armId) siteIdByArmId.set(armId.toLowerCase(), siteId)
    sites.push({
      id: siteId,
      name,
      asn,
      prefixes: mergedPrefixes.length > 0 ? mergedPrefixes : ['10.250.0.0/16'],
    })
  }

  const vpnConnections: AzNetTopology['vpnConnections'] = []
  const vngIdByArmId = new Map<string, string>()
  for (const rawGw of asArray(root.vnetGateways)) {
    const gw = asObject(rawGw, 'VirtualNetworkGateway')
    const armId = asString(gw.id)
    const name = asString(gw.name, armResourceName(armId))
    if (armId && name) {
      vngIdByArmId.set(armId.toLowerCase(), `vng-${name.toLowerCase()}`)
    }
  }

  for (const rawConn of asArray(root.vpnConnections)) {
    const conn = asObject(rawConn, 'VpnConnection')
    const name = asString(conn.name, 'vpn-conn')
    const props = conn.properties && typeof conn.properties === 'object' ? (conn.properties as Record<string, unknown>) : conn
    const vng1 =
      props.virtualNetworkGateway1 && typeof props.virtualNetworkGateway1 === 'object'
        ? (props.virtualNetworkGateway1 as Record<string, unknown>)
        : undefined
    const lgw2 =
      props.localNetworkGateway2 && typeof props.localNetworkGateway2 === 'object'
        ? (props.localNetworkGateway2 as Record<string, unknown>)
        : undefined
    const vngId = vngIdByArmId.get(asString(vng1?.id).toLowerCase())
    const siteId = siteIdByArmId.get(asString(lgw2?.id).toLowerCase())
    if (!vngId || !siteId) continue
    vpnConnections.push({
      id: `vpn-${name.toLowerCase()}`,
      name,
      siteId,
      targetKind: 'vnet-gateway',
      targetId: vngId,
      bgpEnabled: Boolean(props.enableBgp ?? conn.enableBgp ?? true),
      enabled: true,
    })
  }

  let observations: AzCapturedObservations | undefined
  if (Array.isArray(root.nicEffectiveRoutes)) {
    const nicEffectiveRoutes: AzCapturedNicObservation[] = asArray(root.nicEffectiveRoutes).map(
      (rawObs) => {
        const o = asObject(rawObs, 'NicObservation')
        return {
          nicName: asString(o.nicName),
          nicId: asString(o.nicId),
          vnetName: asString(o.vnetName),
          subnetName: asString(o.subnetName),
          privateIp: asString(o.privateIp) || undefined,
          enableIPForwarding: Boolean(o.enableIPForwarding),
          effectiveRoutes: asArray(o.effectiveRoutes).map((rawEr) => {
            const er = asObject(rawEr, 'EffectiveRoute')
            return {
              addressPrefix: asArray(er.addressPrefix).map((x) => String(x)),
              source: asString(er.source),
              state: asString(er.state, 'Active'),
              nextHopType: asString(er.nextHopType),
              nextHopIpAddress: asArray(er.nextHopIpAddress).map((x) => String(x)),
              name: asString(er.name) || undefined,
            }
          }),
        }
      },
    )

    observations = {
      capturedAt: asString(root.capturedAt, new Date().toISOString()),
      collectorVersion: asString(root.collectorVersion, '2026.11.03.1'),
      resourceGroup: rgName,
      subscriptionId: asString(root.subscriptionId) || undefined,
      nicEffectiveRoutes,
      arsLearnedRoutes: arsLearned,
      vngLearnedRoutes: vngLearned,
    }
  }

  const topology: AzNetTopology = {
    version: 2,
    kind: 'azure-network-topology',
    name: `Imported Azure RG · ${rgName}`,
    subtitle: `Captured from resource group '${rgName}' (${vnets.length} VNets, ${udrTables.length} Route Tables)`,
    vnets,
    vnetPeerings,
    udrTables,
    vwanHubs: [],
    erLocations: [],
    erLinks: [],
    sites,
    vpnConnections,
    siteLinks: [],
  }

  const validationIssues = validateAzNetTopology(topology)
  warnings.push(...validationIssues)

  return { topology, warnings, observations }
}

function normalizeAzureSourceToSim(azureSource: string): string {
  if (azureSource === 'Default') return 'System'
  return azureSource
}

function isIgnorableAzureSystemPurposeRoute(
  prefix: string,
  nextHopType: string,
  source: string,
  siteBgpPeerHostPrefixes: Set<string>,
): boolean {
  if (prefix === '0.0.0.0/0') return false
  // Azure SDN injects ~85 internal fabric/CGNAT/loopback/DoD blackhole routes with source="Default" and nextHopType="None"
  if (source === 'Default' && nextHopType === 'None') {
    return true
  }
  // When S2S VPN BGP is used, LocalNetworkGateway requires a /32 bgpPeeringAddress in localNetworkAddressSpace
  if (source === 'VirtualNetworkGateway' && siteBgpPeerHostPrefixes.has(prefix)) {
    return true
  }
  // Azure injects internal RFC1918/CGNAT/Multicast/Internet blackhole routes (100.64.0.0/10, 198.18.0.0/15, etc.)
  if (nextHopType === 'None' || nextHopType === 'Internet') {
    const internalBlockPrefixes = new Set([
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '100.64.0.0/10',
      '169.254.0.0/16',
      '198.18.0.0/15',
      '224.0.0.0/4',
      '255.255.255.255/32',
    ])
    if (internalBlockPrefixes.has(prefix)) return true
  }
  return false
}

export function compareAzNetWithObservations(
  topology: AzNetTopology,
  simulation: AzSimulationResult,
  observations: AzCapturedObservations,
): AzNetComparisonReport {
  const subnetComparisons: AzSubnetComparisonSummary[] = []
  let totalMatchedRoutes = 0
  let totalMismatchedRoutes = 0

  // Collect BGP peer /32 host prefixes from VNG learned routes (origin="Network", /32) or site tunnel endpoints
  const siteBgpPeerHostPrefixes = new Set<string>()
  if (observations.vngLearnedRoutes) {
    for (const routes of Object.values(observations.vngLearnedRoutes)) {
      for (const r of routes) {
        if (r.network?.endsWith('/32')) {
          const peerIp = r.network.slice(0, -3)
          const isBgpSourcePeer = Object.values(observations.vngLearnedRoutes)
            .flat()
            .some((other) => other.origin === 'EBgp' && other.sourcePeer === peerIp)
          if (isBgpSourcePeer) {
            siteBgpPeerHostPrefixes.add(r.network)
          }
        }
      }
    }
  }

  for (const nicObs of observations.nicEffectiveRoutes) {
    const vnet = topology.vnets.find(
      (v) => v.name.toLowerCase() === nicObs.vnetName.toLowerCase(),
    )
    if (!vnet) {
      const localPrefixes = nicObs.effectiveRoutes
        .filter((r) => r.source === 'Default' && r.nextHopType === 'VnetLocal')
        .flatMap((r) => r.addressPrefix)
      const representedAsSite = topology.sites.some((site) =>
        site.prefixes.some((sp) => localPrefixes.includes(sp)),
      )
      if (representedAsSite) {
        continue
      }
    }
    const subnet = vnet?.subnets.find(
      (s) => s.name.toLowerCase() === nicObs.subnetName.toLowerCase(),
    )
    const gwSubnet = vnet?.subnets.find((s) => s.name === 'GatewaySubnet')
    const proxyForGatewaySubnet = Boolean(
      subnet &&
        gwSubnet &&
        subnet.name !== 'GatewaySubnet' &&
        subnet.routeTableId &&
        subnet.routeTableId === gwSubnet.routeTableId,
    )

    const simTable = subnet ? simulation.subnetTables[subnet.id] : undefined
    const simRoutes = simTable?.routes ?? []
    const matchedSimRouteIds = new Set<string>()
    const rows: AzSubnetRouteComparisonRow[] = []

    const isArsRouteMatch = (
      sr: (typeof simRoutes)[number],
      azRoute: (typeof nicObs.effectiveRoutes)[number],
      azNextHopIp?: string,
    ) =>
      sr.source === 'RouteServer' &&
      sr.nextHopType === 'VirtualAppliance' &&
      azRoute.source === 'VirtualNetworkGateway' &&
      azRoute.nextHopType === 'VirtualNetworkGateway' &&
      Boolean(azNextHopIp && sr.nextHopIp === azNextHopIp)

    // Empirical finding (UC8): when a User-Defined Route specifies NextHopType=VirtualNetworkGateway
    // for a VNet/non-gateway prefix that no static VNG connection owns, Azure SDN compiles the UDR
    // into source="User", nextHopType="None" (blackhole) in the NIC effective route table.
    const isUdrUnresolvedVngMatch = (
      sr: (typeof simRoutes)[number],
      azRoute: (typeof nicObs.effectiveRoutes)[number],
    ) =>
      sr.source === 'User' &&
      sr.nextHopType === 'VirtualNetworkGateway' &&
      azRoute.source === 'User' &&
      azRoute.nextHopType === 'None'

    for (const azRoute of nicObs.effectiveRoutes) {
      for (const prefix of azRoute.addressPrefix) {
        if (
          isIgnorableAzureSystemPurposeRoute(
            prefix,
            azRoute.nextHopType,
            azRoute.source,
            siteBgpPeerHostPrefixes,
          )
        ) {
          continue
        }
        const normalizedAzSource = normalizeAzureSourceToSim(azRoute.source)
        const azNextHopIp = azRoute.nextHopIpAddress?.[0]
        const candidates = simRoutes.filter((sr) => sr.prefix === prefix)
        const simMatch =
          // 1. Exact source + nextHopType (or ARS/UDR-VNG equivalence) + nextHopIp, preferring unmatched
          candidates.find(
            (sr) =>
              !matchedSimRouteIds.has(sr.id) &&
              ((sr.source === normalizedAzSource &&
                sr.nextHopType.toLowerCase() === azRoute.nextHopType.toLowerCase()) ||
                isArsRouteMatch(sr, azRoute, azNextHopIp) ||
                isUdrUnresolvedVngMatch(sr, azRoute)) &&
              (!azNextHopIp || !sr.nextHopIp || sr.nextHopIp === azNextHopIp),
          ) ??
          // 2. Same nextHopType (or ARS/UDR-VNG equivalence) + source, even if already matched
          candidates.find(
            (sr) =>
              (sr.source === normalizedAzSource &&
                sr.nextHopType.toLowerCase() === azRoute.nextHopType.toLowerCase()) ||
              isArsRouteMatch(sr, azRoute, azNextHopIp) ||
              isUdrUnresolvedVngMatch(sr, azRoute),
          ) ??
          // 3. Same nextHopType + nextHopIp
          candidates.find(
            (sr) =>
              !matchedSimRouteIds.has(sr.id) &&
              sr.nextHopType.toLowerCase() === azRoute.nextHopType.toLowerCase() &&
              (!azNextHopIp || !sr.nextHopIp || sr.nextHopIp === azNextHopIp),
          ) ??
          // 4. Fallback to any unmatched candidate for the same prefix, or first candidate
          candidates.find((sr) => !matchedSimRouteIds.has(sr.id)) ??
          candidates[0]

        if (simMatch) {
          matchedSimRouteIds.add(simMatch.id)
        }

        const simState = simMatch ? (simMatch.active ? 'Active' : 'Invalid') : 'Invalid'
        // Azure SDN programs ARS-learned NVA routes into NIC effective routes with source="VirtualNetworkGateway"
        // and nextHopType="VirtualNetworkGateway" pointing to the NVA's private IP address.
        const isArsEquivalent = Boolean(
          simMatch && isArsRouteMatch(simMatch, azRoute, azNextHopIp),
        )
        const isUdrVngBlackholeEquivalent = Boolean(
          simMatch && isUdrUnresolvedVngMatch(simMatch, azRoute),
        )
        const matched = Boolean(
          simMatch &&
            simState === azRoute.state &&
            (simMatch.nextHopType.toLowerCase() === azRoute.nextHopType.toLowerCase() ||
              isArsEquivalent ||
              isUdrVngBlackholeEquivalent) &&
            (!azNextHopIp || !simMatch.nextHopIp || simMatch.nextHopIp === azNextHopIp),
        )

        rows.push({
          prefix,
          azureSource: azRoute.source,
          simSource: simMatch ? simMatch.source : 'Missing',
          azureNextHopType: azRoute.nextHopType,
          simNextHopType: simMatch ? simMatch.nextHopType : 'Missing',
          azureNextHopIp: azNextHopIp,
          simNextHopIp: simMatch?.nextHopIp,
          azureState: azRoute.state,
          simState,
          matched,
          note: isArsEquivalent
            ? `Azure programs ARS-learned NVA routes as VirtualNetworkGateway -> ${azNextHopIp}`
            : isUdrVngBlackholeEquivalent
              ? 'Azure SDN compiles UDR NextHopType=VirtualNetworkGateway to None when no static VNG connection owns the prefix'
              : normalizedAzSource !== (simMatch?.source ?? '')
                ? `Azure source '${azRoute.source}' maps to '${normalizedAzSource}'`
                : undefined,
        })
      }
    }

    // Also flag any active simulator route that was completely absent from Azure's effective routes
    for (const sr of simRoutes) {
      if (sr.active && !matchedSimRouteIds.has(sr.id)) {
        const isRemoteHubArsConfirmedOnHub =
          sr.source === 'RouteServer' &&
          sr.originLabel.startsWith('BGP · Remote Hub ') &&
          (observations.nicEffectiveRoutes ?? []).some(
            (hubNic) =>
              hubNic.vnetName !== nicObs.vnetName &&
              hubNic.effectiveRoutes.some(
                (r) =>
                  r.state === 'Active' &&
                  r.addressPrefix.includes(sr.prefix) &&
                  (sr.nextHopIp ? r.nextHopIpAddress?.includes(sr.nextHopIp) : true),
              ),
          )
        if (isRemoteHubArsConfirmedOnHub) {
          continue
        }
        rows.push({
          prefix: sr.prefix,
          azureSource: 'Missing',
          simSource: sr.source,
          azureNextHopType: 'Missing',
          simNextHopType: sr.nextHopType,
          azureNextHopIp: undefined,
          simNextHopIp: sr.nextHopIp,
          azureState: 'Invalid',
          simState: 'Active',
          matched: false,
          note: 'Simulator predicted an Active route that is absent from Azure NIC effective routes',
        })
      }
    }

    const matchedCount = rows.filter((r) => r.matched).length
    const mismatchCount = rows.filter((r) => !r.matched).length
    totalMatchedRoutes += matchedCount
    totalMismatchedRoutes += mismatchCount

    subnetComparisons.push({
      vnetName: nicObs.vnetName,
      subnetName: nicObs.subnetName,
      nicName: nicObs.nicName,
      proxyForGatewaySubnet,
      matchedCount,
      mismatchCount,
      rows,
    })
  }

  return {
    resourceGroup: observations.resourceGroup,
    capturedAt: observations.capturedAt,
    subnetComparisons,
    totalMatchedRoutes,
    totalMismatchedRoutes,
  }
}
