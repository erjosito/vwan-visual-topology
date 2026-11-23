import { lazy, Suspense } from 'react'
import { t } from '../i18n'
import { InspectorSection } from '../WorkspacePresentation'
import { AzureRegionSelect } from '../AzureRegionSelect'
import { cidr } from '../validation'
import type { AzNetTopology, AzVwanHub } from './model'
import { HubTablesEditor } from './HubTablesEditor'

const RouteMaps = lazy(() => import('./RouteMapsPanel').then((module) => ({ default: module.AzRouteMapsPanel })))
const VpnNat = lazy(() => import('../VpnNatEditor').then((module) => ({ default: module.VpnNatHubEditor })))

export function HubConfiguration({ hub, topology, commit, onAttach, onFirewallSnat, onClose, onError,
  focusFirewall, initialOpen, learningAnchor }: {
  hub: AzVwanHub
  topology: AzNetTopology
  commit: (update: (draft: AzNetTopology) => void) => boolean
  onAttach: (vnetId: string) => void
  onFirewallSnat: () => void
  onClose: () => void
  onError: (message: string) => void
  focusFirewall: boolean
  initialOpen: boolean
  learningAnchor: string
}) {
  const update = (patch: Partial<AzVwanHub>) => commit((draft) => {
    Object.assign(draft.vwanHubs.find((entry) => entry.id === hub.id)!, patch)
  })
  return <div data-testid={`aznet-vwanhub-config-${hub.id}`} data-learning-anchor={learningAnchor}>
    <InspectorSection title={t('Virtual WAN hub configuration')} summary={`${hub.name} · ${hub.prefix ?? ''}`} initialOpen>
      <div className="aznet-card">
        <h3>{hub.name}</h3>
        <div className="aznet-field-grid">
          <label className="field">{t('Hub name')}<input className="aznet-input" value={hub.name} maxLength={120}
            onChange={(event) => update({ name: event.target.value })} /></label>
          <label className="field">{t('Azure Region')}<AzureRegionSelect className="aznet-select" value={hub.region ?? ''}
            onChange={(event) => update({ region: event.target.value })} /></label>
          <label className="field">{t('Hub address prefix')}<input className="aznet-input" value={hub.prefix ?? ''}
            onChange={(event) => update({ prefix: event.target.value })} /></label>
          <label className="field">{t('Routing preference')}<select className="aznet-select" value={hub.preference}
            onChange={(event) => update({ preference: event.target.value as AzVwanHub['preference'] })}>
            <option value="ExpressRoute">ExpressRoute</option><option value="VPN">VPN</option><option value="ASPath">ASPath</option>
          </select></label>
        </div>
      </div>
    </InspectorSection>
    <HubTablesEditor hub={hub} topology={topology} commit={commit} onAttach={onAttach}
      initialOpen={initialOpen} focusFirewall={focusFirewall}>
      <form onSubmit={(event) => {
        event.preventDefault()
        const prefixes = String(new FormData(event.currentTarget).get('prefixes') ?? '').split(/[,\s]+/).filter(Boolean)
        if (prefixes.some((prefix) => !cidr(prefix))) { onError(t('Enter valid IPv4 CIDR prefixes.')); return }
        commit((draft) => { draft.vwanHubs.find((entry) => entry.id === hub.id)!.routingIntent.privatePrefixes = prefixes })
      }}>
        <label className="field">{t('Private routing intent prefixes')}<input name="prefixes"
          defaultValue={hub.routingIntent.privatePrefixes?.join(', ') ?? ''}
          data-configuration-saved={hub.routingIntent.privatePrefixes?.join(', ') ?? ''} /></label>
        <button type="submit">{t('Save private routing prefixes')}</button>
      </form>
      <label className="aznet-hover-toggle"><input type="checkbox" checked={topology.allowBranchToBranchTraffic !== false}
        onChange={(event) => {
          const enabled = event.target.checked
          commit((draft) => { draft.allowBranchToBranchTraffic = enabled })
        }} />{t('WAN branch-to-branch route propagation')}</label>
      <p className="muted">{t('Disabling branch propagation does not disable hub learning, VNet connectivity, site links or ExpressRoute Global Reach. This is not a packet-filtering guarantee.')}</p>
    </HubTablesEditor>
    <InspectorSection title={t('Route maps')} summary={t('{0} route maps',
      topology.routeMaps?.filter((map) => map.hubId === hub.id).length ?? 0)} initialOpen={false}>
      <Suspense fallback={null}><RouteMaps key={hub.id} embedded topology={topology} hubId={hub.id}
        onSave={(next) => commit((draft) => Object.assign(draft, next))} onClose={onClose} /></Suspense>
    </InspectorSection>
    <InspectorSection title={t('Firewall NAT')} summary={t('Firewall SNAT')} initialOpen={false}>
      <p>{t('Firewall SNAT is separate from VPN overlap NAT and its connection-owned rules.')}</p>
      <button type="button" onClick={onFirewallSnat}>{t('Firewall SNAT')}</button>
    </InspectorSection>
    <InspectorSection title={t('VPN NAT')} summary={t('Gateway capability and connection-owned mapping rules')} initialOpen={false}>
      <Suspense fallback={null}><VpnNat key={hub.id} hubId={hub.id} topology={topology} commit={commit} /></Suspense>
    </InspectorSection>
  </div>
}
