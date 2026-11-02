import type { LayoutMode, NodePosition, Preference } from '../model'
import { cidr, ipv4 } from '../validation'

export type AzVnetRole =
  | 'hub-vnet'
  | 'spoke-vnet'
  | 'transit-vnet'
  | 'shared-services'
  | 'hub'
  | 'spoke'
  | 'transit'
  | 'standalone'

export type AzPrivateEndpointPolicy = 'Disabled' | 'Enabled' | 'RouteTableEnabled'

export interface AzPrivateEndpoint {
  id: string
  name: string
  ipAddress: string
  serviceName: string
}

export interface AzSubnet {
  id: string
  name: string
  prefix: string
  routeTableId?: string
  privateEndpointNetworkPolicies?: AzPrivateEndpointPolicy
  privateEndpoints?: AzPrivateEndpoint[]
}

export type AzUdrNextHopType =
  | 'VirtualAppliance'
  | 'VirtualNetworkGateway'
  | 'VnetLocal'
  | 'Internet'
  | 'None'

export interface AzUdrRoute {
  id: string
  name: string
  prefix: string
  nextHopType: AzUdrNextHopType
  nextHopIp?: string
  enabled: boolean
}

export interface AzUdrTable {
  id: string
  name: string
  disableBgpRoutePropagation: boolean
  routes: AzUdrRoute[]
}

export interface AzVnetGateway {
  id: string
  name: string
  kind: 'ExpressRoute' | 'Vpn'
  asn: number
  bgpEnabled: boolean
  activeActive?: boolean
  enabled: boolean
}

export type AzArsPreference = 'ExpressRoute' | 'VpnGateway' | 'ASPath'

export interface AzRouteServer {
  id: string
  name: string
  subnetId?: string
  enabled: boolean
  branchToBranchTraffic: boolean
  hubRoutingPreference: AzArsPreference
  peerApplianceIds: string[]
}

export type AzApplianceKind = 'azure-firewall' | 'nva-vm' | 'vnra'

export interface AzApplianceStaticRoute {
  id: string
  prefix: string
  nextHopKind: 'subnet' | 'gateway' | 'appliance' | 'internet' | 'drop'
  nextHopIp?: string
  enabled: boolean
}

export interface AzAppliance {
  id: string
  name: string
  kind: AzApplianceKind
  subnetId: string
  privateIp: string
  asn?: number
  bgpEnabled?: boolean
  enableIpForwarding: boolean
  inspectsTraffic?: boolean
  advertisedPrefixes?: string[]
  staticRoutes: AzApplianceStaticRoute[]
}

export interface AzVwanHubAttachment {
  hubId: string
  enabled: boolean
  propagateDefaultRoute?: boolean
}

export interface AzVNet {
  id: string
  name: string
  region: string
  prefixes: string[]
  role: AzVnetRole
  subnets: AzSubnet[]
  gateways: AzVnetGateway[]
  routeServer?: AzRouteServer
  appliances: AzAppliance[]
  summarizedGatewayPrefixes?: string[]
  vwanHubAttachment?: AzVwanHubAttachment
  x?: number
  y?: number
}

export interface AzPeeringDirectionFlags {
  allowVirtualNetworkAccess: boolean
  allowForwardedTraffic: boolean
  allowGatewayTransit: boolean
  useRemoteGateways: boolean
}

export interface AzVnetPeering {
  id: string
  name: string
  vnetAId: string
  vnetBId: string
  enabled: boolean
  aToB: AzPeeringDirectionFlags
  bToA: AzPeeringDirectionFlags
}

export interface AzVwanHub {
  id: string
  name: string
  region: string
  prefix?: string
  preference: Preference
  routingIntent: {
    private: boolean
    internet: boolean
  }
  x?: number
  y?: number
}

export interface AzSite {
  id: string
  name: string
  asn: number
  prefixes: string[]
  x?: number
  y?: number
}

export interface AzErLocation {
  id: string
  name: string
  globalReachEnabled?: boolean
  x?: number
  y?: number
}

export interface AzErLink {
  id: string
  name: string
  locationId: string
  targetKind: 'vnet-gateway' | 'vwan-hub' | 'site'
  targetId: string
  enabled: boolean
  weight?: number
  prepend?: number[]
}

export interface AzVpnConnection {
  id: string
  name: string
  siteId: string
  targetKind: 'vnet-gateway' | 'vwan-hub' | 'appliance'
  targetId: string
  bgpEnabled: boolean
  staticPrefixes?: string[]
  inboundPrepend?: number[]
  outboundPrepend?: number[]
  enabled: boolean
}

export interface AzSiteLink {
  id: string
  name: string
  siteAId: string
  siteBId: string
  enabled: boolean
}

export interface AzNetTopology {
  version: 2
  kind: 'azure-network-topology'
  name: string
  subtitle?: string
  vnets: AzVNet[]
  vnetPeerings: AzVnetPeering[]
  udrTables: AzUdrTable[]
  vwanHubs: AzVwanHub[]
  erLocations: AzErLocation[]
  erLinks: AzErLink[]
  sites: AzSite[]
  vpnConnections: AzVpnConnection[]
  siteLinks: AzSiteLink[]
  layout?: {
    mode: LayoutMode
    positions: Partial<Record<LayoutMode, Record<string, NodePosition>>>
  }
}

export type AzSelectionKind =
  | 'vnet'
  | 'subnet'
  | 'udrTable'
  | 'peering'
  | 'vwanHub'
  | 'erLocation'
  | 'erLink'
  | 'site'
  | 'vpnConnection'
  | 'siteLink'

export interface AzSelection {
  kind: AzSelectionKind
  id: string
  vnetId?: string
}

export interface AzSampleMetadata {
  id: string
  title: string
  subtitle: string
  summary?: string
  highlights: string[]
  topology: AzNetTopology
}

export const sampleHubSpokeFirewallUdr: AzNetTopology = {
  version: 2,
  kind: 'azure-network-topology',
  name: 'Hub-and-Spoke with Azure Firewall, ER/VPN & GatewaySubnet UDR',
  vnets: [
    {
      id: 'vnet-hub-weu',
      name: 'VNet-Hub-WEU',
      region: 'westeurope',
      prefixes: ['10.0.0.0/22'],
      role: 'hub-vnet',
      subnets: [
        { id: 'sub-hub-gw', name: 'GatewaySubnet', prefix: '10.0.0.0/26', routeTableId: 'rt-gw-subnet' },
        { id: 'sub-hub-fw', name: 'AzureFirewallSubnet', prefix: '10.0.1.0/26' },
        { id: 'sub-hub-mgmt', name: 'snet-shared-dns', prefix: '10.0.2.0/24', routeTableId: 'rt-spoke-to-fw' },
      ],
      gateways: [
        { id: 'vng-hub-er', name: 'ER-GW-Hub-WEU', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true },
        { id: 'vng-hub-vpn', name: 'VPN-GW-Hub-WEU', kind: 'Vpn', asn: 65515, bgpEnabled: true, activeActive: true, enabled: true },
      ],
      appliances: [
        {
          id: 'app-hub-azfw',
          name: 'AzFW-Hub-WEU',
          kind: 'azure-firewall',
          subnetId: 'sub-hub-fw',
          privateIp: '10.0.1.4',
          enableIpForwarding: true,
          inspectsTraffic: true,
          staticRoutes: [],
        },
      ],
    },
    {
      id: 'vnet-spoke-app',
      name: 'VNet-Spoke-App',
      region: 'westeurope',
      prefixes: ['10.1.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-app-web', name: 'snet-app-tier', prefix: '10.1.1.0/24', routeTableId: 'rt-spoke-to-fw' },
        { id: 'sub-app-aks', name: 'snet-aks-nodes', prefix: '10.1.2.0/24', routeTableId: 'rt-spoke-to-fw' },
      ],
      gateways: [],
      appliances: [],
    },
    {
      id: 'vnet-spoke-data',
      name: 'VNet-Spoke-Data',
      region: 'westeurope',
      prefixes: ['10.2.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-data-db', name: 'snet-sql-mi', prefix: '10.2.1.0/24', routeTableId: 'rt-spoke-to-fw' },
        {
          id: 'sub-data-pe',
          name: 'snet-private-endpoints',
          prefix: '10.2.2.0/24',
          routeTableId: 'rt-spoke-to-fw',
          privateEndpointNetworkPolicies: 'Disabled',
          privateEndpoints: [
            { id: 'pe-storage-blob', name: 'pe-fin-datalake', ipAddress: '10.2.2.15', serviceName: 'privatelink.blob.core.windows.net' },
          ],
        },
      ],
      gateways: [],
      appliances: [],
    },
  ],
  vnetPeerings: [
    {
      id: 'peer-hub-app',
      name: 'Hub-WEU ↔ Spoke-App',
      vnetAId: 'vnet-hub-weu',
      vnetBId: 'vnet-spoke-app',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
    },
    {
      id: 'peer-hub-data',
      name: 'Hub-WEU ↔ Spoke-Data',
      vnetAId: 'vnet-hub-weu',
      vnetBId: 'vnet-spoke-data',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
    },
  ],
  udrTables: [
    {
      id: 'rt-spoke-to-fw',
      name: 'RT-Spokes-To-AzFW',
      disableBgpRoutePropagation: true,
      routes: [
        { id: 'udr-rfc1918-a', name: 'to-10-8-via-azfw', prefix: '10.0.0.0/8', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: true },
        { id: 'udr-onprem-172', name: 'to-onprem-via-azfw', prefix: '172.16.0.0/12', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: true },
        { id: 'udr-default-fw', name: 'default-to-azfw', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: true },
      ],
    },
    {
      id: 'rt-gw-subnet',
      name: 'RT-GatewaySubnet-Return',
      disableBgpRoutePropagation: false,
      routes: [
        { id: 'udr-gw-to-app', name: 'spoke-app-via-azfw', prefix: '10.1.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: true },
        { id: 'udr-gw-to-data', name: 'spoke-data-via-azfw', prefix: '10.2.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.0.1.4', enabled: false },
      ],
    },
  ],
  vwanHubs: [],
  erLocations: [
    { id: 'erloc-ams', name: 'Amsterdam Equinix MSEE', globalReachEnabled: true },
  ],
  erLinks: [
    { id: 'erlink-hub-ams', name: 'Hub-WEU ER Connection', locationId: 'erloc-ams', targetKind: 'vnet-gateway', targetId: 'vng-hub-er', enabled: true, weight: 0 },
    { id: 'erlink-hq-ams', name: 'Munich HQ ER Circuit', locationId: 'erloc-ams', targetKind: 'site', targetId: 'site-munich-hq', enabled: true },
  ],
  sites: [
    { id: 'site-munich-hq', name: 'Munich Core DC', asn: 65010, prefixes: ['172.16.10.0/24', '172.16.20.0/24'] },
    { id: 'site-zurich-br', name: 'Zurich Branch (VPN)', asn: 65020, prefixes: ['172.16.50.0/24'] },
  ],
  vpnConnections: [
    {
      id: 'vpn-zurich-hub',
      name: 'S2S-Zurich-to-Hub-WEU',
      siteId: 'site-zurich-br',
      targetKind: 'vnet-gateway',
      targetId: 'vng-hub-vpn',
      bgpEnabled: true,
      inboundPrepend: [65020],
      enabled: true,
    },
  ],
  siteLinks: [
    { id: 'sitelink-muc-zrh', name: 'MPLS Backdoor MUC-ZRH', siteAId: 'site-munich-hq', siteBId: 'site-zurich-br', enabled: true },
  ],
}

export const sampleArsSdwanNvaCoexistence: AzNetTopology = {
  version: 2,
  kind: 'azure-network-topology',
  name: 'Azure Route Server (ARS) + SD-WAN BGP NVA + ER/VPN Branch-to-Branch',
  vnets: [
    {
      id: 'vnet-ars-hub',
      name: 'VNet-Transit-ARS-Hub',
      region: 'northeurope',
      prefixes: ['10.100.0.0/22'],
      role: 'hub-vnet',
      subnets: [
        { id: 'sub-ars-gw', name: 'GatewaySubnet', prefix: '10.100.0.0/26' },
        { id: 'sub-ars-rs', name: 'RouteServerSubnet', prefix: '10.100.1.0/26' },
        { id: 'sub-ars-nva', name: 'snet-sdwan-nva', prefix: '10.100.2.0/24' },
      ],
      gateways: [
        { id: 'vng-ars-er', name: 'ER-GW-Transit', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true },
        { id: 'vng-ars-vpn', name: 'VPN-GW-Transit', kind: 'Vpn', asn: 65515, bgpEnabled: true, enabled: true },
      ],
      routeServer: {
        id: 'ars-hub-neu',
        name: 'ARS-Transit-NEU',
        enabled: true,
        branchToBranchTraffic: true,
        hubRoutingPreference: 'ExpressRoute',
        peerApplianceIds: ['app-sdwan-nva', 'app-sec-nva'],
      },
      appliances: [
        {
          id: 'app-sdwan-nva',
          name: 'SDWAN-Edge-NVA',
          kind: 'nva-vm',
          subnetId: 'sub-ars-nva',
          privateIp: '10.100.2.10',
          asn: 65100,
          bgpEnabled: true,
          enableIpForwarding: true,
          advertisedPrefixes: ['192.168.100.0/24', '10.102.0.0/16'],
          staticRoutes: [
            { id: 'sr-nva-dmz', prefix: '10.102.0.0/16', nextHopKind: 'subnet', nextHopIp: '10.102.1.1', enabled: true },
          ],
        },
        {
          id: 'app-sec-nva',
          name: 'PaloAlto-Inspect-NVA',
          kind: 'nva-vm',
          subnetId: 'sub-ars-nva',
          privateIp: '10.100.2.20',
          asn: 65101,
          bgpEnabled: true,
          enableIpForwarding: true,
          inspectsTraffic: true,
          advertisedPrefixes: ['0.0.0.0/0'],
          staticRoutes: [],
        },
      ],
    },
    {
      id: 'vnet-spoke-erp',
      name: 'VNet-Spoke-SAP',
      region: 'northeurope',
      prefixes: ['10.101.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-sap-app', name: 'snet-sap-app', prefix: '10.101.1.0/24' },
        { id: 'sub-sap-db', name: 'snet-hana-isolated', prefix: '10.101.2.0/24', routeTableId: 'rt-hana-no-bgp' },
      ],
      gateways: [],
      appliances: [],
    },
    {
      id: 'vnet-spoke-dmz',
      name: 'VNet-Spoke-Partner-DMZ',
      region: 'northeurope',
      prefixes: ['10.102.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-dmz-api', name: 'snet-partner-api', prefix: '10.102.1.0/24', routeTableId: 'rt-dmz-via-sdwan' },
      ],
      gateways: [],
      appliances: [],
    },
  ],
  vnetPeerings: [
    {
      id: 'peer-ars-sap',
      name: 'Transit-ARS ↔ Spoke-SAP',
      vnetAId: 'vnet-ars-hub',
      vnetBId: 'vnet-spoke-erp',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
    },
    {
      id: 'peer-ars-dmz',
      name: 'Transit-ARS ↔ Spoke-DMZ',
      vnetAId: 'vnet-ars-hub',
      vnetBId: 'vnet-spoke-dmz',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    },
  ],
  udrTables: [
    {
      id: 'rt-hana-no-bgp',
      name: 'RT-HANA-BGP-Disabled',
      disableBgpRoutePropagation: true,
      routes: [
        { id: 'udr-hana-sap', name: 'allow-sap-hub', prefix: '10.100.0.0/22', nextHopType: 'VnetLocal', enabled: true },
      ],
    },
    {
      id: 'rt-dmz-via-sdwan',
      name: 'RT-DMZ-Via-SDWAN-NVA',
      disableBgpRoutePropagation: true,
      routes: [
        { id: 'udr-dmz-all', name: 'all-private-via-sdwan', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.100.2.10', enabled: true },
      ],
    },
  ],
  vwanHubs: [],
  erLocations: [
    { id: 'erloc-dublin', name: 'Dublin Equinix MSEE', globalReachEnabled: false },
  ],
  erLinks: [
    { id: 'erlink-ars-dub', name: 'Transit Hub ER Link', locationId: 'erloc-dublin', targetKind: 'vnet-gateway', targetId: 'vng-ars-er', enabled: true },
    { id: 'erlink-dc-dub', name: 'Dublin DC ER Link', locationId: 'erloc-dublin', targetKind: 'site', targetId: 'site-dublin-dc', enabled: true },
  ],
  sites: [
    { id: 'site-dublin-dc', name: 'Dublin Enterprise DC', asn: 65040, prefixes: ['172.20.0.0/16'] },
    { id: 'site-sdwan-branch', name: 'Retail SD-WAN Branches', asn: 65100, prefixes: ['192.168.100.0/24'] },
  ],
  vpnConnections: [
    {
      id: 'vpn-sdwan-overlay',
      name: 'SD-WAN Overlay Tunnel',
      siteId: 'site-sdwan-branch',
      targetKind: 'appliance',
      targetId: 'app-sdwan-nva',
      bgpEnabled: true,
      enabled: true,
    },
  ],
  siteLinks: [],
}

export const sampleDualHubVnraGlobalPeering: AzNetTopology = {
  version: 2,
  kind: 'azure-network-topology',
  name: 'Dual-Region Hub-and-Spoke with Managed VNRA & Chained UDRs',
  vnets: [
    {
      id: 'vnet-hub-r1',
      name: 'VNet-Hub-Region1-WEU',
      region: 'westeurope',
      prefixes: ['10.10.0.0/22'],
      role: 'hub-vnet',
      subnets: [
        { id: 'sub-r1-vnra', name: 'VirtualNetworkApplianceSubnet', prefix: '10.10.2.0/24' },
      ],
      gateways: [],
      appliances: [
        {
          id: 'app-vnra-r1',
          name: 'VNRA-Hub-WEU (100 Gbps)',
          kind: 'vnra',
          subnetId: 'sub-r1-vnra',
          privateIp: '10.10.2.4',
          enableIpForwarding: true,
          staticRoutes: [],
        },
      ],
    },
    {
      id: 'vnet-hub-r2',
      name: 'VNet-Hub-Region2-NEU',
      region: 'northeurope',
      prefixes: ['10.20.0.0/22'],
      role: 'hub-vnet',
      subnets: [
        { id: 'sub-r2-vnra', name: 'VirtualNetworkApplianceSubnet', prefix: '10.20.2.0/24' },
      ],
      gateways: [],
      appliances: [
        {
          id: 'app-vnra-r2',
          name: 'VNRA-Hub-NEU (100 Gbps)',
          kind: 'vnra',
          subnetId: 'sub-r2-vnra',
          privateIp: '10.20.2.4',
          enableIpForwarding: true,
          staticRoutes: [],
        },
      ],
    },
    {
      id: 'vnet-spoke-r1-a',
      name: 'VNet-Spoke-WEU-A',
      region: 'westeurope',
      prefixes: ['10.11.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-r1a-work', name: 'snet-workload-a', prefix: '10.11.1.0/24', routeTableId: 'rt-r1-spoke' },
      ],
      gateways: [],
      appliances: [],
    },
    {
      id: 'vnet-spoke-r2-b',
      name: 'VNet-Spoke-NEU-B',
      region: 'northeurope',
      prefixes: ['10.21.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-r2b-work', name: 'snet-workload-b', prefix: '10.21.1.0/24', routeTableId: 'rt-r2-spoke' },
      ],
      gateways: [],
      appliances: [],
    },
    {
      id: 'vnet-spoke-r2-c',
      name: 'VNet-Spoke-NEU-C (Misconfigured Peering)',
      region: 'northeurope',
      prefixes: ['10.22.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-r2c-work', name: 'snet-workload-c', prefix: '10.22.1.0/24', routeTableId: 'rt-r2-spoke' },
      ],
      gateways: [],
      appliances: [],
    },
  ],
  vnetPeerings: [
    {
      id: 'peer-r1-r2-hubs',
      name: 'Global Peering: Hub-WEU ↔ Hub-NEU',
      vnetAId: 'vnet-hub-r1',
      vnetBId: 'vnet-hub-r2',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    },
    {
      id: 'peer-r1-spoke-a',
      name: 'Hub-WEU ↔ Spoke-WEU-A',
      vnetAId: 'vnet-hub-r1',
      vnetBId: 'vnet-spoke-r1-a',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    },
    {
      id: 'peer-r2-spoke-b',
      name: 'Hub-NEU ↔ Spoke-NEU-B',
      vnetAId: 'vnet-hub-r2',
      vnetBId: 'vnet-spoke-r2-b',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    },
    {
      id: 'peer-r2-spoke-c',
      name: 'Hub-NEU ↔ Spoke-NEU-C',
      vnetAId: 'vnet-hub-r2',
      vnetBId: 'vnet-spoke-r2-c',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: false, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: false },
    },
  ],
  udrTables: [
    {
      id: 'rt-r1-spoke',
      name: 'RT-WEU-Spokes-Via-VNRA',
      disableBgpRoutePropagation: false,
      routes: [
        { id: 'udr-r1-to-r2', name: 'to-neu-via-vnra-r1', prefix: '10.20.0.0/14', nextHopType: 'VirtualAppliance', nextHopIp: '10.10.2.4', enabled: true },
      ],
    },
    {
      id: 'rt-r2-spoke',
      name: 'RT-NEU-Spokes-Via-VNRA',
      disableBgpRoutePropagation: false,
      routes: [
        { id: 'udr-r2-to-r1', name: 'to-weu-via-vnra-r2', prefix: '10.8.0.0/14', nextHopType: 'VirtualAppliance', nextHopIp: '10.20.2.4', enabled: true },
      ],
    },
  ],
  vwanHubs: [],
  erLocations: [],
  erLinks: [],
  sites: [],
  vpnConnections: [],
  siteLinks: [],
}

export const sampleHybridVwanAndHubSpoke: AzNetTopology = {
  version: 2,
  kind: 'azure-network-topology',
  name: 'Hybrid Coexistence: Virtual WAN Secured Hub + Classic Hub-and-Spoke',
  vnets: [
    {
      id: 'vnet-vwan-spoke-1',
      name: 'VNet-vWAN-Spoke-AI',
      region: 'westeurope',
      prefixes: ['10.50.0.0/16'],
      role: 'spoke-vnet',
      vwanHubAttachment: {
        hubId: 'vhub-weu-sec',
        enabled: true,
        propagateDefaultRoute: true,
      },
      subnets: [
        { id: 'sub-vwan-ai', name: 'snet-ai-inference', prefix: '10.50.1.0/24' },
      ],
      gateways: [],
      appliances: [],
    },
    {
      id: 'vnet-legacy-hub',
      name: 'VNet-Legacy-Hub-DE',
      region: 'germanywestcentral',
      prefixes: ['10.60.0.0/22'],
      role: 'hub-vnet',
      subnets: [
        { id: 'sub-leg-gw', name: 'GatewaySubnet', prefix: '10.60.0.0/26', routeTableId: 'rt-leg-gw' },
        { id: 'sub-leg-fw', name: 'AzureFirewallSubnet', prefix: '10.60.1.0/26' },
      ],
      gateways: [
        { id: 'vng-leg-er', name: 'ER-GW-Legacy-DE', kind: 'ExpressRoute', asn: 65515, bgpEnabled: true, enabled: true },
      ],
      appliances: [
        {
          id: 'app-leg-fw',
          name: 'AzFW-Legacy-DE',
          kind: 'azure-firewall',
          subnetId: 'sub-leg-fw',
          privateIp: '10.60.1.4',
          enableIpForwarding: true,
          inspectsTraffic: true,
          staticRoutes: [],
        },
      ],
    },
    {
      id: 'vnet-legacy-spoke',
      name: 'VNet-Legacy-CoreBanking',
      region: 'germanywestcentral',
      prefixes: ['10.61.0.0/16'],
      role: 'spoke-vnet',
      subnets: [
        { id: 'sub-leg-core', name: 'snet-core-banking', prefix: '10.61.1.0/24', routeTableId: 'rt-leg-spoke' },
      ],
      gateways: [],
      appliances: [],
    },
  ],
  vnetPeerings: [
    {
      id: 'peer-leg-hub-spoke',
      name: 'Legacy-Hub-DE ↔ CoreBanking',
      vnetAId: 'vnet-legacy-hub',
      vnetBId: 'vnet-legacy-spoke',
      enabled: true,
      aToB: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: true, useRemoteGateways: false },
      bToA: { allowVirtualNetworkAccess: true, allowForwardedTraffic: true, allowGatewayTransit: false, useRemoteGateways: true },
    },
  ],
  udrTables: [
    {
      id: 'rt-leg-spoke',
      name: 'RT-CoreBanking-To-AzFW',
      disableBgpRoutePropagation: true,
      routes: [
        { id: 'udr-leg-all', name: 'all-via-legacy-azfw', prefix: '0.0.0.0/0', nextHopType: 'VirtualAppliance', nextHopIp: '10.60.1.4', enabled: true },
      ],
    },
    {
      id: 'rt-leg-gw',
      name: 'RT-Legacy-GatewaySubnet',
      disableBgpRoutePropagation: false,
      routes: [
        { id: 'udr-leg-gw-spoke', name: 'corebanking-via-azfw', prefix: '10.61.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.60.1.4', enabled: true },
      ],
    },
  ],
  vwanHubs: [
    {
      id: 'vhub-weu-sec',
      name: 'vHub-WestEurope-Secured',
      region: 'westeurope',
      preference: 'ExpressRoute',
      routingIntent: { private: true, internet: true },
    },
  ],
  erLocations: [
    { id: 'erloc-fra', name: 'Frankfurt Equinix MSEE', globalReachEnabled: true },
  ],
  erLinks: [
    { id: 'erlink-vhub-fra', name: 'vHub-WEU ER Circuit', locationId: 'erloc-fra', targetKind: 'vwan-hub', targetId: 'vhub-weu-sec', enabled: true },
    { id: 'erlink-leghub-fra', name: 'Legacy-Hub-DE ER Circuit', locationId: 'erloc-fra', targetKind: 'vnet-gateway', targetId: 'vng-leg-er', enabled: true },
    { id: 'erlink-fra-dc', name: 'Frankfurt Mainframe DC', locationId: 'erloc-fra', targetKind: 'site', targetId: 'site-frankfurt-dc', enabled: true },
  ],
  sites: [
    { id: 'site-frankfurt-dc', name: 'Frankfurt Mainframe DC', asn: 65090, prefixes: ['172.30.0.0/16'] },
  ],
  vpnConnections: [],
  siteLinks: [],
}

export const AZURE_NET_SAMPLES: AzSampleMetadata[] = [
  {
    id: 'hub-spoke-firewall-udr',
    title: 'Hub-and-Spoke + AzFW + GatewaySubnet UDR',
    subtitle: 'Classic self-managed hub with ER & VPN Gateways, spoke UDRs, Private Endpoint /32 override, and GatewaySubnet asymmetric bypass detection.',
    highlights: [
      'Spoke-Data GatewaySubnet UDR is disabled by default — run Check Routing to see the asymmetric firewall bypass alert.',
      'Private Endpoint pe-fin-datalake (10.2.2.15/32) injects an InterfaceEndpoint system route that overrides spoke UDRs until Private Endpoint Network Policies are enabled.',
    ],
    topology: sampleHubSpokeFirewallUdr,
  },
  {
    id: 'ars-sdwan-nva-coexistence',
    title: 'Azure Route Server + SD-WAN BGP NVA + ER/VPN B2B',
    subtitle: 'Dynamic transit hub with Azure Route Server (ASN 65515), Branch-to-Branch ER/VPN exchange, dual NVAs, and BGP propagation controls.',
    highlights: [
      'ARS exchanges routes between ER-GW, VPN-GW, and BGP NVAs when branchToBranchTraffic is enabled.',
      'snet-hana-isolated disables BGP route propagation without a covering default UDR, triggering an on-prem blackhole warning.',
    ],
    topology: sampleArsSdwanNvaCoexistence,
  },
  {
    id: 'dual-hub-vnra-global-peering',
    title: 'Dual-Region Managed VNRA + Chained Global Peering UDRs',
    subtitle: 'High-throughput 100 Gbps Managed VNRA hardware appliances in two regions with UDR transit chaining and peering flag validation.',
    highlights: [
      'Spoke-WEU-A -> VNRA-Hub-WEU -> VNRA-Hub-NEU -> Spoke-NEU-B chains cleanly across global VNet peering.',
      'Spoke-NEU-C has allowVirtualNetworkAccess=false on the hub peering side, demonstrating silent VNRA data-plane drop detection.',
    ],
    topology: sampleDualHubVnraGlobalPeering,
  },
  {
    id: 'hybrid-vwan-and-hub-spoke',
    title: 'Hybrid Virtual WAN Secured Hub + Classic Hub-and-Spoke',
    subtitle: 'Enterprise coexistence linking a Secured vWAN Hub and a classic Hub-and-Spoke VNet across a shared Frankfurt ExpressRoute MSEE.',
    highlights: [
      'Traces flows between vWAN-attached AI spokes (Routing Intent) and classic Hub-and-Spoke CoreBanking subnets.',
      'Models MSEE hairpin / Global Reach transit between vWAN ER Gateway and standalone VNet ER Gateway.',
    ],
    topology: sampleHybridVwanAndHubSpoke,
  },
]

export function cloneAzNetTopology(topology: AzNetTopology): AzNetTopology {
  return structuredClone(topology)
}

export function validateAzNetTopology(input: unknown): string[] {
  const errors: string[] = []
  if (!input || typeof input !== 'object') {
    return ['Topology must be a JSON object.']
  }
  const candidate = input as Partial<AzNetTopology>
  if (candidate.kind !== 'azure-network-topology' || candidate.version !== 2) {
    errors.push('Expected an Azure Network Topology v2 file (kind: "azure-network-topology", version: 2).')
  }
  if (!candidate.name || typeof candidate.name !== 'string') {
    errors.push('Topology name is required.')
  }
  if (!Array.isArray(candidate.vnets)) {
    errors.push('Topology vnets array is required.')
    return errors
  }
  for (const vnet of candidate.vnets) {
    if (!vnet.id || !vnet.name) errors.push('Every VNet must have an id and name.')
    if (!Array.isArray(vnet.prefixes) || !vnet.prefixes.length) {
      errors.push(`VNet "${vnet.name}" must have at least one CIDR prefix.`)
    }
    for (const prefix of vnet.prefixes ?? []) {
      if (!cidr(prefix)) errors.push(`VNet "${vnet.name}" has invalid CIDR "${prefix}".`)
    }
    for (const subnet of vnet.subnets ?? []) {
      if (!cidr(subnet.prefix)) {
        errors.push(`Subnet "${subnet.name}" in "${vnet.name}" has invalid CIDR "${subnet.prefix}".`)
      }
      for (const pe of subnet.privateEndpoints ?? []) {
        if (ipv4(pe.ipAddress) === undefined) {
          errors.push(`Private Endpoint "${pe.name}" has invalid IPv4 address "${pe.ipAddress}".`)
        }
      }
    }
    for (const app of vnet.appliances ?? []) {
      if (ipv4(app.privateIp) === undefined) {
        errors.push(`Appliance "${app.name}" in "${vnet.name}" has invalid IPv4 address "${app.privateIp}".`)
      }
    }
  }
  for (const table of candidate.udrTables ?? []) {
    for (const route of table.routes ?? []) {
      if (!cidr(route.prefix)) {
        errors.push(`UDR route "${route.name}" in "${table.name}" has invalid CIDR "${route.prefix}".`)
      }
      if (route.nextHopType === 'VirtualAppliance' && (!route.nextHopIp || ipv4(route.nextHopIp) === undefined)) {
        errors.push(`UDR route "${route.name}" with VirtualAppliance next hop requires a valid IPv4 address.`)
      }
    }
  }
  return errors
}
