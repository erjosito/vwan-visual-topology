import type { CourseBundle, CourseTask } from './course-contract'
import { transferLessonRequirements, transferLessonTopology } from './transfer-scenario'

const l = (en: string, ja: string) => ({ en, ja })
const selection = { title: l('How Azure selects a route', 'Azure によるルートの選択'),
  url: 'https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview#how-azure-selects-routes-for-traffic-routing' }
const id = 'routing-handover'

export function appendTransferLesson(bundle: CourseBundle) {
  const forward = { vnetId: 'orders', subnetId: 'orders-app', prefix: '10.142.0.0/16' }
  const reverse = { vnetId: 'supplier', subnetId: 'supplier-api', prefix: '10.141.0.0/16' }
  bundle.scenarios.push({ id, document: { mode: 'full', topology: transferLessonTopology() } })
  bundle.guidance.push(
    { id: `${id}.orders-routes`, action: 'routes.open', params: forward,
      instruction: l('Open Orders / Application effective routes.', 'Orders / Application の有効なルートを開く。') },
    { id: `${id}.supplier-routes`, action: 'routes.open', params: reverse,
      instruction: l('Open Supplier / Service effective routes.', 'Supplier / Service の有効なルートを開く。') },
    ...[{ vnetId: 'orders', subnetId: 'orders-app', routeTableId: 'orders-policy' },
      { vnetId: 'supplier', subnetId: 'supplier-api', routeTableId: 'service-policy' }].map((params) => ({
      id: `${id}.${params.vnetId}-policy`, action: 'route-table.configure' as const, params,
      instruction: params.vnetId === 'orders' ? l('Open Orders / Application routing policy.', 'Orders / Application のルーティング ポリシーを開く。')
        : l('Open Supplier / Service routing policy.', 'Supplier / Service のルーティング ポリシーを開く。'),
    })),
  )
  bundle.checks.push(
    { id: `${id}.load-check`, kind: 'scenario.loaded', params: { scenarioId: id } },
    { id: `${id}.source-check`, kind: 'routes.inspected', params: forward },
    { id: `${id}.reply-check`, kind: 'routes.inspected', params: reverse },
    { id: `${id}.repair-check`, kind: 'requirements.satisfied', params: { requirements: transferLessonRequirements } },
    { id: `${id}.quiz`, kind: 'quiz.answered', params: {
      question: l('In the handover starter, Supplier could exchange traffic with Operations 10.141.4.10 but not the app 10.141.3.10. What explains that difference?',
        '引き継ぎの初期構成では、Supplier は Operations の 10.141.4.10 と通信できても、アプリの 10.141.3.10 とは通信できませんでした。その違いを説明するものはどれですか。'),
      correctChoiceId: 'destination-range', choices: [
        { id: 'peering-subnets', text: l('The peering selected Operations and excluded the application subnet.', 'ピアリングが Operations を選び、アプリのサブネットを除外していました。'),
          feedback: l('This is whole-VNet peering, not subnet peering. Both subnets received the peer address-space route; their destination-specific route choices differed.', 'これはサブネット ピアリングではなく、VNet 全体のピアリングです。両サブネットに相手のアドレス空間のルートがあり、宛先別のルート選択が異なっていました。') },
        { id: 'destination-range', text: l('The discard matched the app’s /24 but not the Operations subnet.', '破棄の /24 はアプリに一致し、Operations には一致しませんでした。'),
          feedback: l('Correct. Supplier’s 10.141.3.0/24 → None was more specific than its 10.141.0.0/16 peering route for the app. It did not match 10.141.4.10. The repair needed the independent reply decision, not a second copy of the working forward route.', '正解です。アプリ宛てでは、Supplier の 10.141.3.0/24 → None が 10.141.0.0/16 のピアリングより具体的でした。10.141.4.10 には一致しません。修復には、正常な往路のコピーではなく、独立した復路の判断が必要でした。') },
        { id: 'source-prefix', text: l('Supplier’s own subnet prefix chose a different peer for each request.', 'Supplier 自身のサブネットのプレフィックスが、要求ごとに別の相手を選びました。'),
          feedback: l('These lookups match the destination, not the sender’s subnet prefix. The same Supplier source can select different routes for the two destinations.', 'この検索で一致させるのは宛先であり、送信元のサブネットのプレフィックスではありません。同じ Supplier の送信元でも、2 つの宛先に別のルートを選べます。') },
      ],
    } },
  )
  const task = (suffix: string, points: number, title: ReturnType<typeof l>, instruction: ReturnType<typeof l>,
    check: string, paragraphs: Array<ReturnType<typeof l>>, guides: string[] = [], hints: Array<ReturnType<typeof l>> = []): CourseTask => ({
    id: `${id}.${suffix}`, assessmentVersion: 1, awardId: `${id}.${suffix}`, points, title, instruction,
    checkId: `${id}.${check}`, guidanceIds: guides.map((guide) => `${id}.${guide}`), hints,
    debrief: { paragraphs, references: [selection] },
  })
  const tasks = [
    task('load', 5, l('Take over a different network', '別のネットワークを引き継ぐ'),
      l('This final challenge returns to a small peered network with new owners and addresses. Diagnose from the evidence rather than repeating an earlier repair.',
        '最後の課題では、所有先とアドレスが異なる小さなピアリング構成に戻ります。前の修復を繰り返すのではなく、根拠から診断します。'), 'load-check',
      [l('Orders and Supplier are already peered. Restore the app 10.141.3.10 ↔ service 10.142.7.20 conversation. Operations 10.141.4.10 must remain reachable from both, and Restricted tenant 10.143.1.10 must remain isolated from Orders in both initiation directions. Keep the original address owners.',
        'Orders と Supplier は既にピアリングされています。アプリ 10.141.3.10 ↔ サービス 10.142.7.20 を復旧します。両者から Operations の 10.141.4.10 へ到達でき、Orders と Restricted tenant の 10.143.1.10 は両方向から開始する通信で分離される必要があります。元のアドレスの所有先を保持します。')]),
    task('inspect', 10, l('Read the application’s candidates', 'アプリの候補ルートを読む'),
      l('Open Effective routes for Orders / Application. Read 10.142.0.0/16, then compare every matching candidate for service address 10.142.7.20.',
        'Orders / Application の有効なルートで 10.142.0.0/16 を読み、サービスの 10.142.7.20 に一致する候補を比較します。'), 'source-check',
      [l('Use the actual destination address when comparing candidates. Finding a /16 peer route is evidence of that candidate, not proof that the complete conversation works. Examine the other endpoint independently.',
        '候補の比較では実際の宛先アドレスを使います。/16 のピアリング ルートがあっても、それは候補の根拠であり、通信全体の成功の証明ではありません。他方のエンドポイントも独立して調べます。')], ['orders-routes']),
    task('compare', 10, l('Read the service’s candidates', 'サービスの候補ルートを読む'),
      l('Open Effective routes for Supplier / Service. Read 10.141.0.0/16, then compare every matching candidate for app address 10.141.3.10. Do not edit yet.',
        'Supplier / Service の有効なルートで 10.141.0.0/16 を読み、アプリの 10.141.3.10 に一致する候補を比較します。まだ編集はしません。'), 'reply-check',
      [l('The two tables describe different destination lookups. Compare the app and Operations addresses in both directions. Use your observations to choose a repair; the next task states outcomes rather than naming a faulty setting.',
        '両テーブルは異なる宛先への検索を表します。アプリと Operations のアドレスを、両方向で比較します。観察から修復を選びます。次のステップでは、不具合の設定名ではなく達成すべき結果を示します。')], ['supplier-routes']),
    task('repair', 100, l('Resolve the handover incident', '引き継いだ障害を解決する'),
      l('Restore 10.141.3.10 ↔ 10.142.7.20, preserving Operations 10.141.4.10 from both endpoints and tenant isolation in both initiation directions. Do not move addresses. Choose the routing-policy repair supported by your observations.',
        '10.141.3.10 ↔ 10.142.7.20 を復旧し、両者から Operations の 10.141.4.10 への到達性と、テナントとの両方向の新規通信の分離を保持します。アドレスは移動せず、観察に基づくルーティング ポリシーの修復を選びます。'), 'repair-check',
      [l('The combined check now supports the original app/service conversation, both Operations witnesses and both tenant boundaries. It accepts routing outcomes rather than one prescribed edit. This is modeled routing evidence; live service and security validation remain separate.',
        '総合確認では、元のアプリとサービスの通信、Operations への 2 つの比較用通信、テナントとの両方向の境界を確認しました。特定の編集ではなく、ルーティングの結果を評価しています。モデル上の根拠であり、実サービスやセキュリティの検証は別に必要です。')],
      ['orders-routes', 'supplier-routes', 'orders-policy', 'supplier-policy'],
      [l('Compare the exact failing conversation with the working Operations conversation. Consider destination range, route source and each direction separately.',
        '失敗する通信と、正常な Operations の通信を比較します。宛先範囲、生成元、各方向を分けて考えます。'),
      l('For each destination address, compare the longest matching prefix, including a candidate with next hop None. Navigation can open either policy table; it does not identify which rule to change.',
        '各宛先で、None の候補も含め最長一致を比較します。案内では両方のポリシーを開けますが、変更すべき規則は指定しません。')]),
    task('verify', 10, l('Revisit the repaired reply lookup', '修復後の復路を再確認する'),
      l('Reopen Effective routes for Supplier / Service at 10.141.0.0/16. Compare the candidate that now handles 10.141.3.10 with your starting observation.',
        'Supplier / Service の有効なルートで 10.141.0.0/16 を再度開き、現在 10.141.3.10 を処理する候補と初期の観察を比較します。'), 'reply-check',
      [l('A repair can expose an existing usable candidate rather than create a new connection. Check the destination-specific choice after the change, not merely whether a peer route still appears.',
        '修復では新しい接続を作らず、既存の使用可能な候補が選ばれるようにする場合もあります。ピアリングの行があるかだけでなく、変更後の宛先別の選択を確認します。')], ['supplier-routes']),
    task('explain', 25, l('Close the routing-foundations journey', 'ルーティング基礎の課程を修了する'),
      l('Explain why the same peering could support one destination while another conversation failed.', '同じピアリングで、一方の宛先には到達でき、他方の通信には失敗した理由を説明します。'), 'quiz',
      [l('You completed the core, specialist practice and this different-address diagnosis. The black belt records the core checkpoints; this final step marks completion of the full scenario journey. Free hints and retries remain available, so this is practice evidence, not an independently proctored exam or proof of production readiness.',
        '基礎、専門演習、異なるアドレスでの診断を完了しました。黒帯は基礎のチェックポイントを記録し、この最終ステップがシナリオ版の全課程の修了を示します。ヒントと再試行は無料のため、これは練習の根拠であり、監督付き試験や本番環境への準備完了の証明ではありません。')]),
  ]
  bundle.lessons.push({ id, contentVersion: 1, scenarioId: id, prerequisites: ['multihub-labels'],
    title: l('Completion challenge: a new team handover', '修了課題: 新しいチームへの引き継ぎ'),
    objective: l('Transfer prefix selection and independent-return diagnosis to different owners and addresses without a prescribed repair.',
      '修復手順の指定なしに、異なる所有先とアドレスで、プレフィックスの選択と独立した復路の診断を応用します。'),
    context: l('A different retailer hands you a small network whose app cannot complete its supplier conversation. Existing peerings and some traffic work. Find and repair the routing fault while protecting working Operations and tenant isolation.',
      '別の小売企業から、アプリと仕入先の通信が完了しない小規模ネットワークを引き継ぎます。既存のピアリングと一部の通信は機能しています。Operations の正常な通信とテナントの分離を守りながら、障害を特定して修復してください。'),
    taskOrder: tasks.map((entry) => entry.id), tasks })
}
