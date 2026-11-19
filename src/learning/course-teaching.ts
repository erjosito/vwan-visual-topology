import type { CourseBundle } from './course-contract'
import type { Localized } from './content'
import { hubRouteTables } from '../hub-routing'

const l = (en: string, ja: string): Localized => ({ en, ja })
const routing = 'https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview'
const peering = 'https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview'
const wan = 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing'
const reference = (url: string, en: string, ja: string) => ({ url, title: l(en, ja) })
const routeSources = reference(`${routing}#system-routes`, 'Route sources and next hops', 'ルートの生成元とネクストホップ')
const customRoutes = reference(`${routing}#custom-routes`, 'User-defined and learned routes', 'ユーザー定義ルートと学習ルート')
const selection = reference(`${routing}#how-azure-selects-routes-for-traffic-routing`, 'How Azure selects a route', 'Azure によるルートの選択')
const peerConnectivity = reference(`${peering}#connectivity`, 'Private connectivity with peering', 'ピアリングによるプライベート接続')
const peeringAccess = reference('https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-peering#create-a-virtual-network-peering', 'Peering access settings', 'ピアリングのアクセス設定')
const peeringScope = l('Ordinary whole-VNet peering gives every subnet in either VNet routes to the other VNet’s address space, including Operations as well as Workload. It is not limited to the subnets or IPs used in a test. Subnet peering is a separate option for selecting participating subnets; later isolation topics build on this distinction.',
  '通常の VNet 全体のピアリングでは、Workload だけでなく Operations を含む、両方の VNet のすべてのサブネットに相手のアドレス空間へのルートが追加されます。テストしたサブネットや IP だけに限定されません。参加するサブネットを選ぶサブネット ピアリングは別の選択肢です。この違いは、後の分離の学習につながります。')
const accessPermission = l('A route is not permission. Allow VNet access controls whether traffic may cross the peering: disabling access can block traffic while the peering and its address-space routes remain. UDRs and security rules can impose other restrictions; a peering route alone does not guarantee delivery.',
  'ルートは通信許可ではありません。Allow VNet access はピアリングを通過できるかを制御します。無効にすると、ピアリングとアドレス空間のルートが残っていても通信をブロックできます。UDR やセキュリティ規則も別の制限を加えるため、ピアリング ルートだけで到達性は保証されません。')
const serviceChaining = reference(`${peering}#service-chaining`, 'Service chaining through appliances', '装置を経由するサービス チェーン')
const gatewayTransit = reference(`${peering}#gateways-and-on-premises-connectivity`, 'Gateway transit and on-premises connectivity', 'ゲートウェイ転送とオンプレミス接続')
const hubRouting = reference(`${wan}#routing-concepts`, 'Hub association and propagation', 'ハブの関連付けと伝達')
const hubLabels = reference(`${wan}#labels`, 'Labels and cross-hub propagation', 'ラベルとハブ間の伝達')

type Topic = {
  introduction: Localized
  takeaway: Localized
  references: ReturnType<typeof reference>[]
}
const topics = {
  peering: {
    introduction: l('A virtual network (VNet) is a private address space divided into subnets. Two VNets are separate networks, even in the same Azure region. Peering supplies a direct private connection between them.',
      '仮想ネットワーク (VNet) は、サブネットに分割されたプライベートなアドレス空間です。同じ Azure リージョンにあっても、別々の VNet は別のネットワークです。ピアリングは、その間の直接プライベート接続を提供します。'),
    takeaway: l('Peering normally adds system routes for the other VNet’s address space, with next hop VNetPeering. It connects the two peers, not every network either peer knows. A reply still needs its own usable route; a third VNet does not become reachable through automatic peering transit.',
      'ピアリングは通常、相手の VNet のアドレス空間へのシステム ルートを追加し、ネクストホップは VNetPeering になります。接続するのはその 2 つの VNet であり、各 VNet が知るすべてのネットワークではありません。復路にも使用可能なルートが必要で、3 つ目の VNet への自動転送は行われません。'),
    references: [peerConnectivity, peeringAccess, routeSources],
  },
  override: {
    introduction: l('An enabled connection and a usable route are different things. A user-defined route (UDR) is a routing policy attached to a subnet through a route table. It can change where that subnet sends traffic even when peering remains healthy.',
      '接続が有効であることと、使用可能なルートがあることは別です。ユーザー定義ルート (UDR) は、ルート テーブルを介してサブネットに適用するポリシーです。ピアリングが正常でも、通信の転送先を変えられます。'),
    takeaway: l('For the equal-prefix UDR and peering candidates in this exercise, the UDR wins. Next hop None means discard, not “no preference.” Repairing a connection flag alone cannot fix a selected drop route. Compare prefix length before reasoning about route-source preference.',
      'この演習の同じプレフィックスの UDR とピアリング ルートでは、UDR が優先されます。ネクストホップ None は「優先度なし」ではなく破棄を意味します。接続の設定だけでは、選択された破棄ルートは修復できません。生成元の優先順位を考える前に、プレフィックス長を比較してください。'),
    references: [selection, customRoutes],
  },
  specificity: {
    introduction: l('A route prefix describes a destination address range. A /16 is more specific than a /8: it covers fewer addresses. A broad route toward a firewall therefore does not automatically capture every private destination.',
      'ルートのプレフィックスは宛先アドレスの範囲を表します。/16 は /8 より対象範囲が狭く、より具体的です。そのため、ファイアウォールへの広い集約ルートが、すべてのプライベート宛先を自動的に捕捉するとは限りません。'),
    takeaway: l('Longest-prefix matching selects the narrower matching destination before equal-prefix source preference matters: /24 is more specific than /16, which is more specific than /8. A working connection can therefore bypass an intended inspection waypoint; verify the path, not just reachability.',
      '同じプレフィックスでの生成元の優先順位より先に、最長プレフィックス一致で対象範囲の狭いルートが選ばれます。/24 は /16 より、/16 は /8 より具体的です。その結果、通信が成功しても検査装置を迂回する場合があります。到達性だけでなく経路を確認してください。'),
    references: [selection, serviceChaining],
  },
  chain: {
    introduction: l('A network virtual appliance (NVA) forwards traffic to another stage, such as a firewall or an SD-WAN router. Each appliance subnet needs an onward route appropriate to its role. A VNet boundary does not by itself define the service chain.',
      'ネットワーク仮想アプライアンス (NVA) は、ファイアウォールや SD-WAN ルーターなどの次の段階へ通信を転送します。各装置のサブネットには、その役割に合った後続ルートが必要です。VNet の境界だけでは、サービス チェーンは定まりません。'),
    takeaway: l('A VirtualAppliance next hop directs traffic to an appliance; the appliance must also forward it onward. Copying one subnet’s routing policy to every stage can cause a bypass or a loop. Trace the required stage order in each direction, because the reply performs independent route lookups.',
      'VirtualAppliance のネクストホップは装置へ通信を送りますが、装置自身にも後続の転送が必要です。同じサブネット ポリシーをすべての段階にコピーすると、迂回やループを起こす場合があります。復路でも独立したルート検索が行われるため、各方向の通過順を確認してください。'),
    references: [serviceChaining, customRoutes],
  },
  gateway: {
    introduction: l('A gateway can learn on-premises prefixes through Border Gateway Protocol (BGP). Gateway sharing, route propagation into a workload subnet, and the branch’s route back to Azure are separate parts of the design.',
      'ゲートウェイは Border Gateway Protocol (BGP) によってオンプレミスのプレフィックスを学習できます。ゲートウェイの共有、ワークロードへのルート伝達、拠点から Azure への復路は、それぞれ別の設計要素です。'),
    takeaway: l('A healthy gateway connection does not guarantee that its learned routes appear in a workload’s effective routes. Inspect gateway-transit settings and the subnet’s BGP propagation policy separately. Then check the return prefix: the branch cannot reply merely because Azure knows how to send the request.',
      'ゲートウェイ接続が正常でも、その学習ルートがワークロードの有効なルートに現れるとは限りません。ゲートウェイ転送の設定と、サブネットの BGP 伝達ポリシーを別々に確認します。さらに復路のプレフィックスも調べてください。Azure が要求を送信できるだけでは、拠点は応答できません。'),
    references: [gatewayTransit, customRoutes],
  },
  wan: {
    introduction: l('A Virtual WAN hub can have several route tables. Association chooses the table used by traffic arriving from a connection. Propagation publishes a connection’s prefixes into chosen tables. These settings answer different questions.',
      'Virtual WAN ハブは複数のルート テーブルを持てます。関連付けは接続から入った通信が使用するテーブルを選び、伝達は接続のプレフィックスを指定のテーブルへ公開します。この 2 つは別の設定です。'),
    takeaway: l('Inspect the exact table associated with the source connection, not a union of every hub route. Propagating a service prefix into that table can restore service reachability without publishing a restricted tenant there. Routing isolation must be checked in both initiation directions; it is not a substitute for firewall policy.',
      'ハブ全体のルートを合成せず、送信元接続に関連付いた正確なテーブルを調べます。そのテーブルへサービスのプレフィックスを伝達すれば、制限されたテナントを公開せずにサービスを復旧できます。分離は両方向から開始する通信で確認し、ファイアウォール ポリシーとは区別します。'),
    references: [hubRouting],
  },
  incident: {
    introduction: l('Troubleshooting a multi-tier network means finding the first boundary that cannot forward the destination, then repeating the investigation for the reply. Preserve working conversations while you repair the broken one.',
      '多層ネットワークの診断では、宛先へ転送できなくなる最初の境界を探し、復路でも同じ調査を行います。問題の通信を修復する間も、正常な通信を維持してください。'),
    takeaway: l('A forward trace proves only its own direction. Each upstream subnet or appliance also needs a route back to the original source prefix. The combined checks protect the existing conversation and isolation boundaries, so adding a bypass is not equivalent to repairing the intended transit design.',
      '往路のトレースが証明するのは、その方向だけです。上流の各サブネットや装置にも、元の送信元プレフィックスへの復路が必要です。総合確認は既存の通信と分離境界も保護するため、迂回経路の追加は、本来の転送設計の修復とは異なります。'),
    references: [serviceChaining, selection],
  },
  ha: {
    introduction: l('A load balancer can select a healthy NVA for the original flow without controlling the independent reply. Stateful inspection needs the two directions to reach compatible appliance state, not merely two individually working paths.',
      'ロード バランサーが往路に正常な NVA を選んでも、独立した復路までは制御しません。ステートフルな検査では、各方向の経路が個別に機能するだけでなく、互換性のある装置の状態へ両方向が到達する必要があります。'),
    takeaway: l('A return route aimed at a different NVA can create asymmetric stateful transit. Check the original packet tuple, chosen appliance and reverse lookup together. A declared health snapshot establishes routing for that state; it does not measure failover time or prove existing sessions survive a real transition.',
      '別の NVA を向く復路は、ステートフルな転送の非対称性を起こします。元のパケットのタプル、選択された装置、逆方向の検索を合わせて確認します。宣言された正常性のスナップショットはその状態の経路を示すもので、フェールオーバー時間や実際のセッション継続を証明しません。'),
    references: [reference('https://learn.microsoft.com/azure/architecture/reference-architectures/dmz/nva-ha#load-balancer', 'Highly available NVA design', '高可用性 NVA の設計'), customRoutes],
  },
  hybrid: {
    introduction: l('ExpressRoute and a site-to-site VPN can advertise overlapping branch prefixes. Separate longest-prefix matching from the preference between equal prefixes, and check that the backup is actually enabled before testing a primary withdrawal.',
      'ExpressRoute とサイト間 VPN は、重複する拠点プレフィックスを広告できます。最長プレフィックス一致と、同じプレフィックス同士の優先度を区別し、プライマリを停止する前にバックアップが実際に有効であることを確認します。'),
    takeaway: l('In this exercise a VPN /24 wins over a covering ER /16, while ER wins the equal /24 comparison. After declaring ER withdrawn, inspect the new active workload next hop and the branch’s independent reply. A summary advertisement does not make every address inside its range reachable.',
      'この演習では、VPN の /24 がそれを含む ER の /16 に優先し、同じ /24 同士では ER が優先されます。ER の停止状態を宣言したら、ワークロードで選択された新しいネクストホップと、拠点の独立した復路を調べます。集約広告は、範囲内の全アドレスの到達性を作りません。'),
    references: [reference('https://learn.microsoft.com/azure/expressroute/expressroute-howto-coexist-resource-manager#configuration-designs', 'ExpressRoute and VPN backup routing', 'ExpressRoute と VPN バックアップのルーティング'), selection],
  },
  labels: {
    introduction: l('Hub route-table IDs identify local tables. Labels group propagation destinations across hubs. A route present in one hub does not establish that the independently associated table in another hub has imported it.',
      'ハブのルート テーブル ID は、ローカルなテーブルを識別します。ラベルは、ハブ間の伝達先をまとめます。一方のハブにルートがあっても、他方の独立して関連付いたテーブルへ取り込まれたとは限りません。'),
    takeaway: l('Association chooses the ingress lookup; propagation and destination labels determine where prefixes are published. Compare label spelling and case on the original connections and destination tables. Keep tenant associations separate and verify each direction in its own exact table instead of substituting Default.',
      '関連付けは流入時の検索先を選び、伝達と伝達先ラベルはプレフィックスの公開先を決めます。元の接続と伝達先テーブルで、ラベルの綴りと大文字小文字を比較します。テナントの関連付けを分離したまま、Default で代用せず、各方向の正確なテーブルを確認してください。'),
    references: [hubLabels, hubRouting],
  },
} satisfies Record<string, Topic>

const lessonTeaching: Record<string, { topic: Topic; context: Localized }> = {
  'direct-peering': { topic: topics.peering, context: l('A fictional retailer has put its application and supplier service in two separate VNets. Your team must create private connectivity between their workload subnets and explain why it works in both directions.',
    '架空の小売企業は、アプリと仕入先サービスを別々の VNet に配置しています。あなたのチームは、ワークロード間のプライベート接続を作り、双方向に機能する理由を説明します。') },
  'route-override': { topic: topics.override, context: l('The retailer’s peering is still enabled, but a recent routing-policy change has interrupted the supplier connection. Find the route that now handles supplier traffic and restore the conversation without moving the workloads.',
    '小売企業のピアリングは有効なままですが、最近のルーティング ポリシー変更後に仕入先との通信が止まりました。通信を処理するルートを特定し、ワークロードを移動せずに復旧してください。') },
  'prefix-outage': { topic: topics.specificity, context: l('Your operations team added a broad private-network route, yet traffic is not following the expected path. Compare overlapping destination ranges, repair the intended forwarding and preserve unrelated local connectivity.',
    '運用チームが広いプライベート範囲のルートを追加しましたが、通信が期待する経路を通りません。重複する宛先範囲を比較し、無関係なローカル通信を維持しながら転送を修復してください。') },
  'gateway-return': { topic: topics.gateway, context: l('A branch office uses a shared hub gateway to reach an Azure workload. The connection exists, but the conversation fails. Investigate what the workload learns and how the branch sends its reply.',
    '拠点は共有ハブ ゲートウェイを使って Azure のワークロードへ接続しています。接続は存在しますが、通信に失敗します。ワークロードが学習するルートと、拠点の応答経路を調べてください。') },
  'secured-wan': { topic: topics.wan, context: l('A shared-service network is connected to Virtual WAN, but its intended users cannot reach it. Restore the service through the required inspection path while keeping the restricted network isolated.',
    '共有サービスは Virtual WAN に接続されていますが、必要な利用者から到達できません。制限されたネットワークを分離したまま、指定の検査経路でサービスを復旧してください。') },
  'hybrid-incident': { topic: topics.incident, context: l('You are on call for a hybrid-network incident with more than one routing fault. Use independent source, transit and return evidence to restore the declared service without weakening the existing boundaries.',
    'あなたは、複数のルーティング障害を伴うハイブリッド障害の当番です。送信元、転送、復路の独立した根拠から、既存の境界を弱めずに指定サービスを復旧してください。') },
  'private-link': { topic: topics.peering, context: l('A fictional retailer hosts its ordering app in Application and a supplier API in Partner (10.22.0.0/16). Connect them privately without opening Restricted tenant. First find out which routes the application already has.',
    '架空の小売企業は、注文アプリを Application、仕入先 API を Partner (10.22.0.0/16) に配置しています。Restricted tenant を開放せずに両者を接続してください。まず、アプリが現在持つルートを調べます。') },
  'inspection-bypass': { topic: topics.specificity, context: l('The ordering app can reach Partner, but security requires both directions to traverse Inspection firewall. Investigate why a working conversation is bypassing inspection, then correct the path without opening Restricted tenant.',
    '注文アプリは Partner に到達できますが、セキュリティ要件では双方向とも Inspection firewall を通る必要があります。動作している通信が検査を迂回する理由を調べ、Restricted tenant を開放せずに修復してください。') },
  'colocated-chain': { topic: topics.chain, context: l('The retailer now separates security inspection from SD-WAN transport, with both appliances in one hub VNet. Traffic must cross the firewall and then the router; replies must visit them in reverse order.',
    '小売企業は、同じハブ VNet 内の装置でセキュリティ検査と SD-WAN 転送を分離します。通信はファイアウォール、ルーターの順、応答は逆の順に通る必要があります。') },
  'dedicated-chain': { topic: topics.chain, context: l('The transport team has moved its SD-WAN router into a dedicated VNet. Restore the firewall-to-transport chain across that boundary while keeping Operations reachable and the tenant isolated.',
    '転送チームが SD-WAN ルーターを専用 VNet に移しました。その境界をまたぐ検査・転送のチェーンを復旧し、Operations の到達性とテナントの分離を維持してください。') },
  'branch-advertisement': { topic: topics.gateway, context: l('The branch gateway is connected, but the application cannot reach the branch service at 172.22.0.4. Find why gateway knowledge is missing from the workload’s routes, and check the independent reply.',
    '拠点ゲートウェイは接続済みですが、アプリから拠点サービス 172.22.0.4 に到達できません。ゲートウェイの学習内容がワークロードのルートにない理由と、独立した復路を調べてください。') },
  'wan-isolation': { topic: topics.wan, context: l('Application and Partner share a WAN hub with Restricted tenant. Restore their shared service without giving either side a new path to the tenant. Keep Operations and the existing hub connections working.',
    'Application、Partner、Restricted tenant は WAN ハブを共有しています。テナントへの新しい経路を開かず、共有サービスを復旧してください。Operations と既存のハブ接続は維持します。') },
  'tiered-incident': { topic: topics.incident, context: l('A new lower-tier workload must join the retailer’s existing inspected service. Diagnose its unfamiliar transit boundaries without breaking the original Application-to-Partner conversation or exposing Restricted tenant.',
    '新しい下位層のワークロードを、既存の検査付きサービスへ接続します。元の Application と Partner の通信を壊したり、Restricted tenant を公開したりせずに、新しい転送境界を診断してください。') },
  'ha-return-path': { topic: topics.ha, context: l('Your team added redundant NVAs behind a load balancer, but a stateful conversation still fails. Use the original packet and its independent reply to find whether the two directions reach compatible appliance state.',
    'チームはロード バランサーの背後に冗長 NVA を追加しましたが、ステートフルな通信が失敗します。元のパケットと独立した応答から、両方向が互換性のある装置の状態へ到達するかを調べてください。') },
  'hybrid-preference': { topic: topics.hybrid, context: l('Branch services normally use ExpressRoute, and the VPN backup has not been enabled. Bring the backup into service, compare two destination prefixes, then declare an ER withdrawal and verify both services and their replies.',
    'Branch services は通常 ExpressRoute を使い、VPN バックアップは未有効です。バックアップを有効にし、2 つの宛先プレフィックスを比較してから ER の停止状態を宣言し、両サービスと復路を確認してください。') },
  'multihub-labels': { topic: topics.labels, context: l('West application cannot reach East shared service across two WAN hubs, even though East has a return route. Restore the missing import without changing the original table associations or opening Restricted tenant.',
    '2 つの WAN ハブをまたぐ West application から East shared service に到達できません。East には復路があります。元のテーブルの関連付けを変更したり、Restricted tenant を開放したりせずに、足りないルートの取り込みを復旧してください。') },
}

const hubPurpose = l('A hub VNet shares network services such as a firewall or gateway across multiple workload (spoke) VNets. This centralizes inspection and avoids duplicating the service in every spoke. A hub is still an ordinary VNet: peering alone does not make it forward traffic between spokes.',
  'ハブ VNet は、ファイアウォールやゲートウェイなどを複数のワークロード (スポーク) VNet で共有します。検査を集約し、スポークごとに同じ装置を配置せずに済みます。ハブも通常の VNet であり、ピアリングだけではスポーク間の転送は始まりません。')
const routingPrimer = l('A route table groups user-defined routes (UDRs) and is associated with a subnet. Each UDR matches a destination prefix and specifies a next hop for traffic leaving that subnet. VirtualAppliance with IP 10.20.1.4 means send the packet to Inspection firewall; it does not mean the firewall automatically permits or forwards it.',
  'ルート テーブルはユーザー定義ルート (UDR) をまとめ、サブネットに関連付けます。各 UDR は宛先プレフィックスと、そのサブネットから出る通信のネクストホップを指定します。VirtualAppliance と IP 10.20.1.4 は、Inspection firewall にパケットを送る指定であり、装置による許可や後続転送を自動的に保証しません。')
const taskTeaching: Record<string, { paragraphs: Localized[]; references: ReturnType<typeof reference>[] }> = {
  'inspection-bypass.load': { paragraphs: [hubPurpose, l('This mission adds Inspection hub, its firewall and two empty workload policy tables to your existing application–partner network. Your existing nodes and peering are retained. First connect each spoke to the hub; next add the routing rules yourself. Later missions separate inspection from transport services.',
    'このミッションでは、既存のアプリとパートナーのネットワークに Inspection hub、そのファイアウォール、空のワークロード用ポリシー テーブル 2 つを追加します。既存のノードとピアリングは保持します。まず各スポークをハブに接続し、次にルーティング規則を追加します。後のミッションでは、検査と転送サービスを分離します。')],
    references: [serviceChaining] },
  'inspection-bypass.connect': { paragraphs: [l('Both spokes can now reach the hub, but their existing direct peering can still carry application–partner traffic. The hub is a place to share a service, not an automatic transit switch. Next you will tell the workload subnets when to send traffic to the firewall.',
    '両方のスポークがハブに到達できるようになりましたが、アプリとパートナーの通信は既存の直接ピアリングを通れます。ハブはサービスを共有する場所であり、自動的な中継スイッチではありません。次に、ファイアウォールへ送る条件をワークロードのサブネットに指定します。'), routingPrimer],
    references: [serviceChaining, customRoutes] },
  'inspection-bypass.summary': { paragraphs: [l('You have added a broad /8 policy toward the firewall. The destination Partner /16 also matches that range, but its /16 peering route is more specific. The next inspection shows why a UDR does not automatically override every system route.',
    'ファイアウォールへの広い /8 ポリシーを追加しました。Partner の /16 もその範囲に入りますが、/16 のピアリング ルートの方が具体的です。次の確認で、UDR がすべてのシステム ルートを自動的に上書きするわけではない理由を調べます。')],
    references: [selection] },
  'inspection-bypass.repair': { paragraphs: [l('The check establishes that both directions now traverse Inspection firewall while Operations and tenant isolation are preserved. In the initial comparison, the /16 peering route beat the /8 UDR. One way to change that decision is a destination-specific /16 UDR: at equal prefix length the UDR wins. That is a worked repair example, not the only permitted configuration.',
    '確認できたのは、Operations とテナントの分離を維持したまま、双方向が Inspection firewall を通ることです。最初の比較では、/16 のピアリング ルートが /8 の UDR に優先されました。宛先に合わせた /16 UDR は修復方法の一例であり、同じプレフィックス長では UDR が優先されます。これは修復例であって、唯一許される構成ではありません。')],
    references: [selection, serviceChaining] },
  'hybrid-preference.inspect': { paragraphs: [l('In the starting network, the VPN backup is disabled. The 172.28.20.0/24 route is therefore expected through ExpressRoute. A learned route tells the workload which gateway can carry this destination; it does not establish that a backup connection is ready. Read the selected gateway before changing either connection.',
    '初期ネットワークでは VPN バックアップが無効なため、172.28.20.0/24 は ExpressRoute 経由になる想定です。学習ルートは、その宛先へ転送できるゲートウェイを示しますが、バックアップの準備完了までは示しません。接続を変更する前に、選択されたゲートウェイを読み取ります。')],
    references: [customRoutes, topics.hybrid.references[0]] },
  'hybrid-preference.repair': { paragraphs: [l('The backup is enabled, but backup does not mean unused. With both links enabled, the check requires 172.28.10.0/24 to use VPN and 172.28.20.0/24 to use ER. For .10, the VPN /24 is more specific than the covering ER /16; for .20, ER wins between equal /24 candidates. Prefix length is considered before equal-prefix preference.',
    'バックアップを有効にしても、未使用になるとは限りません。両接続が有効な状態で、確認では 172.28.10.0/24 が VPN、172.28.20.0/24 が ER を使う必要があります。.10 では VPN の /24 が ER の /16 より具体的で、.20 の同じ /24 同士では ER が優先されます。プレフィックス長の比較が、同じ長さでの優先度より先です。')],
    references: [selection, topics.hybrid.references[0]] },
  'hybrid-preference.compare': { paragraphs: [l('Compare destination 172.28.10.10 with 172.28.20.10, not just the two transport names. The first is inside the VPN /24 and the ER /16; the second has equal /24 candidates. A more-specific backup advertisement can attract some traffic even while the primary is healthy.',
    '通信方式の名前だけでなく、宛先 172.28.10.10 と 172.28.20.10 を比較します。前者は VPN の /24 と ER の /16 に含まれ、後者には同じ /24 の候補があります。バックアップの広告の方が具体的なら、プライマリが正常でも一部の通信がバックアップを使います。')],
    references: [selection] },
  'hybrid-preference.withdraw': { paragraphs: [l('The branch ER attachment is now disabled, while the Azure attachment and BGP VPN remain enabled. The check requires both original branch services and their replies to work through the remaining routing, without losing Operations or isolation. This establishes a usable backup configuration for the declared state, not how long a real change would take.',
    '拠点側 ER 接続は無効で、Azure 側接続と BGP VPN は有効なままです。確認では、残った経路で元の両拠点サービスと復路が機能し、Operations と分離が維持される必要があります。これは宣言した状態で使用可能なバックアップ構成を示すものであり、実際の切り替えに要する時間は示しません。')],
    references: [topics.hybrid.references[0], customRoutes] },
  'hybrid-preference.fallback': { paragraphs: [l('For 172.28.20.0/24, compare the selected next hop with the ER gateway used before withdrawal. The VPN candidate can become active when the preferred equal-prefix ER candidate is no longer available. A configured backup that never supplies a usable route would not solve the outage.',
    '172.28.20.0/24 について、選択されたネクストホップを停止前の ER ゲートウェイと比較します。優先された同じプレフィックスの ER 候補が利用できなくなると、VPN 候補が有効になれます。バックアップが設定されていても、使用可能なルートを提供しなければ障害は解消しません。')],
    references: [selection, topics.hybrid.references[0]] },
  'hybrid-preference.return': { paragraphs: [l('The branch must route its reply to the application, such as 10.91.1.10 within 10.91.0.0/16. Its received route and preferred next hop are a separate decision from the workload’s route to 172.28.20.0/24. Compare the branch gateway with the current connection state; an Azure outbound route cannot supply a missing branch return route.',
    '拠点は、10.91.0.0/16 内の 10.91.1.10 など、アプリへの復路を持つ必要があります。受信ルートと優先ネクストホップの選択は、ワークロードから 172.28.20.0/24 への選択とは独立しています。拠点のゲートウェイを現在の接続状態と比較します。Azure の往路は、欠けた拠点の復路を作りません。')],
    references: [gatewayTransit, topics.hybrid.references[0]] },
  'multihub-labels.inspect': { paragraphs: [l('In the starting network, West workloads lacks 10.102.0.0/16, the range containing East shared service 10.102.1.10. West application uses this table because of its association. A route in Default or another hub table cannot substitute for a missing route in this lookup context.',
    '初期ネットワークの West workloads には、East shared service 10.102.1.10 を含む 10.102.0.0/16 がありません。West application は関連付けによってこのテーブルを使います。Default や他のハブ テーブルにあるルートでは、この検索先で欠けているルートを代用できません。')],
    references: [hubRouting] },
  'multihub-labels.compare': { paragraphs: [l('The starting East services table already contains 10.101.0.0/16 for the West application. That return entry does not copy itself into West workloads: it describes a different destination, in a different ingress table. Compare the two propagation directions independently before editing.',
    '初期状態の East services には、West アプリへの 10.101.0.0/16 が既にあります。この復路のエントリが West workloads へ自動でコピーされるわけではありません。別の流入テーブルで、別の宛先を示すルートです。編集前に、両方向の伝達を独立して比較します。')],
    references: [hubRouting, hubLabels] },
  'multihub-labels.repair': { paragraphs: [l('The repair check establishes both service directions while retaining the original associations, Operations and tenant isolation. Labels select propagation destinations across hubs; they do not choose which table an arriving connection uses. Restoring a missing import therefore need not move every connection into a shared table.',
    '修復の確認では、元の関連付け、Operations、テナントの分離を維持したまま、サービスの双方向通信が成立します。ラベルはハブ間の伝達先を選びますが、入ってきた接続が使用するテーブルは選びません。そのため、ルートの取り込みの修復に、全接続を共通テーブルへ移す必要はありません。')],
    references: [hubLabels, hubRouting] },
  'multihub-labels.verify-source': { paragraphs: [l('Look for the East service range in West workloads, the actual source-associated table. Its presence there is the evidence relevant to West’s forward lookup, unlike its presence in an unrelated table. Tenant isolation is a separate requirement: importing the service prefix does not require publishing the tenant prefix.',
    '送信元に実際に関連付いた West workloads で、East サービスの範囲を確認します。無関係なテーブルではなく、ここに存在することが West の往路検索に関係する根拠です。テナントの分離は別の要件であり、サービスのプレフィックスを取り込むためにテナントも公開する必要はありません。')],
    references: [hubRouting, hubLabels] },
  'multihub-labels.verify-return': { paragraphs: [l('East services needs 10.101.0.0/16 to return traffic to West application 10.101.1.10. Revisit this table after repair: changing propagation for one direction must not remove the other direction’s route. Successful source-table inspection alone cannot establish this independent return lookup.',
    'East services には、West application 10.101.1.10 への復路として 10.101.0.0/16 が必要です。修復後にもこのテーブルを確認します。一方の伝達の変更で、他方のルートを失ってはいけません。送信元テーブルの確認だけでは、この独立した復路検索は確認できません。')],
    references: [hubRouting, hubLabels] },
}

const taskHints: Record<string, Localized[]> = {
  'private-link.inspect': [
    l('You are reading routes leaving Application / Workload, not configuring a connection. A missing exact Partner row is useful evidence.',
      '接続の設定ではなく、Application / Workload から出るルートを読みます。Partner の完全一致の行がないことも、大切な根拠です。'),
    l('Use Show me where to open Effective routes. Look for destination prefix 10.22.0.0/16; the next-hop address is a different field.',
      '「場所を表示」で有効なルートを開きます。宛先プレフィックス 10.22.0.0/16 を探します。ネクストホップのアドレスとは別の項目です。'),
  ],
  'private-link.repair': [
    l('Two VNets in the same region are still separate networks. Connect Application and Partner, not the restricted third VNet.',
      '同じリージョンでも、別々の VNet は別のネットワークです。制限された 3 つ目の VNet ではなく、Application と Partner を接続します。'),
    l('Create their peering and allow VNet access in both directions. The Operations subnet stays inside Application and needs no new peering.',
      '両 VNet のピアリングを作り、双方向で VNet アクセスを許可します。Operations は Application 内にあり、新しいピアリングは不要です。'),
  ],
  'inspection-bypass.repair': [
    l('Successful delivery can still bypass inspection. Compare prefix lengths before comparing route sources, then investigate the return direction separately.',
      '通信が成功しても、検査を迂回する場合があります。生成元の優先度より先にプレフィックス長を比較し、復路も別に調べます。'),
    l('A /16 matches more specifically than the /8 summary. A destination-specific UDR toward the firewall is one possible repair; inspect both workload policy tables.',
      '/16 は /8 の集約ルートより具体的です。ファイアウォールへの宛先別 UDR は修復の一例です。両方のワークロードのポリシーを確認します。'),
  ],
  'colocated-chain.repair': [
    l('Reaching the first appliance does not establish the next stage. Follow the firewall subnet’s lookup toward Partner, then the transport subnet’s lookup for the reply.',
      '最初の装置への到達だけでは、次の段階は確認できません。ファイアウォールのサブネットから Partner への検索と、転送装置のサブネットでの復路検索を追います。'),
    l('Check the enabled state of the Partner onward route in Inspection hub / Workload. The transport return policy has a different next stage; do not copy the same rule to both.',
      'Inspection hub / Workload で、Partner への後続ルートが有効か確認します。転送装置の復路では次の段階が異なるため、同じ規則を両方にコピーしないでください。'),
  ],
  'dedicated-chain.repair': [
    l('A usable route to an appliance does not make the appliance forward transit traffic. Compare the transport boundary with the previous one-hub design.',
      '装置への使用可能なルートがあっても、装置が通過通信を転送するとは限りません。前の 1 ハブ構成と転送装置の境界を比較します。'),
    l('Inspect Transport’s SD-WAN router IP forwarding setting. Restore forwarding rather than adding a direct bypass around the required appliances.',
      'Transport の SD-WAN router で IP 転送を確認します。必要な装置を迂回する直接経路ではなく、転送を復旧します。'),
  ],
  'branch-advertisement.repair': [
    l('Gateway learning and publication into a workload subnet are separate. A healthy VPN does not prove that the workload accepts its BGP routes.',
      'ゲートウェイの学習と、ワークロードへの伝達は別です。VPN が正常でも、ワークロードが BGP ルートを受け取るとは限りません。'),
    l('Inspect BGP route propagation on Application / Workload’s associated route table. Then check the branch prefix and the independent return scope.',
      'Application / Workload に関連付いたルート テーブルで BGP ルート伝達を確認し、拠点のプレフィックスと独立した復路を調べます。'),
  ],
  'wan-isolation.repair': [
    l('Association chooses a connection’s lookup table; propagation publishes its prefix. Restoring a shared service does not require publishing the restricted tenant.',
      '関連付けは接続の検索テーブルを選び、伝達はプレフィックスを公開します。共有サービスの復旧に、制限されたテナントの公開は不要です。'),
    l('In Regional WAN connection routing, compare Partner’s propagation with Application’s Default association. Leave Restricted’s isolated routing unchanged.',
      'Regional WAN の接続ルーティングで、Partner の伝達先を Application の Default 関連付けと比較します。Restricted の分離された設定は維持します。'),
  ],
  'tiered-incident.repair': [
    l('Start at Indirect workload, then trace the reply toward its 10.25.0.0/16 source range. Fixing the first direction can leave a second fault in the return chain.',
      'Indirect workload から始め、10.25.0.0/16 の送信元範囲への復路も追います。往路を修復しても、復路の別の障害が残る場合があります。'),
    l('Check the disabled service route in Indirect workload’s policy, then Inspection hub’s return route for 10.25.0.0/16. Its next stage must lead toward the tier router, not back toward transport.',
      'Indirect workload の無効なサービス ルートを確認し、次に Inspection hub の 10.25.0.0/16 への復路を調べます。次の段階は転送装置へ戻るのではなく、下位層のルーターへ向かう必要があります。'),
  ],
  'ha-return-path.repair': [
    l('Each direction can be routable while a stateful conversation is asymmetric. Compare the NVA chosen for the original packet with the appliance targeted by the reply.',
      '各方向にルートがあっても、ステートフルな通信が非対称になる場合があります。元のパケットが選んだ NVA と、応答の転送先装置を比較します。'),
    l('Inspect Remote workload’s return steering policy. Compare its next hop with the transit frontend at 10.80.3.10; do not change the original packet or backend ownership.',
      'Remote workload の復路ポリシーを確認し、ネクストホップを転送フロントエンド 10.80.3.10 と比較します。元のパケットやバックエンドの所有関係は変更しません。'),
  ],
  'hybrid-preference.repair': [
    l('Enabling the backup connection and accepting its BGP advertisements are separate from choosing the preferred route.',
      'バックアップ接続の有効化と BGP 広告の受信は、優先ルートの選択とは別です。'),
    l('Open Branch VPN backup, enable the connection and BGP, then save. Leave both ER attachments enabled for the comparison.',
      'Branch VPN backup を開き、接続と BGP を有効にして保存します。比較のため、両 ER 接続は有効のままにします。'),
  ],
  'hybrid-preference.withdraw': [
    l('Withdraw the branch’s primary advertisement without disabling the Azure attachment or the VPN backup.',
      'Azure 側の接続や VPN バックアップを無効にせず、拠点のプライマリ広告を停止します。'),
    l('Disable and save Branch ExpressRoute attachment only. If a service still fails, inspect the workload route and the branch return independently.',
      'Branch ExpressRoute attachment だけを無効にして保存します。サービスがまだ失敗する場合は、ワークロードのルートと拠点の復路を別々に調べます。'),
  ],
  'multihub-labels.repair': [
    l('The missing entry is in West workloads. Compare that destination table’s labels with East shared service’s propagation; changing association would change a different decision.',
      '欠けているエントリは West workloads にあります。この伝達先テーブルのラベルを East shared service の伝達設定と比較します。関連付けの変更は別の判断を変えてしまいます。'),
    l('Compare the shared label’s spelling and case across hubs. Keep the four original associations and Restricted tenant’s separate propagation while restoring the import.',
      '両ハブで shared ラベルの綴りと大文字小文字を比較します。元の 4 つの関連付けと Restricted tenant の別の伝達先を維持して、取り込みを復旧します。'),
  ],
}

const routeBasics = [
  l('Effective routes combine the routes available to traffic leaving a subnet. In Azure you inspect them on a workload’s network interface; this simulator groups them by subnet. A route’s prefix is a destination range, not the address of the next hop.',
    '有効なルートは、サブネットから出る通信が利用できるルートをまとめたものです。Azure ではワークロードのネットワーク インターフェイスで確認し、このシミュレーターではサブネット単位に表示します。プレフィックスは宛先の範囲であり、ネクストホップのアドレスではありません。'),
  l('For example, 10.22.1.4 belongs to 10.22.0.0/16, but not to 10.21.0.0/16. The /16 describes a whole destination range, not just the tested IP. An exact route row for that range may be absent; a broader matching range is a separate possibility.',
    'たとえば、10.22.1.4 は 10.22.0.0/16 に含まれますが、10.21.0.0/16 には含まれません。/16 はテストした IP だけでなく、宛先の範囲全体を表します。その範囲の完全一致の行がなくても、より広い範囲に一致する可能性は別にあります。'),
  l('Source tells you who supplied the route: System (Default in Azure) means Azure created it. Next hop tells you where traffic goes next: VnetLocal stays within the VNet, while VNetPeering crosses a peering. Other sources and next-hop types will appear when you introduce routing policies and gateways.',
    'Source はルートの生成元です。System（Azure では Default）は Azure が作成したことを示します。Next hop は次の転送先で、VnetLocal は VNet 内、VNetPeering はピアリングを越える転送です。他の生成元やネクストホップは、ルーティング ポリシーやゲートウェイを導入するときに学びます。'),
]
const returnPath = l('The reply is a new routing decision toward the original source. Compare its selected next hop independently; a successful forward lookup never creates a return route by itself.',
  '応答では、元の送信元に向けて新たにルートを選択します。選択されたネクストホップを独立して比較してください。往路の検索が成功しても、復路は自動的には作られません。')

/** Assemble presentation content from native check scopes; never change checks or awards. */
export function teachCourse(bundle: CourseBundle) {
  let firstSubnetInspection = true
  for (const lesson of bundle.lessons) {
    const teaching = lessonTeaching[lesson.id]
    if (!teaching) {
      if (!lesson.context || lesson.tasks.some((task) => !task.debrief)) throw new Error(`Missing teaching content for ${lesson.id}`)
      continue
    }
    lesson.context ??= teaching.context
    const document = bundle.scenarios.find((scenario) => scenario.id === lesson.scenarioId)!.document
    const topology = document.mode === 'vwan' ? undefined : document.topology
    let inspected: { vnetId: string; subnetId: string } | undefined
    for (const id of lesson.taskOrder) {
      const task = lesson.tasks.find((entry) => entry.id === id)!
      const check = bundle.checks.find((entry) => entry.id === task.checkId)!
      if (!task.hints.length && taskHints[task.id]) task.hints = taskHints[task.id]
      let paragraphs = [check.kind === 'scenario.loaded' ? teaching.topic.introduction : teaching.topic.takeaway]
      let references = teaching.topic.references
      if (check.kind === 'scenario.loaded') task.instruction = taskTeaching[task.id]?.paragraphs[0] ?? teaching.topic.introduction
      if (teaching.topic === topics.peering && check.kind === 'scenario.loaded') paragraphs.push(peeringScope)
      if (teaching.topic === topics.peering && (check.kind === 'requirements.satisfied' || check.kind === 'vnet.peered')) paragraphs.push(accessPermission)
      if (check.kind === 'quiz.answered') paragraphs = [check.params.choices.find((choice) => choice.id === check.params.correctChoiceId)!.feedback]
      if (check.kind === 'routes.inspected') {
        if (!topology) throw new Error(`Missing subnet teaching scope for ${task.id}`)
        const { vnetId, subnetId, prefix } = check.params
        const vnet = topology.vnets.find((entry) => entry.id === vnetId)!
        const subnet = vnet.subnets.find((entry) => entry.id === subnetId)!
        task.instruction = l(`Open Effective routes for subnet ${subnet.name} in VNet ${vnet.name}. This table shows the routes available to traffic leaving that subnet. Find the exact prefix ${prefix} and read its Source and Next hop, or note that no exact row exists.`,
          `VNet ${vnet.name} のサブネット ${subnet.name} で「有効なルート」を開きます。この表は、そのサブネットから出る通信が利用できるルートを示します。完全一致の ${prefix} を探し、Source（生成元）と Next hop（ネクストホップ）を読むか、完全一致の行がないことを確認してください。`)
        if (firstSubnetInspection) { paragraphs = routeBasics; references = [routeSources, selection] }
        else if (inspected && (inspected.vnetId !== vnetId || inspected.subnetId !== subnetId)) paragraphs = [teaching.topic.takeaway, returnPath]
        firstSubnetInspection = false
        inspected ??= check.params
      }
      if (check.kind === 'control-routes.inspected') {
        if (!topology) throw new Error(`Missing router teaching scope for ${task.id}`)
        const { prefix } = check.params
        if ('siteId' in check.params) {
          const siteId = check.params.siteId
          const site = topology.sites.find((entry) => entry.id === siteId)!
          task.instruction = l(`Open the received BGP routes for ${site.name}. Find ${prefix} and read its preferred next hop. This is the branch’s route back, not the Azure workload’s outbound table.`,
            `${site.name} の受信 BGP ルートを開き、${prefix} と優先ネクストホップを調べます。これは拠点からの復路であり、Azure ワークロードの送信テーブルではありません。`)
        } else {
          const { hubId, tableId } = check.params
          const hub = topology.vwanHubs.find((entry) => entry.id === hubId)!
          const table = hubRouteTables(hub).find((entry) => entry.id === tableId)!
          task.instruction = l(`Open the hub route table ${hub.name} / ${table.name}. Find the exact prefix ${prefix}, or its absence, and read the selected route. This table is the lookup context for its associated connections, not a combination of all hub tables.`,
            `ハブのルート テーブル ${hub.name} / ${table.name} を開き、完全一致の ${prefix} の有無と選択されたルートを調べます。これは関連付いた接続の検索先であり、ハブ全体のテーブルの合成ではありません。`)
        }
      }
      task.debrief ??= taskTeaching[task.id] ?? { paragraphs, references }
    }
  }
}
