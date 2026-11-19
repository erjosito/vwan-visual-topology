import type { CourseBundle, CourseTask } from './course-contract'
import { hybridLessonRequirements, hybridLessonTopology } from './hybrid-scenario'

const l = (en: string, ja: string) => ({ en, ja })

export function appendHybridLesson(bundle: CourseBundle) {
  const id = 'hybrid-preference'
  const before = { vnetId: 'hybrid-app', subnetId: 'work', prefix: '172.28.20.0/24' }
  const specific = { ...before, prefix: '172.28.10.0/24' }
  const returnScope = { siteId: 'hybrid-branch', prefix: '10.91.0.0/16' }
  const vpn = { kind: 'vpn-connection' as const, connectionId: 'branch-vpn', enabled: true, bgpEnabled: true }
  const er = { kind: 'er-link' as const, connectionId: 'branch-er', enabled: true }
  bundle.scenarios.push({ id, document: { mode: 'full', topology: hybridLessonTopology() } })
  bundle.guidance.push(
    { id: `${id}.source-guide`, action: 'routes.open', params: before,
      instruction: l('Inspect Application / Workload, not the gateway table.', 'ゲートウェイではなく Application / Workload のテーブルを調べます。') },
    { id: `${id}.specific-guide`, action: 'routes.open', params: specific,
      instruction: l('Compare the VPN /24 with the ER /16 and the other ER /24.', 'VPN の /24 を、ER の /16 ともう一方の ER の /24 と比較します。') },
    { id: `${id}.vpn-guide`, action: 'connection.configure', params: { kind: 'vpn-connection', connectionId: 'branch-vpn' },
      instruction: l('Open the original Branch VPN backup connection. You must enable and save it yourself.', '元の Branch VPN backup 接続を開きます。有効化と保存は自分で実行してください。') },
    { id: `${id}.er-guide`, action: 'connection.configure', params: { kind: 'er-link', connectionId: 'branch-er' },
      instruction: l('Open the original branch-side ER attachment, not the Azure attachment. Guidance does not withdraw it.', 'Azure 側ではなく、元の拠点側 ER 接続を開きます。案内だけでは無効化されません。') },
    { id: `${id}.return-guide`, action: 'site-routes.open', params: returnScope,
      instruction: l('Inspect Branch services’ independent received routes for the application prefix.', 'Branch services が受信したアプリ プレフィックスへの独立した復路を調べます。') },
  )
  bundle.checks.push(
    { id: `${id}.load-check`, kind: 'scenario.loaded', params: { scenarioId: id } },
    { id: `${id}.before`, kind: 'routes.inspected', params: before },
    { id: `${id}.repair-check`, kind: 'connections.configured', params: {
      connections: [vpn, er],
      selectedRoutes: [{ ...before, nextHopResourceId: 'primary-er' }, { ...specific, nextHopResourceId: 'backup-vpn' }],
      requirements: hybridLessonRequirements,
    } },
    { id: `${id}.specific`, kind: 'routes.inspected', params: specific },
    { id: `${id}.diagnosis-check`, kind: 'quiz.answered', params: {
      question: l('With both links enabled, .10.10 uses VPN while .20.10 uses ER. What explains this difference?', '両接続が有効なとき、.10.10 は VPN、.20.10 は ER を使います。この違いの理由は何ですか。'),
      correctChoiceId: 'different-prefixes', choices: [
        { id: 'shorter-as', text: l('The shorter VPN AS path takes priority over prefix length for .10.', '.10 では、短い VPN AS パスがプレフィックス長より優先されます。'),
          feedback: l('Prefix length is compared before choosing between matching routes of equal length.', '一致するルートは、同じ長さの候補を比較する前にプレフィックス長で選択します。') },
        { id: 'different-prefixes', text: l('VPN’s /24 wins for .10; equal-prefix preference selects ER for .20.', '.10 は VPN の /24、同じ /24 同士の .20 は ER です。'),
          feedback: l('The actual active workload routes establish both comparisons. An aggregate does not make unowned holes reachable.', '有効なワークロード ルートで両方を確認できます。集約広告は、所有されない空き範囲の到達性を作りません。') },
        { id: 'shared-return', text: l('The branch’s reply policy selects the outbound Azure gateway for each service.', '拠点の応答ポリシーが、各サービスの Azure 側の往路ゲートウェイを選びます。'),
          feedback: l('Each direction has an independent lookup. A return route does not select the workload’s outbound route.', '各方向で独立して検索します。復路はワークロードの往路を選択しません。') },
      ],
    } },
    { id: `${id}.withdraw-check`, kind: 'connections.configured', params: {
      connections: [vpn, { ...er, enabled: false }],
      selectedRoutes: [{ ...before, nextHopResourceId: 'backup-vpn' }, { ...specific, nextHopResourceId: 'backup-vpn' }],
      requirements: hybridLessonRequirements,
    } },
    { id: `${id}.after-withdrawal`, kind: 'routes.inspected', params: before },
    { id: `${id}.return`, kind: 'control-routes.inspected', params: returnScope },
    { id: `${id}.quiz`, kind: 'quiz.answered', params: {
      question: l('After the declared ER withdrawal, what does the successful paired assessment establish?', 'ER を無効にした宣言状態で、双方向の評価成功は何を証明しますか。'),
      correctChoiceId: 'snapshot', choices: [
        { id: 'sessions', text: l('Existing service sessions continued without interruption during the real ER withdrawal.', '実際の ER 停止中も、既存のサービス セッションは中断なく継続しました。'),
          feedback: l('No elapsed transition, live traffic or session state is simulated.', '経過時間を伴う切り替え、実通信、セッション状態はシミュレートしていません。') },
        { id: 'all-prefixes', text: l('Every advertised summary address acquired a tested route through the backup.', '広告した集約範囲の全アドレスに、検証済みのバックアップ経路ができました。'),
          feedback: l('The checks bind two original branch services, Operations and isolation, not every address in an aggregate.', '評価は元の 2 サービス、Operations、分離を対象とし、集約範囲の全アドレスを対象にはしません。') },
        { id: 'snapshot', text: l('Both declared service conversations have usable routes in this snapshot.', 'この宣言状態では、元の両サービスに使用可能な往復経路があります。'),
          feedback: l('Production qualification still needs timed withdrawal/recovery and independently configured on-premises return preference. This is not a measured failover or SLA.', '本番の検証には、時間を計測した切り替えと復旧、およびオンプレミスの独立した復路優先設定が必要です。これはフェールオーバー時間や SLA の測定ではありません。') },
      ],
    } },
  )
  const task = (suffix: string, points: number, title: ReturnType<typeof l>, instruction: ReturnType<typeof l>, check: string, guides: string[] = []): CourseTask => ({
    id: `${id}.${suffix}`, assessmentVersion: 1, awardId: `${id}.${suffix}`, points, title, instruction,
    hints: [], checkId: `${id}.${check}`, guidanceIds: guides.map((guide) => `${id}.${guide}`),
  })
  const tasks = [
    task('load', 5, l('Open the hybrid incident', 'ハイブリッド障害を開く'),
      l('Confirm loading this original practice network. Your normal design stays protected. No Azure resources are deployed.', '初期練習ネットワークの読み込みを確認します。通常の設計は保護され、Azure リソースはデプロイされません。'), 'load-check'),
    task('inspect', 5, l('Read the primary route', 'プライマリ ルートを読む'),
      l('Inspect Application / Workload for 172.28.20.0/24. Identify its current source and gateway. The preconfigured VPN connection is disabled.', 'Application / Workload の 172.28.20.0/24 を調べ、生成元とゲートウェイを確認します。事前設定済み VPN 接続は無効です。'), 'before', ['source-guide']),
    task('repair', 65, l('Bring the original backup into service', '元のバックアップ接続を有効にする'),
      l('Enable and save Branch VPN backup with BGP enabled. Leave both original ER attachments enabled. Preserve gateway sharing, Operations 10.91.2.10 and Restricted tenant isolation. Both branch services must work in both directions.', 'BGP を有効にした Branch VPN backup を有効化して保存します。元の両 ER 接続、ゲートウェイ共有、Operations 10.91.2.10、テナントの分離を保持します。両拠点サービスの双方向通信が必要です。'), 'repair-check', ['vpn-guide']),
    task('compare', 10, l('Compare specificity with preference', '具体性と優先度を比較する'),
      l('Inspect 172.28.10.0/24 and compare it with ER’s 172.28.0.0/16 and 172.28.20.0/24.', '172.28.10.0/24 を調べ、ER の 172.28.0.0/16、172.28.20.0/24 と比較します。'), 'specific', ['specific-guide']),
    task('diagnose', 25, l('Explain the two different winners', '異なる 2 つの選択結果を説明する'),
      l('Use the active routes for branch addresses 172.28.10.10 and 172.28.20.10, not transport branding alone.', '通信方式の名前だけでなく、拠点アドレス 172.28.10.10 と 172.28.20.10 の有効なルートから判断します。'), 'diagnosis-check'),
    task('withdraw', 80, l('Declare the primary withdrawal', 'プライマリの停止状態を宣言する'),
      l('Disable and save only Branch ExpressRoute attachment. Keep Azure ExpressRoute attachment and the original BGP VPN enabled. Verify both original branch services, independent replies, Operations and isolation. This changes a steady-state declaration, not elapsed failover.', 'Branch ExpressRoute attachment だけを無効化して保存します。Azure 側 ER 接続と元の BGP VPN は有効のまま、両サービス、独立した復路、Operations、分離を確認します。これは定常状態の宣言変更であり、時間を伴う切り替えではありません。'), 'withdraw-check', ['er-guide']),
    task('fallback', 10, l('Inspect the new workload gateway', '変更後のワークロード ゲートウェイを調べる'),
      l('Inspect Application / Workload’s 172.28.20.0/24 route after withdrawal and compare its gateway with the primary snapshot.', '停止後の Application / Workload の 172.28.20.0/24 を調べ、以前のゲートウェイと比較します。'), 'after-withdrawal', ['source-guide']),
    task('return', 10, l('Inspect the branch reply independently', '拠点の復路を独立して調べる'),
      l('In Branch services, inspect the preferred 10.91.0.0/16 received route in this branch scope, not an Azure subnet table.', 'Branch services で、受信した 10.91.0.0/16 の優先ルートを調べます。Azure サブネットではなく拠点の範囲を確認してください。'), 'return', ['return-guide']),
    task('explain', 40, l('State the evidence boundary', '根拠の範囲を説明する'),
      l('Separate modeled routing from measured convergence, live service health and session continuity.', 'モデル上のルーティングを、収束時間の測定、実サービスの正常性、セッション継続と区別します。'), 'quiz'),
  ]
  bundle.lessons.push({ id, contentVersion: 1, scenarioId: id, prerequisites: ['ha-return-path'],
    title: l('Hybrid incident: preference, specificity and withdrawal', 'ハイブリッド障害: 優先度、具体性、停止状態'),
    objective: l('Qualify a declared ER/VPN backup without mistaking preference for longest-prefix match or forward reachability for a return path.', 'ER/VPN の宣言されたバックアップを検証し、優先度と最長一致、往路と復路を区別します。'),
    taskOrder: tasks.map((entry) => entry.id), tasks })
}
