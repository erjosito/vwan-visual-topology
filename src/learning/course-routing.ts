import type { CourseBundle } from './course-contract'
import { gatewayCheckpoint, prefixCheckpoint } from './course-profile'

export const routingLessons: CourseBundle['lessons'] = [
  {
    id: 'prefix-outage', contentVersion: 1, scenarioId: 'prefix-outage', prerequisites: ['route-override'],
    title: { en: 'Incident: only one workload is down', ja: '障害: 1 つのワークロードだけが停止' },
    objective: { en: 'Restore the application without confusing longest-prefix matching with equal-prefix preference.', ja: '最長プレフィックス一致と同じプレフィックスの優先順位を区別して、アプリケーションの経路を復旧します。' },
    taskOrder: ['prefix.load', 'prefix.predict', 'prefix.inspect', 'prefix.repair', 'prefix.verify', 'prefix.explain'],
    tasks: [
      {
        id: 'prefix.load', assessmentVersion: 1, awardId: 'prefix.load', points: 5,
        title: { en: 'Open the partial-outage incident', ja: '一部停止の障害を開く' },
        instruction: { en: 'Confirm loading the incident into protected practice. Workload B now has application and batch subnets; the peering is already enabled.', ja: '保護された練習への障害構成の読み込みを確認します。Workload B にはアプリとバッチのサブネットがあり、ピアリングは既に有効です。' },
        checkId: 'load-prefix', guidanceIds: [], hints: [],
      },
      {
        id: 'prefix.predict', assessmentVersion: 1, awardId: 'prefix.predict', points: 15,
        title: { en: 'Predict which workload is affected', ja: '影響を受けるワークロードを予測する' },
        instruction: { en: 'The source has a /8 discard and a /24 discard, alongside the /16 peering route. Predict traffic from 10.1.1.4 before editing.', ja: '送信元には /16 のピアリング ルートに加え、/8 と /24 の破棄ルートがあります。編集前に 10.1.1.4 からの通信を予測してください。' },
        checkId: 'predict-prefix', guidanceIds: [], hints: [],
      },
      {
        id: 'prefix.inspect', assessmentVersion: 1, awardId: 'prefix.inspect', points: 10,
        title: { en: 'Find the more-specific discard', ja: 'より具体的な破棄ルートを探す' },
        instruction: { en: 'In work-a, inspect 10.2.1.0/24 and compare it with 10.2.0.0/16 and 10.0.0.0/8. An active candidate is not necessarily the longest match for every destination.', ja: 'work-a で 10.2.1.0/24 を調べ、10.2.0.0/16 と 10.0.0.0/8 と比較します。有効な候補がすべての宛先の最長一致になるわけではありません。' },
        checkId: 'inspect-prefix', guidanceIds: ['prefix-routes'], hints: [],
      },
      {
        id: 'prefix.repair', assessmentVersion: 1, awardId: 'prefix.repair', points: 45,
        title: { en: 'Restore the application path', ja: 'アプリケーションの経路を復旧する' },
        instruction: { en: 'Retire the obsolete application quarantine. Both 10.2.1.4 and batch address 10.2.2.4 must be reachable from 10.1.1.4 with return paths. Do not change endpoint addresses.', ja: '不要になったアプリの隔離を解除します。10.1.1.4 から 10.2.1.4 とバッチの 10.2.2.4 の両方に復路を含めて到達できる必要があります。エンドポイントのアドレスは変更しません。' },
        checkId: 'prefix-restored', guidanceIds: ['prefix-repair'],
        hints: [{ en: 'Disabling only the /8 discard will not remove the /24 blocker. Disabling the obsolete /24 route is one valid repair; removing its table association is also accepted.', ja: '/8 の破棄だけを無効にしても /24 の遮断は残ります。不要な /24 の無効化が解決方法の一つです。テーブルの関連付け解除も有効な代替策です。' }],
      },
      {
        id: 'prefix.verify', assessmentVersion: 1, awardId: 'prefix.verify', points: 30,
        title: { en: 'Protect the unaffected batch workload', ja: '影響のなかったバッチも確認する' },
        instruction: { en: 'Recheck both workload addresses on the current canvas. A fix for the application must not break the batch path or either return path.', ja: '現在のキャンバスで両方のワークロードのアドレスを再確認します。アプリの修復でバッチの経路や各復路を壊してはいけません。' },
        checkId: 'prefix-restored', guidanceIds: ['routes-a'], hints: [],
      },
      {
        id: prefixCheckpoint.taskId, assessmentVersion: prefixCheckpoint.assessmentVersion, awardId: 'prefix.explain', points: 45,
        title: { en: 'Explain two destinations, two decisions', ja: '2 つの宛先と異なる判断を説明する' },
        instruction: { en: 'Apply longest-prefix matching to a different address in the same VNet. Do not conclude that a UDR always defeats every peering route.', ja: '同じ VNet の別のアドレスに最長プレフィックス一致を適用します。UDR が常にすべてのピアリング ルートより優先されるとは限りません。' },
        checkId: prefixCheckpoint.checkId, guidanceIds: [], hints: [],
      },
    ],
  },
  {
    id: 'gateway-return', contentVersion: 1, scenarioId: 'gateway-return', prerequisites: ['prefix-outage'],
    title: { en: 'Incident: the branch cannot reply', ja: '障害: 拠点からの応答が届かない' },
    objective: { en: 'Diagnose a preconfigured shared VPN gateway and BGP transit path by separating source routing from gateway return routing.', ja: '送信元の経路とゲートウェイの復路を区別して、構成済みの共有 VPN ゲートウェイと BGP 転送を診断します。' },
    taskOrder: ['gateway.load', 'gateway.predict', 'gateway.inspect-forward', 'gateway.inspect-return', 'gateway.repair', 'gateway.verify', 'gateway.explain'],
    tasks: [
      {
        id: 'gateway.load', assessmentVersion: 1, awardId: 'gateway.load', points: 5,
        title: { en: 'Open the branch incident', ja: '拠点の障害を開く' },
        instruction: { en: 'Load the protected incident. Workload A uses the classic hub VPN gateway; gateway transit, remote-gateway use and BGP are already configured.', ja: '保護された障害構成を読み込みます。Workload A は従来型ハブの VPN ゲートウェイを使用し、ゲートウェイ転送、リモート ゲートウェイの使用、BGP は構成済みです。' },
        checkId: 'load-gateway', guidanceIds: [], hints: [],
      },
      {
        id: 'gateway.predict', assessmentVersion: 1, awardId: 'gateway.predict', points: 25,
        title: { en: 'Challenge the one-table diagnosis', ja: '1 つのテーブルだけの診断を疑う' },
        instruction: { en: 'A colleague sees the branch route in work-a and declares the incident solved. Decide what that evidence actually proves.', ja: '同僚は work-a の拠点ルートを見て解決済みと判断しました。その根拠で実際に何が分かるか判断してください。' },
        checkId: 'predict-gateway', guidanceIds: [], hints: [],
      },
      {
        id: 'gateway.inspect-forward', assessmentVersion: 1, awardId: 'gateway.inspect-forward', points: 10,
        title: { en: 'Inspect the learned branch prefix', ja: '学習した拠点プレフィックスを調べる' },
        instruction: { en: 'Inspect 172.16.0.0/24 in work-a. Identify the remote virtual network gateway as the next hop; this alone says nothing about successful replies.', ja: 'work-a で 172.16.0.0/24 を調べます。リモート仮想ネットワーク ゲートウェイがネクストホップであることを確認します。これだけでは応答の成功は分かりません。' },
        checkId: 'inspect-branch', guidanceIds: ['branch-routes'], hints: [],
      },
      {
        id: 'gateway.inspect-return', assessmentVersion: 1, awardId: 'gateway.inspect-return', points: 10,
        title: { en: 'Inspect the gateway return decision', ja: 'ゲートウェイの復路の判断を調べる' },
        instruction: { en: 'Switch to the hub GatewaySubnet, not work-a. Inspect 10.1.0.0/16 and identify which route wins for replies to the workload.', ja: 'work-a ではなくハブの GatewaySubnet に切り替えます。10.1.0.0/16 を調べ、ワークロードへの応答で優先されるルートを確認します。' },
        checkId: 'inspect-gateway-return', guidanceIds: ['gateway-return-routes'], hints: [],
      },
      {
        id: 'gateway.repair', assessmentVersion: 1, awardId: 'gateway.repair', points: 65,
        title: { en: 'Restore replies through the shared gateway', ja: '共有ゲートウェイ経由の応答を復旧する' },
        instruction: { en: 'Repair the obsolete GatewaySubnet quarantine without moving the workload or branch. The current model must allow both directions between 10.1.1.4 and 172.16.0.4.', ja: 'ワークロードや拠点を移動せず、GatewaySubnet の不要な隔離を修復します。現在のモデルで 10.1.1.4 と 172.16.0.4 の双方向を許可する必要があります。' },
        checkId: 'gateway-restored', guidanceIds: ['gateway-return-repair'],
        hints: [{ en: 'The source already learns the branch prefix. Examine the equal-prefix None route on GatewaySubnet before changing BGP or peering settings. Disable that obsolete route or remove its association.', ja: '送信元は既に拠点のプレフィックスを学習しています。BGP やピアリングを変更する前に、GatewaySubnet の同じプレフィックスの None ルートを調べます。不要なルートの無効化や関連付け解除が可能です。' }],
      },
      {
        id: 'gateway.verify', assessmentVersion: 1, awardId: 'gateway.verify', points: 45,
        title: { en: 'Verify the learned route and both paths', ja: '学習ルートと双方向の経路を検証する' },
        instruction: { en: 'Check the exact branch route in work-a together with the modeled forward and independent return path. These are routing results, not a live VPN or application-delivery test.', ja: 'work-a の完全一致の拠点ルートと、モデルの往路および独立した復路をまとめて確認します。これは経路の結果であり、実際の VPN やアプリの配信テストではありません。' },
        checkId: 'gateway-evidence', guidanceIds: ['branch-routes'], hints: [],
      },
      {
        id: gatewayCheckpoint.taskId, assessmentVersion: gatewayCheckpoint.assessmentVersion, awardId: 'gateway.explain', points: 65,
        title: { en: 'Explain gateway transit without inventing connectivity', ja: '接続性を決めつけずゲートウェイ転送を説明する' },
        instruction: { en: 'Transfer the diagnosis to a new spoke. Separate configured gateway sharing, learned routes and actual bidirectional forwarding.', ja: '新しいスポークに診断を応用します。ゲートウェイ共有の構成、学習ルート、実際の双方向の転送を区別してください。' },
        checkId: gatewayCheckpoint.checkId, guidanceIds: [], hints: [],
      },
    ],
  },
]

export const routingChecks: CourseBundle['checks'] = [
  { id: 'load-prefix', kind: 'scenario.loaded', params: { scenarioId: 'prefix-outage' } },
  { id: 'load-gateway', kind: 'scenario.loaded', params: { scenarioId: 'gateway-return' } },
  { id: 'inspect-prefix', kind: 'routes.inspected', params: { vnetId: 'a', subnetId: 'work-a', prefix: '10.2.1.0/24' } },
  { id: 'inspect-branch', kind: 'routes.inspected', params: { vnetId: 'a', subnetId: 'work-a', prefix: '172.16.0.0/24' } },
  { id: 'inspect-gateway-return', kind: 'routes.inspected', params: { vnetId: 'hub', subnetId: 'gateway', prefix: '10.1.0.0/16' } },
  { id: 'prefix-restored', kind: 'requirements.satisfied', params: { requirements: [
    { id: 'application-path', kind: 'flow', source: { kind: 'subnet', vnetId: 'a', subnetId: 'work-a' },
      target: { kind: 'subnet', vnetId: 'b', subnetId: 'work-b' }, sourceAddress: '10.1.1.4', destinationAddress: '10.2.1.4', expectation: 'allow' },
    { id: 'batch-path', kind: 'flow', source: { kind: 'subnet', vnetId: 'a', subnetId: 'work-a' },
      target: { kind: 'subnet', vnetId: 'b', subnetId: 'work-batch' }, sourceAddress: '10.1.1.4', destinationAddress: '10.2.2.4', expectation: 'allow' },
  ] } },
  { id: 'gateway-restored', kind: 'requirements.satisfied', params: { requirements: [
    { id: 'branch-pair', kind: 'flow', source: { kind: 'subnet', vnetId: 'a', subnetId: 'work-a' },
      target: { kind: 'site', siteId: 'branch' }, sourceAddress: '10.1.1.4', destinationAddress: '172.16.0.4', expectation: 'allow' },
  ] } },
  { id: 'gateway-evidence', kind: 'requirements.satisfied', params: { requirements: [
    { id: 'learned-branch-prefix', kind: 'route', table: 'work-a', prefix: '172.16.0.0/24', expectation: 'present' },
    { id: 'branch-bidirectional', kind: 'flow', source: { kind: 'subnet', vnetId: 'a', subnetId: 'work-a' },
      target: { kind: 'site', siteId: 'branch' }, sourceAddress: '10.1.1.4', destinationAddress: '172.16.0.4', expectation: 'allow' },
  ] } },
  {
    id: 'predict-prefix', kind: 'quiz.answered', params: {
      question: { en: 'With /24 and /8 discards and /16 peering, which destination is blocked before repair?', ja: '/24 と /8 の破棄、/16 のピアリングがある場合、修復前に遮断される宛先はどれですか。' },
      correctChoiceId: 'application-only',
      choices: [
        { id: 'both', text: { en: 'Both addresses use the /8 discard ahead of the /16 peering route.', ja: '両方のアドレスが、/16 のピアリングより /8 の破棄を優先します。' },
          feedback: { en: 'The /8 UDR is less specific than /16 peering. It does not win for either address while the peering route is available.', ja: '/8 UDR は /16 ピアリングより具体的ではありません。ピアリング ルートが利用できる間、どちらのアドレスでも /8 は優先されません。' } },
        { id: 'application-only', text: { en: 'Only 10.2.1.4; 10.2.2.4 uses the /16 peering route.', ja: '10.2.1.4 のみ。10.2.2.4 は /16 のピアリング ルートを使います。' },
          feedback: { en: 'Correct. The /24 matches the application, not the batch address. The batch address uses /16 rather than /8.', ja: '正解です。/24 はアプリに一致し、バッチには一致しません。バッチは /8 ではなく /16 を使います。' } },
        { id: 'neither', text: { en: 'Both addresses use the enabled /16 peering ahead of the discards.', ja: '両方のアドレスが、破棄より有効な /16 のピアリングを優先します。' },
          feedback: { en: 'Enabled peering does not defeat the more-specific /24 UDR for the application address.', ja: '有効なピアリングでも、アプリのアドレスに対するより具体的な /24 UDR には優先しません。' } },
      ],
    },
  },
  {
    id: 'explain-prefix', kind: 'quiz.answered', params: {
      question: { en: 'If only the /8 discard remains, why can 10.2.2.4 still be reached?', ja: '/8 の破棄だけが残る場合、なぜ 10.2.2.4 に到達できますか。' },
      correctChoiceId: 'longer-peering',
      choices: [
        { id: 'route-type-first', text: { en: 'The /8 UDR is preferred by source before matching the /16 prefix.', ja: '/16 の一致を調べる前に、生成元によって /8 の UDR が優先されます。' },
          feedback: { en: 'This repeats the equal-prefix rule outside its scope. Here /16 is a longer match than /8.', ja: '同じプレフィックスの規則を適用範囲外に使っています。ここでは /16 が /8 より長く一致します。' } },
        { id: 'longer-peering', text: { en: 'The available /16 peering route is a longer match than the /8 UDR.', ja: '利用可能な /16 ピアリング ルートが /8 UDR より長く一致するためです。' },
          feedback: { en: 'Correct. Compare prefix lengths first in this scenario; equal-prefix preference explains the earlier /16-versus-/16 incident.', ja: '正解です。このシナリオではまず長さを比較します。同じプレフィックスの優先順位は、前の /16 同士の障害を説明します。' } },
        { id: 'same-region', text: { en: 'The shared region provides a VNet-local route to the remote address.', ja: '共通のリージョンが、リモート アドレスへの VNet ローカル ルートを提供します。' },
          feedback: { en: 'The region is not the reason. The actual connecting path and selected route are required.', ja: 'リージョンは理由ではありません。実際の接続経路と選択されたルートが必要です。' } },
      ],
    },
  },
  {
    id: 'predict-gateway', kind: 'quiz.answered', params: {
      question: { en: 'Does the branch route in work-a prove a successful conversation?', ja: 'work-a に拠点ルートがあれば、通信の成功が証明されますか。' },
      correctChoiceId: 'check-return',
      choices: [
        { id: 'bgp-guarantees', text: { en: 'Yes: the learned branch prefix also establishes the gateway return decision.', ja: 'はい。学習済みの拠点プレフィックスが、ゲートウェイの復路の判断も確立します。' },
          feedback: { en: 'BGP route learning does not prove that the branch and gateway return lookups can reach the source.', ja: 'BGP のルート学習だけでは、拠点やゲートウェイの復路が送信元に到達することは証明できません。' } },
        { id: 'check-return', text: { en: 'No: inspect the gateway return decision and assess both directions.', ja: 'いいえ。ゲートウェイの復路の判断を調べ、双方向を評価します。' },
          feedback: { en: 'Correct. The source route and independent return routing are separate evidence.', ja: '正解です。送信元のルートと独立した復路は別々の根拠です。' } },
        { id: 'new-gateway', text: { en: 'No: move the branch connection to a dedicated gateway in this spoke.', ja: 'いいえ。拠点接続を、このスポーク専用のゲートウェイに移動します。' },
          feedback: { en: 'Gateway transit allows sharing a remote gateway. The starter already has that configuration.', ja: 'ゲートウェイ転送ではリモート ゲートウェイを共有できます。初期構成には既にその設定があります。' } },
      ],
    },
  },
  {
    id: 'explain-gateway', kind: 'quiz.answered', params: {
      question: { en: 'A new spoke has ordinary hub peering but no remote-gateway use. What should you conclude?', ja: '新しいスポークには通常のハブ ピアリングがありますが、リモート ゲートウェイは使用しません。何が言えますか。' },
      correctChoiceId: 'transit-and-evidence',
      choices: [
        { id: 'automatic-transit', text: { en: 'The hub peering supplies gateway sharing; verify the workload route afterward.', ja: 'ハブ ピアリングがゲートウェイを共有するので、その後にワークロードのルートを確認します。' },
          feedback: { en: 'Ordinary peering is not automatic transit. Sharing a gateway needs the corresponding supported transit configuration.', ja: '通常のピアリングは自動転送ではありません。ゲートウェイの共有には対応する転送構成が必要です。' } },
        { id: 'transit-and-evidence', text: { en: 'Configure supported gateway sharing, then verify route propagation and both forwarding directions.', ja: 'サポートされるゲートウェイ共有を構成し、ルート伝達と双方向の転送を検証します。' },
          feedback: { en: 'Correct. Hub gateway transit and spoke remote-gateway use enable sharing; effective routes and both paths still need checking.', ja: '正解です。ハブのゲートウェイ転送とスポークのリモート ゲートウェイ使用で共有でき、有効なルートと双方向の経路も確認が必要です。' } },
        { id: 'live-proof', text: { en: 'Verify the hub route; that result also establishes the new spoke return path.', ja: 'ハブのルートを確認すれば、その結果で新しいスポークの復路も確立されます。' },
          feedback: { en: 'A hub route does not establish the new spoke lookup or the independent return decision. Check both owned scopes.', ja: 'ハブのルートは、新しいスポークの検索や独立した復路を証明しません。両方の所有範囲を確認してください。' } },
      ],
    },
  },
]

export const routingGuidance: CourseBundle['guidance'] = [
  { id: 'prefix-routes', action: 'routes.open', params: { vnetId: 'a', subnetId: 'work-a', prefix: '10.2.1.0/24' },
    instruction: { en: 'Open Workload A / work-a and highlight the application /24 route.', ja: 'Workload A / work-a を開き、アプリの /24 ルートを強調表示します。' } },
  { id: 'prefix-repair', action: 'route-table.configure', params: { vnetId: 'a', subnetId: 'work-a', routeTableId: 'blocking', routeId: 'drop-b' },
    instruction: { en: 'Reveal the exact retired /24 quarantine route; you make the repair.', ja: '不要になった /24 の隔離ルートを表示します。修復は自分で行います。' } },
  { id: 'branch-routes', action: 'routes.open', params: { vnetId: 'a', subnetId: 'work-a', prefix: '172.16.0.0/24' },
    instruction: { en: 'Open the branch prefix in Workload A / work-a.', ja: 'Workload A / work-a で拠点のプレフィックスを開きます。' } },
  { id: 'gateway-return-routes', action: 'routes.open', params: { vnetId: 'hub', subnetId: 'gateway', prefix: '10.1.0.0/16' },
    instruction: { en: 'Open Classic hub / GatewaySubnet and highlight the return prefix, not the source subnet.', ja: '送信元ではなく Classic hub / GatewaySubnet を開き、復路のプレフィックスを強調表示します。' } },
  { id: 'gateway-return-repair', action: 'route-table.configure', params: { vnetId: 'hub', subnetId: 'gateway', routeTableId: 'return-policy', routeId: 'drop-return' },
    instruction: { en: 'Reveal the obsolete return discard in the GatewaySubnet route table.', ja: 'GatewaySubnet のルート テーブルで、不要な復路の破棄ルートを表示します。' } },
]
