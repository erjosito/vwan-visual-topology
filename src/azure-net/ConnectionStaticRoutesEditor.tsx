import { useState } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import { cidr } from '../validation'
import type { AzNetTopology, AzVNet } from './model'
import { connectionStaticLimitations } from './vnet-connection-routes'

registerJapaneseMessages({
  'Connection static routes': '接続の静的ルート',
  'Propagate static route': '静的ルートを伝達',
  'Indirect spoke prefixes': '間接スポークのプレフィックス',
  'Spoke Firewall/NVA next hop': 'スポーク Firewall/NVA の次ホップ',
  'Add connection static route': '接続の静的ルートを追加',
  'Remove connection static route {0}': '接続の静的ルート {0} を削除',
  'Peer indirect spokes to this VNet and add return UDRs pointing to this Firewall/NVA. Do not attach the indirect spokes to the virtual hub.': '間接スポークをこの VNet にピアリングし、この Firewall/NVA を指す戻り経路の UDR を追加してください。間接スポークは仮想ハブに接続しないでください。',
  'Choose a next hop': '次ホップを選択',
  'No connection static routes': '接続の静的ルートはありません',
})

export function ConnectionStaticRoutesEditor({ vnet, topology, commit }: {
  vnet: AzVNet
  topology: AzNetTopology
  commit: (update: (draft: AzNetTopology) => void) => void
}) {
  const [prefixes, setPrefixes] = useState('')
  const [nextHop, setNextHop] = useState('')
  const routes = vnet.vwanHubAttachment!.staticRoutes ?? []
  const parsed = [...new Set(prefixes.split(',').map((prefix) => prefix.trim()).filter(Boolean))]
  const valid = parsed.length > 0 && parsed.every((prefix) => cidr(prefix)) && routes.length < 64 &&
    routes.reduce((count, route) => count + route.addressPrefixes.length, parsed.length) <= 256 &&
    vnet.appliances.some((app) => app.privateIp === nextHop && app.kind !== 'vnra')
  const limitations = connectionStaticLimitations(topology, vnet)
  return <section aria-label={`${t('Connection static routes')} · ${vnet.name}`} data-testid={`connection-static-${vnet.id}`}>
    <h5>{t('Connection static routes')}</h5>
    <p>{t('Peer indirect spokes to this VNet and add return UDRs pointing to this Firewall/NVA. Do not attach the indirect spokes to the virtual hub.')}</p>
    <label className="aznet-toggle-row"><input type="checkbox"
      checked={vnet.vwanHubAttachment!.propagateStaticRoutes === true}
      onChange={(event) => {
        const checked = event.target.checked
        commit((draft) => { draft.vnets.find((entry) => entry.id === vnet.id)!.vwanHubAttachment!.propagateStaticRoutes = checked })
      }} />{t('Propagate static route')}</label>
    {routes.length ? <ul>{routes.map((route) => <li key={route.name}>
      <code>{route.addressPrefixes.join(', ')} → {route.nextHopIpAddress}</code>{' '}
      <button type="button" className="aznet-btn" aria-label={t('Remove connection static route {0}', route.name)}
        onClick={() => commit((draft) => {
          const owner = draft.vnets.find((entry) => entry.id === vnet.id)!.vwanHubAttachment!
          owner.staticRoutes = owner.staticRoutes!.filter((entry) => entry.name !== route.name)
        })}>{t('Remove')}</button>
    </li>)}</ul> : <p>{t('No connection static routes')}</p>}
    <label>{t('Indirect spoke prefixes')}<input className="aznet-input" value={prefixes} placeholder="10.2.0.0/16"
      onChange={(event) => setPrefixes(event.target.value)} /></label>
    <label>{t('Spoke Firewall/NVA next hop')}<select className="aznet-select" value={nextHop}
      aria-label={t('Spoke Firewall/NVA next hop')}
      onChange={(event) => setNextHop(event.target.value)}>
      <option value="">{t('Choose a next hop')}</option>
      {vnet.appliances.filter((app) => app.kind !== 'vnra').map((app) =>
        <option key={app.id} value={app.privateIp}>{app.name} · {app.privateIp}</option>)}
    </select></label>
    <button type="button" className="aznet-btn" disabled={!valid} onClick={() => {
      commit((draft) => {
        const owner = draft.vnets.find((entry) => entry.id === vnet.id)!.vwanHubAttachment!
        ;(owner.staticRoutes ??= []).push({
          name: `indirect-${crypto.randomUUID()}`, addressPrefixes: parsed, nextHopIpAddress: nextHop,
        })
        owner.propagateStaticRoutes = true
      })
      setPrefixes('')
    }}>{t('Add connection static route')}</button>
    {limitations.map((reason) => <p role="status" key={reason}>{reason}</p>)}
  </section>
}
