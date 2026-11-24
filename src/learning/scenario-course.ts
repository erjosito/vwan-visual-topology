import type { CourseBundle, CourseGuidance } from './course-contract'
import type { Localized } from './content'
import type { FlowRequirement } from '../platform/contract'
import { scenarioCourse } from './editions'
import { scenarioTopologies } from './scenario-topologies'
import { haLessonRequirements } from './ha-scenario'
import { appendHybridLesson } from './hybrid-course'
import { appendMultihubLesson } from './multihub-course'
import { teachCourse } from './course-teaching'
import { addScenarioFoundations } from './scenario-foundations'
import { appendTransferLesson } from './transfer-course'

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
      [l('Peering publishes its two VNets’ routes, not Restricted’s.', 'ピアリングは両 VNet のルートを公開し、Restricted のルートは公開しません。'), l('The route and flow evidence is scoped to the connected pair; the isolation check separately covers the tenant.', 'ルートと経路の根拠は接続したペアの範囲です。テナントは別の分離条件で確認しています。')],
      [l('Using 10.x addresses places Restricted in the same private network.', '10.x の使用により、Restricted も同じプライベート ネットワークに属します。'), l('Private address space is not one shared VNet. Restricted still needs an actual connecting path; sharing the 10.0.0.0/8 range does not supply one.', 'プライベート範囲が同じでも、1 つの VNet ではありません。Restricted への実際の接続経路が必要で、10.0.0.0/8 の共有だけでは接続されません。')],
      [l('The new peering also blocks connections to the other VNets.', '新しいピアリングは、他の VNet への接続もブロックします。'), l('Peering creates a path for its pair; it is not a deny rule for other networks. The separate isolation check establishes that no tenant path was opened here.', 'ピアリングは両者の経路を作るもので、他ネットワークへの拒否規則ではありません。ここでテナントへの経路が開いていないことは、別の分離条件で確認しています。')],
    ], correct: 0,
    fundamentals: [
      { id: 'subnet-scope', title: l('Understand the peering scope', 'ピアリングの範囲を理解する'),
        question: l('With ordinary whole-VNet peering, which subnets in Application and Partner receive routes to the other VNet?', '通常の VNet 全体のピアリングでは、Application と Partner のどのサブネットに相手の VNet へのルートが追加されますか。'),
        answers: [
          [l('The subnets selected as the connectivity test’s two endpoints.', '接続テストの両エンドポイントに選ばれたサブネットです。'), l('A test selects example endpoints; it does not limit the scope of whole-VNet peering.', 'テストのエンドポイントは例であり、VNet 全体のピアリングの範囲を制限しません。')],
          [l('Every subnet in the two peered VNets.', 'ピアリングした両 VNet のすべてのサブネットです。'), l('Whole-VNet peering adds routes throughout both VNets, not just between the tested subnets. Actual traffic still depends on access settings, selected routes and security rules. Subnet peering is a separate, narrower option.', 'VNet 全体のピアリングは、テストしたサブネットだけでなく両方の VNet 全体にルートを追加します。実際の通信はアクセス設定、選択ルート、セキュリティ規則にも依存します。サブネット ピアリングは、範囲を絞る別の選択肢です。')],
          [l('The subnets using matching address ranges in the two VNets.', '両 VNet で、一致するアドレス範囲を使うサブネットです。'), l('Matching subnet ranges are not a peering requirement. Ordinary whole-VNet peering requires non-overlapping VNet address spaces and supplies peer routes throughout both VNets.', 'サブネット範囲の一致は必要ありません。通常の VNet 全体のピアリングでは、VNet アドレス空間が重複しないことが必要で、両 VNet 全体へ相手のルートを追加します。')],
        ], correct: 1 },
      { id: 'access-setting', title: l('Distinguish a route from permission', 'ルートと通信許可を区別する'),
        question: l('What happens if Allow VNet access is cleared on a connected peering?', '接続済みのピアリングで Allow VNet access をオフにすると、どうなりますか。'),
        answers: [
          [l('The address-space routes disappear, but the peering remains connected.', 'アドレス空間のルートは消えますが、ピアリングは接続済みのままです。'), l('Clearing access is a forwarding permission change, not deletion or route withdrawal. The address-space routes can remain visible.', 'アクセスの解除は転送の許可の変更であり、削除やルートの撤回ではありません。アドレス空間のルートは表示されたままの場合があります。')],
          [l('A matching UDR can still permit the blocked peering traffic.', '一致する UDR があれば、ブロックされたピアリング通信も許可できます。'), l('A next-hop choice does not override the peering’s access permission. Having a matching route is different from being allowed to forward across the connection.', 'ネクストホップの選択は、ピアリングのアクセス許可を上書きしません。一致するルートと、接続を通過できる許可は別です。')],
          [l('Affected traffic is blocked; peering routes can remain.', '対象の通信はブロックされますが、ピアリングのルートは残り得ます。'), l('A route describes where traffic would go; it does not grant permission to cross a peering. Check Allow VNet access as well as effective routes. Turning access off does not itself delete the peering or withdraw its address-space routes.', 'ルートは転送先を示すものであり、ピアリングを通過する許可ではありません。有効なルートと Allow VNet access の両方を確認します。アクセスを無効にしても、それ自体でピアリングやアドレス空間のルートが削除されるわけではありません。')],
        ], correct: 2 },
    ],
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
      [l('The /8 UDR became inactive because the peering connection existed.', 'ピアリング接続があるため、/8 UDR が無効になっていました。'), l('The /8 can remain an active candidate for its prefix. A more-specific /16 can still be selected for Partner’s destination address.', '/8 は、そのプレフィックスの有効な候補として残れます。それでも Partner の宛先では、より具体的な /16 が選ばれます。')],
      [l('The firewall IP had to match Partner’s destination address range.', 'ファイアウォールの IP が、Partner の宛先範囲に含まれる必要がありました。'), l('The next-hop IP identifies the router, not the destination owner. The firewall is correctly in the hub; compare matching destination prefixes.', 'ネクストホップの IP はルーターを識別し、宛先の所有先を示しません。ファイアウォールは正しくハブ内にあります。一致する宛先プレフィックスを比較します。')],
      [l('The /16 peering route matched more specifically than /8.', '/16 のピアリング ルートが、/8 より具体的に一致しました。'), l('For these declared candidates, the /16 peering route is more specific than the /8 UDR. Test inspection, not delivery alone.', 'この候補では /16 のピアリング ルートが /8 の UDR より具体的です。到達だけでなく検査も確認してください。')],
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
      [l('The workload’s policy controls the lookup at every onward appliance.', 'ワークロードのポリシーが、後続の全装置での検索を制御します。'), l('A subnet policy applies at that subnet’s departure. Each appliance subnet performs its own onward lookup.', 'サブネットのポリシーは、そのサブネットからの送信に適用されます。各装置のサブネットは独立して後続を検索します。')],
      [l('Each appliance subnet forwards toward its own next service stage.', '各装置のサブネットは、それぞれの次のサービス段階へ転送します。'), l('A copied subnet policy can skip a stage or send traffic back to an earlier one. Both directions need explicit reasoning.', 'サブネット ポリシーのコピーは、段階の迂回や前の段階への逆戻りを招きます。双方向を考える必要があります。')],
      [l('Both appliance subnets should forward toward the same next hop.', '両装置のサブネットは、同じネクストホップへ転送する必要があります。'), l('The required sequence has different next stages at the firewall and transport router. Identical policies can loop or skip a stage.', '必要な順序では、ファイアウォールと転送ルーターで次の段階が異なります。同じポリシーではループや段階の迂回を起こす場合があります。')],
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
      [l('Maintain inter-VNet reachability and enabled forwarding at each appliance boundary.', '各装置の境界で、VNet 間の到達性と有効な転送を維持します。'), l('A route toward an owned next hop is not sufficient if that appliance does not forward the transit traffic.', '所有されるネクストホップへのルートがあっても、装置が通過通信を転送しなければ不十分です。')],
      [l('Enable gateway transit on each peering to carry the appliance chain.', '装置チェーンを通すため、各ピアリングでゲートウェイ転送を有効にします。'), l('Gateway transit shares a gateway; it does not switch on an NVA’s forwarding. This chain uses explicitly addressed appliances.', 'ゲートウェイ転送はゲートウェイの共有であり、NVA の転送を有効にはしません。このチェーンは IP を指定した装置を使います。')],
      [l('Enable forwarded traffic on peering instead of the NVA’s NIC forwarding.', 'NVA の NIC 転送の代わりに、ピアリングの転送トラフィックを許可します。'), l('Peering permission and NIC IP forwarding are separate obligations. Allowing a forwarded packet across a peering does not make the appliance forward it.', 'ピアリングの許可と NIC IP 転送は別の要件です。ピアリングで転送パケットを許可しても、装置自身の転送は有効になりません。')],
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
      [l('Learning a branch prefix also publishes it into every workload table.', '拠点プレフィックスの学習により、全ワークロードのテーブルにも公開されます。'), l('A gateway can learn a prefix while a workload’s route-table policy suppresses BGP propagation. Learning and publication are distinct.', 'ゲートウェイが学習しても、ワークロードのルート テーブルで BGP 伝達を抑制できます。学習と公開は別です。')],
      [l('Allowing gateway transit overrides the workload table’s BGP propagation setting.', 'ゲートウェイ転送を許可すると、ワークロードの BGP 伝達設定を上書きします。'), l('Gateway sharing does not override subnet propagation policy. Check the already configured transit separately from the workload table.', 'ゲートウェイ共有はサブネットの伝達ポリシーを上書きしません。構成済みの転送とワークロードのテーブルは別に確認します。')],
      [l('Gateway learning and workload propagation are separate routing controls.', 'ゲートウェイの学習とワークロードへの伝達は、別のルーティング制御です。'), l('The connection and shared gateway can be healthy while the workload table suppresses their learned routes.', '接続と共有ゲートウェイが正常でも、ワークロードのテーブルで学習ルートが抑制される場合があります。')],
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
      [l('Association publishes the local prefix; propagation selects the source’s lookup.', '関連付けは自分のプレフィックスを公開し、伝達は送信元の検索先を選びます。'), l('The source connection association selects its routing context.', '送信元接続の関連付けが、使用するルーティング コンテキストを選択します。')],
      [l('Association selects the lookup; propagation publishes the connection’s prefixes.', '関連付けは検索先を選び、伝達は接続のプレフィックスを公開します。'), l('They are separate settings. Inspect the exact Default table, not a union of routes from unrelated contexts.', 'これらは別々の設定です。無関係なコンテキストのルートの集合ではなく、正確な Default テーブルを調べてください。')],
      [l('Association selects the source lookup and also publishes its own prefix.', '関連付けは送信元の検索先を選び、自分のプレフィックスも公開します。'), l('Selecting a table for lookups does not publish the connection’s prefix there. Propagation controls that separate decision.', '検索に使うテーブルの選択は、その接続のプレフィックスを公開しません。公開は別の伝達設定で制御します。')],
    ], correct: 1,
  },
  {
    id: 'tiered-incident', points: 250,
    title: l('Guided incident: an indirect workload joins the service path', '段階的な障害対応: 間接接続されたワークロード'),
    objective: l('Prepare the new tier’s first stage, then diagnose the remaining return boundary.', '新しい階層の最初の段階を準備し、残る復路の境界を診断します。'),
    repair: l('Connect 10.25.1.4 to Partner through Tier router, Inspection firewall and SD-WAN router, with the reverse order on the reply. Keep the existing Application-to-Partner inspected chain working and do not open the restricted tenant. Keep original endpoint and appliance owners.', '10.25.1.4 から Partner へ Tier router、Inspection firewall、SD-WAN router の順に接続し、復路は逆順にします。既存の Application と Partner の検査経路とテナントの分離、所有関係を保持してください。'),
    before: { vnetId: 'leaf', subnetId: 'leaf-work', prefix: '10.22.0.0/16' },
    after: { vnetId: 'hub', subnetId: 'hub-work', prefix: '10.25.0.0/16' },
    requirements: [{ ...pair('indirect-chain', 'leaf'), applianceChain: { forward: ['tier', 'fw', 'sdwan'], reverse: ['sdwan', 'fw', 'tier'] } },
      { ...pair('existing-partner'), applianceChain: { forward: ['fw', 'sdwan'], reverse: ['sdwan', 'fw'] } },
      { ...pair('indirect-isolation', 'leaf', 'c'), expectation: 'deny' as const }],
    question: l('What does a successful forward trace establish about this indirect workload?', 'この間接ワークロードで、往路のトレース成功は何を証明しますか。'),
    answers: [
      [l('The outbound path works; the reply still needs its own lookup.', '往路は機能しますが、応答には独立した復路検索が必要です。'), l('The lower-tier prefix needs a usable return path at each upstream boundary. The combined check also protects the existing conversation.', '下位層のプレフィックスには、上流の各境界で使用できる復路が必要です。総合確認は既存の通信も保護します。')],
      [l('The forward result also establishes the upstream route to the source.', '往路の結果により、上流から送信元へのルートも確立されます。'), l('The forward trace follows destination routes; it does not establish upstream reachability to the source prefix.', '往路のトレースは宛先ルートに従います。送信元プレフィックスへの上流の到達性は証明しません。')],
      [l('The forward result establishes replies for the existing and new conversations.', '往路の結果により、既存と新規の通信の復路も確立されます。'), l('The existing and new conversations have different source owners and are assessed separately.', '既存と新規の通信は送信元の所有関係が異なり、別々に評価されます。')],
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
        [l('The request’s frontend translates the client address before selecting its NVA.', '要求のフロントエンドが、NVA の選択前にクライアントのアドレスを変換します。'), l('This rule explicitly preserves the original packet tuple; compare the independent onward routes.', 'このルールは元のパケット タプルを明示的に保持します。独立した後続ルートを比較してください。')],
        [l('The reply selects a different NVA from the request’s chosen backend.', '応答は、要求で選ばれたバックエンドと異なる NVA を選びます。'), l('The forward snapshot selects primary-vm; the remote UDR sends the reply to the standby NVA. Reachability alone is insufficient.', '往路のスナップショットは primary-vm を選びますが、リモートの UDR は復路を待機 NVA に向けています。到達性だけでは不十分です。')],
        [l('The request’s HA-ports rule chooses the backend for the independent reply.', '要求の HA ポート ルールが、独立した応答のバックエンドも選びます。'), l('HA-ports steering does not rewrite the remote subnet UDR. Inspect that independent route.', 'HA ポート転送は、リモート サブネットの UDR を書き換えません。独立したルートを確認してください。')],
      ], correct: 1,
    },
    question: l('The repaired evidence confirms the original tuples and intended return NVA. Which behavior over time remains untested?', '修復後の根拠では、元のタプルと意図した復路の NVA を確認できました。時間の経過に伴うどの動作が、まだ検証されていませんか。'),
    answers: [
      [l('Whether the original flow’s source and destination tuple are preserved.', '元のフローの送信元と宛先のタプルが保持されるかどうか。'), l('Tuple preservation is part of this bounded declaration and its packet evidence.', 'タプルの保持は、この限定された宣言とパケットの根拠に含まれます。')],
      [l('Whether the return reaches the same declared appliance as the request.', '復路が、要求と同じ宣言済みの装置へ到達するかどうか。'), l('Both directions and the original backend are checked separately in this configuration.', 'この構成では、双方向と元のバックエンドを個別に確認しています。')],
      [l('Whether established sessions survive a real change in backend health.', '実際の装置障害でも、既存セッションが維持されるかどうか。'), l('Declared eligibility and steady-state routing do not prove live probes, convergence, Azure hashing or vendor state replication. Session continuity needs separate live evidence.', '宣言された適格性と定常状態のルーティングは、ライブ プローブ、収束、Azure のハッシュ処理、ベンダーの状態複製を証明しません。セッション継続には別の実環境の根拠が必要です。')],
    ], correct: 2,
  },
]

const repairScopes: Record<string, Array<[string, string?]>> = {
  'private-link': [],
  'inspection-bypass': [['b', 'b-work'], ['a', 'a-work']],
  'colocated-chain': [['hub', 'hub-work'], ['hub', 'transport-work']],
  'dedicated-chain': [['transport']],
  'branch-advertisement': [['a', 'a-work']],
  'wan-isolation': [],
  'tiered-incident': [['hub', 'hub-work'], ['leaf', 'leaf-work']],
  'ha-return-path': [['remote', 'remote-work']],
}

export const scenarioBundle: CourseBundle = { schemaVersion: 1, course: scenarioCourse, lessons: [], scenarios: [], checks: [], guidance: [] }
for (const [index, definition] of definitions.entries()) {
  const { id, before, after } = definition
  const scopeName = (scope: typeof before) => {
    const vnet = scenarioTopologies[id].vnets.find((vnet) => vnet.id === scope.vnetId)!
    return `${vnet.name} / ${vnet.subnets.find((subnet) => subnet.id === scope.subnetId)!.name}`
  }
  const repairGuidance: CourseGuidance[] = []
  for (const [vnetId, subnetId] of repairScopes[id]) {
    const vnet = scenarioTopologies[id].vnets.find((entry) => entry.id === vnetId)!
    if (subnetId) {
      const subnet = vnet.subnets.find((entry) => entry.id === subnetId)!
      repairGuidance.push({ id: `${id}.table-${subnet.id}`, action: 'route-table.configure',
        params: { vnetId: vnet.id, subnetId: subnet.id, routeTableId: subnet.routeTableId! },
        instruction: l(`Open ${vnet.name} / ${subnet.name} routing policy.`, `${vnet.name} / ${subnet.name} のルーティング ポリシーを開く。`) })
    } else repairGuidance.push({ id: `${id}.configure-${vnet.id}`, action: 'network.configure', params: { vnetId: vnet.id },
      instruction: l(`Open ${vnet.name} appliance settings.`, `${vnet.name} の装置設定を開く。`) })
  }
  repairGuidance.push(...definition.guidance ?? [])
  if (id === 'wan-isolation') repairGuidance.push({ id: `${id}.hub-config`, action: 'hub.configure', params: { hubId: 'wan' },
    instruction: l('Open Regional WAN connection routing settings.', 'Regional WAN の接続ルーティング設定を開く。') },
    { id: `${id}.hub`, action: 'hub-routes.open', params: { hubId: 'wan', tableId: 'defaultRouteTable' },
      instruction: l('Open Regional WAN / Default effective routes.', 'Regional WAN / Default の有効なルートを開く。') })
  scenarioBundle.scenarios.push({ id, ...(id === 'inspection-bypass' ? { extendsScenarioId: 'private-link' } : {}),
    document: { mode: 'full', topology: scenarioTopologies[id] } })
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
  for (const quiz of definition.fundamentals ?? []) scenarioBundle.checks.push({
    id: `${id}.${quiz.id}-check`, kind: 'quiz.answered', params: {
      question: quiz.question, correctChoiceId: `choice-${quiz.correct}`,
      choices: quiz.answers.map(([text, feedback], choice) => ({ id: `choice-${choice}`, text, feedback })),
    },
  })
  const tasks = [
    { suffix: 'load', points: 5, title: l('Open this scenario', 'このシナリオを開く'),
      instruction: l('Confirm loading this original practice network. Your normal design stays protected; no Azure resources are deployed.', '初期練習ネットワークの読み込みを確認します。通常の設計は保護され、Azure リソースはデプロイされません。'),
      checkId: `${id}.load-check`, guidanceIds: [] },
    { suffix: 'inspect', points: 5, title: l('Read the source routing evidence', '送信元のルートの根拠を読む'),
      instruction: l(`Open Effective routes for ${scopeName(before)}. Find ${before.prefix} and compare its source and next hop, or note the absence of an exact route.`,
        `${scopeName(before)} の有効なルートを開き、${before.prefix} の生成元とネクストホップ、または完全一致ルートがないことを確認してください。`),
      checkId: `${id}.before`, guidanceIds: [`${id}.before-guide`] },
    ...(definition.diagnosis ? [{ suffix: 'diagnose', points: 25, title: l('Diagnose the packet evidence', 'パケットの根拠から診断する'),
      instruction: l('Run the unchanged starter packet probe using Show me where. Compare the original tuple and the independent reply before choosing an explanation.', '「場所を表示」で初期構成のパケット プローブを実行します。元のタプルと独立した復路を比較してから、理由を選んでください。'),
      checkId: `${id}.diagnosis-check`, guidanceIds: [`${id}.packet`] }] : []),
    { suffix: 'repair', points: definition.points - 35 - (definition.diagnosis ? 25 : 0), title: l('Meet the network requirements', 'ネットワーク要件を満たす'),
      instruction: definition.repair, checkId: `${id}.repair-check`, guidanceIds: repairGuidance.map((entry) => entry.id) },
    { suffix: 'return', points: 5, title: l('Inspect the independent return scope', '独立した復路の範囲を調べる'),
      instruction: l(`Inspect ${scopeName(after)} for ${after.prefix}. Compare this scope with the source.`,
        `${scopeName(after)} で ${after.prefix} を調べ、送信元とこの範囲を比較します。`),
      checkId: `${id}.after`, guidanceIds: [`${id}.after-guide`] },
    ...(definition.fundamentals ?? []).map((quiz) => ({ suffix: quiz.id, points: 10, title: quiz.title,
      instruction: quiz.question, checkId: `${id}.${quiz.id}-check`, guidanceIds: [] })),
    { suffix: 'explain', points: 20, title: l('Explain the architectural consequence', '設計上の意味を説明する'),
      instruction: definition.question,
      checkId: `${id}.quiz`, guidanceIds: [] },
  ].map(({ suffix, ...task }) => ({ ...task, id: `${id}.${suffix}`, assessmentVersion: 1, awardId: `${id}.${suffix}`, hints: [] }))
  if (id === 'inspection-bypass') {
    scenarioBundle.guidance.push(...['a', 'b'].map((vnetId) => ({
      id: `${id}.peer-${vnetId}`, action: 'peering.command' as const, params: { vnetAId: vnetId, vnetBId: 'hub' },
      instruction: l(`Connect ${vnetId === 'a' ? 'Application' : 'Partner'} to Inspection hub. Keep the existing Application–Partner link for the route comparison.`,
        `${vnetId === 'a' ? 'Application' : 'Partner'} を Inspection hub に接続します。ルートの比較用に既存の Application–Partner 接続は残します。`),
    })))
    scenarioBundle.checks.push(
      { id: `${id}.connect-check`, kind: 'peerings.configured', params: {
        peerings: ['a', 'b'].map((vnetAId) => ({ vnetAId, vnetBId: 'hub' })), requirements: [witness, isolation],
      } },
      { id: `${id}.summary-check`, kind: 'udrs.configured', params: {
        routes: ['a', 'b'].map((vnetId) => ({ vnetId, subnetId: `${vnetId}-work`, prefix: '10.0.0.0/8', nextHopIp: '10.20.1.4' })),
        requirements: [witness, isolation],
      } })
    tasks.splice(1, 0,
      { id: `${id}.connect`, assessmentVersion: 1, awardId: `${id}.connect`, points: 10,
        title: l('Connect the spokes to the inspection hub', 'スポークを検査ハブに接続する'),
        instruction: l('Create Application–Inspection hub and Partner–Inspection hub peerings. Leave the existing Application–Partner peering in place for now. Connecting spokes to a hub does not make the hub forward between them. Warning/error indicators about unfinished inspection routing are expected while the policy tables are empty. You do not need to resolve those yet; the upcoming routing and path-check steps explain and address them.',
          'Application–Inspection hub と Partner–Inspection hub のピアリングを作ります。比較のため、既存の Application–Partner ピアリングは残します。スポークをハブに接続するだけでは、ハブ経由の転送は始まりません。ポリシー テーブルが空の間は、未完成の検査ルーティングに関する警告やエラーの表示があっても想定内です。今はそれらを解消する必要はありません。後続のルーティングと経路確認のステップで説明し、対処します。'),
        checkId: `${id}.connect-check`, guidanceIds: [`${id}.peer-a`, `${id}.peer-b`], hints: [] },
      { id: `${id}.summary`, assessmentVersion: 1, awardId: `${id}.summary`, points: 15,
        title: l('Add the first routing policies', '最初のルーティング ポリシーを追加する'),
        instruction: l('A route table groups rules for traffic leaving its associated subnet. Add one enabled UDR to each empty Workload policy table: destination 10.0.0.0/8, next hop VirtualAppliance, IP 10.20.1.4 (Inspection firewall). Do not add a /16 yet: the next step compares these overlapping routes.',
          'ルート テーブルは、関連付いたサブネットから出る通信の規則をまとめます。各 Workload の空のポリシー テーブルに、有効な UDR を 1 つ追加します。宛先 10.0.0.0/8、ネクストホップ VirtualAppliance、IP 10.20.1.4 (Inspection firewall) です。まだ /16 は追加しません。次のステップで重複するルートを比較します。'),
        checkId: `${id}.summary-check`, guidanceIds: [`${id}.table-a-work`, `${id}.table-b-work`], hints: [] })
  }
  scenarioBundle.lessons.push({ id, contentVersion: id === 'inspection-bypass' ? 2 : 1, scenarioId: id, title: definition.title, objective: definition.objective,
    prerequisites: index ? [definitions[index - 1].id] : [], taskOrder: tasks.map((task) => task.id), tasks })
}
appendHybridLesson(scenarioBundle)
appendMultihubLesson(scenarioBundle)
addScenarioFoundations(scenarioBundle)
appendTransferLesson(scenarioBundle)
teachCourse(scenarioBundle)
