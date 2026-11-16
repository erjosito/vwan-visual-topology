import type { CourseBundle } from './course-contract'
import { courseScenarios } from './course-scenarios'

// Contract fixtures only: not imported by the existing learning UI.
export const exampleCourse: CourseBundle = {
  schemaVersion: 1,
  course: {
    id: 'azure-networking-preview', contentVersion: 1, publication: 'preview',
    title: { en: 'Guided course contract examples', ja: 'ガイド付きコースの契約例' },
    lessonOrder: ['direct-peering', 'route-override'],
    belts: [
      { id: 'white', name: { en: 'White belt', ja: '白帯' }, color: '#ffffff', pointsRequired: 0, checkpointTaskIds: [] },
      { id: 'yellow', name: { en: 'Yellow belt', ja: '黄帯' }, color: '#eab308', pointsRequired: 100, checkpointTaskIds: ['peering.explain'] },
    ],
  },
  scenarios: courseScenarios,
  lessons: [
    {
      id: 'direct-peering', contentVersion: 1, scenarioId: 'two-vnets', prerequisites: [],
      title: { en: 'Connect two Azure VNets', ja: '2 つの Azure VNet を接続' },
      objective: { en: 'Predict, create and explain direct peering and its routes in both directions.', ja: '直接ピアリングと双方向のルートを予測し、作成して説明します。' },
      taskOrder: ['peering.load', 'peering.predict', 'peering.inspect-before', 'peering.connect', 'peering.inspect-after', 'peering.verify', 'peering.explain'],
      tasks: [
        {
          id: 'peering.load', assessmentVersion: 1, awardId: 'peering.load', points: 5,
          title: { en: 'Load the practice network', ja: '練習ネットワークを読み込む' },
          instruction: { en: 'Load two isolated VNets into the practice canvas. This does not deploy Azure resources.', ja: '分離された 2 つの VNet を練習キャンバスに読み込みます。Azure リソースはデプロイしません。' },
          checkId: 'load-peering', guidanceIds: [], hints: [],
        },
        {
          id: 'peering.predict', assessmentVersion: 1, awardId: 'peering.predict', points: 15,
          title: { en: 'Predict connectivity', ja: '接続性を予測する' },
          instruction: { en: 'Before editing, predict whether the two workload subnets can exchange private traffic.', ja: '編集前に、2 つのワークロード サブネットがプライベート通信できるか予測してください。' },
          checkId: 'predict-isolation', guidanceIds: [], hints: [],
        },
        {
          id: 'peering.inspect-before', assessmentVersion: 1, awardId: 'peering.inspect-before', points: 5,
          title: { en: 'Inspect the starting routes', ja: '開始時のルートを調べる' },
          instruction: { en: 'Inspect subnet work-a for an exact route to 10.2.0.0/16. A default route is not a peering route.', ja: 'work-a で 10.2.0.0/16 の完全一致ルートを確認します。既定ルートはピアリング ルートではありません。' },
          checkId: 'inspect-a', guidanceIds: ['routes-a'], hints: [],
        },
        {
          id: 'peering.connect', assessmentVersion: 1, awardId: 'peering.connect', points: 30,
          title: { en: 'Peer VNet A with VNet B', ja: 'VNet A と VNet B をピアリングする' },
          instruction: { en: 'Create a direct enabled peering with virtual network access allowed in both directions.', ja: '両方向の仮想ネットワーク アクセスを許可した直接ピアリングを作成して有効にします。' },
          checkId: 'peer-a-b', guidanceIds: ['peer-command'],
          hints: [{ en: 'Use Show me where to locate the command. Navigation help never costs points.', ja: '「場所を表示」でコマンドを探せます。操作場所の案内でポイントは減りません。' }],
        },
        {
          id: 'peering.inspect-after', assessmentVersion: 1, awardId: 'peering.inspect-after', points: 5,
          title: { en: 'Inspect the new route', ja: '新しいルートを調べる' },
          instruction: { en: 'Inspect work-a again and locate 10.2.0.0/16. Compare it with the original table.', ja: 'work-a を再度調べ、10.2.0.0/16 を探して元のテーブルと比較します。' },
          checkId: 'inspect-a', guidanceIds: ['routes-a'], hints: [],
        },
        {
          id: 'peering.verify', assessmentVersion: 1, awardId: 'peering.verify', points: 20,
          title: { en: 'Verify the forward and return paths', ja: '往路と復路を検証する' },
          instruction: { en: 'Check the exact peering route and bidirectional forwarding between 10.1.1.4 and 10.2.1.4.', ja: '10.1.1.4 と 10.2.1.4 間の完全一致ピアリング ルートと双方向の転送を確認します。' },
          checkId: 'connected', guidanceIds: ['routes-a'], hints: [],
        },
        {
          id: 'peering.explain', assessmentVersion: 1, awardId: 'peering.explain', points: 20,
          title: { en: 'Explain peering scope', ja: 'ピアリングの範囲を説明する' },
          instruction: { en: 'Apply what changed to a third VNet, rather than memorizing a menu location.', ja: 'メニューの位置を覚えるのではなく、変更の意味を 3 つ目の VNet に適用してください。' },
          checkId: 'explain-nontransitive', guidanceIds: [], hints: [],
        },
      ],
    },
    {
      id: 'route-override', contentVersion: 1, scenarioId: 'peered-with-drop', prerequisites: ['direct-peering'],
      title: { en: 'Checkpoint: a route overrides peering', ja: 'チェックポイント: ピアリングを上書きするルート' },
      objective: { en: 'Diagnose a selected equal-prefix UDR, restore both paths, and explain route preference. This is one advanced example, not a complete advanced curriculum.', ja: '同じプレフィックスの選択済み UDR を診断し、双方向の経路を復元してルートの優先順位を説明します。これは高度な例の一つで、上級カリキュラム全体ではありません。' },
      taskOrder: ['override.load', 'override.inspect', 'override.repair', 'override.explain'],
      tasks: [
        {
          id: 'override.load', assessmentVersion: 1, awardId: 'override.load', points: 5,
          title: { en: 'Load the conflicting route', ja: '競合ルートを読み込む' },
          instruction: { en: 'Load the checkpoint starter explicitly; the original practice attempt remains separate.', ja: 'チェックポイントの初期構成を明示的に読み込みます。元の練習は別に保持されます。' },
          checkId: 'load-override', guidanceIds: [], hints: [],
        },
        {
          id: 'override.inspect', assessmentVersion: 1, awardId: 'override.inspect', points: 5,
          title: { en: 'Find the selected next hop', ja: '選択されたネクストホップを探す' },
          instruction: { en: 'Inspect the 10.2.0.0/16 candidates in work-a. Why is the enabled peering not enough?', ja: 'work-a の 10.2.0.0/16 の候補を調べます。有効なピアリングだけではなぜ不十分ですか。' },
          checkId: 'inspect-a', guidanceIds: ['routes-a'], hints: [],
        },
        {
          id: 'override.repair', assessmentVersion: 1, awardId: 'override.repair', points: 40,
          title: { en: 'Restore the modeled paths', ja: 'モデルの経路を復元する' },
          instruction: { en: 'Repair the routing policy without changing endpoint ownership. A valid supported alternative forwarding design may also pass.', ja: 'エンドポイントの所有関係を変えずにルーティング ポリシーを修復します。別の有効でサポートされる転送設計でも達成できます。' },
          checkId: 'flow-restored', guidanceIds: ['repair-drop'],
          hints: [{ en: 'The exact-prefix UDR with next hop None is selected ahead of peering. Inspect its association before changing peering flags.', ja: 'ネクストホップ None の完全一致 UDR はピアリングより優先されます。ピアリングの設定を変える前に関連付けを調べてください。' }],
        },
        {
          id: 'override.explain', assessmentVersion: 1, awardId: 'override.explain', points: 25,
          title: { en: 'Explain the winning route', ja: '優先ルートを説明する' },
          instruction: { en: 'Explain why this UDR won; do not generalize equal-prefix preference to different prefix lengths.', ja: 'この UDR が優先された理由を説明します。同じプレフィックスの優先順位を異なる長さのプレフィックスに一般化しないでください。' },
          checkId: 'explain-udr', guidanceIds: [], hints: [],
        },
      ],
    },
  ],
  checks: [
    { id: 'load-peering', kind: 'scenario.loaded', params: { scenarioId: 'two-vnets' } },
    { id: 'load-override', kind: 'scenario.loaded', params: { scenarioId: 'peered-with-drop' } },
    { id: 'inspect-a', kind: 'routes.inspected', params: { vnetId: 'a', subnetId: 'work-a', prefix: '10.2.0.0/16' } },
    { id: 'peer-a-b', kind: 'vnet.peered', params: { vnetAId: 'a', vnetBId: 'b' } },
    {
      id: 'connected', kind: 'requirements.satisfied',
      params: { requirements: [
        { id: 'route-b', kind: 'route', table: 'work-a', prefix: '10.2.0.0/16', expectation: 'present' },
        { id: 'workload-flow', kind: 'flow', source: { kind: 'subnet', vnetId: 'a', subnetId: 'work-a' },
          target: { kind: 'subnet', vnetId: 'b', subnetId: 'work-b' }, sourceAddress: '10.1.1.4', destinationAddress: '10.2.1.4', expectation: 'allow' },
      ] },
    },
    {
      id: 'flow-restored', kind: 'requirements.satisfied',
      params: { requirements: [
        { id: 'restored-flow', kind: 'flow', source: { kind: 'subnet', vnetId: 'a', subnetId: 'work-a' },
          target: { kind: 'subnet', vnetId: 'b', subnetId: 'work-b' }, sourceAddress: '10.1.1.4', destinationAddress: '10.2.1.4', expectation: 'allow' },
      ] },
    },
    {
      id: 'predict-isolation', kind: 'quiz.answered',
      params: {
        question: { en: 'Can these two isolated VNets exchange private traffic?', ja: '分離されたこの 2 つの VNet はプライベート通信できますか。' },
        correctChoiceId: 'no-connection',
        choices: [
          { id: 'same-region', text: { en: 'Yes, because they share a region.', ja: '同じリージョンなので可能です。' },
            feedback: { en: 'A shared region does not establish private connectivity.', ja: '同じリージョンであることはプライベート接続を確立しません。' } },
          { id: 'no-connection', text: { en: 'No, there is no connecting path.', ja: '接続経路がないため不可能です。' },
            feedback: { en: 'Correct. Separate VNet address spaces need a supported connecting path.', ja: '正解です。別々の VNet アドレス空間にはサポートされる接続経路が必要です。' } },
        ],
      },
    },
    {
      id: 'explain-nontransitive', kind: 'quiz.answered',
      params: {
        question: { en: 'If B is also peered with C, does A automatically reach C through B?', ja: 'B が C ともピアリングすると、A は B 経由で自動的に C に到達しますか。' },
        correctChoiceId: 'not-transitive',
        choices: [
          { id: 'automatic', text: { en: 'Yes, peering is transitive.', ja: 'はい、ピアリングには推移性があります。' },
            feedback: { en: 'Ordinary VNet peering does not provide automatic transit.', ja: '通常の VNet ピアリングでは自動転送は提供されません。' } },
          { id: 'not-transitive', text: { en: 'No, a supported direct or transit design is required.', ja: 'いいえ、サポートされる直接接続または転送設計が必要です。' },
            feedback: { en: 'Correct. A-B and B-C peerings alone do not connect A to C.', ja: '正解です。A-B と B-C のピアリングだけでは A と C は接続されません。' } },
        ],
      },
    },
    {
      id: 'explain-udr', kind: 'quiz.answered',
      params: {
        question: { en: 'Why does this /16 UDR override the peering /16 route?', ja: 'この /16 UDR がピアリングの /16 ルートを上書きするのはなぜですか。' },
        correctChoiceId: 'same-prefix',
        choices: [
          { id: 'always-udr', text: { en: 'UDRs always beat more-specific routes.', ja: 'UDR は常により具体的なルートより優先されます。' },
            feedback: { en: 'Longest-prefix matching happens first; do not ignore prefix length.', ja: '最長プレフィックス一致が最初に行われます。プレフィックス長を無視しないでください。' } },
          { id: 'same-prefix', text: { en: 'For the same prefix, the UDR has higher preference.', ja: '同じプレフィックスでは UDR の優先順位が高いためです。' },
            feedback: { en: 'Correct. Equal-prefix preference selects the UDR; None drops the traffic.', ja: '正解です。同じプレフィックスの優先順位で UDR が選択され、None が通信を破棄します。' } },
        ],
      },
    },
  ],
  guidance: [
    { id: 'routes-a', action: 'routes.open', params: { vnetId: 'a', subnetId: 'work-a', prefix: '10.2.0.0/16' },
      instruction: { en: 'Open effective routes for Workload A / work-a and inspect this prefix, including its absence.', ja: 'Workload A / work-a の有効なルートを開き、このプレフィックスの有無を調べます。' } },
    { id: 'peer-command', action: 'peering.command', params: { vnetAId: 'a', vnetBId: 'b' },
      instruction: { en: 'Locate Workload A, open Peer with VNet, and highlight Workload B. You execute the command.', ja: 'Workload A の「Peer with VNet」を開き、Workload B を強調表示します。コマンドは自分で実行します。' } },
    { id: 'repair-drop', action: 'route-table.configure',
      params: { vnetId: 'a', subnetId: 'work-a', routeTableId: 'blocking', routeId: 'drop-b' },
      instruction: { en: 'Reveal the associated route table and highlight the selected drop route. You decide the routing repair.', ja: '関連付けられたルート テーブルを開き、選択された破棄ルートを強調表示します。修復方法は自分で決めます。' } },
  ],
}
