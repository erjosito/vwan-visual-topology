import { useWorkspaceEditorState } from '../workspace-context'
import { confirmConfigurationSwitch } from '../configuration-selection'
import { azWorkspaceIdentity, workspaceIdentityKey } from '../workspace-objects'
import type { AzNetTopology } from './model'
import type { AzSelectedEntity } from './AzureNetDiagram'

export type InspectorTab = 'routes' | 'tracer' | 'diagnostics' | 'editor' | 'azure'

export function defaultSelected(topology: AzNetTopology): AzSelectedEntity {
  const firstVnet = topology.vnets[1] ?? topology.vnets[0]
  if (firstVnet?.subnets[0]) return { kind: 'subnet', vnetId: firstVnet.id, subnetId: firstVnet.subnets[0].id }
  if (firstVnet) return { kind: 'vnet', vnetId: firstVnet.id }
  if (topology.erLocations[0]) return { kind: 'er-location', locationId: topology.erLocations[0].id }
  if (topology.sites[0]) return { kind: 'site', siteId: topology.sites[0].id }
  return { kind: 'vnet', vnetId: 'vnet-1' }
}

export function useAzSelection(topology: AzNetTopology, onSelectionChange: () => void, onInspectRoutes: () => void) {
  const [activeTab, setActiveTab] = useWorkspaceEditorState<InspectorTab | null>('aznet.inspector', null)
  const [selected, setInspectedEntity] = useWorkspaceEditorState<AzSelectedEntity>('aznet.selected', () => defaultSelected(topology))
  const [canvasSelection, setCanvasSelection] = useWorkspaceEditorState<AzSelectedEntity>('aznet.canvasSelection')
  const [routeInspection, setRouteInspection] = useWorkspaceEditorState<AzSelectedEntity | null>('aznet.routeInspection', null)
  const routeSelection = routeInspection ?? selected
  const setSelected = (entity: AzSelectedEntity) => {
    const changed = workspaceIdentityKey(azWorkspaceIdentity(entity)) !== workspaceIdentityKey(azWorkspaceIdentity(selected))
    if (activeTab === 'editor' && changed && !confirmConfigurationSwitch('.aznet-app .aznet-inspector-window')) return false
    if (changed) onSelectionChange()
    setInspectedEntity(entity)
    setCanvasSelection(entity)
    return true
  }
  const selectCanvasObject = (entity: AzSelectedEntity) => {
    if (activeTab === 'editor' && entity.kind !== 'site-link' && entity.kind !== 'er-global-reach-link') return setSelected(entity)
    setCanvasSelection(entity)
    return true
  }
  const inspectRoutes = (entity: AzSelectedEntity) => {
    onInspectRoutes()
    if (!setSelected(entity)) return false
    setRouteInspection(entity)
    setActiveTab('routes')
    return true
  }
  const selectCreatedEntity = (entity: AzSelectedEntity) => {
    setInspectedEntity(entity)
    setCanvasSelection(entity)
  }
  const selectedExists = (() => {
    if ('vnetId' in selected) {
      const vnet = topology.vnets.find(item => item.id === selected.vnetId)
      if (!vnet) return false
      switch (selected.kind) {
        case 'subnet': return vnet.subnets.some(item => item.id === selected.subnetId)
        case 'gateway': return vnet.gateways.some(item => item.id === selected.gatewayId)
        case 'appliance': return vnet.appliances.some(item => item.id === selected.applianceId)
        case 'route-server': return vnet.routeServer?.id === selected.routeServerId
        default: return true
      }
    }
    switch (selected.kind) {
      case 'site': return topology.sites.some(item => item.id === selected.siteId)
      case 'er-location': return topology.erLocations.some(item => item.id === selected.locationId)
      case 'vwan-hub': return topology.vwanHubs.some(item => item.id === selected.hubId)
      case 'peering': return topology.vnetPeerings.some(item => item.id === selected.peeringId)
      case 'er-link': return topology.erLinks.some(item => item.id === selected.linkId)
      case 'er-global-reach-link': return topology.erGlobalReachLinks?.some(item => item.id === selected.linkId)
      case 'vpn-connection': return topology.vpnConnections.some(item => item.id === selected.connectionId)
      case 'site-link': return topology.siteLinks.some(item => item.id === selected.siteLinkId)
    }
  })()
  return {
    activeTab, setActiveTab, selected, setSelected, canvasSelection, setCanvasSelection,
    routeInspection, routeSelection, selectCanvasObject, inspectRoutes, selectCreatedEntity, selectedExists,
  }
}
