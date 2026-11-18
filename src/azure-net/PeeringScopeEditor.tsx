import { useState } from 'react'
import { t } from '../i18n'
import { registerJapaneseMessages } from '../messages'
import type { AzNetTopology, AzVnetPeering } from './model'
import { subnetPeeringLimitations, validateSubnetPeeringScopes } from './subnet-peering'

registerJapaneseMessages({
  'Peering scope': 'ピアリングの範囲',
  'Whole VNet': 'VNet 全体',
  'Selected subnets': '選択したサブネット',
  'Participating subnets in {0}': '{0} の参加サブネット',
  'Apply peering scope': 'ピアリングの範囲を適用',
  'Changing peering type changes this design only. Azure requires deleting and recreating the peering to change its type; membership edits update and synchronize the existing link.': '種類の変更はこの設計にのみ適用されます。Azure で種類を変更するにはピアリングの削除と再作成が必要です。参加サブネットの変更は既存リンクの更新と同期で行います。',
  'Current preview: nonparticipating local subnets can see remote participating-subnet routes, but forwarding requires participation on both ends. This is not an NSG or route-suppression setting.': '現在のプレビューでは、参加していないローカル サブネットにもリモートの参加サブネットへのルートが表示されますが、転送には両端の参加が必要です。NSG やルート抑制の設定ではありません。',
  'Subscription allowlisting, current VM SKU prerequisites and live Azure enablement are not verified. IPv6 and delegated-subnet over-advertisement are not assessed.': 'サブスクリプションの許可リスト、現在の VM SKU 要件、Azure での有効化は確認されていません。IPv6 と委任サブネットの過剰広告は未評価です。',
})

export default function PeeringScopeEditor({ topology, peering, onApply }: {
  topology: AzNetTopology; peering: AzVnetPeering; onApply: (scope: NonNullable<AzVnetPeering['scope']>) => void
}) {
  const [type, setType] = useState(peering.scope?.type ?? 'whole-vnet')
  const [aIds, setAIds] = useState(peering.scope?.type === 'subnets' ? peering.scope.subnetAIds : [])
  const [bIds, setBIds] = useState(peering.scope?.type === 'subnets' ? peering.scope.subnetBIds : [])
  const scope: NonNullable<AzVnetPeering['scope']> = type === 'subnets'
    ? { type, subnetAIds: aIds, subnetBIds: bIds } : { type }
  const proposed = { ...topology, vnetPeerings: topology.vnetPeerings.map((item) => item.id === peering.id ? { ...item, scope } : item) }
  const errors = validateSubnetPeeringScopes(proposed)
  const sides: [string, string[], (ids: string[]) => void][] = [[peering.vnetAId, aIds, setAIds], [peering.vnetBId, bIds, setBIds]]
  return <fieldset data-testid="peering-scope-editor" className="peering-scope-editor">
    <legend>{t('Peering scope')}</legend>
    <label className="field"><span>{t('Peering scope')}</span><select aria-label={t('Peering scope')} value={type} onChange={(event) => setType(event.target.value as typeof type)}>
      <option value="whole-vnet">{t('Whole VNet')}</option><option value="subnets">{t('Selected subnets')}</option>
    </select></label>
    <p>{t('Changing peering type changes this design only. Azure requires deleting and recreating the peering to change its type; membership edits update and synchronize the existing link.')}</p>
    {type === 'subnets' && <>
      <p>{t('Current preview: nonparticipating local subnets can see remote participating-subnet routes, but forwarding requires participation on both ends. This is not an NSG or route-suppression setting.')}</p>
      <p className="muted">{t('Subscription allowlisting, current VM SKU prerequisites and live Azure enablement are not verified. IPv6 and delegated-subnet over-advertisement are not assessed.')}</p>
      {sides.map(([vnetId, selected, update]) => {
        const owner = topology.vnets.find((vnet) => vnet.id === vnetId)
        return <fieldset key={vnetId}><legend>{t('Participating subnets in {0}', owner?.name ?? vnetId)}</legend>
          {owner?.subnets.map((subnet) => <label key={subnet.id} className="aznet-checkbox-row"><input type="checkbox"
            aria-label={`${owner.name}: ${subnet.name} (${subnet.id})`} checked={selected.includes(subnet.id)}
            onChange={(event) => update(event.target.checked ? [...selected, subnet.id] : selected.filter((id) => id !== subnet.id))} />
            {subnet.name} · {subnet.prefix} · {subnet.id}</label>)}
          {selected.filter((id) => !owner?.subnets.some((subnet) => subnet.id === id)).map((id) => <label key={id}><input type="checkbox" checked
            onChange={() => update(selected.filter((candidate) => candidate !== id))} />{id} ({t('Unavailable')})</label>)}
        </fieldset>
      })}
    </>}
    {errors.map((error) => <p role="status" key={error}>{error}</p>)}
    {subnetPeeringLimitations(proposed).map((reason) => <p role="status" key={reason}>{reason}</p>)}
    <button type="button" disabled={errors.length > 0} onClick={() => onApply(scope)}>{t('Apply peering scope')}</button>
  </fieldset>
}
