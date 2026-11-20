import type { CourseBundle } from './course-contract'
import type { Localized } from './content'
import { hubRouteTables } from '../hub-routing'
import { introduceBeltStages } from './belt-stages'

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
const peeringScope = l('Ordinary whole-VNet peering requires non-overlapping VNet address spaces and gives every subnet routes to the other VNet, including Operations. It is not a test-IP allow list. Subnet peering is a separate, narrower option introduced in later isolation topics.',
  '通常の VNet 全体のピアリングでは、VNet のアドレス空間が重複しないことが必要で、Operations を含む全サブネットに相手へのルートが追加されます。テストした IP の許可リストではありません。サブネット ピアリングは、後の分離で扱う範囲を絞った別の選択肢です。')
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
const routingPrimer = l('A route table groups user-defined routes (UDRs) and is associated with a subnet. Each UDR matches a destination prefix and specifies a next hop for traffic leaving that subnet. VirtualAppliance with IP 10.20.1.4 means send the packet to Inspection firewall; it does not mean the firewall automatically permits or forwards it. Azure Firewall rules and network security groups (NSGs) provide separate traffic permission checks.',
  'ルート テーブルはユーザー定義ルート (UDR) をまとめ、サブネットに関連付けます。各 UDR は宛先プレフィックスと、そのサブネットから出る通信のネクストホップを指定します。VirtualAppliance と IP 10.20.1.4 は、Inspection firewall にパケットを送る指定であり、装置による許可や後続転送を自動的に保証しません。Azure Firewall のルールとネットワーク セキュリティ グループ (NSG) による通信の許可は、別に確認します。')
const firewallRules = reference('https://learn.microsoft.com/en-us/azure/firewall/rule-processing#outbound-connectivity', 'Azure Firewall rule processing', 'Azure Firewall のルール処理')
const securityRules = reference('https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview#security-rules', 'NSG security rules', 'NSG のセキュリティ ルール')
const taskTeaching: Record<string, { paragraphs: Localized[]; references: ReturnType<typeof reference>[] }> = {
  'private-link.load': { paragraphs: [
    l('In this starter, Application owns 10.21.0.0/16 and contains both Workload and Operations subnets. Its System route uses VnetLocal: that destination range stays within this VNet, rather than crossing into another network.',
      'この初期構成では、Application は 10.21.0.0/16 を所有し、Workload と Operations サブネットを含みます。その System ルートの VnetLocal は、この宛先範囲が別のネットワークへ渡らず、この VNet 内に留まることを示します。'),
    l('Partner owns a separate 10.22.0.0/16 range. Both networks use private addresses, but that does not connect them. Next, look for Partner’s range in the application’s routes before deciding how to connect it.',
      'Partner は別の 10.22.0.0/16 を所有します。両ネットワークがプライベート アドレスを使っていても、それだけで接続されるわけではありません。次に、接続方法を判断する前に、アプリのルートで Partner の範囲を探します。'),
  ], references: [routeSources, peerConnectivity] },
  'inspection-bypass.load': { paragraphs: [hubPurpose, l('This mission adds Inspection hub, its firewall and two empty workload policy tables to your existing application–partner network. Your existing nodes and peering are retained. First connect each spoke to the hub; next add the routing rules yourself. Later missions separate inspection from transport services.',
    'このミッションでは、既存のアプリとパートナーのネットワークに Inspection hub、そのファイアウォール、空のワークロード用ポリシー テーブル 2 つを追加します。既存のノードとピアリングは保持します。まず各スポークをハブに接続し、次にルーティング規則を追加します。後のミッションでは、検査と転送サービスを分離します。')],
    references: [serviceChaining] },
  'inspection-bypass.connect': { paragraphs: [l('Both spokes can now reach the hub, but their existing direct peering can still carry application–partner traffic. The hub is a place to share a service, not an automatic transit switch. Next you will tell the workload subnets when to send traffic to the firewall.',
    '両方のスポークがハブに到達できるようになりましたが、アプリとパートナーの通信は既存の直接ピアリングを通れます。ハブはサービスを共有する場所であり、自動的な中継スイッチではありません。次に、ファイアウォールへ送る条件をワークロードのサブネットに指定します。'),
    l('The inspection-routing warning/error indicators can remain: peering is complete, but firewall steering is not. Leave those issues for the upcoming route-table, UDR and path-verification steps. Keep the diagnostics visible; this intermediate network is not ready to deploy, and unrelated addressing or peering errors still need attention.',
      '検査ルーティングに関する警告やエラーの表示は残ることがあります。ピアリングは完成しましたが、ファイアウォールへ送る経路は未完成です。それらは後続のルート テーブル、UDR、経路検証のステップで扱います。診断表示は残してください。この中間構成はデプロイの準備ができた状態ではなく、別のアドレス設定やピアリングのエラーには引き続き対処が必要です。'), routingPrimer],
    references: [customRoutes, firewallRules, securityRules] },
  'inspection-bypass.predict-subnet': { paragraphs: [
    l('Steering traffic through a firewall and permitting it are different requirements. Azure Firewall rules can deny HTTPS even when the routes are correct. NSGs add separate filtering on their associated subnets or network interfaces.',
      'ファイアウォール経由にすることと、通信を許可することは別の要件です。ルートが正しくても、Azure Firewall のルールによって HTTPS が拒否される場合があります。NSG は、関連付いたサブネットやネットワーク インターフェイスで別のフィルタリングを行います。'),
    l('This simulator checks routing and modeled forwarding, not Azure Firewall policy or NSG enforcement. A passing routing check does not prove that those security rules permit a real application connection; verify them separately in Azure.',
      'このシミュレーターが確認するのはルーティングとモデル化した転送であり、Azure Firewall のポリシーや NSG による制御ではありません。ルーティングの確認に合格しても、実際のアプリ接続がセキュリティ ルールで許可される証明にはなりません。Azure で別に確認してください。'),
  ], references: [firewallRules, securityRules] },
  'inspection-bypass.summary': { paragraphs: [l('You added a broad /8 policy toward the firewall. Local and peering candidates still exist alongside it. Before editing again, predict which candidate matches each destination most specifically; then compare that prediction with Effective routes.',
    'ファイアウォールへの広い /8 ポリシーを追加しました。ローカルとピアリングの候補も共存しています。次の編集前に、各宛先に最も具体的に一致する候補を予測し、有効なルートと比較します。')],
    references: [selection] },
  'private-link.default-route': { paragraphs: [l('The missing Partner /16 row is not the end of the lookup. Azure also supplies broader system routes. In this unconnected starter, 10.0.0.0/8 points to None: discard private destinations without a more-specific usable route. The Internet default 0.0.0.0/0 covers every address, but /8 is the longer match for 10.22.1.4.',
    'Partner の /16 の行がなくても、検索はそこで終わりません。Azure は、より広いシステム ルートも提供します。未接続の初期構成では、10.0.0.0/8 の None は、より具体的な使用可能なルートがないプライベート宛先を破棄します。Internet の既定ルート 0.0.0.0/0 は全アドレスを含みますが、10.22.1.4 では /8 の方が長く一致します。')],
    references: [routeSources, selection] },
  'inspection-bypass.inspect': { paragraphs: [l('Partner’s 10.22.0.0/16 is the narrower match for 10.22.1.4 than the broad 10.0.0.0/8 UDR. An active summary can therefore coexist with a selected peering route. “Active” means a usable candidate for its prefix, not the route used by every address inside that range.',
    '10.22.1.4 では、Partner の 10.22.0.0/16 が、広い 10.0.0.0/8 UDR より狭く一致します。有効な集約ルートと、選択されるピアリング ルートは共存できます。「有効」は、そのプレフィックスの候補が使用可能であることを示し、範囲内の全アドレスがそのルートを使う意味ではありません。')],
    references: [selection] },
  'inspection-bypass.forward': { paragraphs: [l('Application’s destination-specific /16 UDR now directs the request to Inspection firewall ahead of the equal /16 peering route. This task checked that rule and protected Operations/isolation; it did not yet require the reply to traverse inspection. Next reason from Partner toward Application, not from Application toward Partner again.',
    'Application の宛先別 /16 UDR は、同じ /16 のピアリングより優先され、要求を Inspection firewall に送ります。このステップは、その規則と Operations および分離を確認しましたが、復路の検査経由までは要求していません。次は Application から Partner を繰り返さず、Partner から Application を考えます。')],
    references: [selection, customRoutes] },
  'inspection-bypass.repair': { paragraphs: [l('The check establishes that both directions now traverse Inspection firewall while Operations and tenant isolation are preserved. In the initial comparison, the /16 peering route beat the /8 UDR. One way to change that decision is a destination-specific /16 UDR: at equal prefix length the UDR wins. That is a worked repair example, not the only permitted configuration.',
    '確認できたのは、Operations とテナントの分離を維持したまま、双方向が Inspection firewall を通ることです。最初の比較では、/16 のピアリング ルートが /8 の UDR に優先されました。宛先に合わせた /16 UDR は修復方法の一例であり、同じプレフィックス長では UDR が優先されます。これは修復例であって、唯一許される構成ではありません。')],
    references: [selection, serviceChaining] },
  'inspection-bypass.return': { paragraphs: [l('Partner’s Workload table is the source of the reply toward Application’s 10.21.0.0/16. Compare this with the earlier request toward 10.22.0.0/16. The repair check assessed firewall traversal in both directions; this observation shows the separate return lookup that supports it.',
    'Partner の Workload テーブルは、Application の 10.21.0.0/16 への応答の送信元です。先ほどの 10.22.0.0/16 への要求と比較します。修復の評価では双方向のファイアウォール通過を確認し、この観察では、それを支える独立した復路検索を読み取ります。')],
    references: [selection, serviceChaining] },
  'colocated-chain.load': { paragraphs: [l('This new practice snapshot removes the direct spoke link and adds an SD-WAN router in a second subnet of Inspection hub. Both appliances stay in one VNet, but have different roles: firewall inspection first, transport onward second. Existing spoke steering is preconfigured so you can focus on the handoff between those services.',
    '新しい練習スナップショットでは、スポーク間の直接リンクを外し、Inspection hub の別サブネットに SD-WAN ルーターを追加します。同じ VNet 内でも、先に検査するファイアウォールと、次に転送する装置では役割が異なります。スポークの転送先は構成済みなので、サービス間の引き渡しに集中します。')],
    references: [serviceChaining] },
  'colocated-chain.inspect': { paragraphs: [l('This table belongs to the firewall subnet, not Application. After accepting the request, the firewall needs an onward route toward Partner. A route on Application’s subnet cannot supply that second lookup. Compare the Partner route’s enabled state and next hop with the required next stage, SD-WAN router.',
    'この表は Application ではなく、ファイアウォールのサブネットのものです。要求を受け取った後、ファイアウォールには Partner への後続ルートが必要です。Application のルートは、この 2 回目の検索を代用できません。Partner ルートの有効状態とネクストホップを、次の段階である SD-WAN router と比較します。')],
    references: [serviceChaining, customRoutes] },
  'colocated-chain.repair': { paragraphs: [l('The assessed request now visits firewall then SD-WAN, and the reply visits SD-WAN then firewall. These are different onward decisions even though both appliances share a VNet. The combined check also preserves local Operations and the restricted tenant boundary.',
    '評価した要求はファイアウォール、SD-WAN の順、応答は逆の順を通ります。装置が同じ VNet 内でも、後続の判断は異なります。総合確認では、ローカル Operations とテナントの分離も維持しています。')],
    references: [serviceChaining] },
  'colocated-chain.return': { paragraphs: [l('Transport’s subnet now looks up Application’s 10.21.0.0/16 for the reply. Its next stage is the firewall, not Partner or itself. Reusing the firewall subnet’s Partner policy here would confuse the direction and can skip a stage or create a loop.',
    '転送装置のサブネットは、応答先 Application の 10.21.0.0/16 を検索します。次の段階は Partner や自分自身ではなく、ファイアウォールです。ここにファイアウォールの Partner 向けポリシーをコピーすると、方向を混同し、段階の迂回やループを起こす場合があります。')],
    references: [serviceChaining, customRoutes] },
  'dedicated-chain.load': { paragraphs: [l('This practice snapshot moves SD-WAN transport from Inspection hub into a dedicated Transport VNet. Separating service ownership can simplify team boundaries, but adds inter-VNet handoffs. The peering paths and UDRs are prepared; investigate whether each appliance can actually forward the traffic it receives.',
    'この練習スナップショットでは、SD-WAN を Inspection hub から専用の Transport VNet に移します。サービスの所有を分けるとチームの境界を整理できますが、VNet 間の引き渡しが増えます。ピアリングと UDR は準備済みです。各装置が受け取った通信を実際に転送できるか調べます。'),
    l('Allow forwarded traffic on a peering permits transit packets across that peering; it does not switch on an NVA’s NIC IP forwarding. NIC forwarding and guest routing are separate production configuration responsibilities. Gateway transit is a different setting for sharing a gateway, introduced next.',
      'ピアリングの Allow forwarded traffic は、そのピアリングで転送パケットを許可する設定で、NVA の NIC IP 転送を有効にする設定ではありません。NIC の転送とゲストのルーティングは、本番では別々に構成します。ゲートウェイを共有する Gateway transit は別の設定で、次に扱います。')],
    references: [serviceChaining, peeringAccess] },
  'dedicated-chain.inspect': { paragraphs: [l('Inspection hub’s route toward Partner now points to the SD-WAN address in Transport. That candidate establishes a next hop, not the appliance’s ability to carry transit traffic. Keep route selection, peering permission and appliance forwarding as three separate questions.',
    'Inspection hub の Partner 向けルートは、Transport の SD-WAN アドレスを指します。これはネクストホップの候補を示すもので、装置が通過通信を転送できる証明ではありません。ルート選択、ピアリングの許可、装置の転送を分けて考えます。')],
    references: [serviceChaining, peeringAccess] },
  'dedicated-chain.repair': { paragraphs: [l('The required forward and reverse appliance order now passes across the dedicated Transport boundary. This verifies the declared routing and forwarding state, not firewall rules or guest service health. A direct spoke peering would not be equivalent if it bypassed a required appliance.',
    '専用 Transport の境界をまたいで、必要な往路と復路の装置順が合格しました。確認したのは宣言されたルーティングと転送状態であり、ファイアウォール規則やゲストの正常性ではありません。必要な装置を迂回する直接ピアリングは、同じ解決にはなりません。')],
    references: [serviceChaining] },
  'dedicated-chain.return': { paragraphs: [l('Transport’s subnet needs an Application return route through Inspection firewall in the other VNet. The original source’s successful lookup cannot create this route. Follow the return destination and next-hop owner across each boundary rather than copying the outbound order.',
    'Transport のサブネットには、別 VNet の Inspection firewall を通る Application への復路が必要です。元の送信元の検索成功で、このルートは作られません。往路の順番をコピーせず、復路の宛先とネクストホップの所有先を各境界で追います。')],
    references: [serviceChaining, selection] },
  'branch-advertisement.load': { paragraphs: [l('This smaller practice snapshot sets aside the appliance chain to introduce a shared VPN gateway and Branch office 172.22.0.0/24. BGP advertises which prefixes a neighbor can reach; it is not an application health test.',
    'この小さな練習スナップショットでは装置チェーンを一旦置き、共有 VPN ゲートウェイと Branch office の 172.22.0.0/24 を導入します。BGP は隣接先が到達できるプレフィックスを広告するもので、アプリの正常性テストではありません。'),
    l('The hub allows gateway transit; Application uses that remote gateway. These preconfigured peering settings share the gateway. A separate route-table setting controls whether its BGP-learned routes reach Workload. After the repair, GatewaySubnet still needs its own route back to Application.',
      'ハブはゲートウェイ転送を許可し、Application はそのリモート ゲートウェイを使用します。これらのピアリング設定は構成済みです。別のルート テーブル設定が、BGP 学習ルートを Workload に伝達するか制御します。修復後も、GatewaySubnet には独立した Application への復路が必要です。')],
    references: [gatewayTransit, customRoutes] },
  'branch-advertisement.inspect': { paragraphs: [l('The absent exact branch prefix is evidence about Application / Workload, not proof that the gateway learned nothing. Compare the workload table’s BGP propagation setting with the already configured VPN and gateway sharing. Local VnetLocal and peering routes have different sources from gateway-learned routes.',
    '完全一致の拠点プレフィックスがないことは Application / Workload の根拠であり、ゲートウェイが何も学習していない証明ではありません。ワークロードの BGP 伝達設定を、構成済みの VPN とゲートウェイ共有と比較します。ローカルやピアリングのルートと、ゲートウェイ学習ルートでは生成元が異なります。')],
    references: [customRoutes, gatewayTransit] },
  'branch-advertisement.repair': { paragraphs: [l('The original workload and branch now have a usable modeled conversation in both directions while Operations and isolation hold. A learned branch route can supply the workload’s outbound decision, but it does not prove the independent gateway return lookup. Read that separate scope next.',
    '元のワークロードと拠点は、Operations と分離を維持したまま、モデル上で双方向に通信できます。学習した拠点ルートはワークロードの往路を提供できますが、独立したゲートウェイの復路検索を証明しません。次に、その別の範囲を読みます。')],
    references: [gatewayTransit, customRoutes] },
  'branch-advertisement.return': { paragraphs: [l('GatewaySubnet is a transit source for replies to Application’s 10.21.0.0/16, not the branch-prefix lookup you inspected in Workload. A policy attached here can affect gateway return traffic without changing the workload table. A source route and a gateway return route answer different questions.',
    'GatewaySubnet は、Application の 10.21.0.0/16 への応答の転送元です。Workload で読んだ拠点プレフィックスの検索とは異なります。ここに関連付いたポリシーは、Workload の表を変えずにゲートウェイの復路へ影響します。送信元のルートと、ゲートウェイの復路は別の問いに答えます。')],
    references: [gatewayTransit, customRoutes] },
  'wan-isolation.load': { paragraphs: [l('This snapshot replaces the ordinary hub VNet and its customer-managed gateway with a Microsoft-managed Virtual WAN hub. VNets attach through hub connections instead of ordinary hub peerings. Hub route tables now decide which connected prefixes each source can look up; they are not subnet UDR tables.',
    'このスナップショットでは、通常のハブ VNet と利用者管理のゲートウェイを、Microsoft 管理の Virtual WAN ハブに置き換えます。VNet は通常のハブ ピアリングではなく、ハブ接続で参加します。ハブのルート テーブルが、各送信元から検索できる接続先のプレフィックスを決めます。サブネットの UDR テーブルとは別のものです。'), topics.wan.introduction],
    references: [hubRouting] },
  'wan-isolation.inspect': { paragraphs: [l('Application’s hub connection uses Default. A missing Partner prefix here can reflect missing publication into that context, even though Partner is attached. Association asks “where does this source look up traffic?”; propagation asks “where is this connection’s prefix published?”',
    'Application のハブ接続は Default を使います。Partner が接続済みでも、その範囲へ公開されていなければプレフィックスはありません。関連付けは「この送信元はどこで検索するか」、伝達は「この接続のプレフィックスをどこへ公開するか」を指定します。')],
    references: [hubRouting] },
  'wan-isolation.repair': { paragraphs: [l('The service conversation and both tenant initiation boundaries now pass, with the original hub identities and Operations preserved. Restoring one shared-service publication need not place every connection in the same routing domain. Read Partner’s independent return next.',
    '元のハブの識別子と Operations を保持し、サービスの通信と、テナントとの両方向の新規通信の境界が合格しました。共有サービスの公開の修復に、全接続を同じルーティング ドメインへ入れる必要はありません。次に Partner の独立した復路を読みます。')],
    references: [hubRouting] },
  'wan-isolation.return': { paragraphs: [l('Partner also looks up traffic in Default, but its return destination is Application’s 10.21.0.0/16. A source connection’s association does not publish that source’s own prefix. Separate the lookup used by a connection from publication of its routes.',
    'Partner も Default で検索しますが、復路の宛先は Application の 10.21.0.0/16 です。送信元接続の関連付けは、その送信元自身のプレフィックスを公開しません。接続が使用する検索先と、そのルートの公開先を区別します。')],
    references: [hubRouting] },
  'wan-isolation.explain': { paragraphs: [topics.wan.takeaway,
    l('Related feature: Virtual WAN routing intent steers private or Internet traffic through a security next hop in the managed hub. It is not enabled in this isolation exercise, and it cannot rescue traffic already discarded by a source subnet UDR. Configuring secured-hub intent is practiced in the original edition; this scenario edition introduces its scope, not an equivalent configuration lab.',
      '関連機能として、Virtual WAN のルーティング インテントは、プライベートまたは Internet 通信を管理ハブ内のセキュリティ用ネクストホップへ送ります。この分離演習では無効で、送信元 UDR で既に破棄された通信も救済しません。保護されたハブの設定は従来版で練習でき、このシナリオ版では範囲の紹介に留めています。')],
    references: [hubRouting, reference('https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies#background', 'Routing intent: private and Internet policies', 'ルーティング インテント: プライベートと Internet のポリシー')] },
  'tiered-incident.load': { paragraphs: [l('Return to the dedicated inspection/transport design in a new snapshot. Indirect workload 10.25.0.0/16 sits behind a Tier router in Application rather than attaching directly to the shared hub. First prepare that tier’s departure, then diagnose the remaining path while protecting the existing service.',
    '新しいスナップショットで、検査と転送を分離した構成に戻ります。Indirect workload の 10.25.0.0/16 は、共有ハブに直接接続せず、Application 内の Tier router の背後にあります。まず新しい階層の送信を準備し、既存サービスを守りながら残る経路を診断します。')],
    references: [serviceChaining] },
  'tiered-incident.inspect': { paragraphs: [l('A route candidate can be listed but disabled. The new tier has its own source table; the existing Application policy does not apply to traffic before it reaches Tier router. Separate this first departure from each onward and return lookup.',
    'ルートは表示されていても、無効な候補の場合があります。新しい階層には独自の送信元テーブルがあり、Tier router へ到達する前の通信に既存の Application ポリシーは適用されません。最初の送信と、後続および復路の検索を分けて考えます。')],
    references: [customRoutes, serviceChaining] },
  'tiered-incident.entry': { paragraphs: [l('The new tier now has its enabled departure rule, and the checks preserve the existing inspected conversation and isolation. This staged task does not yet certify the new conversation: upstream routers must also know how to reach 10.25.0.0/16 on the reply.',
    '新しい階層の送信規則が有効になり、既存の検査付き通信と分離も維持されています。この段階では、新しい通信全体はまだ認定していません。応答時には、上流のルーターにも 10.25.0.0/16 への経路が必要です。')],
    references: [serviceChaining, selection] },
  'tiered-incident.repair': { paragraphs: [l('The new conversation now crosses Tier router, firewall and SD-WAN in the required order, with the reply in reverse order. The existing Application conversation remains separately assessed. Repairing a tier-specific return route is different from changing every workload’s policy.',
    '新しい通信は Tier router、ファイアウォール、SD-WAN の順、応答は逆順を通ります。既存の Application の通信も独立して評価しています。階層固有の復路の修復と、全ワークロードのポリシー変更は異なります。')],
    references: [serviceChaining] },
  'tiered-incident.return': { paragraphs: [l('Inspection hub’s route for 10.25.0.0/16 must lead toward the original Indirect workload owner, not simply toward the transport service used for Partner. Compare the destination and next-stage owner here with the earlier 10.22.0.0/16 source lookup.',
    'Inspection hub の 10.25.0.0/16 は、Partner 向けの転送サービスへ単に向けるのではなく、元の Indirect workload の所有先へ導く必要があります。この宛先と次の段階の所有先を、先ほどの 10.22.0.0/16 の送信元検索と比較します。')],
    references: [serviceChaining, selection] },
  'ha-return-path.load': { paragraphs: [l('This new snapshot changes names and prefixes and introduces a load-balanced NVA pair: client 10.81.1.10, server 10.82.1.10, transit frontend 10.80.3.10. A frontend can select the request’s backend without controlling the remote subnet’s reply route. Read the original packet tuple and both selected appliances before editing.',
    'この新しいスナップショットでは、名前とプレフィックスを変え、負荷分散された 2 台の NVA を導入します。クライアントは 10.81.1.10、サーバーは 10.82.1.10、転送フロントエンドは 10.80.3.10 です。フロントエンドが要求のバックエンドを選んでも、リモート サブネットの復路は制御しません。編集前に元のタプルと両方向の装置を読みます。')],
    references: topics.ha.references },
  'ha-return-path.inspect': { paragraphs: [l('The application route sends the server destination toward the transit frontend. That tells you where the request enters HA steering, not which appliance the reply will reach. The packet probe next distinguishes the original client/server tuple from the frontend and backend identities.',
    'アプリのルートは、サーバー宛てを転送フロントエンドへ送ります。これは要求が HA 転送に入る場所であり、復路がどの装置へ届くかは示しません。次のパケット プローブで、元のクライアントとサーバーのタプルを、フロントエンドおよびバックエンドの識別子と区別します。')],
    references: topics.ha.references },
  'ha-return-path.repair': { paragraphs: [l('The paired check now confirms the required original tuple, primary backend and same-NVA transit in both directions, with local Operations preserved. Routing the reply through the transit frontend and pinning the currently selected appliance can both satisfy a declared snapshot; they have different implications when backend eligibility later changes.',
    '双方向の確認で、必要な元のタプル、プライマリ バックエンド、同じ NVA の通過、およびローカル Operations の維持を確認しました。転送フロントエンド経由の復路と、現在の装置への固定は、どちらも宣言されたスナップショットを満たせますが、後で適格なバックエンドが変わった場合の意味が異なります。')],
    references: topics.ha.references },
  'ha-return-path.return': { paragraphs: [l('Remote’s table makes its own decision for client range 10.81.0.0/16. Compare its next hop with the backend seen by the forward packet probe; a successful individual return route is not sufficient if it reaches incompatible NVA state.',
    'Remote のテーブルは、クライアント範囲 10.81.0.0/16 を独立して検索します。ネクストホップと、往路のプローブで見たバックエンドを比較します。復路だけが成功しても、互換性のない NVA の状態へ届くなら不十分です。')],
    references: topics.ha.references },
  'ha-return-path.explain': { paragraphs: [topics.ha.takeaway,
    l('This checkpoint completes the core black-belt requirements once the XP threshold is met. Black belt does not mean every task is finished: the following ER/VPN and multi-hub missions are specialist practice, followed by a different-address completion challenge. Your earned belt is retained.',
      'このチェックポイントで、必要な XP を満たせば基礎の黒帯要件が完成します。黒帯は全ステップの完了を意味しません。続く ER/VPN と複数ハブは専門演習で、その後に異なるアドレスでの修了課題があります。獲得済みの帯は保持されます。')],
    references: topics.ha.references },
  'hybrid-preference.load': { paragraphs: [l('Specialist practice begins with a fresh classic hub/VPN/ExpressRoute network and new 10.91.0.0/16 workload addresses. Keep your core black belt; this mission adds backup-route reasoning rather than a higher belt. Compare service-specific prefixes before declaring a primary withdrawal.', '専門演習は、従来型ハブ、VPN、ExpressRoute の新しいネットワークと、10.91.0.0/16 のワークロードで始めます。基礎の黒帯は保持し、上の帯ではなくバックアップ経路の判断を練習します。プライマリの停止状態を宣言する前に、サービス別のプレフィックスを比較します。'), topics.hybrid.introduction],
    references: topics.hybrid.references },
  'multihub-labels.load': { paragraphs: [l('This specialist snapshot returns to Virtual WAN, now with separate West and East hubs and custom tables. The ordinary Default-table exercise becomes a cross-hub publication problem: local table IDs and destination labels have different roles. Original associations stay fixed so you can focus on propagation.',
    'この専門演習では Virtual WAN に戻り、West と East の別々のハブとカスタム テーブルを使います。Default テーブルの演習から、ハブ間の公開の問題へ進みます。ローカルなテーブル ID と伝達先ラベルは別の役割です。伝達に集中するため、元の関連付けは維持します。'), topics.labels.introduction],
    references: [hubLabels, hubRouting] },
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
    l('You prepared the request’s steering. Now consider Partner’s separate lookup for the reply to Application; the request’s route does not select that next hop.',
      '要求の転送先は準備しました。次に、Application への応答を Partner が独立して検索することを考えます。要求のルートでは、そのネクストホップは選ばれません。'),
    l('On the reply, /16 peering matches more specifically than the /8 summary. A destination-specific UDR toward the firewall is one possible repair; compare Partner’s policy with the request you prepared.',
      '応答でも、/16 のピアリングは /8 の集約ルートより具体的です。ファイアウォールへの宛先別 UDR は修復の一例です。Partner のポリシーを、準備済みの要求の転送先と比較します。'),
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
    l('The new tier’s departure rule is enabled. Trace the reply toward its original 10.25.0.0/16 owner; a repaired first stage does not create every upstream return route.',
      '新しい階層の送信規則は有効です。元の所有先 10.25.0.0/16 への復路を追います。最初の段階の修復で、上流の全復路が作られるわけではありません。'),
    l('Compare Inspection hub’s return route for 10.25.0.0/16 with the location of Tier router. Its next stage must lead toward that tier, not back toward transport.',
      'Inspection hub の 10.25.0.0/16 への復路を、Tier router の位置と比較します。次の段階は転送装置ではなく、その階層へ導く必要があります。'),
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

/** Assemble presentation from native scopes; preserve grading identities and awards. */
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
      if (check.kind === 'scenario.loaded' && !check.params.inspection) task.instruction = taskTeaching[task.id]?.paragraphs[0] ?? teaching.topic.introduction
      if (teaching.topic === topics.peering && (check.kind === 'requirements.satisfied' || check.kind === 'vnet.peered')) paragraphs.push(peeringScope, accessPermission)
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
  introduceBeltStages(bundle)
}
