import type { PlatformDocument, Requirement } from '../platform/contract'
import { createEmptyAzNetTopology } from '../azure-net/model'
import type { Localized, ConceptId } from './content'
import { connectivityExercises } from './connectivity-exercises'

export type Exercise = {
  id: string
  version: number
  title: Localized
  objective: Localized
  requirements: Requirement[]
  hints: Localized[]
  concepts: ConceptId[]
  prerequisites: string[]
  starter: PlatformDocument
}

function network(mode: 'hub-spoke' | 'full'): PlatformDocument {
  const topology = createEmptyAzNetTopology()
  topology.name = 'Two owned workload networks'
  topology.vnets = ['a', 'b'].map((id, index) => ({
    id, name: `Workload ${id.toUpperCase()}`, role: 'spoke', region: 'swedencentral',
    prefixes: [`10.${index + 1}.0.0/16`],
    subnets: [{ id: `work-${id}`, name: 'Workload', prefix: `10.${index + 1}.1.0/24` }],
    gateways: [], appliances: [],
  }))
  if (mode === 'full') {
    topology.vwanHubs = [{
      id: 'hub', name: 'Virtual hub', region: 'swedencentral', preference: 'ExpressRoute',
      routingIntent: { private: false, internet: false },
    }]
    topology.vnets[0].vwanHubAttachment = { hubId: 'hub', enabled: true }
  }
  return { mode, topology }
}

const networkRequirement: Requirement = {
  id: 'workload-connectivity', kind: 'flow',
  source: { kind: 'subnet', vnetId: 'a', subnetId: 'work-a' },
  target: { kind: 'subnet', vnetId: 'b', subnetId: 'work-b' },
  sourceAddress: '10.1.1.4', destinationAddress: '10.2.1.4', expectation: 'allow',
}

export const exercises: Exercise[] = [
  {
    id: 'vwan-connect', version: 1,
    title: { en: 'Connect two Virtual WAN spokes', ja: 'Virtual WAN の 2 つのスポークを接続' },
    objective: { en: 'Deliver traffic in both directions between 10.1.0.4 in spoke a and 10.2.0.4 in spoke b. Keep these endpoint IDs and address ownership; choose your own valid hub arrangement. The starter deliberately has an unassessable propagation scope. Repair it or simplify the hub arrangement; not assessed must never be treated as a pass or verified isolation.', ja: 'スポーク a の 10.1.0.4 とスポーク b の 10.2.0.4 を双方向で接続してください。エンドポイント ID とアドレスの所有関係を保ち、ハブの配置は自由に設計できます。初期構成の伝達スコープは評価不能です。修正するかハブ配置を簡素化してください。評価不能は達成や検証済みの分離を意味しません。' },
    requirements: [{
      id: 'spoke-connectivity', kind: 'flow',
      source: { kind: 'spoke', id: 'a' }, target: { kind: 'spoke', id: 'b' },
      sourceAddress: '10.1.0.4', destinationAddress: '10.2.0.4', expectation: 'allow',
    }],
    hints: [
      { en: 'Inspect route-table scope at both spokes and both hubs before changing a preference.', ja: '優先設定を変える前に、両方のスポークとハブのテーブルのスコープを確認してください。' },
      { en: 'You may attach both spokes to one hub, or repair route export between separate hubs. More than one design can pass.', ja: '同じハブに両方を接続するか、別々のハブ間のルートのエクスポートを修正できます。複数の設計が合格します。' },
    ],
    concepts: ['contexts', 'selection', 'coverage'], prerequisites: [],
    starter: {
      mode: 'vwan',
      topology: {
        version: 1, name: 'Two spoke practice',
        hubs: ['one', 'two'].map((id) => ({
          id, name: `Hub ${id}`, region: 'swedencentral', preference: 'ExpressRoute',
          routingIntent: { private: false, internet: false, privatePrefixes: [] },
          ...(id === 'two' ? { routeTables: [{ id: 'defaultRouteTable', name: 'Default', labels: [] }] } : {}),
        })),
        spokes: [
          { id: 'a', name: 'Workload A', hubId: 'one', prefixes: ['10.1.0.0/16'] },
          { id: 'b', name: 'Workload B', hubId: 'two', prefixes: ['10.2.0.0/16'],
            hubRouting: { status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: [], labels: [] } },
        ],
        sites: [], connections: [], siteLinks: [],
      },
    },
  },
  {
    id: 'peering-connect', version: 1,
    title: { en: 'Restore bidirectional VNet connectivity', ja: 'VNet の双方向接続を復元' },
    objective: { en: 'Connect workload subnet work-a in VNet a (10.1.1.4) to subnet work-b in VNet b (10.2.1.4), including the return path. Keep endpoint IDs and address ownership. Choose peering or another supported forwarding design; matching a reference topology is not required.', ja: 'VNet a のサブネット work-a（10.1.1.4）と VNet b のサブネット work-b（10.2.1.4）を戻り経路も含めて接続してください。ID とアドレスの所有関係を保ちます。ピアリングや他のサポートされる転送設計を選択でき、参照トポロジとの一致は不要です。' },
    requirements: [networkRequirement],
    hints: [
      { en: 'Check the workload subnet tables, and remember that connectivity must work in both directions.', ja: 'ワークロードのサブネット テーブルを確認してください。接続は双方向で必要です。' },
      { en: 'A direct peering with virtual-network access enabled in both directions is one solution. A supported transit design can also satisfy the same flow.', ja: '両方向の仮想ネットワーク アクセスを許可する直接ピアリングが一つの解です。サポートされる転送設計でも同じフローを満たせます。' },
    ],
    concepts: ['peering', 'selection', 'coverage'], prerequisites: [],
    starter: network('hub-spoke'),
  },
  {
    id: 'hybrid-connect', version: 1,
    title: { en: 'Connect workloads in Full Hybrid', ja: 'Full Hybrid でワークロードを接続' },
    objective: { en: 'Connect the same two owned workload subnets through a supported Full Hybrid design. The starter attaches only VNet a to a virtual hub. You can use hub attachments, peering, or a different modeled design; both forward and return delivery are required.', ja: 'Full Hybrid のサポートされる設計で同じ 2 つのワークロードのサブネットを接続してください。初期構成では VNet a だけが仮想ハブに接続されています。ハブ接続、ピアリング、その他のモデル化された設計を使用でき、往路と復路の配信が必要です。' },
    requirements: [networkRequirement],
    hints: [
      { en: 'Inspect the disconnected VNet and its workload table. A hub drawn on the canvas does not automatically connect a VNet.', ja: '未接続の VNet とワークロード テーブルを確認してください。ハブが描かれていても VNet は自動的に接続されません。' },
      { en: 'Attaching VNet b to the existing hub is one solution. Direct peering is another for this connectivity-only requirement.', ja: 'VNet b を既存のハブに接続する方法が一つの解です。接続だけが要件のため、直接ピアリングも解になります。' },
    ],
    concepts: ['peering', 'contexts', 'coverage'], prerequisites: ['peering-connect'],
    starter: network('full'),
  },
  ...connectivityExercises,
]
