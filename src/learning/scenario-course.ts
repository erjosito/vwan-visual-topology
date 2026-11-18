import type { CourseBundle, CourseGuidance } from './course-contract'
import type { Localized } from './content'
import type { FlowRequirement } from '../platform/contract'
import { scenarioCourse } from './editions'
import { scenarioTopologies } from './scenario-topologies'
import { haLessonRequirements } from './ha-scenario'

const l = (en: string, ja: string): Localized => ({ en, ja })
const subnet = (vnetId: string, subnetId = `${vnetId}-work`) => ({ kind: 'subnet' as const, vnetId, subnetId })
const pair = (id: string, source = 'a', target = 'b'): FlowRequirement => ({
  id, kind: 'flow', source: subnet(source), target: subnet(target),
  sourceAddress: source === 'leaf' ? '10.25.1.4' : '10.21.1.4',
  destinationAddress: target === 'c' ? '10.23.1.4' : '10.22.1.4', expectation: 'allow',
})
const witness: FlowRequirement = { ...pair('operations'), target: subnet('a', 'a-ops'), destinationAddress: '10.21.2.4' }
const isolation: FlowRequirement = { ...pair('restricted-tenant', 'a', 'c'), expectation: 'deny' }
const definitions = [
  {
    id: 'private-link', points: 100,
    title: l('A private partner connection', 'パートナーとのプライベート接続'),
    objective: l('Connect the application and partner without opening the restricted tenant.', '制限されたテナントを開放せず、アプリとパートナーを接続します。'),
    repair: l('Allow 10.21.1.4 and 10.22.1.4 to communicate in both directions. Keep 10.23.1.4 isolated from the application and preserve local Operations reachability.', '10.21.1.4 と 10.22.1.4 の双方向通信を可能にします。アプリから 10.23.1.4 への分離と、ローカル Operations への到達性を保持してください。'),
    before: { vnetId: 'a', subnetId: 'a-work', prefix: '10.22.0.0/16' },
    after: { vnetId: 'b', subnetId: 'b-work', prefix: '10.21.0.0/16' },
    requirements: [pair('partner'), witness, isolation],
    guidance: [{ id: 'private-link.connect', action: 'peering.command', params: { vnetAId: 'a', vnetBId: 'b' },
      instruction: l('Locate the command for connecting Application to Partner. You choose and execute the connection.', 'Application と Partner を接続するコマンドを探します。接続は自分で選んで実行します。') }] satisfies CourseGuidance[],
    question: l('After connecting these two VNets, what keeps the restricted tenant outside this path?', 'この 2 つの VNet を接続した後も、制限されたテナントがこの経路に含まれない理由は何ですか。'),
    answers: [
      [l('The new peering connects its two endpoints, not the third VNet.', '新しいピアリングは 2 つの接続先を結び、3 つ目の VNet は結びません。'), l('The route and flow evidence is scoped to the connected pair; the isolation check separately covers the tenant.', 'ルートと経路の根拠は接続したペアの範囲です。テナントは別の分離条件で確認しています。')],
      [l('The common region adds a private route with a lower preference.', '共通のリージョンが、優先度の低いプライベート ルートを追加します。'), l('A common region does not establish a private connection to the tenant.', '共通のリージョンであることは、テナントへのプライベート接続を確立しません。')],
      [l('The Operations subnet exports a route on behalf of the tenant.', 'Operations サブネットがテナントを代理してルートを伝達します。'), l('Local Operations reachability is a witness, not a transit or advertisement service.', 'ローカル Operations の到達性は比較用の条件であり、転送や広告のサービスではありません。')],
    ], correct: 0,
  },
  {
    id: 'inspection-bypass', points: 125,
    title: l('Reachable is not the same as inspected', '到達と検査は同じではない'),
    objective: l('Investigate a working conversation that does not meet its inspection requirement.', '通信は成功しても検査要件を満たさない設計を調べます。'),
    repair: l('Both directions between Application and Partner must traverse Inspection firewall. Keep the restricted tenant isolated and Operations reachable. Endpoint ownership must stay unchanged.', 'Application と Partner の双方向が Inspection firewall を通る必要があります。テナントの分離、Operations への到達性、エンドポイントの所有関係を保持してください。'),
    before: { vnetId: 'a', subnetId: 'a-work', prefix: '10.22.0.0/16' },
    after: { vnetId: 'b', subnetId: 'b-work', prefix: '10.21.0.0/16' },
    requirements: [{ ...pair('inspected-partner'), requiredApplianceId: 'fw' }, witness, isolation],
    question: l('In the starter, why did the partner conversation bypass the firewall despite a private summary UDR?', '初期構成にプライベート集約 UDR があるのに、パートナーとの通信がファイアウォールを迂回した理由は何ですか。'),
    answers: [
      [l('The return route selected a different firewall instance.', '復路が別のファイアウォール インスタンスを選択しました。'), l('This topology declares one inspection appliance; the initial pair bypassed it rather than selecting a second instance.', 'この構成の検査装置は 1 台です。初期経路は別の装置を選ばず、その装置を迂回しました。')],
      [l('The firewall subnet changed the partner address ownership.', 'ファイアウォール サブネットがパートナーのアドレス所有関係を変えました。'), l('The partner remains in its original VNet. Address ownership did not change.', 'パートナーは元の VNet に残っており、アドレスの所有関係は変わっていません。')],
      [l('The more-specific peering prefix won over the summary.', 'より具体的なピアリング プレフィックスが集約ルートより優先されました。'), l('For these declared candidates, the /16 peering route is more specific than the /8 UDR. Test inspection, not delivery alone.', 'この候補では /16 のピアリング ルートが /8 の UDR より具体的です。到達だけでなく検査も確認してください。')],
    ], correct: 2,
  },
  {
    id: 'colocated-chain', points: 200,
    title: l('Two appliances, one hub VNet', '1 つのハブ VNet と 2 台の装置'),
    objective: l('Separate firewall and transport subnet routing roles within the same VNet.', '同じ VNet 内でファイアウォールと転送装置のサブネットの役割を区別します。'),
    repair: l('Application to Partner must traverse Inspection firewall, then SD-WAN router. The independently routed reply must traverse SD-WAN router, then Inspection firewall. Preserve Operations and tenant isolation.', 'Application から Partner への経路は Inspection firewall、SD-WAN router の順に通る必要があります。独立した復路は逆の順に通ります。Operations とテナントの分離を保持してください。'),
    before: { vnetId: 'hub', subnetId: 'hub-work', prefix: '10.22.0.0/16' },
    after: { vnetId: 'hub', subnetId: 'transport-work', prefix: '10.21.0.0/16' },
    requirements: [{ ...pair('service-chain'), applianceChain: { forward: ['fw', 'sdwan'], reverse: ['sdwan', 'fw'] } }, witness, isolation],
    question: l('Why do these two appliance subnets need different onward routing policies?', 'この 2 つの装置のサブネットに、異なる後続ルーティング ポリシーが必要な理由は何ですか。'),
    answers: [
      [l('Their shared VNet gives each subnet a different peering state.', '共有 VNet により、各サブネットのピアリング状態が異なります。'), l('The peerings belong to the VNet; the relevant difference is the next stage each appliance must reach.', 'ピアリングは VNet に属します。重要な違いは、各装置が到達すべき次の段階です。')],
      [l('Each appliance has a different next stage in the required path.', '各装置は、必要な経路の中で異なる次の段階を持ちます。'), l('A copied subnet policy can skip a stage or send traffic back to an earlier one. Both directions need explicit reasoning.', 'サブネット ポリシーのコピーは、段階の迂回や前の段階への逆戻りを招きます。双方向を考える必要があります。')],
      [l('The transport subnet advertises the firewall subnet as a branch.', '転送装置のサブネットが、ファイアウォールのサブネットを拠点として広告します。'), l('This case models static appliance forwarding, not an overlay or branch advertisement protocol.', 'この課題は装置の静的な転送をモデル化しており、オーバーレイや拠点広告のプロトコルではありません。')],
    ], correct: 1,
  },
  {
    id: 'dedicated-chain', points: 250,
    title: l('Separate transport and inspection VNets', '転送と検査の VNet を分離する'),
    objective: l('Diagnose forwarding across a dedicated appliance VNet without adding a bypass.', '専用の装置 VNet を通る転送を、迂回経路を追加せずに診断します。'),
    repair: l('Restore the declared firewall-then-transport path to Partner and its reverse chain. Preserve the address owners, Operations reachability and restricted-tenant isolation.', 'Partner へのファイアウォール、転送装置の順の経路と逆順の復路を復旧します。アドレスの所有関係、Operations の到達性、テナントの分離を保持してください。'),
    before: { vnetId: 'hub', subnetId: 'hub-work', prefix: '10.22.0.0/16' },
    after: { vnetId: 'transport', subnetId: 'transport-work', prefix: '10.21.0.0/16' },
    requirements: [{ ...pair('dedicated-service-chain'), applianceChain: { forward: ['fw', 'sdwan'], reverse: ['sdwan', 'fw'] } }, witness, isolation],
    question: l('What additional obligation comes with the dedicated transport VNet in this design?', 'この設計で転送装置専用の VNet を設けると、どの追加要件が生じますか。'),
    answers: [
      [l('Maintain inter-VNet reach and forwarding at the appliance boundary.', '装置の境界で VNet 間の到達性と転送を維持します。'), l('A route toward an owned next hop is not sufficient if that appliance does not forward the transit traffic.', '所有されるネクストホップへのルートがあっても、装置が通過通信を転送しなければ不十分です。')],
      [l('Export the workload prefix from the restricted tenant connection.', '制限されたテナントの接続から、ワークロードのプレフィックスを広告します。'), l('The restricted tenant is not the transit network in this topology.', 'この構成では、制限されたテナントは転送ネットワークではありません。')],
      [l('Associate the Operations subnet with the transport route table.', 'Operations サブネットを転送装置のルート テーブルに関連付けます。'), l('Operations is a local witness. Moving its policy does not repair the appliance forwarding boundary.', 'Operations はローカルの比較対象です。そのポリシーの移動は、装置の転送境界を修復しません。')],
    ], correct: 0,
  },
  {
    id: 'branch-advertisement', points: 200,
    title: l('A connected gateway, a missing workload route', 'ゲートウェイは接続済み、ワークロードのルートは不在'),
    objective: l('Distinguish a gateway learning a branch route from injecting it into a workload subnet.', 'ゲートウェイによる拠点ルートの学習と、ワークロードへの伝達を区別します。'),
    repair: l('Restore both directions between 10.21.1.4 and branch 172.22.0.4. Keep local Operations working and the restricted tenant isolated. Keep the shared gateway and connection identities.', '10.21.1.4 と拠点 172.22.0.4 の双方向を復旧します。Operations とテナントの分離、共有ゲートウェイと接続の識別子を保持してください。'),
    before: { vnetId: 'a', subnetId: 'a-work', prefix: '172.22.0.0/24' },
    after: { vnetId: 'hub', subnetId: 'gateway', prefix: '10.21.0.0/16' },
    requirements: [{ ...pair('branch-pair'), target: { kind: 'site' as const, siteId: 'branch' }, destinationAddress: '172.22.0.4' }, witness, isolation],
    question: l('Which distinction explains the missing branch route in the starter workload table?', '初期ワークロードのテーブルに拠点ルートがない理由を説明する区別はどれですか。'),
    answers: [
      [l('A branch advertisement is the same as a workload peering route.', '拠点の広告は、ワークロードのピアリング ルートと同じです。'), l('Gateway-learned and peering routes have different sources and propagation controls.', 'ゲートウェイ学習ルートとピアリング ルートは、生成元と伝達制御が異なります。')],
      [l('A local Operations route proves the branch was advertised.', 'ローカル Operations のルートが、拠点の広告を証明します。'), l('The local witness does not establish a route to an independently owned branch prefix.', 'ローカルの比較用通信は、独立した拠点プレフィックスへのルートを証明しません。')],
      [l('Gateway learning and workload route propagation are separate controls.', 'ゲートウェイの学習とワークロードへの伝達は、別々の制御です。'), l('The connection and shared gateway can be healthy while the workload table suppresses their learned routes.', '接続と共有ゲートウェイが正常でも、ワークロードのテーブルで学習ルートが抑制される場合があります。')],
    ], correct: 2,
  },
  {
    id: 'wan-isolation', points: 200,
    title: l('Restore a shared service without opening a tenant', 'テナントを開放せず共有サービスを復旧'),
    objective: l('Work with WAN association and propagation as separate routing decisions.', 'WAN の関連付けと伝達を、別のルーティング判断として扱います。'),
    repair: l('Restore Application-to-Partner communication in both directions. Neither Application nor Restricted may initiate a delivered path to the other. Preserve Operations and the existing hub connection identities.', 'Application と Partner の双方向通信を復旧します。Application と Restricted の間では、どちらから開始しても到達できない状態を保持します。Operations とハブ接続の識別子も保持してください。'),
    before: { vnetId: 'a', subnetId: 'a-work', prefix: '10.22.0.0/16' },
    after: { vnetId: 'b', subnetId: 'b-work', prefix: '10.21.0.0/16' },
    requirements: [pair('shared-service'), witness, isolation,
      { ...pair('restricted-initiation'), source: subnet('c'), target: subnet('a'), sourceAddress: '10.23.1.4', destinationAddress: '10.21.1.4', expectation: 'deny' as const },
      { id: 'hub-partner', kind: 'route' as const, table: 'wan', hubTableId: 'defaultRouteTable', prefix: '10.22.0.0/16', expectation: 'present' as const }],
    question: l('Why can a connection use Default without its own prefix appearing in Default?', '接続が Default を使用していても、その接続のプレフィックスが Default に現れない理由は何ですか。'),
    answers: [
      [l('The destination subnet decides which hub table the source uses.', '宛先サブネットが、送信元の使用するハブ テーブルを決定します。'), l('The source connection association selects its routing context.', '送信元接続の関連付けが、使用するルーティング コンテキストを選択します。')],
      [l('Association chooses the lookup context; propagation publishes prefixes.', '関連付けは検索先を選び、伝達はプレフィックスを公開します。'), l('They are separate settings. Inspect the exact Default table, not a union of routes from unrelated contexts.', 'これらは別々の設定です。無関係なコンテキストのルートの集合ではなく、正確な Default テーブルを調べてください。')],
      [l('A local VNet route advertises the connection into each hub table.', 'ローカル VNet ルートが、接続を各ハブ テーブルに広告します。'), l('A local route does not select hub propagation destinations.', 'ローカル ルートは、ハブの伝達先を選択しません。')],
    ], correct: 1,
  },
  {
    id: 'tiered-incident', points: 250,
    title: l('Capstone: an indirect workload joins the service path', '総合課題: 間接接続されたワークロード'),
    objective: l('Diagnose an unfamiliar tier without being told which controls are wrong.', 'どの制御に問題があるかを教わらず、新しい階層を診断します。'),
    repair: l('Connect 10.25.1.4 to Partner through Tier router, Inspection firewall and SD-WAN router, with the reverse order on the reply. Keep the existing Application-to-Partner inspected chain working and do not open the restricted tenant. Keep original endpoint and appliance owners.', '10.25.1.4 から Partner へ Tier router、Inspection firewall、SD-WAN router の順に接続し、復路は逆順にします。既存の Application と Partner の検査経路とテナントの分離、所有関係を保持してください。'),
    before: { vnetId: 'leaf', subnetId: 'leaf-work', prefix: '10.22.0.0/16' },
    after: { vnetId: 'hub', subnetId: 'hub-work', prefix: '10.25.0.0/16' },
    requirements: [{ ...pair('indirect-chain', 'leaf'), applianceChain: { forward: ['tier', 'fw', 'sdwan'], reverse: ['sdwan', 'fw', 'tier'] } },
      { ...pair('existing-partner'), applianceChain: { forward: ['fw', 'sdwan'], reverse: ['sdwan', 'fw'] } },
      { ...pair('indirect-isolation', 'leaf', 'c'), expectation: 'deny' as const }],
    question: l('What does a successful forward trace establish about this indirect workload?', 'この間接ワークロードで、往路のトレース成功は何を証明しますか。'),
    answers: [
      [l('The outbound path works; the reply still needs an independent check.', '往路は機能しますが、復路は独立して確認する必要があります。'), l('The lower-tier prefix needs a usable return path at each upstream boundary. The combined check also protects the existing conversation.', '下位層のプレフィックスには、上流の各境界で使用できる復路が必要です。総合確認は既存の通信も保護します。')],
      [l('The upstream firewall has learned the indirect return prefix.', '上流のファイアウォールが、間接ワークロードの復路を学習しています。'), l('The forward trace follows destination routes; it does not establish upstream reachability to the source prefix.', '往路のトレースは宛先ルートに従います。送信元プレフィックスへの上流の到達性は証明しません。')],
      [l('The existing partner conversation uses the new tier as its reply.', '既存のパートナー通信は、新しい階層を復路として使用します。'), l('The existing and new conversations have different source owners and are assessed separately.', '既存と新規の通信は送信元の所有関係が異なり、別々に評価されます。')],
    ], correct: 0,
  },
  {
    id: 'ha-return-path', points: 250,
    title: l('HA transit: an independent return path', 'HA 転送: 独立した復路'),
    objective: l('Diagnose asymmetric NVA transit without confusing a declared health snapshot with live failover.', '宣言された正常性のスナップショットとライブ フェールオーバーを区別し、NVA 転送の非対称性を診断します。'),
    repair: l('Restore the original client/server conversation through the same eligible NVA in both directions. Keep forward HA-ports steering and the original primary backend. Preserve original endpoints and local Operations reachability. Compare a return route through Transit VIP 10.80.3.10 with pinning the currently selected NVA: either must meet this snapshot, but a pinned route does not follow a later backend selection. This is a configuration repair, not automated failover.',
      '元のクライアントとサーバーの双方向通信が、同じ適格な NVA を通るように復旧します。往路の HA ポート転送と元のプライマリ バックエンドを保持し、元のエンドポイントと Operations への到達性も保持します。Transit VIP 10.80.3.10 を通る復路と、現在選択された NVA に固定する復路を比較してください。どちらもこのスナップショットを満たす必要がありますが、固定ルートは後のバックエンド選択に追従しません。これは構成の修復であり、自動フェールオーバーではありません。'),
    before: { vnetId: 'application', subnetId: 'work', prefix: '10.82.0.0/16' },
    after: { vnetId: 'remote', subnetId: 'remote-work', prefix: '10.81.0.0/16' },
    requirements: haLessonRequirements,
    guidance: [{ id: 'ha-return-path.packet', action: 'packet-probe.open', params: { vnetId: 'hub' },
      instruction: l('In the native packet probe, choose Application client as source and Remote server as destination, TCP 49152 to 443. Run the trace and compare forward/reply tuples, backend identities and symmetry. Close VNet detail to return to the lesson. No configuration is applied for you.',
        '標準のパケット プローブで、送信元に Application client、宛先に Remote server、TCP 49152 から 443 を選びます。トレースを実行し、往復のタプル、バックエンドの識別子、対称性を比較します。VNet 詳細を閉じると課題に戻れます。構成は自動で変更されません。') }] satisfies CourseGuidance[],
    diagnosis: {
      question: l('In the unchanged starter trace, what explains the reported asymmetry?', '変更していない初期構成のトレースで、非対称と報告される理由は何ですか。'),
      answers: [
        [l('The client packet is translated to the frontend address.', 'クライアントのパケットがフロントエンドのアドレスに変換されます。'), l('This rule explicitly preserves the original packet tuple; compare the independent onward routes.', 'このルールは元のパケット タプルを明示的に保持します。独立した後続ルートを比較してください。')],
        [l('The reply route pins a different appliance than the selected backend.', '復路が、選択されたバックエンドとは別の装置に固定されています。'), l('The forward snapshot selects primary-vm; the remote UDR sends the reply to the standby NVA. Reachability alone is insufficient.', '往路のスナップショットは primary-vm を選びますが、リモートの UDR は復路を待機 NVA に向けています。到達性だけでは不十分です。')],
        [l('Forward HA-ports steering also fixes the remote subnet next hop.', '往路の HA ポート転送により、リモート サブネットのネクストホップも固定されます。'), l('HA-ports steering does not rewrite the remote subnet UDR. Inspect that independent route.', 'HA ポート転送は、リモート サブネットの UDR を書き換えません。独立したルートを確認してください。')],
      ], correct: 1,
    },
    question: l('The repaired evidence confirms the original tuples and intended return NVA. Which behavior over time remains untested?', '修復後の根拠では、元のタプルと意図した復路の NVA を確認できました。時間の経過に伴うどの動作が、まだ検証されていませんか。'),
    answers: [
      [l('Whether the original addresses and ports are retained.', '元のアドレスとポートが保持されるかどうか。'), l('Tuple preservation is part of this bounded declaration and its packet evidence.', 'タプルの保持は、この限定された宣言とパケットの根拠に含まれます。')],
      [l('Whether the independent return follows the declared NVA.', '独立した復路が、宣言された NVA を通るかどうか。'), l('Both directions and the original backend are checked separately in this configuration.', 'この構成では、双方向と元のバックエンドを個別に確認しています。')],
      [l('Whether established sessions survive a real backend failure.', '実際のバックエンド障害で、確立済みセッションが維持されるかどうか。'), l('Declared eligibility and steady-state routing do not prove live probes, convergence, Azure hashing or vendor state replication. Session continuity needs separate live evidence.', '宣言された適格性と定常状態のルーティングは、ライブ プローブ、収束、Azure のハッシュ処理、ベンダーの状態複製を証明しません。セッション継続には別の実環境の根拠が必要です。')],
    ], correct: 2,
  },
]

export const scenarioBundle: CourseBundle = { schemaVersion: 1, course: scenarioCourse, lessons: [], scenarios: [], checks: [], guidance: [] }
for (const [index, definition] of definitions.entries()) {
  const { id, before, after } = definition
  const scopeName = (scope: typeof before) => {
    const vnet = scenarioTopologies[id].vnets.find((vnet) => vnet.id === scope.vnetId)!
    return `${vnet.name} / ${vnet.subnets.find((subnet) => subnet.id === scope.subnetId)!.name}`
  }
  const repairGuidance: CourseGuidance[] = definition.guidance ?? []
  for (const vnet of scenarioTopologies[id].vnets) {
    if (vnet.id === 'c') continue
    repairGuidance.push({ id: `${id}.configure-${vnet.id}`, action: 'network.configure', params: { vnetId: vnet.id },
      instruction: l(`Locate the native configuration for ${vnet.name}; inspect its controls without changing the assessed design automatically.`, `${vnet.name} の標準設定画面を開きます。設計は自動で変更されません。`) })
    for (const subnet of vnet.subnets.filter((subnet) => subnet.routeTableId)) {
      repairGuidance.push({ id: `${id}.table-${subnet.id}`, action: 'route-table.configure',
        params: { vnetId: vnet.id, subnetId: subnet.id, routeTableId: subnet.routeTableId! },
        instruction: l(`Locate the routing policy for ${vnet.name} / ${subnet.name}. Choose the diagnosis and repair yourself.`, `${vnet.name} / ${subnet.name} のルーティング ポリシーを開きます。診断と修復は自分で判断します。`) })
    }
  }
  if (id === 'wan-isolation') repairGuidance.push({ id: `${id}.hub`, action: 'hub-routes.open', params: { hubId: 'wan', tableId: 'defaultRouteTable' },
    instruction: l('Inspect this hub’s exact Default table. This is not a union of the hub tables.', 'このハブの正確な Default テーブルを調べます。複数テーブルの集合ではありません。') },
    { id: `${id}.hub-config`, action: 'hub.configure', params: { hubId: 'wan' },
      instruction: l('Locate the hub connection routing controls; choose the appropriate association and propagation yourself.', 'ハブ接続のルーティング設定を開きます。関連付けと伝達は自分で判断します。') })
  scenarioBundle.scenarios.push({ id, document: { mode: 'full', topology: scenarioTopologies[id] } })
  scenarioBundle.guidance.push(...repairGuidance,
    { id: `${id}.before-guide`, action: 'routes.open', params: before, instruction: l('Locate the requested source table and prefix, including its absence.', '指定された送信元テーブルとプレフィックスの有無を調べます。') },
    { id: `${id}.after-guide`, action: 'routes.open', params: after, instruction: l('Locate the independently scoped return table and compare its next hop.', '独立した復路のテーブルを開き、ネクストホップを比較します。') })
  scenarioBundle.checks.push(
    { id: `${id}.load-check`, kind: 'scenario.loaded', params: { scenarioId: id } },
    { id: `${id}.before`, kind: 'routes.inspected', params: before },
    { id: `${id}.repair-check`, kind: 'requirements.satisfied', params: { requirements: definition.requirements } },
    { id: `${id}.after`, kind: 'routes.inspected', params: after },
    { id: `${id}.quiz`, kind: 'quiz.answered', params: { question: definition.question, correctChoiceId: `choice-${definition.correct}`,
      choices: definition.answers.map(([text, feedback], choice) => ({ id: `choice-${choice}`, text, feedback })) } })
  if (definition.diagnosis) scenarioBundle.checks.push({
    id: `${id}.diagnosis-check`, kind: 'quiz.answered', params: {
      question: definition.diagnosis.question, correctChoiceId: `choice-${definition.diagnosis.correct}`,
      choices: definition.diagnosis.answers.map(([text, feedback], choice) => ({ id: `choice-${choice}`, text, feedback })),
    },
  })
  const tasks = [
    { suffix: 'load', points: 5, title: l('Open this scenario', 'このシナリオを開く'),
      instruction: l('Confirm loading this original practice network. Your normal design stays protected; no Azure resources are deployed.', '初期練習ネットワークの読み込みを確認します。通常の設計は保護され、Azure リソースはデプロイされません。'),
      checkId: `${id}.load-check`, guidanceIds: [] },
    { suffix: 'inspect', points: 5, title: l('Read the source routing evidence', '送信元のルートの根拠を読む'),
      instruction: l(`Inspect ${scopeName(before)} for ${before.prefix}. Note the source and next hop, or the absence of an exact route. Record the inspection there.`,
        `${scopeName(before)} で ${before.prefix} を調べます。生成元とネクストホップ、または完全一致ルートがないことを確認し、その画面で記録してください。`),
      checkId: `${id}.before`, guidanceIds: [`${id}.before-guide`] },
    ...(definition.diagnosis ? [{ suffix: 'diagnose', points: 25, title: l('Diagnose the packet evidence', 'パケットの根拠から診断する'),
      instruction: l('Run the unchanged starter packet probe using Show me where. Compare the original tuple and the independent reply before choosing an explanation.', '「場所を表示」で初期構成のパケット プローブを実行します。元のタプルと独立した復路を比較してから、理由を選んでください。'),
      checkId: `${id}.diagnosis-check`, guidanceIds: [`${id}.packet`] }] : []),
    { suffix: 'repair', points: definition.points - 35 - (definition.diagnosis ? 25 : 0), title: l('Meet the network requirements', 'ネットワーク要件を満たす'),
      instruction: definition.repair, checkId: `${id}.repair-check`, guidanceIds: repairGuidance.map((entry) => entry.id) },
    { suffix: 'return', points: 5, title: l('Inspect the independent return scope', '独立した復路の範囲を調べる'),
      instruction: l(`Inspect ${scopeName(after)} for ${after.prefix}. Compare this scope with the source; then record the inspection.`,
        `${scopeName(after)} で ${after.prefix} を調べます。送信元とこの範囲を比較し、確認を記録してください。`),
      checkId: `${id}.after`, guidanceIds: [`${id}.after-guide`] },
    { suffix: 'explain', points: 20, title: l('Explain the architectural consequence', '設計上の意味を説明する'),
      instruction: l('Use the declared scenario and the evidence you inspected, not the location of a simulator control.', 'シミュレーターの操作場所ではなく、シナリオと確認した根拠に基づいて回答してください。'),
      checkId: `${id}.quiz`, guidanceIds: [] },
  ].map(({ suffix, ...task }) => ({ ...task, id: `${id}.${suffix}`, assessmentVersion: 1, awardId: `${id}.${suffix}`, hints: [] }))
  scenarioBundle.lessons.push({ id, contentVersion: 1, scenarioId: id, title: definition.title, objective: definition.objective,
    prerequisites: index ? [definitions[index - 1].id] : [], taskOrder: tasks.map((task) => task.id), tasks })
}
