import type { CourseBundle } from './course-contract'
import { capstoneCheckpoint, wanCheckpoint } from './course-profile'

export const wanLessons: CourseBundle['lessons'] = [
  {
    id: 'secured-wan', contentVersion: 1, scenarioId: 'secured-wan', prerequisites: ['gateway-return'],
    title: { en: 'Incident: the secured WAN path', ja: '障害: 保護された WAN の経路' },
    objective: { en: 'Restore connectivity through the intended secured hub, not around it; distinguish table scope from private routing intent.', ja: '保護されたハブを迂回せずに接続を復旧し、テーブルの範囲とプライベート ルーティング インテントを区別します。' },
    taskOrder: ['wan.load', 'wan.predict', 'wan.inspect-forward', 'wan.repair', 'wan.inspect-return', 'wan.verify', 'wan.scope', 'wan.explain'],
    tasks: [
      {
        id: 'wan.load', assessmentVersion: 1, awardId: 'wan.load', points: 5,
        title: { en: 'Open the secured WAN incident', ja: '保護された WAN の障害を開く' },
        instruction: { en: 'Load two workloads attached to a secured Virtual WAN hub. Private routing intent and Default-table propagation are preconfigured; a workload UDR is not.', ja: '保護された Virtual WAN ハブに接続された 2 つのワークロードを読み込みます。プライベート インテントと Default テーブルへの伝達は構成済みですが、ワークロードの UDR に問題があります。' },
        checkId: 'load-wan', guidanceIds: [], hints: [],
      },
      {
        id: 'wan.predict', assessmentVersion: 1, awardId: 'wan.predict', points: 30,
        title: { en: 'Predict whether hub intent is enough', ja: 'ハブのインテントだけで十分か予測する' },
        instruction: { en: 'Workload A has an exact 10.2.0.0/16 discard. Decide whether private routing intent can make that traffic reach the hub.', ja: 'Workload A には 10.2.0.0/16 の完全一致の破棄があります。プライベート インテントがあれば、この通信はハブに到達しますか。' },
        checkId: 'predict-wan', guidanceIds: [], hints: [],
      },
      {
        id: 'wan.inspect-forward', assessmentVersion: 1, awardId: 'wan.inspect-forward', points: 10,
        title: { en: 'Inspect the workload before blaming the hub', ja: 'ハブを疑う前にワークロードを調べる' },
        instruction: { en: 'Inspect 10.2.0.0/16 in work-a. Compare the selected discard with the hub-learned candidate; a hub connection is not proof of forwarding.', ja: 'work-a で 10.2.0.0/16 を調べます。選択された破棄とハブからの学習候補を比較してください。ハブへの接続だけでは転送の証明になりません。' },
        checkId: 'inspect-a', guidanceIds: ['routes-a'], hints: [],
      },
      {
        id: 'wan.repair', assessmentVersion: 1, awardId: 'wan.repair', points: 75,
        title: { en: 'Restore the secured path, not a bypass', ja: '迂回せず保護された経路を復旧する' },
        instruction: { en: 'Retire the obsolete discard. Both directions between 10.1.1.4 and 10.2.1.4 must traverse the secured WAN Firewall. A new direct peering is not an acceptable shortcut.', ja: '不要な破棄を解除します。10.1.1.4 と 10.2.1.4 の双方向が保護された WAN ファイアウォールを通る必要があります。直接ピアリングによる迂回は認められません。' },
        checkId: 'secured-workload-path', guidanceIds: ['repair-drop'],
        hints: [{ en: 'Disable the obsolete UDR or remove its association. Keep private routing intent enabled: a delivered path that bypasses inspection fails this condition.', ja: '不要な UDR の無効化や関連付け解除が可能です。プライベート インテントは有効のままにします。検査を迂回して届く経路では達成できません。' }],
      },
      {
        id: 'wan.inspect-return', assessmentVersion: 1, awardId: 'wan.inspect-return', points: 10,
        title: { en: 'Inspect the other workload return scope', ja: '相手のワークロードの復路を調べる' },
        instruction: { en: 'Inspect 10.1.0.0/16 in Workload B / work-b. Do not reuse the source table as evidence for a different subnet.', ja: 'Workload B / work-b で 10.1.0.0/16 を調べます。別のサブネットの根拠として送信元のテーブルを使わないでください。' },
        checkId: 'inspect-workload-return', guidanceIds: ['workload-return-routes'], hints: [],
      },
      {
        id: 'wan.verify', assessmentVersion: 1, awardId: 'wan.verify', points: 65,
        title: { en: 'Verify the exact table and inspected pair', ja: '正確なテーブルと検査経路を検証する' },
        instruction: { en: 'Check the destination route in this hub’s Default table and both inspected paths. A route in another table, or forwarding without the Firewall waypoint, is not equivalent.', ja: 'このハブの Default テーブルの宛先ルートと、検査を通る双方向の経路を確認します。別のテーブルのルートやファイアウォールを通らない転送は同等ではありません。' },
        checkId: 'wan-evidence', guidanceIds: ['wan-default-routes'], hints: [],
      },
      {
        id: 'wan.scope', assessmentVersion: 1, awardId: 'wan.scope', points: 60,
        title: { en: 'Separate association from propagation', ja: '関連付けと伝達を区別する' },
        instruction: { en: 'Apply the routing-table model to another connection. Seeing a route somewhere is not proof that this connection uses that table.', ja: '別の接続にルート テーブルの考え方を適用します。どこかにルートが見えても、その接続がそのテーブルを使用する証明にはなりません。' },
        checkId: 'explain-wan-scope', guidanceIds: [], hints: [],
      },
      {
        id: wanCheckpoint.taskId, assessmentVersion: wanCheckpoint.assessmentVersion, awardId: 'wan.explain', points: 70,
        title: { en: 'Explain private intent without overclaiming security', ja: 'セキュリティを断言せずプライベート インテントを説明する' },
        instruction: { en: 'Distinguish a modeled private-traffic inspection path from internet routing, Firewall rules and actual application delivery.', ja: 'モデルのプライベート通信の検査経路を、インターネット経路、ファイアウォール規則、実際のアプリの配信と区別します。' },
        checkId: wanCheckpoint.checkId, guidanceIds: [], hints: [],
      },
    ],
  },
  {
    id: 'hybrid-incident', contentVersion: 1, scenarioId: 'hybrid-incident', prerequisites: ['secured-wan'],
    title: { en: 'Capstone: two faults, one hybrid network', ja: '総合課題: 1 つのハイブリッド環境と 2 つの障害' },
    objective: { en: 'Transfer your diagnosis across gateway transit, ExpressRoute and a secured WAN. Restore independent branch and workload conversations without bypassing inspection.', ja: 'ゲートウェイ転送、ExpressRoute、保護された WAN に診断を応用します。検査を迂回せず、拠点とワークロードの独立した通信を復旧します。' },
    taskOrder: ['capstone.load', 'capstone.predict', 'capstone.inspect-branch', 'capstone.repair-branch', 'capstone.inspect-return', 'capstone.repair-return', 'capstone.verify', 'capstone.explain'],
    tasks: [
      {
        id: 'capstone.load', assessmentVersion: 1, awardId: 'capstone.load', points: 5,
        title: { en: 'Take ownership of the hybrid incident', ja: 'ハイブリッド環境の障害に取り組む' },
        instruction: { en: 'Confirm the capstone starter. Workload A uses a classic shared gateway and ExpressRoute; Workload B and the branch use the secured WAN. Two obsolete quarantines remain.', ja: '総合課題の初期構成を確認します。Workload A は従来型の共有ゲートウェイと ExpressRoute、Workload B と拠点は保護された WAN を使用します。不要な隔離が 2 つ残っています。' },
        checkId: 'load-capstone', guidanceIds: [], hints: [],
      },
      {
        id: 'capstone.predict', assessmentVersion: 1, awardId: 'capstone.predict', points: 35,
        title: { en: 'Predict two independent failure directions', ja: '独立した 2 つの障害の方向を予測する' },
        instruction: { en: 'A discards the branch prefix; B discards the return prefix for A. Predict why fixing just one table cannot restore both conversations.', ja: 'A は拠点のプレフィックスを、B は A への復路のプレフィックスを破棄しています。1 つのテーブルだけでは両方の通信を復旧できない理由を予測します。' },
        checkId: 'predict-capstone', guidanceIds: [], hints: [],
      },
      {
        id: 'capstone.inspect-branch', assessmentVersion: 1, awardId: 'capstone.inspect-branch', points: 10,
        title: { en: 'Localize the branch’s forward blocker', ja: '拠点への往路の遮断箇所を特定する' },
        instruction: { en: 'Inspect 172.16.0.0/24 in A / work-a. Keep the independent workload-return problem separate.', ja: 'A / work-a で 172.16.0.0/24 を調べます。独立したワークロードの復路の問題とは分けて考えてください。' },
        checkId: 'inspect-branch', guidanceIds: ['branch-routes'], hints: [],
      },
      {
        id: 'capstone.repair-branch', assessmentVersion: 1, awardId: 'capstone.repair-branch', points: 85,
        title: { en: 'Restore only the branch conversation first', ja: 'まず拠点との通信を復旧する' },
        instruction: { en: 'Restore 10.1.1.4 ↔ 172.16.0.4 through the WAN Firewall in both directions. Do not assume that this also repairs Workload B.', ja: '10.1.1.4 と 172.16.0.4 の通信を、双方向とも WAN ファイアウォール経由で復旧します。これで Workload B も直るとは限りません。' },
        checkId: 'secured-branch-path', guidanceIds: ['hybrid-branch-repair'],
        hints: [{ en: 'The exact branch discard is associated with work-a, not GatewaySubnet. Disable the obsolete route or remove that association; retain the secured transit path.', ja: '完全一致の拠点の破棄は GatewaySubnet ではなく work-a に関連付けられています。不要なルートの無効化や関連付け解除を行い、保護された転送経路は保持します。' }],
      },
      {
        id: 'capstone.inspect-return', assessmentVersion: 1, awardId: 'capstone.inspect-return', points: 10,
        title: { en: 'Find the remaining reverse-path fault', ja: '残った復路の障害を探す' },
        instruction: { en: 'Inspect B / work-b for 10.1.0.0/16. The forward path to B can be valid while this return decision still discards replies.', ja: 'B / work-b で 10.1.0.0/16 を調べます。B への往路が有効でも、この復路の判断では応答が破棄されます。' },
        checkId: 'inspect-workload-return', guidanceIds: ['workload-return-routes'], hints: [],
      },
      {
        id: 'capstone.repair-return', assessmentVersion: 1, awardId: 'capstone.repair-return', points: 115,
        title: { en: 'Restore the remote workload’s replies', ja: 'リモート ワークロードの応答を復旧する' },
        instruction: { en: 'Restore both directions between 10.1.1.4 and 10.2.1.4 through the WAN Firewall. A direct peering bypass does not satisfy this design.', ja: '10.1.1.4 と 10.2.1.4 の双方向を WAN ファイアウォール経由で復旧します。直接ピアリングによる迂回では、この設計を達成できません。' },
        checkId: 'secured-workload-path', guidanceIds: ['hybrid-return-repair'],
        hints: [{ en: 'This discard belongs to B’s workload subnet, unlike the earlier GatewaySubnet incident. Disable the obsolete return route or remove its association.', ja: '以前の GatewaySubnet の障害と異なり、この破棄は B のワークロード サブネットにあります。不要な復路ルートの無効化や関連付け解除が可能です。' }],
      },
      {
        id: 'capstone.verify', assessmentVersion: 1, awardId: 'capstone.verify', points: 110,
        title: { en: 'Verify both repairs survived together', ja: '両方の修復が維持されているか検証する' },
        instruction: { en: 'Recheck both conversations, both inspection directions and A’s advertised prefix in this WAN hub’s Default table. Neither a restored branch alone nor an inspected one-way path is enough.', ja: '両方の通信、双方向の検査、この WAN ハブの Default テーブルの A の広告プレフィックスを再確認します。拠点だけの復旧や片方向だけの検査では不十分です。' },
        checkId: 'hybrid-complete', guidanceIds: ['routes-a'], hints: [],
      },
      {
        id: capstoneCheckpoint.taskId, assessmentVersion: capstoneCheckpoint.assessmentVersion, awardId: 'capstone.explain', points: 80,
        title: { en: 'Close the incident with an honest evidence statement', ja: '根拠の限界を正しく報告して障害を完了する' },
        instruction: { en: 'Explain what the current routing evidence supports and what still needs real deployment, policy and application validation. Black belt records local practice, not professional certification.', ja: '現在の経路の根拠で言えることと、実際の環境、ポリシー、アプリの検証が必要なことを説明します。黒帯はローカルの練習記録であり、専門資格ではありません。' },
        checkId: capstoneCheckpoint.checkId, guidanceIds: [], hints: [],
      },
    ],
  },
]

const workloadFlow = {
  id: 'inspected-workloads', kind: 'flow' as const, source: { kind: 'subnet' as const, vnetId: 'a', subnetId: 'work-a' },
  target: { kind: 'subnet' as const, vnetId: 'b', subnetId: 'work-b' },
  sourceAddress: '10.1.1.4', destinationAddress: '10.2.1.4', expectation: 'allow' as const, requiredApplianceId: 'vhub-fw:wan',
}
const branchFlow = {
  id: 'inspected-branch', kind: 'flow' as const, source: { kind: 'subnet' as const, vnetId: 'a', subnetId: 'work-a' },
  target: { kind: 'site' as const, siteId: 'branch' },
  sourceAddress: '10.1.1.4', destinationAddress: '172.16.0.4', expectation: 'allow' as const, requiredApplianceId: 'vhub-fw:wan',
}

export const wanChecks: CourseBundle['checks'] = [
  { id: 'load-wan', kind: 'scenario.loaded', params: { scenarioId: 'secured-wan' } },
  { id: 'load-capstone', kind: 'scenario.loaded', params: { scenarioId: 'hybrid-incident' } },
  { id: 'inspect-workload-return', kind: 'routes.inspected', params: { vnetId: 'b', subnetId: 'work-b', prefix: '10.1.0.0/16' } },
  { id: 'secured-workload-path', kind: 'requirements.satisfied', params: { requirements: [workloadFlow] } },
  { id: 'secured-branch-path', kind: 'requirements.satisfied', params: { requirements: [branchFlow] } },
  { id: 'wan-evidence', kind: 'requirements.satisfied', params: { requirements: [
    { id: 'wan-default-destination', kind: 'route', table: 'wan', hubTableId: 'defaultRouteTable', prefix: '10.2.0.0/16', expectation: 'present' },
    workloadFlow,
  ] } },
  { id: 'hybrid-complete', kind: 'requirements.satisfied', params: { requirements: [
    { id: 'wan-default-classic', kind: 'route', table: 'wan', hubTableId: 'defaultRouteTable', prefix: '10.1.0.0/16', expectation: 'present' },
    branchFlow, workloadFlow,
  ] } },
  {
    id: 'predict-wan', kind: 'quiz.answered', params: {
      question: { en: 'Can private routing intent undo the selected workload discard?', ja: 'プライベート インテントは、選択されたワークロードの破棄を取り消せますか。' },
      correctChoiceId: 'source-first',
      choices: [
        { id: 'intent-overrides', text: { en: 'Yes: private intent changes the source subnet lookup before the hub.', ja: 'はい。プライベート インテントが、ハブの前に送信元の検索を変更します。' },
          feedback: { en: 'Traffic discarded at the source never reaches the hub policy.', ja: '送信元で破棄された通信は、ハブのポリシーに到達しません。' } },
        { id: 'source-first', text: { en: 'No: the source must first forward traffic toward the hub.', ja: 'いいえ。まず送信元がハブに向けて転送する必要があります。' },
          feedback: { en: 'Correct. Diagnose the selected source route before assuming the hub is at fault.', ja: '正解です。ハブの障害と考える前に、送信元で選択されたルートを診断します。' } },
        { id: 'internet-policy', text: { en: 'Yes: enabling internet intent adds a competing private /16 route.', ja: 'はい。インターネット インテントが、競合するプライベート /16 を追加します。' },
          feedback: { en: 'Internet intent is not a repair for this source’s private-prefix UDR.', ja: 'インターネット インテントは、この送信元のプライベート プレフィックスの UDR の修復にはなりません。' } },
      ],
    },
  },
  {
    id: 'explain-wan-scope', kind: 'quiz.answered', params: {
      question: { en: 'Which distinction is correct for a hub connection?', ja: 'ハブ接続について正しい区別はどれですか。' },
      correctChoiceId: 'lookup-versus-export',
      choices: [
        { id: 'same-setting', text: { en: 'Association selects the export table; propagation selects the lookup table.', ja: '関連付けは広告先を選び、伝達は参照先テーブルを選択します。' },
          feedback: { en: 'They have different roles: lookup scope and route distribution.', ja: '役割は異なります。参照する範囲と、ルートの配布です。' } },
        { id: 'lookup-versus-export', text: { en: 'Association selects its lookup table; propagation distributes its routes to tables.', ja: '関連付けは参照先テーブルを選び、伝達はルートをテーブルに配布します。' },
          feedback: { en: 'Correct. A connection associates to one table and can propagate to one or more. This scenario uses Default tables, not custom-table intent.', ja: '正解です。接続は 1 つのテーブルに関連付けられ、1 つ以上に伝達できます。このシナリオは Default テーブルを使用し、カスタム テーブルとインテントの組み合わせではありません。' } },
        { id: 'any-table', text: { en: 'Association publishes the local prefix; propagation creates the connection.', ja: '関連付けはローカル プレフィックスを公開し、伝達は接続を作成します。' },
          feedback: { en: 'Propagation publishes routes to selected tables; it does not create the connection. Association chooses the lookup context.', ja: '伝達は、選択したテーブルにルートを公開します。接続を作成するものではありません。関連付けが参照範囲を選びます。' } },
      ],
    },
  },
  {
    id: 'explain-wan', kind: 'quiz.answered', params: {
      question: { en: 'Both private paths traverse the modeled Firewall. What does that establish?', ja: '双方向のプライベート経路がモデルのファイアウォールを通ります。何が分かりますか。' },
      correctChoiceId: 'routing-only',
      choices: [
        { id: 'application-proof', text: { en: 'The private routes meet inspection, which also establishes the live Firewall policy.', ja: 'プライベート経路が検査を満たすため、実際のファイアウォール ポリシーも確立されています。' },
          feedback: { en: 'A routing waypoint does not evaluate Firewall policy, guest readiness or delivery.', ja: '経路上の通過点は、ファイアウォール ポリシー、ゲストの準備状態、配信を評価しません。' } },
        { id: 'routing-only', text: { en: 'The current modeled private routes meet the inspection condition, not a delivery guarantee.', ja: '現在のモデルのプライベート経路は検査条件を満たしますが、配信は保証しません。' },
          feedback: { en: 'Correct. Private routing intent is distinct from internet intent and from security/application enforcement.', ja: '正解です。プライベート インテントは、インターネット インテントやセキュリティ、アプリの制御とは別です。' } },
        { id: 'all-tables', text: { en: 'The private routes meet inspection, which also establishes the other hub table contexts.', ja: 'プライベート経路が検査を満たすため、他のハブ テーブルのコンテキストも確立されています。' },
          feedback: { en: 'Evidence is bound to this topology, table scope and current revision.', ja: '根拠は、この構成、テーブルの範囲、現在のリビジョンに限られます。' } },
      ],
    },
  },
  {
    id: 'predict-capstone', kind: 'quiz.answered', params: {
      question: { en: 'What follows from A’s branch discard and B’s return discard?', ja: 'A の拠点の破棄と B の復路の破棄から、何が言えますか。' },
      correctChoiceId: 'independent-faults',
      choices: [
        { id: 'one-fix', text: { en: 'The branch discard blocks both conversations on their forward paths.', ja: '拠点の破棄が、両方の通信の往路を遮断しています。' },
          feedback: { en: 'B still discards replies to A. Independent destinations can have independent faults.', ja: 'B は引き続き A への応答を破棄します。別の宛先には独立した障害があり得ます。' } },
        { id: 'independent-faults', text: { en: 'The branch is blocked forward; the remote workload is blocked on return.', ja: '拠点は往路で、リモート ワークロードは復路で遮断されます。' },
          feedback: { en: 'Correct. Restore each scoped conversation, then prove both repairs still hold together.', ja: '正解です。各範囲の通信を復旧し、その後、両方の修復が同時に維持されているか検証します。' } },
        { id: 'return-irrelevant', text: { en: 'Both faults are on return, because requests inherit the hub routes.', ja: '要求はハブのルートを引き継ぐため、両方の障害は復路にあります。' },
          feedback: { en: 'The model performs independent return lookups; a forward success does not make replies work.', ja: 'モデルは復路を独立して参照します。往路の成功だけでは応答は保証されません。' } },
      ],
    },
  },
  {
    id: 'explain-capstone', kind: 'quiz.answered', params: {
      question: { en: 'Which incident closure statement is justified?', ja: '根拠に基づく障害完了の報告はどれですか。' },
      correctChoiceId: 'bounded-evidence',
      choices: [
        { id: 'certified', text: { en: 'These routes and both inspected conversations pass, so the live Firewall policy is also established.', ja: 'ルートと双方向の検査経路が合格したため、実際のファイアウォール ポリシーも確立されています。' },
          feedback: { en: 'A modeled inspection path does not establish live Firewall rule enforcement or application delivery.', ja: 'モデルの検査経路は、実際のファイアウォール規則の適用やアプリの配信を証明しません。' } },
        { id: 'bounded-evidence', text: { en: 'These current routes and both inspected conversations pass; live policy, convergence and delivery still need validation.', ja: '現在のルートと検査を通る双方向の通信は合格です。実際のポリシー、収束、配信は別途検証が必要です。' },
          feedback: { en: 'Correct. Report the supported witnesses and unresolved real-world questions separately. You completed the local practice path.', ja: '正解です。根拠となる経路と、実環境で未解決の点は分けて報告します。ローカルの練習課程を完了しました。' } },
        { id: 'unknown-passes', text: { en: 'These routes and inspected conversations pass, so remaining table contexts can be inferred from them.', ja: 'ルートと検査経路が合格したため、残りのテーブルのコンテキストも推定できます。' },
          feedback: { en: 'The current witnesses do not establish another table context. Unassessed contexts remain unresolved.', ja: '現在の根拠は、別のテーブルの範囲を証明しません。未評価の範囲は未解決のままです。' } },
      ],
    },
  },
]

export const wanGuidance: CourseBundle['guidance'] = [
  { id: 'wan-default-routes', action: 'hub-routes.open', params: { hubId: 'wan', tableId: 'defaultRouteTable' },
    instruction: { en: 'Open the secured WAN hub and its exact Default effective-route table.', ja: '保護された WAN ハブの正確な Default 有効ルート テーブルを開きます。' } },
  { id: 'workload-return-routes', action: 'routes.open', params: { vnetId: 'b', subnetId: 'work-b', prefix: '10.1.0.0/16' },
    instruction: { en: 'Open Workload B / work-b and highlight the return prefix to A.', ja: 'Workload B / work-b を開き、A への復路のプレフィックスを強調表示します。' } },
  { id: 'hybrid-branch-repair', action: 'route-table.configure', params: { vnetId: 'a', subnetId: 'work-a', routeTableId: 'branch-policy', routeId: 'drop-branch' },
    instruction: { en: 'Reveal A’s exact branch quarantine, not the gateway or B’s table.', ja: 'ゲートウェイや B のテーブルではなく、A の拠点の隔離を表示します。' } },
  { id: 'hybrid-return-repair', action: 'route-table.configure', params: { vnetId: 'b', subnetId: 'work-b', routeTableId: 'return-policy', routeId: 'drop-return' },
    instruction: { en: 'Reveal B’s exact return discard for A; you execute the repair.', ja: 'B の A への復路の破棄を表示します。修復は自分で行います。' } },
]
