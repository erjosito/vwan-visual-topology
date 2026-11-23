import type { CourseBundle, CourseCheck, CourseGuidance, CourseLesson, CourseTask } from './course-contract'
import type { Localized } from './content'
import type { Requirement } from '../platform/contract'
import { curriculumV2Course } from './curriculum-v2-profile'
import {
  curriculumV2LessonIds, curriculumV2Topologies, curriculumV2Requirements, curriculumV2HaRequirements,
  curriculumV2Packet, type CurriculumV2LessonId,
} from './curriculum-v2-topologies'

const l = (en: string, ja: string): Localized => ({ en, ja })
const checks: CourseCheck[] = [], guidance: CourseGuidance[] = [], lessons: CourseLesson[] = []
type Reference = NonNullable<CourseTask['debrief']>['references'][number]
const ref = (en: string, ja: string, path: string): Reference => ({ title: l(en, ja), url: `https://learn.microsoft.com/en-us/azure/${path}` })
const references: Record<CurriculumV2LessonId, Reference[]> = {
  'v2-peering': [ref('VNet peering and connectivity', 'VNet ピアリングと接続', 'virtual-network/virtual-network-peering-overview#connectivity')],
  'v2-firewall': [ref('Route selection', 'ルートの選択', 'virtual-network/virtual-networks-udr-overview#how-azure-selects-routes-for-traffic-routing'),
    ref('Azure Firewall features', 'Azure Firewall の機能', 'firewall/features#built-in-high-availability-and-availability-zones')],
  'v2-wan': [ref('Virtual WAN connectivity', 'Virtual WAN の接続', 'virtual-wan/virtual-wan-about#connectivity')],
  'v2-secured-wan': [ref('Private routing policy', 'プライベート ルーティング ポリシー', 'virtual-wan/how-to-routing-policies#private-routing-policy')],
  'v2-static-vpn': [ref('VPN Gateway connections', 'VPN Gateway の接続', 'vpn-gateway/vpn-gateway-about-vpngateways#connectivity'),
    ref('VPN gateway transit', 'VPN ゲートウェイ転送', 'vpn-gateway/vpn-gateway-peering-gateway-transit#prerequisites')],
  'v2-bgp': [ref('BGP and VPN Gateway', 'BGP と VPN Gateway', 'vpn-gateway/vpn-gateway-bgp-overview#why'),
    ref('BGP propagation', 'BGP の伝達', 'virtual-network/virtual-networks-udr-overview#optional-default-routes')],
  'v2-expressroute': [ref('ExpressRoute connectivity', 'ExpressRoute の接続', 'expressroute/expressroute-introduction#layer-3-connectivity'),
    ref('ExpressRoute redundancy', 'ExpressRoute の冗長性', 'expressroute/expressroute-introduction#redundancy')],
  'v2-er-locations': [ref('Resilience across peering locations', 'ピアリング拠点間の回復性', 'expressroute/expressroute-introduction#resiliency')],
  'v2-vpn-backup': [ref('VPN and ExpressRoute coexistence', 'VPN と ExpressRoute の共存', 'expressroute/expressroute-howto-coexist-resource-manager#limits-and-limitations')],
  'v2-nva-ha': [ref('HA ports flow symmetry', 'HA ポートのフロー対称性', 'load-balancer/load-balancer-ha-ports-overview#flow-symmetry'),
    ref('Route Server overview', 'Route Server の概要', 'route-server/overview#how-azure-route-server-works')],
  'v2-segmentation': [ref('Association and propagation', '関連付けと伝達', 'virtual-wan/about-virtual-hub-routing#concepts')],
  'v2-handover': [ref('Hub route propagation', 'ハブ ルートの伝達', 'virtual-wan/about-virtual-hub-routing#propagation'),
    ref('Route selection and troubleshooting', 'ルート選択とトラブルシューティング', 'virtual-network/virtual-networks-udr-overview#how-azure-selects-routes-for-traffic-routing')],
}

function hybridChapters() {
{
  const id = 'v2-static-vpn', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C05 · A warehouse joins by static VPN', 'C05 · 倉庫を静的 VPN で接続'),
    l('Configure static S2S prefixes and explicitly share a VPN gateway.', '静的 S2S プレフィックスを設定し、VPN ゲートウェイを明示的に共有します。'),
    l('Reset to the classic comparison to isolate hybrid connectivity: familiar Azure services and Operations, an unconnected tenant, VPN VNG in GatewaySubnet, and Warehouse 172.22.0.0/24 at a modeled edge. Firewall steering is intentionally absent. The tunnel is disabled, its prepared static prefix is incorrect, and Application does not yet use the remote gateway. BGP remains off on this connection.',
      'ハイブリッド接続に集中するため通常ハブ比較へ切り替えます。元の Azure サービスと Operations、未接続テナント、GatewaySubnet の VPN VNG、モデル化されたエッジの Warehouse 172.22.0.0/24 があります。ファイアウォール誘導は意図的に省略します。トンネルは無効で静的プレフィックスは誤っており、Application はリモート ゲートウェイを未使用です。この接続の BGP は無効のままです。'), [
      t('roles', 15, l('Map the hybrid roles', 'ハイブリッドの役割を整理'),
        l('Locate Warehouse VPN gateway in GatewaySubnet and the Warehouse edge. Distinguish the Azure gateway’s subnet from the routing information needed to reach the remote site.', 'GatewaySubnet の Warehouse VPN gateway と Warehouse エッジを確認し、Azure ゲートウェイのサブネットとリモート サイトへ到達するためのルーティング情報を区別してください。'),
        l('The Azure VPN gateway terminates the Azure side; remote-site prefixes describe Warehouse destinations, not GatewaySubnet. In Azure, a Local Network Gateway describes the remote site and its prefixes. This lab represents that routing information on the modeled VPN connection, not a complete Local Network Gateway provisioning workflow.', 'Azure VPN ゲートウェイが Azure 側を終端し、リモート サイトのプレフィックスは GatewaySubnet ではなく Warehouse の宛先を表します。Azure では Local Network Gateway がリモート サイトとそのプレフィックスを記述します。このラボではモデル化された VPN 接続でそのルーティング情報を表し、Local Network Gateway の完全なプロビジョニング手順ではありません。'),
        quiz(l('Does GatewaySubnet need to include Warehouse’s 172.22.0.0/24 to route VPN traffic?', 'VPN トラフィックをルーティングするために、GatewaySubnet は Warehouse の 172.22.0.0/24 を含む必要がありますか？'),
          l('No. Declare the remote-site prefix for VPN routing; GatewaySubnet holds Azure gateway addresses.', 'いいえ。VPN ルーティングにはリモート サイトのプレフィックスを宣言し、GatewaySubnet は Azure ゲートウェイのアドレスを持ちます。'),
          l('Yes. Add the remote-site prefix to GatewaySubnet; a gateway subnet must contain the VPN destinations.', 'はい。リモート サイトのプレフィックスを GatewaySubnet に追加します。ゲートウェイ サブネットは VPN の宛先を含む必要があります。'),
          l('Remote-site routing prefixes and Azure gateway placement describe different address spaces.', 'リモート サイトのルーティング プレフィックスと Azure ゲートウェイ配置は、異なるアドレス空間を表します。'), l('GatewaySubnet contains the Azure gateway, not the remote network. Configure remote-site routing instead of expanding the gateway subnet.', 'GatewaySubnet はリモート ネットワークではなく Azure ゲートウェイを含みます。ゲートウェイ サブネットを拡張するのではなく、リモート サイトのルーティングを設定します。'), { id: 'choice-b', position: 'second' }),
        [network('hybrid-hub'), connection('vpn-connection', 'warehouse-vpn')]),
      t('prefix', 25, l('Declare the static Warehouse prefix', '静的 Warehouse プレフィックスを宣言'),
        l('Replace Warehouse site-to-site VPN’s prepared remote static prefix with the owned 172.22.0.0/24. Keep the tunnel disabled and connection BGP off for this step.', 'Warehouse site-to-site VPN の準備済みリモート静的プレフィックスを所有範囲 172.22.0.0/24 に置き換えます。この段階ではトンネルを無効、接続 BGP を無効のままにしてください。'),
        l('The remote route declaration now matches the original Warehouse destination. Static VPN prefixes are connection-level remote routing information, not subnet UDRs.', 'リモート ルート宣言が元の Warehouse 宛先に一致します。静的 VPN プレフィックスは接続レベルのリモート情報であり、サブネット UDR ではありません。'),
        configured(id, vpn({ staticPrefixes: ['172.22.0.0/24'], enabled: false, bgpEnabled: false })), [connection('vpn-connection', 'warehouse-vpn')]),
      t('enable', 25, l('Enable static S2S connectivity', '静的 S2S 接続を有効化'),
        l('Enable the original Warehouse site-to-site VPN connection. Do not enable BGP or add a subnet UDR.', '元の Warehouse site-to-site VPN 接続を有効にします。BGP を有効にしたりサブネット UDR を追加したりしないでください。'),
        l('The modeled static connection is available to the hub gateway. Application still needs the explicit shared-gateway setting before inspecting its remote workload route.', 'モデル化された静的接続がハブ ゲートウェイで利用可能になりました。Application のリモート ワークロード ルート確認前に、共有ゲートウェイ設定が必要です。'),
        configured(id, vpn({ staticPrefixes: ['172.22.0.0/24'], enabled: true, bgpEnabled: false })), [connection('vpn-connection', 'warehouse-vpn')]),
      t('share-gateway', 25, l('Use the shared hub gateway', '共有ハブ ゲートウェイを使用'),
        l('The hub side already allows gateway transit. Enable Application’s use of the hub’s remote VPN gateway on the existing peering, without changing the tenant or direct Partner connection.', 'ハブ側のゲートウェイ転送は許可済みです。テナントや Partner 直接接続を変えず、既存ピアリングの Application 側でハブのリモート VPN ゲートウェイの使用を有効にしてください。'),
        l('Gateway transit and spoke use of the remote gateway are separate directional settings. Application now has the specific Warehouse static route and an independently modeled reply.', 'ゲートウェイ転送とスポークのリモート ゲートウェイ使用は別の方向設定です。Application に Warehouse の静的ルートと独立した応答が成立します。'),
        configured(id, { vnetPeerings: [{ id: 'peer-hybrid-hub-app', aToB: { allowGatewayTransit: true }, bToA: { useRemoteGateways: true } }] }, curriculumV2Requirements[id]),
        [g('peering.configure', { peeringId: 'peer-hybrid-hub-app' }, 'Open the original Application–hub peering settings.', '元の Application–ハブ ピアリング設定を開きます。')]),
      t('inspect-static', 10, l('Inspect the workload’s static VPN route', 'ワークロードの静的 VPN ルートを確認'),
        l('Now inspect subnet Workload in VNet Application for 172.22.0.0/24. Identify the VPN gateway next hop and static connection origin, then review Application–Warehouse and its reply.', 'VNet Application の Workload サブネットで 172.22.0.0/24 を確認してください。VPN ゲートウェイの次ホップと静的接続の起点を識別し、Application–Warehouse と応答を確認します。'),
        l('The VPN gateway is the next hop for the declared static prefix. BGP remains off: gateway reachability does not mean this route was learned through BGP.', '宣言した静的プレフィックスの次ホップは VPN ゲートウェイです。BGP は無効のままで、ゲートウェイへの到達性は BGP によるルート学習を意味しません。'),
        inspect('app', 'app-work', '172.22.0.0/24'), [routes('app', 'app-work', '172.22.0.0/24')]),
      t('checkpoint', 15, l('Explain static routing and replies', '静的ルーティングと応答を説明'),
        l('Explain why the Azure remote prefix and the independently prepared on-premises return path are both required.', 'Azure 側のリモート プレフィックスと、別に準備されたオンプレミス応答経路の両方が必要な理由を説明してください。'),
        l('The connection supplies static remote prefixes to Azure; Warehouse’s modeled connection supplies its Azure return context. Real on-premises route installation, IPsec selectors and tunnel establishment are not provisioned or measured here.', '接続が Azure へ静的リモート プレフィックスを提供し、Warehouse のモデル化された接続が Azure への応答コンテキストを提供します。実オンプレミスのルート導入、IPsec セレクター、トンネル確立はここでは実行・測定していません。'),
        quiz(l('What completes request and reply routing in this static VPN design?', 'この静的 VPN 設計で、要求と応答の両方のルーティングに必要なものは？'),
          l('Azure declares Warehouse’s /24; Warehouse also needs a return route for Application’s /16.', 'Azure に Warehouse の /24 を設定し、Warehouse にも Application の /16 への応答ルートが必要です。'),
          l('Azure declares Warehouse’s /24; that declaration also installs Warehouse’s return route for Application’s /16.', 'Azure に Warehouse の /24 を設定すると、Warehouse に Application の /16 への応答ルートも導入されます。'),
          l('Each side’s routing role remains independent.', '各側のルーティングの役割は独立しています。'), l('Declaring Warehouse’s prefix on the Azure connection does not install Application’s return route at Warehouse.', 'Azure 接続で Warehouse のプレフィックスを宣言しても、Warehouse に Application への応答ルートが設定されるわけではありません。'), { id: 'choice-a', position: 'first' })),
    ])
}

{
  const id = 'v2-bgp', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C06 · Learn routes, then publish them', 'C06 · ルートを学習して公開'),
    l('Separate BGP prefix learning at the VPN gateway from workload propagation.', 'VPN ゲートウェイの BGP プレフィックス学習とワークロード伝達を区別します。'),
    l('Continue the classic VPN snapshot with the active tunnel, gateway sharing and original Warehouse prefix. Warehouse also has 172.22.1.0/24. Gateway BGP capability and ASN 65515 are prepared; connection BGP is off. Application’s Workload subnet has the empty Application route publication table. BGP exchanges reachable prefixes between neighbors identified by autonomous-system numbers. A subnet route table can suppress propagation independently of gateway learning: compare the two layers rather than assuming an enabled exchange reaches the workload.',
      '通常 VPN 構成で有効トンネル、ゲートウェイ共有、元の Warehouse プレフィックスを維持します。Warehouse には 172.22.1.0/24 もあります。ゲートウェイの BGP 能力と ASN 65515 は準備済みですが、接続 BGP は無効です。Application の Workload サブネットには空の Application route publication テーブルがあります。BGP は自律システム番号で識別する隣接間で到達プレフィックスを交換します。サブネット テーブルはゲートウェイの学習とは別に伝達を抑制できるため、有効な交換がワークロードへ届くと決めつけず、両階層を比較してください。'), [
      t('enable-bgp', 25, l('Enable prefix exchange', 'プレフィックス交換を有効化'),
        l('Enable BGP on the original active Warehouse site-to-site VPN connection. Gateway capability is already prepared; do not remove Application route publication or change its propagation yet.', '元の有効な Warehouse site-to-site VPN 接続で BGP を有効にします。ゲートウェイ能力は準備済みです。Application route publication の削除や伝達の変更はまだ行わないでください。'),
        l('The configured gateway can now learn Warehouse’s advertised prefixes. An enabled exchange does not guarantee every subnet publishes those learned routes.', '設定済みゲートウェイが Warehouse の広告プレフィックスを学習できます。交換を有効にしても、すべてのサブネットに学習ルートが公開される保証はありません。'),
        configured(id, { ...vpn({ enabled: true, bgpEnabled: true }),
          vnets: [{ id: 'hybrid-hub', gateways: [{ id: 'vpn-gateway', enabled: true, bgpEnabled: true }] }] }), [connection('vpn-connection', 'warehouse-vpn')]),
      t('inspect-gateway', 10, l('Inspect gateway learning', 'ゲートウェイの学習を確認'),
        l('Inspect Warehouse VPN gateway’s native routes for new Warehouse 172.22.1.0/24 in Classic hybrid gateway hub. Do not substitute Application’s Workload subnet table.', 'Classic hybrid gateway hub の Warehouse VPN gateway のネイティブ ルートで、新しい Warehouse 172.22.1.0/24 を確認してください。Application の Workload サブネット テーブルで代用しないでください。'),
        l('You inspected the gateway’s learned route context. This establishes where the new prefix was received, not whether the workload route table uses it.', 'ゲートウェイの学習ルート コンテキストを確認しました。新しいプレフィックスの受信位置を示しますが、ワークロード テーブルが使用するかは別です。'),
        control({ vnetId: 'hybrid-hub', gatewayId: 'vpn-gateway', prefix: '172.22.1.0/24' }), [gatewayRoutes('vpn-gateway', '172.22.1.0/24')]),
      t('inspect-workload', 10, l('Compare workload route publication', 'ワークロードのルート公開を比較'),
        l('Inspect effective routes for subnet Workload in VNet Application for 172.22.1.0/24. Compare what you find with the gateway observation before changing the table.', 'VNet Application の Workload サブネットの実効ルートで 172.22.1.0/24 を確認し、テーブルを変える前にゲートウェイの観測結果と比較してください。'),
        l('You inspected the independent workload lookup. Absence of the learned prefix here can coexist with successful gateway learning.', '独立したワークロード ルックアップを確認しました。ここに学習プレフィックスがなくても、ゲートウェイでは学習済みの場合があります。'),
        inspect('app', 'app-work', '172.22.1.0/24'), [routes('app', 'app-work', '172.22.1.0/24')]),
      t('diagnose', 35, l('Diagnose the publication boundary', '公開境界を診断'),
        l('Use the gateway and workload observations to decide whether the new prefix was not learned or was not propagated to the workload.', 'ゲートウェイとワークロードの観測を使い、新しいプレフィックスが未学習なのか、ワークロードへ未伝達なのか判断してください。'),
        l('Gateway learning and workload BGP propagation are different stages. The active tunnel and gateway exchange do not override an explicit workload propagation suppression.', 'ゲートウェイ学習とワークロード BGP 伝達は異なる段階です。有効トンネルやゲートウェイ交換は、明示的なワークロード伝達抑制を上書きしません。'),
        quiz(l('Where does the observed route stop?', '観測したルートはどこで止まっていますか？'),
          l('The gateway learned 172.22.1.0/24, but the workload table suppresses BGP propagation.', 'ゲートウェイは 172.22.1.0/24 を学習しましたが、ワークロード テーブルが BGP 伝達を抑制しています。'),
          l('The gateway has not learned 172.22.1.0/24, so the workload table is waiting for its advertisement.', 'ゲートウェイが 172.22.1.0/24 を未学習のため、ワークロード テーブルはその広告を待っています。'),
          l('The two inspected contexts isolate the publication boundary.', '確認した 2 つのコンテキストから公開境界を特定できます。'), l('The gateway table already contains the Warehouse prefix. Its absence in Workload points to subnet publication, not failed gateway learning.', 'ゲートウェイ テーブルには Warehouse のプレフィックスがあります。Workload にないことは、ゲートウェイ学習失敗ではなくサブネットへの公開を示します。'), { id: 'choice-b', position: 'first' })),
      t('propagate', 25, l('Publish learned routes to the workload', '学習ルートをワークロードへ公開'),
        l('Enable BGP propagation on the original Application route publication table; keep its empty UDR list and subnet association. Verify both original and new Warehouse services plus Operations and tenant boundaries.', '元の Application route publication テーブルで BGP 伝達を有効にし、空の UDR リストとサブネット関連付けを維持してください。元の Warehouse サービスと新サービス、Operations、テナント境界を検証します。'),
        l('Both advertised Warehouse prefixes now reach the workload routing context. The same original service pair and the added service have independent request/reply evidence.', '広告された両 Warehouse プレフィックスがワークロード コンテキストへ届きます。元のサービス間と追加サービスの要求/応答をそれぞれ確認しました。'),
        configured(id, { udrTables: [{ id: 'workload-routes', disableBgpRoutePropagation: false, routes: [] }],
          vnets: [{ id: 'app', subnets: [{ id: 'app-work', prefix: '10.21.1.0/24', routeTableId: 'workload-routes' }] }] }, curriculumV2Requirements[id]),
        [policy('app', 'workload-routes')]),
      t('checkpoint', 15, l('Explain static-to-dynamic transfer', '静的から動的への変化を説明'),
        l('Explain what changed from C05 and why forward learning alone is insufficient evidence for a conversation.', 'C05 からの変更点と、要求側の学習だけでは通信の証明に不十分な理由を説明してください。'),
        l('BGP replaces manual remote-prefix publication with neighbor advertisements. Workload propagation still matters, and independently evaluated Warehouse replies—not tunnel enablement alone—support the paired routing result. Timers and live convergence are not assessed.', 'BGP は手動リモート プレフィックス公開を隣接広告に置き換えます。ワークロード伝達も必要です。有効トンネルだけでなく、独立評価した Warehouse 応答が両方向の結果を支えます。タイマーや実収束は評価していません。'),
        quiz(l('What proves the new dynamic routing objective?', '新しい動的ルーティング目標を裏付けるものは？'),
          l('Gateway learning and workload propagation are verified, along with Warehouse’s independent reply.', 'ゲートウェイ学習とワークロード伝達に加え、Warehouse の独立した応答も確認されています。'),
          l('Gateway learning and an active VPN are verified, so that evidence also establishes Warehouse’s reply.', 'ゲートウェイ学習と有効な VPN が確認されたため、その証拠で Warehouse の応答も確認されています。'),
          l('Each routing boundary needs its own evidence.', '各ルーティング境界に独自の証拠が必要です。'), l('Gateway learning and an active VPN do not establish Warehouse’s independent reply route.', 'ゲートウェイ学習と有効な VPN だけでは、Warehouse の独立した応答ルートを確認したことにはなりません。'), { id: 'choice-a', position: 'second' })),
    ])
}

{
  const id = 'v2-expressroute', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C07 · Walk an ExpressRoute prefix', 'C07 · ExpressRoute プレフィックスを追跡'),
    l('Distinguish circuit, private peering, location, MSEE evidence and Azure gateway.', '回線、プライベート ピアリング、拠点、MSEE 証拠、Azure ゲートウェイを区別します。'),
    l('Retain the Azure/warehouse addresses and gateway sharing in a classic ER comparison. A prepared ER gateway replaces the VPN transport; original Warehouse and Azure attachments at Amsterdam start disabled. Standard-circuit dual MSEEs are conceptual: the native location view aggregates the modeled private-peering paths and does not expose two routers or physical BGP sessions.',
      '通常 ER 比較で Azure/倉庫アドレスとゲートウェイ共有を維持します。準備済み ER ゲートウェイが VPN を置き換え、Amsterdam の元の Warehouse/Azure 接続は無効から開始します。標準回線の二重 MSEE は概念として扱います。ネイティブ拠点ビューはモデル化されたプライベート ピアリングを集約し、2 台のルーターや物理 BGP セッションは表示しません。'), [
      t('architecture', 15, l('Map the ExpressRoute architecture', 'ExpressRoute 構成を整理'),
        l('Identify the service circuit/private peering, Amsterdam peering location, MSEE boundary, Azure ExpressRoute gateway and its VNet attachment. Distinguish the location from Sweden Central.', 'サービス回線/プライベート ピアリング、Amsterdam 拠点、MSEE 境界、Azure ExpressRoute gateway、VNet 接続を識別し、拠点と Sweden Central を区別してください。'),
        l('The circuit carries connectivity via a provider/peering location; private peering exchanges private prefixes; the ER gateway connects the Azure VNet. A peering location is not the application’s Azure region.', '回線はプロバイダー/ピアリング拠点経由の接続、プライベート ピアリングはプライベート プレフィックス交換、ER ゲートウェイは Azure VNet 接続を担います。ピアリング拠点はアプリの Azure リージョンではありません。'),
        quiz(l('How do the Amsterdam peering location and Azure ExpressRoute gateway differ?', 'Amsterdam のピアリング拠点と Azure ExpressRoute ゲートウェイは、役割がどう異なりますか？'),
          l('Amsterdam hosts private peering; the Azure gateway connects the VNet to that peering.', 'Amsterdam はプライベート ピアリングの拠点で、Azure ゲートウェイが VNet をそのピアリングへ接続します。'),
          l('Amsterdam connects the VNet directly to the circuit; the Azure gateway serves the Warehouse edge.', 'Amsterdam が VNet を回線へ直接接続し、Azure ゲートウェイは Warehouse エッジ側を接続します。'),
          l('These are different ownership and routing boundaries.', 'それぞれ所有とルーティングの境界が異なります。'), l('The Azure gateway attaches the VNet, not the Warehouse edge. Private peering connects the on-premises side at the MSEE/location boundary.', 'Azure ゲートウェイは Warehouse エッジではなく VNet を接続します。プライベート ピアリングが MSEE/拠点境界でオンプレミス側を接続します。'), { id: 'choice-b', position: 'first' }),
        [network('hybrid-hub'), erRoutes('location-a', '172.22.0.0/24')]),
      t('attach-warehouse', 25, l('Activate original private peering', '元のプライベート ピアリングを有効化'),
        l('Enable Warehouse private peering A (aggregate) at the original Amsterdam location. Leave Azure gateway attachment A disabled for this step.', '元の Amsterdam 拠点の Warehouse private peering A (aggregate) を有効にします。この段階では Azure gateway attachment A は無効のままにしてください。'),
        l('The original on-premises attachment is available. The Azure gateway still needs its separate connection; one attachment alone is not an end-to-end route.', '元のオンプレミス接続が利用可能になりました。Azure ゲートウェイには別の接続が必要で、一方だけではエンドツーエンドのルートになりません。'),
        configured(id, erLink('warehouse-er-a', true)), [connection('er-link', 'warehouse-er-a')]),
      t('attach-azure', 25, l('Connect the original ER gateway', '元の ER ゲートウェイを接続'),
        l('Enable Azure gateway attachment A, retaining Warehouse’s original enabled attachment and all endpoint ownership.', 'Azure gateway attachment A を有効にし、Warehouse の元の有効な接続と全エンドポイント所有を維持してください。'),
        l('Both original attachments are available. Native routing can now carry the Warehouse prefix to Azure and the Azure prefix back toward Warehouse.', '両方の元の接続が利用可能になりました。ネイティブ ルーティングが Warehouse プレフィックスを Azure へ、Azure プレフィックスを Warehouse 側へ運べます。'),
        configured(id, { erLinks: [{ id: 'warehouse-er-a', enabled: true }, { id: 'azure-er-a', enabled: true }] }, curriculumV2Requirements[id]), [connection('er-link', 'azure-er-a')]),
      t('inspect-msee-remote', 10, l('Inspect aggregate peering-location routes', '集約されたピアリング拠点ルートを確認'),
        l('Inspect Amsterdam’s native ER routes for Warehouse 172.22.0.0/24. Identify the on-premises attachment that supplies it.', 'Amsterdam のネイティブ ER ルートで Warehouse 172.22.0.0/24 を確認し、供給元のオンプレミス接続を識別してください。'),
        l('You inspected the modeled MSEE/location prefix boundary. This aggregate evidence cannot be split into invented primary and secondary MSEE observations.', 'モデル化された MSEE/拠点のプレフィックス境界を確認しました。この集約証拠を架空の主系/副系 MSEE 観測に分割することはできません。'),
        control({ locationId: 'location-a', prefix: '172.22.0.0/24' }), [erRoutes('location-a', '172.22.0.0/24')]),
      t('inspect-gateway', 10, l('Compare the ER gateway’s learned route', 'ER ゲートウェイの学習ルートを比較'),
        l('Inspect ExpressRoute gateway in VNet Classic hybrid gateway hub for that same Warehouse /24. Compare gateway next-hop ownership with the location evidence.', '同じ Warehouse /24 を VNet Classic hybrid gateway hub の ExpressRoute gateway で確認し、ゲートウェイの次ホップ所有と拠点の証拠を比較してください。'),
        l('You inspected a different control-plane scope. The gateway’s Azure attachment and the location’s on-premises attachment play different roles in the route walk.', '異なる制御プレーン対象を確認しました。ゲートウェイの Azure 接続と拠点のオンプレミス接続は、ルート追跡で別の役割を持ちます。'),
        control({ vnetId: 'hybrid-hub', gatewayId: 'er-gateway', prefix: '172.22.0.0/24' }), [gatewayRoutes('er-gateway', '172.22.0.0/24')]),
      t('inspect-msee-azure', 10, l('Inspect Azure export and independent reply', 'Azure のエクスポートと独立応答を確認'),
        l('Inspect Amsterdam for Application 10.21.0.0/16, then review the original Warehouse conversation’s independently evaluated reply.', 'Amsterdam の Application 10.21.0.0/16 を確認し、元の Warehouse 通信の独立評価した応答を確認してください。'),
        l('You inspected Azure’s exported prefix at the location boundary. The separately modeled reverse path, rather than a forward row alone, supports the paired routing result.', '拠点境界で Azure のエクスポート プレフィックスを確認しました。要求の行だけでなく、別にモデル化した逆方向経路が両方向の結果を支えます。'),
        control({ locationId: 'location-a', prefix: '10.21.0.0/16' }), [erRoutes('location-a', '10.21.0.0/16')]),
      t('checkpoint', 15, l('Distinguish circuit and location redundancy', '回線と拠点の冗長性を区別'),
        l('Distinguish redundant MSEE connections within one circuit’s peering location from connectivity through a second peering location. Use the aggregate view without claiming separate observations of both MSEEs.', '1 本の回線のピアリング拠点内の冗長 MSEE 接続と、2 つ目のピアリング拠点を使う接続を区別してください。集約ビューを使い、両 MSEE を個別に観測したとは主張しないでください。'),
        l('One ExpressRoute circuit has redundant connections to MSEEs at its peering location. This local redundancy is distinct from a second location path. Here it is architectural context; per-MSEE sessions and link failure behavior are not separately modeled.', '1 本の ExpressRoute 回線は、そのピアリング拠点で MSEE への冗長接続を持ちます。この局所冗長性と 2 拠点目の経路は異なります。ここでは構成上の説明であり、MSEE 別のセッションやリンク障害動作は個別にモデル化していません。'),
        quiz(l('What does one circuit’s redundant MSEE connectivity provide?', '1 本の回線の冗長 MSEE 接続が提供するものは？'),
          l('Redundant MSEE connections within one peering location; location diversity needs another location.', '1 つのピアリング拠点内の冗長 MSEE 接続です。拠点の多様性には別の拠点が必要です。'),
          l('Redundant MSEE connections across two peering locations; location diversity comes with one circuit.', '2 つのピアリング拠点にまたがる冗長 MSEE 接続です。1 本の回線で拠点の多様性も提供されます。'),
          l('Local components and a location-wide failure are different domains.', '局所コンポーネントと拠点全体の障害は異なるドメインです。'), l('The native view is one aggregate location, not two independent locations.', 'ネイティブ ビューは 1 つの集約拠点であり、独立した 2 拠点ではありません。'), { id: 'choice-a', position: 'first' })),
    ])
}

{
  const id = 'v2-er-locations', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C08 · A second peering location', 'C08 · 2 つ目のピアリング拠点'),
    l('Declare Location A unavailable and prove surviving routing via Location B.', '拠点 A を利用不可と宣言し、拠点 B の残存ルーティングを確認します。'),
    l('Retain working Amsterdam A and the original endpoints. London B is prepared with an enabled Azure attachment and disabled Warehouse attachment. Two original attachments at A must be disabled for this bounded declaration; no real facility outage or elapsed failover is measured.',
      '正常な Amsterdam A と元のエンドポイントを維持します。London B は Azure 接続が有効、Warehouse 接続が無効で準備済みです。この限定宣言には A の元の 2 接続を無効にする必要があります。実施設障害や経過時間付きフェイルオーバーは測定しません。'), [
      t('attach-location-b', 25, l('Complete the second location path', '2 つ目の拠点経路を完成'),
        l('Enable Warehouse private peering B (aggregate), leaving both original A attachments enabled.', '元の A の両接続を有効のまま、Warehouse private peering B (aggregate) を有効にしてください。'),
        l('Both locations now have the original Azure and Warehouse attachment roles. A second location needs both sides; an Azure-only connection is not a usable Warehouse path.', '両拠点に元の Azure/Warehouse 接続役割が揃いました。2 拠点目も両側が必要で、Azure 側だけでは Warehouse 経路として使えません。'),
        configured(id, { erLinks: [{ id: 'warehouse-er-b', enabled: true }, { id: 'azure-er-b', enabled: true },
          { id: 'warehouse-er-a', enabled: true }, { id: 'azure-er-a', enabled: true }] }, curriculumV2Requirements[id]), [connection('er-link', 'warehouse-er-b')]),
      t('inspect-candidates', 10, l('Compare eligible location routes', '候補拠点ルートを比較'),
        l('Inspect ExpressRoute gateway’s Warehouse /24 candidates and compare their A/B location ownership before withdrawing anything.', '何も撤回する前に、ExpressRoute gateway の Warehouse /24 候補と A/B 拠点所有を比較してください。'),
        l('You inspected the distinct modeled location candidates. Their presence does not establish provider diversity, spare bandwidth or physical facility independence.', '異なるモデル化拠点候補を確認しました。候補の存在だけではプロバイダー多様性、予備帯域、物理施設の独立性を証明できません。'),
        control({ vnetId: 'hybrid-hub', gatewayId: 'er-gateway', prefix: '172.22.0.0/24' }), [gatewayRoutes('er-gateway', '172.22.0.0/24')]),
      t('withdraw-warehouse-a', 25, l('Declare Warehouse attachment A unavailable', 'Warehouse 接続 A を利用不可に宣言'),
        l('Disable original Warehouse private peering A (aggregate) as the first part of this lab’s Location A outage declaration. Do not disable B or alter prefixes.', 'このラボの拠点 A 障害宣言の第 1 段階として、元の Warehouse private peering A (aggregate) を無効にします。B の無効化やプレフィックス変更はしないでください。'),
        l('Warehouse connectivity at A is withdrawn. This is an intermediate declared configuration, not yet the complete A-location declaration.', 'A の Warehouse 接続を撤回しました。これは途中の宣言構成で、A 拠点全体の宣言はまだ完了していません。'),
        configured(id, erLink('warehouse-er-a', false), curriculumV2Requirements[id]), [connection('er-link', 'warehouse-er-a')]),
      t('withdraw-azure-a', 25, l('Complete the bounded Location A declaration', '限定された拠点 A 宣言を完了'),
        l('Disable original Azure gateway attachment A. Confirm both original A attachments are now unavailable and both B attachments remain enabled.', '元の Azure gateway attachment A を無効にし、元の A の両接続が利用不可で、B の両接続が有効であることを確認してください。'),
        l('Every original attachment at A in this lab is disabled. The original service conversation remains routed through the surviving B configuration.', 'このラボの A にあるすべての元の接続を無効にしました。元のサービス通信は残存する B 構成を通じてルーティングされます。'),
        configured(id, { erLinks: [{ id: 'warehouse-er-a', enabled: false }, { id: 'azure-er-a', enabled: false },
          { id: 'warehouse-er-b', enabled: true }, { id: 'azure-er-b', enabled: true }] }, curriculumV2Requirements[id]), [connection('er-link', 'azure-er-a')]),
      t('inspect-survivor', 10, l('Inspect the surviving B export', '残存 B エクスポートを確認'),
        l('Inspect London for Warehouse 172.22.0.0/24 and review the original Azure↔Warehouse routing legs. Do not substitute new endpoints.', 'London の Warehouse 172.22.0.0/24 を確認し、元の Azure↔Warehouse 両経路を確認してください。新しいエンドポイントで代用しないでください。'),
        l('You inspected the surviving London location route. Automatic checks also confirm the original two-way communication through the surviving configuration. This is steady-state routing, not elapsed recovery or session continuity.', '残存する London 拠点のルートを確認しました。自動確認では残存構成による元の両方向通信も検証します。定常状態のルーティングであり、回復時間やセッション継続ではありません。'),
        control({ locationId: 'location-b', prefix: '172.22.0.0/24' }), [erRoutes('location-b', '172.22.0.0/24')]),
      t('checkpoint', 15, l('Explain the failure-domain difference', '障害ドメインの違いを説明'),
        l('Explain what the second location adds beyond the circuit’s local dual-MSEE redundancy.', '2 拠点目が回線内の二重 MSEE 冗長性に加えるものを説明してください。'),
        l('The second modeled peering location provides another attachment path after all original A attachments are unavailable. Production claims about provider diversity, capacity and real facility failures require separate evidence.', '2 つ目のモデル化ピアリング拠点が、元の A の全接続を利用不可にした後の別接続経路を提供します。本番のプロバイダー多様性、容量、実施設障害には別の証拠が必要です。'),
        quiz(l('Why does B add a different routing failure boundary?', 'B が異なるルーティング障害境界を追加する理由は？'),
          l('B has end-to-end attachments at another peering location, surviving the withdrawal of A’s attachments.', 'B は別のピアリング拠点で両端の接続を持ち、A の接続を撤回しても利用できます。'),
          l('B adds another MSEE connection inside A’s peering location, relying on that same location remaining available.', 'B は A のピアリング拠点内に MSEE 接続を追加し、その同じ拠点が利用可能であることに依存します。'),
          l('Location diversity is not the same as redundant local connections.', '拠点の多様性と局所接続の冗長性は同じではありません。'), l('A and B are explicitly distinct modeled locations.', 'A と B は明示的に異なるモデル化拠点です。'), { id: 'choice-b', position: 'second' })),
    ])
}

{
  const id = 'v2-vpn-backup', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C09 · A backup must be usable', 'C09 · 使用可能なバックアップ'),
    l('Assess equal-prefix ER preference and a bidirectionally usable VPN backup.', '同一プレフィックスの ER 優先と両方向に使える VPN バックアップを評価します。'),
    l('Reset to a deliberately smaller one-location ER/VPN transport comparison, not a recommendation to replace C08 resilience. Original Warehouse /24 is identical on both transports. ER works; the prepared BGP VPN backup is disabled. No summarization, prefix-length puzzle or ARS is introduced.',
      'C08 の回復性を置き換える推奨ではなく、意図的に小さい 1 拠点 ER/VPN 比較へ切り替えます。元の Warehouse /24 は両トランスポートで同一です。ER は正常で準備済み BGP VPN バックアップは無効です。要約、プレフィックス長パズル、ARS は導入しません。'), [
      t('enable-backup', 25, l('Ready the original VPN backup', '元の VPN バックアップを準備'),
        l('Enable original Warehouse site-to-site VPN with BGP while preserving both working ER A attachments.', '正常な ER A の両接続を維持し、元の Warehouse site-to-site VPN を BGP で有効にしてください。'),
        l('Both transports can advertise the same owned remote /24. Preparing backup connectivity does not require withdrawing the primary.', '両トランスポートが同じ所有リモート /24 を広告できます。バックアップ準備のために主系を撤回する必要はありません。'),
        configured(id, { ...vpn({ enabled: true, bgpEnabled: true }), erLinks: [{ id: 'warehouse-er-a', enabled: true }, { id: 'azure-er-a', enabled: true }] }, curriculumV2Requirements[id],
          [{ vnetId: 'app', subnetId: 'app-work', prefix: '172.22.0.0/24', nextHopResourceId: 'er-gateway', destinationAddress: '172.22.0.10' }]),
        [connection('vpn-connection', 'warehouse-vpn')]),
      t('inspect-primary', 10, l('Inspect equal-prefix primary selection', '同一プレフィックスの主系選択を確認'),
        l('Inspect subnet Workload in VNet Application for 172.22.0.0/24. Identify ExpressRoute gateway as the selected primary with the VPN ready for that same prefix.', 'VNet Application の Workload サブネットで 172.22.0.0/24 を確認し、同じプレフィックスで VPN が準備済みの状態で、ExpressRoute gateway が主系に選択されることを識別してください。'),
        l('Both transports advertise the same /24, so prefix length does not decide between them. In this classic ER/VPN coexistence configuration without Azure Route Server, the workload prefers ExpressRoute.', '両トランスポートは同じ /24 を広告するため、プレフィックス長では両者を区別できません。Azure Route Server のない今回の通常 ER/VPN 共存構成では、ワークロードは ExpressRoute を優先します。'),
        inspect('app', 'app-work', '172.22.0.0/24'), [routes('app', 'app-work', '172.22.0.0/24')]),
      t('withdraw-er', 25, l('Withdraw original on-premises ER', '元のオンプレミス ER を撤回'),
        l('Disable Warehouse private peering A (aggregate) only. Preserve the original enabled BGP VPN and original owned prefixes.', 'Warehouse private peering A (aggregate) のみを無効にし、元の有効な BGP VPN と所有プレフィックスを維持してください。'),
        l('The original Warehouse ER advertisement is withdrawn in this declared snapshot. Native routes can select the prepared VPN without changing the destination prefix.', '宣言スナップショットで元の Warehouse ER 広告を撤回しました。宛先プレフィックスを変えず、準備済み VPN をネイティブ ルートが選択できます。'),
        configured(id, { ...erLink('warehouse-er-a', false), ...vpn({ enabled: true, bgpEnabled: true }) }, curriculumV2Requirements[id],
          [{ vnetId: 'app', subnetId: 'app-work', prefix: '172.22.0.0/24', nextHopResourceId: 'vpn-gateway', destinationAddress: '172.22.0.10' }]), [connection('er-link', 'warehouse-er-a')]),
      t('inspect-backup', 10, l('Inspect VPN selection and reply', 'VPN 選択と応答を確認'),
        l('Freshly inspect subnet Workload in VNet Application for the unchanged Warehouse /24. Identify Warehouse VPN gateway and independently review Warehouse’s reply, Operations and both tenant initiation boundaries.', '変更していない Warehouse /24 を VNet Application の Workload サブネット で新たに確認します。Warehouse VPN gateway を識別し、Warehouse 応答、Operations、両テナント開始境界を独立して確認してください。'),
        l('The fresh workload inspection shows VPN selection after ER withdrawal. Automatic routing checks confirm the original request and independent reply, with the other boundaries preserved. This is not a measurement of live failover or session survival.', '新たなワークロード確認で ER 撤回後の VPN 選択が分かります。自動ルーティング確認では他の境界を維持し、元の要求と独立した応答を検証します。実フェイルオーバーやセッション継続の測定ではありません。'),
        inspect('app', 'app-work', '172.22.0.0/24'), [routes('app', 'app-work', '172.22.0.0/24')]),
      t('checkpoint', 15, l('Explain usable backup evidence', '使用可能なバックアップ証拠を説明'),
        l('Explain why this backup is usable, rather than relying on a green connection icon alone.', '接続の緑アイコンだけに頼らず、バックアップが使用可能である理由を説明してください。'),
        l('Usability depends on the original remote prefix being learned, selected at the workload after ER withdrawal, and supported by an independent Warehouse reply. Azure’s forward preference does not by itself configure on-premises return policy.', '使用可能性には元のリモート プレフィックスの学習、ER 撤回後のワークロード選択、独立した Warehouse 応答が必要です。Azure の要求優先だけでオンプレミス応答ポリシーが設定されるわけではありません。'),
        quiz(l('Which evidence supports the backup objective?', 'バックアップ目標を裏付ける証拠は？'),
          l('The workload selects VPN after ER withdrawal, and Warehouse’s independently checked reply still works.', 'ER 撤回後にワークロードが VPN を選択し、独立して確認した Warehouse の応答も正常です。'),
          l('The gateway has a VPN route before ER withdrawal, and its previously working ER reply proves VPN readiness.', 'ER 撤回前にゲートウェイに VPN ルートがあり、以前の正常な ER 応答が VPN の準備を裏付けます。'),
          l('The original destination and both routing legs qualify readiness.', '元の宛先と両ルーティング経路が準備を裏付けます。'), l('A pre-withdrawal gateway route and an earlier ER reply do not prove workload VPN selection and reply routing after withdrawal.', '撤回前のゲートウェイ ルートと以前の ER 応答では、撤回後のワークロード VPN 選択と応答ルーティングを証明できません。'), { id: 'choice-a', position: 'first' })),
    ])
}
}
type NativeGuidance = { action: string; params: Record<string, unknown>; instruction: Localized }
const g = (action: string, params: Record<string, unknown>, en: string, ja: string): NativeGuidance => ({ action, params, instruction: l(en, ja) })
const routes = (vnetId: string, subnetId: string, prefix: string) =>
  g('routes.open', { vnetId, subnetId, prefix }, `Inspect ${vnetId}/${subnetId}: ${prefix}.`, `${vnetId}/${subnetId} の ${prefix} を確認します。`)
const hubRoutes = (hubId: string, tableId: string, prefix: string) =>
  g('hub-routes.open', { hubId, tableId, prefix }, `Inspect the exact ${hubId}/${tableId} table.`, `${hubId}/${tableId} の正確なテーブルを確認します。`)
const network = (vnetId: string) => g('network.configure', { vnetId }, `Open ${vnetId}'s native network controls.`, `${vnetId} のネイティブ ネットワーク設定を開きます。`)
const connection = (kind: 'er-link' | 'vpn-connection', connectionId: string) =>
  g('connection.configure', { kind, connectionId }, `Edit original connection ${connectionId}.`, `元の接続 ${connectionId} を編集します。`)
const policy = (vnetId: string, routeTableId: string, routeId?: string) =>
  g('route-table.configure', { vnetId, subnetId: `${vnetId}-work`, routeTableId, ...(routeId ? { routeId } : {}) }, `Edit the prepared ${routeTableId} policy.`, `準備済みの ${routeTableId} ポリシーを編集します。`)
const gatewayRoutes = (gatewayId: string, prefix: string) =>
  g('gateway-routes.open', { vnetId: 'hybrid-hub', gatewayId, prefix }, `Inspect original gateway ${gatewayId}, not a workload table.`, `ワークロード テーブルではなく、元のゲートウェイ ${gatewayId} を確認します。`)
const erRoutes = (locationId: string, prefix: string) =>
  g('er-routes.open', { locationId, prefix }, `Inspect aggregate location ${locationId}; it is not two independent MSEE tables.`, `集約された拠点 ${locationId} を確認します。独立した 2 台の MSEE テーブルではありません。`)
const inspect = (vnetId: string, subnetId: string, prefix: string, requirements?: Requirement[]) =>
  ({ kind: 'routes.inspected', params: { vnetId, subnetId, prefix, ...(requirements ? { requirements } : {}) } })
const control = (params: Record<string, unknown>) => ({ kind: 'control-routes.inspected', params })
const invariantRequirements = (id: CurriculumV2LessonId) => curriculumV2Requirements[id].filter((r) =>
  ['operations', 'application-to-tenant', 'tenant-to-application'].includes(r.id))
function configured(id: CurriculumV2LessonId, expected: Record<string, unknown>, requirements = invariantRequirements(id),
  selectedRoutes?: { vnetId: string; subnetId: string; prefix: string; nextHopResourceId: string; destinationAddress: string }[]) {
  const ownership = curriculumV2Topologies[id].vnets.map((v) => ({
    id: v.id, prefixes: v.prefixes, subnets: v.subnets.map((s) => ({ id: s.id, prefix: s.prefix })),
  }))
  const edits = (expected.vnets ?? []) as Record<string, unknown>[]
  return { kind: 'topology.configured', params: { expected: { ...expected, vnets: ownership.map((v) => ({ ...v, ...edits.find((e) => e.id === v.id) })) },
    requirements, ...(selectedRoutes ? { selectedRoutes } : {}) } }
}
const vpn = (state: Record<string, unknown>) => ({ vpnConnections: [{ id: 'warehouse-vpn', siteId: 'warehouse', targetKind: 'vnet-gateway', targetId: 'vpn-gateway', ...state }] })
const erLink = (id: string, enabled: boolean) => ({ erLinks: [{ id, enabled }] })
const wanAttachment = (id: string, propagatedTableId = 'defaultRouteTable') => ({ vnets: [{ id, vwanHubAttachment: { hubId: 'wan-hub', enabled: true,
  hubRouting: { status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: [propagatedTableId], labels: [] } } }] })
const enablePolicy = (table: string, route: string, prefix: string) => ({ udrTables: [{ id: table, routes: [
  { id: route, prefix, nextHopType: 'VirtualAppliance', nextHopIp: '10.20.1.4', enabled: true },
] }] })
function quiz(question: Localized, correct: Localized, wrong: Localized, explanation: Localized, wrongExplanation: Localized,
  answer: { id: 'choice-a' | 'choice-b'; position: 'first' | 'second' }) {
  const choices = [
    { id: answer.id, text: correct, feedback: explanation },
    { id: answer.id === 'choice-a' ? 'choice-b' : 'choice-a', text: wrong, feedback: wrongExplanation },
  ]
  return { kind: 'quiz.answered', params: { question,
    choices: answer.position === 'first' ? choices : choices.reverse(), correctChoiceId: answer.id } }
}
const conceptualHints: Partial<Record<string, Localized>> = {
  'v2-peering.inspect-local': l('Read the destination prefix and next hop together: the prefix describes an address range, and the next hop says where matching traffic goes.',
    '宛先プレフィックスと次ホップを合わせて読みます。プレフィックスはアドレス範囲、次ホップは一致するトラフィックの行き先を示します。'),
  'v2-peering.address': l('For this /16, compare the first two octets of the destination with the prefix. Being private does not make an address part of the same VNet.',
    'この /16 では、宛先とプレフィックスの最初の 2 オクテットを比較します。プライベート アドレスでも同じ VNet の範囲とは限りません。'),
  'v2-peering.predict': l('Look for a connection between the separate VNet address spaces, rather than a shared region label.',
    '共通のリージョン名ではなく、別々の VNet アドレス空間を結ぶ接続を探します。'),
  'v2-peering.checkpoint': l('Compare the VNets at the two ends of each peering with the destination range in Application’s table.',
    '各ピアリングの両端の VNet と、Application のテーブルにある宛先範囲を比較します。'),
  'v2-firewall.role': l('Separate the decision to send traffic to an appliance from the appliance’s decision to permit that traffic.',
    'アプライアンスへ送信する判断と、そのアプライアンスが通信を許可する判断を分けて考えます。'),
  'v2-firewall.predict-prefix': l('First compare how specifically the routes match the destination. Compare route sources only after that.',
    'まず宛先への一致がどれほど具体的かを比較し、その後でルート ソースを比較します。'),
  'v2-firewall.checkpoint': l('A trace can show which routing next hops were used without evaluating the rules on those devices.',
    'トレースで使用した次ホップは確認できますが、その装置の許可規則を評価したことにはなりません。'),
  'v2-wan.transit': l('Look at the hub connection and next hop. Is communication using an ordinary spoke peering or the managed hub?',
    'ハブ接続と次ホップを確認します。通信は通常のスポーク間ピアリングとマネージド ハブのどちらを使っていますか？'),
  'v2-secured-wan.placement': l('Compare where the steering policy is configured: a subnet route table in C02 or the managed hub here.',
    '誘導ポリシーの設定場所を比較します。C02 はサブネットのルート テーブル、今回はマネージド ハブです。'),
  'v2-secured-wan.verify-original': l('Use the most-specific matching route for the Partner destination; a covering route need not have exactly the Partner /16 prefix.',
    'Partner の宛先に最も具体的に一致するルートを使います。対象ルートのプレフィックスが Partner の /16 と同じとは限りません。'),
  'v2-secured-wan.checkpoint': l('Private and Internet routing intent are separate policies. Check which one is enabled in this scenario.',
    'プライベートとインターネットのルーティング意図は別のポリシーです。このシナリオで有効なのはどちらか確認します。'),
  'v2-static-vpn.roles': l('GatewaySubnet contains Azure gateway addresses. Remote VPN routing information describes prefixes beyond that subnet.',
    'GatewaySubnet には Azure ゲートウェイのアドレスがあります。リモート VPN のルーティング情報は、そのサブネット外のプレフィックスを表します。'),
  'v2-static-vpn.share-gateway': l('Gateway transit on the hub side and use of the remote gateway on the spoke side have different jobs; check both directions of the existing peering.',
    'ハブ側のゲートウェイ転送とスポーク側のリモート ゲートウェイ使用は役割が異なります。既存ピアリングの両方向を確認します。'),
  'v2-static-vpn.checkpoint': l('Follow the reply as a new lookup at Warehouse. Its destination is Application’s prefix, not Warehouse’s own prefix.',
    'Warehouse の新たなルックアップとして応答を追います。宛先は Warehouse 自身ではなく Application のプレフィックスです。'),
  'v2-bgp.diagnose': l('A prefix can be received at a gateway without appearing in a subnet. Use the two observations to locate that boundary.',
    'ゲートウェイが受信したプレフィックスがサブネットに現れない場合があります。2 つの観測でその境界を特定します。'),
  'v2-bgp.checkpoint': l('Separate neighbor exchange, subnet propagation and the remote return lookup; they are different parts of the same communication.',
    '隣接との交換、サブネットへの伝達、リモート側の応答ルックアップを分けます。同じ通信でも別々の段階です。'),
  'v2-expressroute.architecture': l('Distinguish the provider/MSEE peering boundary from the Azure gateway that attaches a VNet to it.',
    'プロバイダー/MSEE のピアリング境界と、そこへ VNet を接続する Azure ゲートウェイを区別します。'),
  'v2-expressroute.checkpoint': l('Two router connections and two peering locations are different failure domains.',
    '2 台のルーターへの接続と、2 つのピアリング拠点は異なる障害ドメインです。'),
  'v2-er-locations.checkpoint': l('Identify the location of the surviving attachments, not just the number of connections.',
    '接続数だけでなく、残存する接続がどの拠点にあるか確認します。'),
  'v2-vpn-backup.checkpoint': l('Compare evidence collected after the primary withdrawal with evidence collected while the primary still worked.',
    '主系を撤回した後の証拠と、主系が正常だったときの証拠を比較します。'),
  'v2-nva-ha.responsibilities': l('A load balancer can select a backend, but that selection does not replicate an NVA’s session state.',
    'ロード バランサーはバックエンドを選択できますが、その選択で NVA のセッション状態が複製されるわけではありません。'),
  'v2-nva-ha.predict-reply': l('Read the next hop in Partner’s return route. Do not substitute the request’s selected backend for that independent lookup.',
    'Partner の応答ルートの次ホップを読みます。その独立したルックアップを要求側の選択バックエンドで代用しないでください。'),
  'v2-nva-ha.diagnose': l('Compare a backend’s private IP with the shared frontend IP. Which one remains useful when backend eligibility changes?',
    'バックエンドのプライベート IP と共有フロントエンド IP を比較します。適格バックエンドが変わっても使えるのはどちらですか？'),
  'v2-nva-ha.repair-return': l('Keep the two original endpoint addresses and routing directions fixed while comparing the return next hop with the shared frontend.',
    '元の両エンドポイント アドレスと通信方向を維持し、応答の次ホップと共有フロントエンドを比較します。'),
  'v2-nva-ha.checkpoint': l('Compare the unchanged route next hops across both health snapshots, not only the backend that passed the first one.',
    '最初に合格したバックエンドだけでなく、両ヘルス状態で変えていないルートの次ホップを比較します。'),
  'v2-segmentation.lookup-export': l('Association chooses a lookup table for incoming traffic; propagation decides where this connection’s prefixes are published.',
    '関連付けは接続から入るトラフィックのルックアップ テーブルを選び、伝達は接続のプレフィックスの公開先を決めます。'),
  'v2-segmentation.regional-label': l('Compare the remote publication label with the destination table’s labels, preserving its local label and tenant boundaries.',
    'ローカル ラベルとテナント境界を維持し、リモート公開ラベルと宛先テーブルのラベルを比較します。'),
  'v2-segmentation.checkpoint': l('A connection’s lookup association does not by itself prevent other tables from learning its prefixes.',
    '接続のルックアップ関連付けだけで、他のテーブルがそのプレフィックスを学習することを防げるわけではありません。'),
  'v2-handover.diagnose': l('Use working Inventory, Operations and Warehouse as controls, then distinguish the source import from the reply publication.',
    '正常な Inventory、Operations、Warehouse を対照にし、送信元のインポートと応答の公開を区別します。'),
  'v2-handover.checkpoint': l('Keep routing observations separate from security-rule, live application and recovery-time evidence.',
    'ルーティングの観測と、セキュリティ規則、実アプリケーション、回復時間の証拠を分けます。'),
}
function readableGuidance(lessonId: CurriculumV2LessonId, cue: NativeGuidance): NativeGuidance {
  const topology = curriculumV2Topologies[lessonId], params = cue.params
  const vnet = topology.vnets.find((vnet) => vnet.id === params.vnetId)
  const subnet = vnet?.subnets.find((subnet) => subnet.id === params.subnetId)
  let instruction = cue.instruction
  if (cue.action === 'routes.open' && vnet && subnet) {
    instruction = l(`Inspect effective routes for subnet ${subnet.name} in VNet ${vnet.name}, considering destinations in ${params.prefix}.`,
      `VNet ${vnet.name} の ${subnet.name} サブネットで、${params.prefix} 内の宛先の実効ルートを確認します。`)
  } else if (cue.action === 'hub-routes.open') {
    const hub = topology.vwanHubs.find((hub) => hub.id === params.hubId)
    const table = hub?.routeTables?.find((table) => table.id === params.tableId)
    const name = table?.name ?? (params.tableId === 'defaultRouteTable' ? 'Default' : undefined)
    if (hub && name) instruction = l(`Inspect ${params.prefix} in table ${name} in hub ${hub.name}.`,
      `ハブ ${hub.name} の ${name} テーブルで ${params.prefix} を確認します。`)
  } else if (cue.action === 'network.configure' && vnet) {
    instruction = l(`Open network controls for VNet ${vnet.name}.`, `VNet ${vnet.name} のネットワーク設定を開きます。`)
  } else if (cue.action === 'connection.configure') {
    const connection = [...topology.vpnConnections, ...topology.erLinks].find((entry) => entry.id === params.connectionId)
    if (connection) instruction = l(`Open connection ${connection.name}.`, `接続 ${connection.name} を開きます。`)
  } else if (cue.action === 'gateway-routes.open' && vnet) {
    const gateway = vnet.gateways.find((gateway) => gateway.id === params.gatewayId)
    if (gateway) instruction = l(`Inspect ${params.prefix} at ${gateway.name} in VNet ${vnet.name}, not the workload table.`,
      `ワークロード テーブルではなく、VNet ${vnet.name} の ${gateway.name} で ${params.prefix} を確認します。`)
  } else if (cue.action === 'er-routes.open') {
    const location = topology.erLocations.find((location) => location.id === params.locationId)
    if (location) instruction = l(`Inspect ${params.prefix} in the aggregate routes for ExpressRoute location ${location.name}; this is not a separate view of each MSEE.`,
      `ExpressRoute 拠点 ${location.name} の集約ルートで ${params.prefix} を確認します。各 MSEE の個別ビューではありません。`)
  } else if (cue.action === 'peering.command') {
    const a = topology.vnets.find((vnet) => vnet.id === params.vnetAId), b = topology.vnets.find((vnet) => vnet.id === params.vnetBId)
    if (a && b) instruction = l(`Create peering between VNet ${a.name} and VNet ${b.name}.`,
      `VNet ${a.name} と VNet ${b.name} のピアリングを作成します。`)
  } else if (cue.action === 'route-table.configure' && vnet && subnet) {
    const table = topology.udrTables.find((table) => table.id === params.routeTableId)
    if (table) instruction = l(`Open route table ${table.name} for subnet ${subnet.name} in VNet ${vnet.name}.`,
      `VNet ${vnet.name} の ${subnet.name} サブネットのルート テーブル ${table.name} を開きます。`)
  }
  return { ...cue, instruction }
}
type CheckSpec = { kind: string; params: Record<string, unknown> }
function task(lessonId: CurriculumV2LessonId, suffix: string, points: number, title: Localized, instruction: Localized, debrief: Localized,
  check: CheckSpec, anchors: NativeGuidance[] = [], hints: Localized[] = []): CourseTask {
  const id = `${lessonId}.${suffix}`, checkId = `${id}.check`
  checks.push({ id: checkId, ...check } as CourseCheck)
  const guidanceIds = anchors.map((anchor, index) => {
    const guideId = `${id}.guide-${index + 1}`
    guidance.push({ id: guideId, ...readableGuidance(lessonId, anchor) } as CourseGuidance)
    return guideId
  })
  return { id, assessmentVersion: lessonId === 'v2-secured-wan' && ['private-intent', 'attach-service'].includes(suffix) ? 2 : 1,
    awardId: `${id}.award`, points, title, instruction, checkId, guidanceIds,
    hints: hints.length ? hints : conceptualHints[id] ? [conceptualHints[id]!] : [],
    debrief: { paragraphs: [debrief], references: references[lessonId] } }
}
function chapter(id: CurriculumV2LessonId, title: Localized, objective: Localized, context: Localized, tasks: CourseTask[]) {
  const index = curriculumV2LessonIds.indexOf(id)
  lessons.push({ id, contentVersion: 1, title, objective, context, scenarioId: id,
    prerequisites: index ? [curriculumV2LessonIds[index - 1]] : [], taskOrder: tasks.map((t) => t.id), tasks })
}

{
  const id = 'v2-peering', t = (suffix: string, points: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = [], assessmentVersion = 1) =>
    ({ ...task(id, suffix, points, title, instruction, debrief, check, anchors), assessmentVersion })
  chapter(id, l('C01 · Two services, two VNets', 'C01 · 2 つのサービスと VNet'),
    l('Interpret VNet address ranges and establish ordinary private VNet peering.', 'VNet のアドレス範囲を読み、通常のプライベート VNet ピアリングを確立します。'),
    l('The retailer has VNet Application 10.21.0.0/16 and VNet Partner 10.22.0.0/16 in the same region. Application’s Workload subnet is 10.21.1.0/24 and Operations is 10.21.2.0/24; VNet Restricted tenant uses 10.23.0.0/16. Effective routes show destination prefixes and their next hops; a prefix represents an address range. This comparison starts without peerings.',
      '小売企業の VNet Application は 10.21.0.0/16、VNet Partner は 10.22.0.0/16 で同一リージョンです。Application の Workload サブネットは 10.21.1.0/24、Operations は 10.21.2.0/24、VNet Restricted tenant は 10.23.0.0/16 です。実効ルートは宛先プレフィックスと次ホップを示し、プレフィックスはアドレス範囲を表します。この比較はピアリングなしで開始します。'), [
      t('inspect-local', 10, l('Read a local effective route', 'ローカル実効ルートを読む'),
        l('Open effective routes for subnet Workload in VNet Application. Select the 10.21.0.0/16 row and identify its address range and next hop.', 'VNet Application の Workload サブネットの実効ルートを開き、10.21.0.0/16 の行のアドレス範囲と次ホップを確認してください。'),
        l('The local VNet route covers Application’s address range. Its prefix identifies matching destinations; its next hop keeps those destinations within the VNet. It does not cover every private address in the region.', 'ローカル VNet ルートは Application のアドレス範囲を対象にします。プレフィックスは一致する宛先を示し、次ホップはその宛先が VNet 内であることを示します。同じリージョンのすべてのプライベート アドレスを対象にするものではありません。'),
        inspect('app', 'app-work', '10.21.0.0/16'), [routes('app', 'app-work', '10.21.0.0/16')]),
      t('address', 15, l('Check the local route’s scope', 'ローカル ルートの範囲を確認'),
        l('Use the 10.21.0.0/16 local VNet route you inspected in Application. Compare its address range with destination 10.22.1.10.', 'Application で確認したローカル VNet ルート 10.21.0.0/16 を使い、そのアドレス範囲と宛先 10.22.1.10 を比較してください。'),
        l('10.21.0.0/16 covers 10.21.0.0 through 10.21.255.255, so it does not cover 10.22.1.10. A private IP address is not automatically local to this VNet. Connecting the two VNets is a separate question.', '10.21.0.0/16 の範囲は 10.21.0.0 から 10.21.255.255 であり、10.22.1.10 は含まれません。プライベート IP アドレスでも、この VNet のローカル アドレスになるわけではありません。2 つの VNet の接続は別の問題です。'),
        quiz(l('Application has a local VNet route for 10.21.0.0/16. Does that route cover destination 10.22.1.10?', 'Application には 10.21.0.0/16 のローカル VNet ルートがあります。このルートは宛先 10.22.1.10 を対象にしますか？'),
          l('No. Both are private addresses, but 10.22.1.10 is outside this /16.', 'いいえ。どちらもプライベート アドレスですが、10.22.1.10 はこの /16 の範囲外です。'),
          l('Yes. Both are private addresses, so 10.22.1.10 is inside this /16.', 'はい。どちらもプライベート アドレスなので、10.22.1.10 はこの /16 の範囲内です。'),
          l('The route covers 10.21.0.0 through 10.21.255.255, not 10.22.1.10.', 'このルートの範囲は 10.21.0.0 から 10.21.255.255 であり、10.22.1.10 は含まれません。'),
          l('A route matches its destination prefix, not every private IP address. 10.22.1.10 is outside 10.21.0.0/16.', 'ルートは宛先プレフィックスに一致するアドレスを対象とし、すべてのプライベート IP アドレスを対象にするものではありません。10.22.1.10 は 10.21.0.0/16 の範囲外です。'), { id: 'choice-a', position: 'second' })),
      t('predict', 15, l('Predict the unconnected path', '未接続の経路を予測'),
        l('Before editing anything, predict whether Application can reach Partner just because both use private addresses in Sweden Central.', '編集前に、両者が Sweden Central のプライベート アドレスを使用しているだけで接続できるか予測してください。'),
        l('Separate VNets require an explicit connectivity design. A common Azure region does not join their private routing domains.', '別々の VNet には明示的な接続設計が必要です。同一 Azure リージョンでもプライベート ルーティング ドメインは結合されません。'),
        quiz(l('What provides the missing private connection?', '不足しているプライベート接続を提供するものは？'),
          l('An explicit connection between the two VNet address spaces', '2 つの VNet アドレス空間を結ぶ明示的な接続'), l('Same-region placement with different VNet address spaces', '異なる VNet アドレス空間を同じリージョンに配置'),
          l('Non-overlapping address spaces avoid conflicts but do not create a connection.', '重複しないアドレス空間は競合を避けますが、接続を作成するものではありません。'), l('Region placement does not create routes between VNets.', 'リージョンへの配置だけでは VNet 間のルートは作成されません。'), { id: 'choice-b', position: 'first' })),
      t('connect', 25, l('Build a peering chain and inspect its limit', 'ピアリングの連鎖を作成し限界を確認'),
        l('First peer VNet Application with VNet Partner. Then peer Partner with Restricted tenant, without peering Application directly to Restricted tenant. Finally open effective routes for subnet Workload in Application and look for 10.23.0.0/16. Does connecting both VNets to Partner give Application a route to Restricted tenant? Show me where guides each action in order.',
          'まず VNet Application と VNet Partner をピアリングし、次に Partner と Restricted tenant をピアリングしてください。Application と Restricted tenant は直接接続しないでください。最後に Application の Workload サブネットの実効ルートを開き、10.23.0.0/16 を探します。両方を Partner に接続すると Application に Restricted tenant へのルートは追加されますか？「場所を表示」が各操作を順に案内します。'),
        l('Partner has a direct peering to each VNet, but Application has no peering route for Restricted tenant 10.23.0.0/16. Ordinary VNet peering is not transitive: Partner does not relay routes or traffic between its peers. Application–Partner and Partner–Restricted tenant work independently; Application–Restricted tenant still has no working path. Operations remains reachable.',
          'Partner は各 VNet と直接ピアリングされていますが、Application に Restricted tenant の 10.23.0.0/16 へのピアリング ルートはありません。通常の VNet ピアリングは推移的ではなく、Partner はピア間のルートやトラフィックを中継しません。Application–Partner と Partner–Restricted tenant は個別に接続できますが、Application–Restricted tenant の経路は依然として利用できません。Operations への接続は維持されています。'),
        inspect('app', 'app-work', '10.23.0.0/16', curriculumV2Requirements[id]),
        [g('peering.command', { vnetAId: 'app', vnetBId: 'partner' }, 'Create Application–Partner peering.', 'Application–Partner のピアリングを作成します。'),
          g('peering.command', { vnetAId: 'partner', vnetBId: 'tenant' }, 'Create Partner–Restricted tenant peering.', 'Partner–Restricted tenant のピアリングを作成します。'),
          routes('app', 'app-work', '10.23.0.0/16')], 2),
      t('checkpoint', 15, l('Explain peering scope', 'ピアリングの範囲を説明'),
        l('Use Application’s effective routes after the two peerings you created. Decide whether this chain gives Application a path to Restricted tenant, and explain the route evidence.', '作成した 2 つのピアリング後の Application の実効ルートを使い、この連鎖で Restricted tenant への経路が得られるか判断し、ルートの証拠を説明してください。'),
        l('Each whole-VNet peering connects its two address spaces, not every VNet connected to either peer. The missing 10.23.0.0/16 peering route in Application demonstrates that chaining ordinary peerings does not provide transit.', 'VNet 全体のピアリングはその両端のアドレス空間を接続し、ピアに接続したすべての VNet を接続するものではありません。Application に 10.23.0.0/16 のピアリング ルートがないことから、通常ピアリングの連鎖では転送が提供されないと分かります。'),
        quiz(l('Does the peering chain you built make Restricted tenant reachable from Application?', '作成したピアリングの連鎖で Application から Restricted tenant に到達できますか？'),
          l('No; each peering connects its own pair, and Partner does not relay their routes.', 'いいえ。各ピアリングはその両端を接続し、Partner は両者のルートを中継しません。'),
          l('Yes; each peering advertises its other peers, and Partner relays their routes.', 'はい。各ピアリングは他のピアも広告し、Partner は両者のルートを中継します。'),
          l('Your Application table has no 10.23.0.0/16 peering route. Transit needs a separate supported design.', 'Application のテーブルに 10.23.0.0/16 のピアリング ルートはありません。転送には別の対応した設計が必要です。'),
          l('Both direct peerings work, but Partner does not provide transit between them. The Application table has no Restricted tenant peering route.', '両方の直接ピアリングは正常でも、Partner はその間の転送を提供しません。Application のテーブルに Restricted tenant へのピアリング ルートはありません。'), { id: 'choice-a', position: 'first' })),
    ])
}

{
  const id = 'v2-firewall', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C02 · Connected is not inspected', 'C02 · 接続と検査は別'),
    l('Use Azure Firewall, deliberate UDRs and independent reply reasoning.', 'Azure Firewall、意図的な UDR、独立した応答経路の検討を適用します。'),
    l('Retain Application, Partner, Operations and the direct Application–Partner peering. This snapshot adds Customer-owned inspection hub with Azure Firewall in AzureFirewallSubnet and a Partner–hub peering; Application–hub is missing. A user-defined route (UDR) steers matching destinations to a chosen next hop from a subnet’s associated route table. Azure chooses the most-specific prefix before comparing route sources; an equal-prefix UDR takes priority over peering. The named UDR rows are prepared but disabled. This comparison is not a recommended migration from C01.',
      'Application、Partner、Operations と Application–Partner の直接ピアリングを維持します。今回の構成では Customer-owned inspection hub に AzureFirewallSubnet の Azure Firewall と Partner–hub ピアリングを追加し、Application–hub は未接続です。ユーザー定義ルート（UDR）は、サブネットに関連付けたテーブルから一致する宛先を指定の次ホップへ誘導します。Azure はルート ソースより先に最も具体的なプレフィックスを選び、同一プレフィックスでは UDR がピアリングより優先されます。指定 UDR は準備済みですが無効です。C01 からの推奨移行を示す比較ではありません。'), [
      t('role', 15, l('Identify managed inspection', 'マネージド検査を識別'),
        l('Find Azure Firewall 10.20.1.4 in AzureFirewallSubnet. Distinguish its routing role from a rule allowing HTTPS.', 'AzureFirewallSubnet の Azure Firewall 10.20.1.4 を確認し、ルーティング上の役割と HTTPS の許可規則を区別してください。'),
        l('Azure Firewall is a managed appliance here, not a vendor VM whose NIC forwarding or instance HA you must configure. Steering toward it does not demonstrate security-rule permission.', 'ここでは Azure Firewall はマネージド アプライアンスです。NIC 転送やインスタンス HA を設定するベンダー VM ではありません。そこへ誘導してもセキュリティ規則の許可は証明されません。'),
        quiz(l('What does a UDR toward Azure Firewall establish?', 'Azure Firewall への UDR が確立するものは？'),
          l('A next hop to the firewall; a network rule must separately permit HTTPS.', 'ファイアウォールへの次ホップです。HTTPS の許可には別途ネットワーク規則が必要です。'),
          l('A next hop to the firewall plus a network rule that implicitly permits HTTPS.', 'ファイアウォールへの次ホップと、HTTPS を暗黙に許可するネットワーク規則です。'),
          l('Routing and security authorization are different checks.', 'ルーティングとセキュリティの許可は別々に確認します。'), l('A next hop is not an allow rule.', '次ホップは許可規則ではありません。'), { id: 'choice-b', position: 'second' }), [network('hub')]),
      t('connect-hub', 25, l('Connect Application to the hub', 'Application をハブへ接続'),
        l('Create the Application–hub whole-VNet peering. Leave the Application–Partner peering in place for the next comparison.', 'Application–hub の VNet 全体のピアリングを作成してください。次の比較のため Application–Partner のピアリングは残します。'),
        l('The firewall is now reachable as a next hop, but the original direct service route remains. Infrastructure reachability is not inspection policy.', 'ファイアウォールへ次ホップとして到達できますが、元の直接サービス ルートは残っています。インフラへの到達性だけでは検査ポリシーにはなりません。'),
        { kind: 'vnet.peered', params: { vnetAId: 'app', vnetBId: 'hub', requirements: invariantRequirements(id) } },
        [g('peering.command', { vnetAId: 'app', vnetBId: 'hub' }, 'Create Application–hub peering.', 'Application–hub のピアリングを作成します。')]),
      t('summary', 25, l('Enable a broad inspection policy', '広い検査ポリシーを有効化'),
        l('Enable prepared private-summary in app inspection policy: 10.0.0.0/8 toward Azure Firewall 10.20.1.4. Do not remove direct peering.', 'app inspection policy の private-summary を有効にします。10.0.0.0/8 を Azure Firewall 10.20.1.4 へ向け、直接ピアリングは削除しないでください。'),
        l('The broad UDR is configured. It is not yet proof that the more-specific Partner destination uses the firewall.', '広い UDR を設定しました。ただし、より具体的な Partner の宛先がファイアウォールを通る証明にはなっていません。'),
        configured(id, enablePolicy('app-policy', 'private-summary', '10.0.0.0/8')), [policy('app', 'app-policy', 'private-summary')]),
      t('predict-prefix', 15, l('Compare competing prefixes', '競合するプレフィックスを比較'),
        l('Inspect the Workload subnet’s routes in VNet Application after enabling the /8 UDR. Compare that UDR with the /16 Partner peering route and decide which matches 10.22.1.10 most specifically.', '/8 UDR を有効にした後の VNet Application の Workload サブネットのルートを確認します。その UDR と Partner ピアリングの /16 を比較し、10.22.1.10 に最も具体的に一致するものを判断してください。'),
        l('Azure first compares prefix length. Partner /16 beats private-summary /8 even though the latter is a UDR. Equal-prefix route source precedence is a separate comparison.', 'Azure はまずプレフィックス長を比較します。Partner /16 は UDR の private-summary /8 より優先されます。同じプレフィックスでのルート ソース優先順位は別の比較です。'),
        quiz(l('Which path wins for 10.22.1.10?', '10.22.1.10 ではどちらが選択されますか？'),
          l('The /16 peering route, because prefix length is compared before route source.', 'ルート ソースより先にプレフィックス長を比較するため、/16 のピアリング ルートです。'),
          l('The /8 user route, because route source is compared before prefix length.', 'プレフィックス長より先にルート ソースを比較するため、/8 のユーザー ルートです。'),
          l('Longest-prefix matching happens before route-source precedence.', '最長プレフィックス一致はルート ソース優先順位より先です。'), l('UDR priority applies after matching prefix specificity.', 'UDR の優先順位はプレフィックスの具体性を比較した後に適用されます。'), { id: 'choice-a', position: 'second' }),
        [routes('app', 'app-work', '10.22.0.0/16')]),
      t('forward', 25, l('Steer the original request', '元の要求を誘導'),
        l('Enable partner-inspection in app inspection policy for the original Partner /16 toward 10.20.1.4. Do not edit Partner return yet.', '元の Partner /16 を 10.20.1.4 に向ける app inspection policy の partner-inspection を有効にしてください。Partner の応答はまだ編集しません。'),
        l('The destination-specific request policy now overrides equal-prefix peering selection. Partner still chooses its reply independently; one repaired direction is not the completed inspection objective.', '宛先固有の要求ポリシーが同じプレフィックスのピアリングより優先されます。Partner は応答を独立して選択するため、一方向の修復だけでは検査目標は完了しません。'),
        configured(id, enablePolicy('app-policy', 'partner-inspection', '10.22.0.0/16')), [policy('app', 'app-policy', 'partner-inspection')]),
      t('return', 25, l('Repair independent reply steering', '独立した応答誘導を修復'),
        l('Enable application-return in partner inspection policy for Application /16 toward 10.20.1.4. Verify the original service pair through Azure Firewall on both legs and retain Operations and tenant boundaries.', 'partner inspection policy の application-return を有効にし、Application /16 を 10.20.1.4 へ向けてください。元の通信が両方向で Azure Firewall を通り、Operations とテナント境界を維持することを検証します。'),
        l('Both modeled routing traces now include Azure Firewall. The reply needed its own policy; the request UDR did not install that return policy automatically.', 'モデル化された両ルーティング トレースに Azure Firewall が含まれます。応答には独自のポリシーが必要で、要求 UDR がその応答ポリシーを自動導入するわけではありません。'),
        configured(id, enablePolicy('partner-policy', 'application-return', '10.21.0.0/16'), curriculumV2Requirements[id]), [policy('partner', 'partner-policy', 'application-return')]),
      t('checkpoint', 15, l('State the evidence boundary', '証拠の範囲を説明'),
        l('State what the paired firewall routing evidence supports before handing this comparison to a security reviewer.', 'セキュリティ レビューへ渡す前に、両方向のファイアウォール経路の証拠が裏付ける範囲を述べてください。'),
        l('The managed inspection waypoint is on both modeled routing legs. Actual firewall/NSG permissions, NAT, stateful session handling and application delivery still need independent validation.', 'マネージド検査の経由点がモデル化された両経路に存在します。実際のファイアウォール/NSG 許可、NAT、ステートフル セッション処理、アプリケーション配信には独立した検証が必要です。'),
        quiz(l('What can this result establish?', 'この結果で確認できるものは？'), l('Request and reply traverse Azure Firewall; their rule permissions remain unchecked.', '要求と応答は Azure Firewall を通りますが、規則による許可はまだ確認していません。'),
          l('Request and reply traverse Azure Firewall; their rule permissions are therefore verified.', '要求と応答は Azure Firewall を通るため、規則による許可も確認されています。'),
          l('This is routing evidence, not packet delivery through enforced policy.', 'これはルーティングの証拠であり、適用されたポリシーを通じた実配信の証明ではありません。'), l('The routing model does not execute firewall security policy.', 'ルーティング モデルはファイアウォールのセキュリティ ポリシーを実行しません。'), { id: 'choice-b', position: 'first' })),
    ])
}

{
  const id = 'v2-wan', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C03 · Managed spoke transit', 'C03 · マネージド スポーク転送'),
    l('Attach VNets to a Standard Virtual WAN managed hub and inspect Default transit.', 'Standard Virtual WAN のマネージド ハブへ VNet を接続し、Default 転送を確認します。'),
    l('Use a separate Standard Virtual WAN managed-hub comparison with the familiar services, Operations and detached tenant. Partner is connected; Application and Local shared service are prepared but disabled. Default is the built-in hub route table: these connections use it for hub lookups and publish their VNet prefixes into it. No classic peerings, customer NVA, BGP or routing intent are present. “Basic” here means introductory routing, not the Basic Virtual WAN product tier.',
      '元のサービス、Operations、未接続テナントを維持し、別の Standard Virtual WAN マネージド ハブを比較します。Partner は接続済みで、Application と Local shared service は準備済みですが無効です。Default は組み込みのハブ ルート テーブルで、これらの接続はハブでのルックアップに使い、VNet プレフィックスを公開します。通常ピアリング、顧客 NVA、BGP、ルーティング意図はありません。ここでの「基礎」は入門を意味し、Basic Virtual WAN 製品階層ではありません。'), [
      t('attach-application', 25, l('Attach Application', 'Application を接続'),
        l('Enable Application’s prepared VNet connection to Managed regional virtual hub. Keep association and propagation on Default. Virtual WAN is the service; Managed regional virtual hub is its managed regional router; the VNet connection joins Application to it.', 'Application の準備済み Managed regional virtual hub 接続を有効にします。関連付けと伝達は Default のままにしてください。Virtual WAN はサービス、Managed regional virtual hub はマネージド リージョナル ルーター、VNet 接続は Application を結ぶ接続です。'),
        l('Application now uses managed hub connectivity to Partner without a direct spoke peering or customer transit VM.', 'Application は直接スポーク ピアリングや顧客転送 VM なしで、マネージド ハブ経由で Partner に接続します。'),
        configured(id, wanAttachment('app'), curriculumV2Requirements[id].slice(0, 4)), [network('app')]),
      t('inspect-default', 10, l('Inspect Default transit', 'Default 転送を確認'),
        l('Open the Default route table in Managed regional virtual hub for Partner 10.22.0.0/16. Identify the VNet connection that supplies this destination.', 'Managed regional virtual hub の Default ルート テーブルで Partner 10.22.0.0/16 を確認し、この宛先を提供する VNet 接続を識別してください。'),
        l('This observation is the hub’s Default lookup context. The hub routes between VNet connections; workload subnets have their own effective-route lookups. One layer’s row is not an inspection of the other layer.', '今回確認したのはハブの Default ルックアップです。ハブは VNet 接続間をルーティングし、ワークロード サブネットは独自の実効ルートを持ちます。一方の行の確認で、もう一方の階層を確認したことにはなりません。'),
        control({ hubId: 'wan-hub', tableId: 'defaultRouteTable', prefix: '10.22.0.0/16' }), [hubRoutes('wan-hub', 'defaultRouteTable', '10.22.0.0/16')]),
      t('transit', 15, l('Explain the managed alternative', 'マネージドの代替を説明'),
        l('Compare this attached-spoke conversation with the nontransitive ordinary peerings from C01.', 'この接続済みスポーク間の通信と、C01 の推移的でない通常ピアリングを比較してください。'),
        l('The Standard virtual hub provides managed spoke transit. A VNet connection is not a new direct peering between every pair of spokes.', 'Standard 仮想ハブがマネージド スポーク転送を提供します。VNet 接続はすべてのスポーク間に直接ピアリングを作成するものではありません。'),
        quiz(l('Why can attached spokes communicate here?', '接続済みスポークが通信できる理由は？'),
          l('The hub routes between VNet connections; direct spoke peerings are not required.', 'ハブが VNet 接続間をルーティングするため、直接スポーク ピアリングは不要です。'),
          l('The hub installs direct VNet peerings between spokes; hub transit is not required.', 'ハブがスポーク間に直接 VNet ピアリングを作成するため、ハブ転送は不要です。'),
          l('The hub router supplies the missing transit function.', 'ハブ ルーターが必要な転送機能を提供します。'), l('Ordinary peering behavior has not changed.', '通常ピアリングの動作は変わっていません。'), { id: 'choice-a', position: 'second' })),
      t('checkpoint', 25, l('Add a third spoke without peerings', 'ピアリングなしで 3 つ目を追加'),
        l('Enable Local shared service’s original Managed regional virtual hub connection on Default. Verify Application–Partner, Application–Local shared service, Operations and both tenant initiation boundaries without direct spoke peerings.', 'Local shared service の元の Managed regional virtual hub 接続を Default で有効にしてください。直接スポーク ピアリングを追加せず、Application–Partner、Application–Local shared service、Operations、両テナント開始境界を検証します。'),
        l('A third original spoke now participates in managed transit through its connection. This checkpoint verifies the declared conversations; it does not certify every possible spoke or security policy.', '3 つ目の元のスポークが接続経由でマネージド転送に参加します。このチェックポイントは宣言された通信を検証し、あらゆるスポークやセキュリティ ポリシーを認定するものではありません。'),
        configured(id, { ...wanAttachment('shared'), vnetPeerings: [] }, curriculumV2Requirements[id]), [network('shared')]),
    ])
}

{
  const id = 'v2-secured-wan', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C04 · Managed private inspection', 'C04 · マネージド プライベート検査'),
    l('Apply private routing intent through hub Azure Firewall using Default connections.', 'Default 接続でハブ Azure Firewall のプライベート ルーティング意図を適用します。'),
    l('Continue the managed pattern in a prepared snapshot: Application and Partner attached, Local shared service disabled, tenant detached, hub Azure Firewall ready. All connections use Default. Private intent is off; no custom tables, hybrid gateways, NVA or Internet policy are introduced.',
      '準備済みスナップショットでマネージド構成を継続します。Application と Partner は接続済み、Local shared service は無効、テナントは未接続でハブ Azure Firewall は準備済みです。すべて Default を使用します。プライベート意図は無効で、カスタム テーブル、ハイブリッド ゲートウェイ、NVA、インターネット ポリシーは導入しません。'), [
      t('placement', 15, l('Compare Firewall placement', 'Firewall の配置を比較'),
        l('Identify hub Azure Firewall and compare it with C02’s AzureFirewallSubnet deployment.', 'hub Azure Firewall を識別し、C02 の AzureFirewallSubnet 配置と比較してください。'),
        l('Both are Azure Firewall, but this one belongs to the managed virtual hub. Private routing intent manages hub steering rather than reproducing C02’s per-workload policies.', 'どちらも Azure Firewall ですが、今回はマネージド仮想ハブに属します。プライベート ルーティング意図がハブ誘導を管理し、C02 のワークロードごとのポリシーを再作成する必要はありません。'),
        quiz(l('How does firewall steering differ between C02 and this managed hub?', 'C02 と今回のマネージド ハブでは、ファイアウォールへの誘導はどう異なりますか？'), l('C02 uses workload UDRs; this managed-hub deployment uses a hub routing policy.', 'C02 はワークロード UDR を使い、今回のマネージド ハブはハブ ルーティング ポリシーを使います。'),
          l('Both deployments use workload UDRs; the hub policy does not steer private traffic.', '両方ともワークロード UDR を使い、ハブ ポリシーはプライベート トラフィックを誘導しません。'),
          l('C02 steers at the workload subnet; this deployment steers with the managed hub’s private policy.', 'C02 はワークロード サブネットで誘導し、今回はマネージド ハブのプライベート ポリシーで誘導します。'), l('The hub private policy supplies steering without copying C02’s workload UDRs into this deployment.', 'ハブのプライベート ポリシーが誘導するため、C02 のワークロード UDR を今回の構成に複製する必要はありません。'), { id: 'choice-b', position: 'first' }),
        [g('hub.configure', { hubId: 'wan-hub' }, 'Find the prepared hub Azure Firewall.', '準備済みのハブ Azure Firewall を確認します。')]),
      t('private-intent', 25, l('Enable private routing intent', 'プライベート ルーティング意図を有効化'),
        l('Enable Managed regional virtual hub’s private routing intent through hub Azure Firewall. Keep Internet intent off. The policy manages Default association and None propagation; do not override those connection settings.', 'hub Azure Firewall を使用する Managed regional virtual hub のプライベート ルーティング意図を有効にし、インターネット意図は無効のままにします。ポリシーが関連付けを Default、伝達を None に管理します。接続設定を上書きしないでください。'),
        l('The original private communication now traverses the managed hub firewall in both directions. Managed None propagation uses the security appliance routing domain; it is not manual connection isolation.', '元のプライベート通信が両方向でマネージド ハブ ファイアウォールを通ります。管理された None 伝達はセキュリティ アプライアンスのルーティング ドメインを使用し、接続の手動分離ではありません。'),
        configured(id, {
          vwanHubs: [{ id: 'wan-hub', firewall: { id: 'hub-firewall' }, routingIntent: { private: true, internet: false } }],
          vnets: ['app', 'partner'].flatMap((vnetId) => wanAttachment(vnetId, 'noneRouteTable').vnets),
        }, curriculumV2Requirements[id].slice(0, 4)),
        [g('hub.configure', { hubId: 'wan-hub' }, 'Enable private routing intent only.', 'プライベート ルーティング意図のみを有効にします。')]),
      t('verify-original', 10, l('Inspect the original private workload route', '元のプライベート ワークロード ルートを確認'),
        l('Open effective routes for subnet Workload in VNet Application. Identify the route covering Partner 10.22.1.10 and its next hop. Automatic routing checks also verify both original directions, Operations and tenant boundaries.', 'VNet Application の Workload サブネットの実効ルートを開き、Partner 10.22.1.10 を対象にするルートと次ホップを確認してください。自動ルーティング確認では元の両方向、Operations、テナント境界も検証します。'),
        l('Your workload inspection is paired with automatic request and reply routing checks through the hub firewall. The original private paths and retained boundaries qualify; security policy, NAT and live sessions are separate assessments.', 'ワークロードの確認と、ハブ ファイアウォールを通る要求・応答の自動ルーティング確認を合わせています。元のプライベート経路と維持した境界は合格ですが、セキュリティ ポリシー、NAT、実セッションは別の評価です。'),
        inspect('app', 'app-work', '10.22.0.0/16', curriculumV2Requirements[id].slice(0, 4)), [routes('app', 'app-work', '10.22.0.0/16')]),
      t('attach-service', 25, l('Attach the new private spoke', '新しいプライベート スポークを接続'),
        l('Enable Local shared service’s original connection, retaining policy-managed Default association and None propagation. Do not add a workload firewall UDR or direct spoke peering.', 'Local shared service の元の接続を有効にし、ポリシー管理の関連付け Default と伝達 None を維持します。ワークロード ファイアウォール UDR や直接スポーク ピアリングは追加しないでください。'),
        l('The new private spoke inherits managed private steering through the hub policy. No per-spoke UDR was needed for this Default-table pattern.', '新しいプライベート スポークがハブ ポリシーによるマネージド誘導を利用します。この Default 構成にはスポークごとの UDR は不要でした。'),
        configured(id, { ...wanAttachment('shared', 'noneRouteTable'), udrTables: [], vnetPeerings: [] }, curriculumV2Requirements[id]), [network('shared')]),
      t('checkpoint', 15, l('Explain policy scope', 'ポリシーの範囲を説明'),
        l('Explain why the newly attached Local shared service communication is privately inspected and what this routing result does not say about Internet traffic.', '新たに接続した Local shared service との通信が検査される理由と、この結果がインターネット トラフィックについて説明しない点を述べてください。'),
        l('Private routing intent governs the declared private Default connections, including Local shared service. Internet policy is still off. Firewall/NSG permission checks are separate from routing evidence.', 'プライベート ルーティング意図は Local shared service を含む宣言済みのプライベート Default 接続に適用されます。インターネット ポリシーは無効のままで、ファイアウォール/NSG の許可はルーティング証拠とは別に確認します。'),
        quiz(l('What does the private policy imply for the new Local shared service connection?', 'プライベート ポリシーは、新しい Local shared service 接続のどの通信に適用されますか？'),
          l('Local shared service’s private paths use the firewall; Internet steering needs a separate policy.', 'Local shared service のプライベート経路はファイアウォールを使い、インターネット誘導には別のポリシーが必要です。'),
          l('Local shared service’s private paths use the firewall; Internet steering uses the same private policy.', 'Local shared service のプライベート経路はファイアウォールを使い、インターネット誘導も同じプライベート ポリシーを使います。'),
          l('Private and Internet routing intent are separate. Only the private policy is enabled here.', 'プライベートとインターネットのルーティング意図は別です。ここではプライベート ポリシーだけが有効です。'), l('Enabling the private policy does not enable Internet steering; Internet intent remains off.', 'プライベート ポリシーの有効化でインターネット誘導が有効になるわけではなく、インターネット意図は無効のままです。'), { id: 'choice-a', position: 'second' })),
    ])
}

hybridChapters()

{
  const id = 'v2-nva-ha', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  const packetGuide = g('packet-probe.open', { vnetId: 'application' }, 'Probe Application client 10.81.1.10 → Remote server 10.82.1.10 using TCP source port 49152 and destination port 443.', 'Application client 10.81.1.10 → Remote server 10.82.1.10 の TCP プローブを送信元ポート 49152、宛先ポート 443 で実行します。')
  const steering = {
    udrTables: [
      { id: 'application-steering', routes: [{ id: 'application-path', prefix: '10.82.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.80.3.10', enabled: true }] },
      { id: 'remote-steering', routes: [{ id: 'remote-path', prefix: '10.81.0.0/16', nextHopType: 'VirtualAppliance', nextHopIp: '10.80.3.10', enabled: true }] },
    ],
    inventory: { loadBalancers: [{ id: 'transit-lb',
      frontends: [{ id: 'transit-vip', privateIp: '10.80.3.10' }],
      pools: [{ id: 'transit-pool', members: [
        { workloadId: 'primary-vm', nicId: 'primary-nic', ipConfigurationId: 'primary-ip' },
        { workloadId: 'standby-vm', nicId: 'standby-nic', ipConfigurationId: 'standby-ip' },
      ] }],
      rules: [{ id: 'transit-rule', frontendId: 'transit-vip', poolId: 'transit-pool', probeId: 'transit-probe',
        haPorts: true, floatingIp: true, protocol: 'all', frontendPort: 0, backendPort: 0, haPortsForwarding: 'preserve-tuple' }],
    }] },
  }
  const health = { inventory: { loadBalancers: [{ ...steering.inventory.loadBalancers[0], probes: [{ id: 'transit-probe', health: [
    { target: { workloadId: 'primary-vm', nicId: 'primary-nic', ipConfigurationId: 'primary-ip' }, status: 'unhealthy' },
    { target: { workloadId: 'standby-vm', nicId: 'standby-nic', ipConfigurationId: 'standby-ip' }, status: 'healthy' },
  ] }] }] } }
  chapter(id, l('C10 · Vendor inspection makes HA yours', 'C10 · ベンダー検査の HA 責任'),
    l('Repair symmetric HA-ports steering and test the same packet in two declared health states.', '対称 HA ポート誘導を修復し、同じパケットを 2 つの宣言ヘルス状態で検証します。'),
    l('A fictional vendor-only stateful inspection requirement motivates this separate NVA comparison, not an Azure Firewall upgrade or a VWAN prerequisite. The vendor requires request and reply to use the same eligible NVA. Application client 10.81.1.10 and Remote server 10.82.1.10 are the original endpoints; existing ER/Warehouse connectivity is context. Two forwarding-enabled NVAs and an internal Standard load balancer with a floating HA-ports rule are prepared. Its shared VIP (virtual IP) is 10.80.3.10; backend health determines eligibility. The first snapshot has only Preferred NVA eligible; inspect both directions before changing steering or health. Operations works and tenant is detached. Ungraded comparison: Azure Route Server exchanges BGP routes but does not forward traffic or replicate vendor sessions.',
      '架空のベンダー専用ステートフル検査要件のため、Azure Firewall のアップグレードや VWAN の前提ではない別の NVA 比較を行います。ベンダーは要求と応答で同じ適格 NVA を使うことを求めます。元のエンドポイントは Application client 10.81.1.10 と Remote server 10.82.1.10 で、既存 ER/Warehouse 接続は背景です。転送有効の 2 NVA と、浮動 HA ポート規則を持つ内部 Standard ロード バランサーは準備済みです。共有 VIP（仮想 IP）は 10.80.3.10 で、バックエンド ヘルスが適格性を決めます。最初は Preferred NVA だけが適格です。誘導やヘルスの変更前に両方向を確認してください。Operations は正常、テナントは未接続です。無採点の比較として、Azure Route Server は BGP ルートを交換しますが、トラフィック転送やベンダー セッション複製は行いません。'), [
      t('responsibilities', 15, l('Identify customer HA responsibilities', '顧客 HA 責任を識別'),
        l('Compare the prepared vendor NVA pair with C02/C04 Azure Firewall. Identify which responsibilities now belong to the customer.', '準備済みベンダー NVA ペアと C02/C04 の Azure Firewall を比較し、新たな顧客責任を識別してください。'),
        l('NVA instances, health eligibility, forwarding, steering and vendor state compatibility need customer design. Routine NIC forwarding and peering permissions are already prepared; two VMs alone do not create stateful resilience.', 'NVA インスタンス、ヘルス適格性、転送、誘導、ベンダー状態互換性は顧客設計が必要です。通常 NIC 転送とピアリング許可は準備済みで、2 VM だけではステートフル回復性は成立しません。'),
        quiz(l('What changes with customer-managed NVAs?', '顧客管理 NVA で変わるものは？'),
          l('The customer designs health and steering; NVA session continuity depends on vendor capabilities.', '顧客がヘルスと誘導を設計し、NVA のセッション継続はベンダー機能に依存します。'),
          l('The load balancer designs health and session continuity; the customer only configures NVA addressing.', 'ロード バランサーがヘルスとセッション継続を設計し、顧客は NVA のアドレスだけを設定します。'),
          l('The customer configures health and steering; session continuity needs appropriate vendor support.', '顧客がヘルスと誘導を設定し、セッション継続には適切なベンダー対応が必要です。'), l('Backend selection does not design customer health checks or replicate NVA session state.', 'バックエンド選択で顧客のヘルス チェックが設計されたり、NVA セッション状態が複製されたりするわけではありません。'), { id: 'choice-b', position: 'second' }), [network('hub')]),
      t('inspect-packet', 10, l('Inspect the original selected backend', '元の選択バックエンドを確認'),
        l('Run a fresh native TCP probe from Application client 10.81.1.10 to Remote server 10.82.1.10, source port 49152 and destination port 443. Inspect the selected request backend without changing health or return policy.', 'Application client 10.81.1.10 から Remote server 10.82.1.10 へ、送信元ポート 49152、宛先ポート 443 の TCP プローブを新たに実行してください。ヘルスや応答ポリシーを変えず、要求で選ばれたバックエンドを確認します。'),
        l('You inspected the exact original tuple. The declared health selects Preferred NVA for the request; this observation is not yet a symmetric HA qualification.', '正確な元のタプルを確認しました。宣言ヘルスが要求に Preferred NVA を選択しますが、対称 HA の合格ではありません。'),
        { kind: 'packet.inspected', params: { vnetId: 'application', packet: curriculumV2Packet, requirements: invariantRequirements(id) } }, [packetGuide]),
      t('predict-reply', 15, l('Predict the independent reply backend', '独立した応答バックエンドを予測'),
        l('Read the return route for 10.81.0.0/16 in subnet Remote workload in VNet Partner and compare it with the completed probe’s reply trace. Identify the unrepaired reply next hop.', 'VNet Partner の Remote workload サブネットで 10.81.0.0/16 の応答ルートを読み、完了したプローブの応答トレースと比較して、未修復の応答次ホップを識別してください。'),
        l('The original reply UDR targets Standby NVA 10.80.2.4 directly. Selecting Preferred NVA for the request does not rewrite Partner’s independent route.', '元の応答 UDR は Standby NVA 10.80.2.4 を直接指定します。要求で Preferred NVA を選択しても、Partner の独立ルートを書き換えることはありません。'),
        quiz(l('Where does the unrepaired reply steer?', '未修復の応答はどこへ向かいますか？'),
          l('Standby NVA 10.80.2.4, selected independently by Partner’s return UDR.', 'Partner の応答 UDR が独立して選ぶ Standby NVA 10.80.2.4 です。'),
          l('Preferred NVA 10.80.1.4, reused from the request’s load-balancer selection.', '要求側のロード バランサー選択を引き継ぐ Preferred NVA 10.80.1.4 です。'),
          l('Reply lookup uses its own UDR.', '応答ルックアップは独自 UDR を使います。'), l('A selected forward backend does not install the reverse route.', '要求バックエンドの選択は逆ルートを作成しません。'), { id: 'choice-a', position: 'second' }),
        [routes('remote', 'remote-work', '10.81.0.0/16')]),
      t('diagnose', 35, l('Diagnose asymmetric steering', '非対称誘導を診断'),
        l('Explain the routing mechanism behind the two different NVA selections. Keep the original endpoint addresses, health state and working Operations path unchanged.', '要求と応答で異なる NVA が選ばれるルーティング方式を説明してください。元のエンドポイント アドレス、ヘルス状態、正常な Operations 経路は変えないでください。'),
        l('The asymmetric direct reply pin bypasses the HA-ports selection mechanism. More instances or a forward route alone cannot repair that boundary.', '非対称の直接応答固定が HA ポート選択方式を迂回しています。インスタンス増加や要求ルートだけではこの境界を修復できません。'),
        quiz(l('Which routing mechanism explains the two different NVA selections?', '要求と応答で異なる NVA が選ばれるのは、どのルーティング方式によるものですか？'),
          l('Partner’s reply UDR names a backend IP, bypassing shared frontend selection.', 'Partner の応答 UDR がバックエンド IP を指定し、共有フロントエンドの選択を迂回しています。'),
          l('Partner’s reply UDR must name a backend IP because the HA-ports frontend only handles requests.', 'HA ポート フロントエンドは要求だけを扱うため、Partner の応答 UDR はバックエンド IP を指定する必要があります。'),
          l('The return UDR bypasses the shared frontend and selects a backend independently.', '応答 UDR が共有フロントエンドを迂回し、独立してバックエンドを選びます。'), l('The prepared HA-ports mechanism supports both directions. A direct backend next hop bypasses that selection.', '準備済み HA ポート方式は両方向に対応します。バックエンドを直接次ホップにすると、その選択を迂回します。'), { id: 'choice-b', position: 'first' })),
      t('repair-return', 25, l('Repair reply through the shared frontend', '共有フロントエンド経由の応答を修復'),
        l('Set Application return in Independent remote return to the existing Transit VIP 10.80.3.10, not Preferred NVA’s IP. Keep Application transit, LB identities and Preferred-only health unchanged. Verify the exact packet, Preferred NVA on both legs, Operations and tenant boundaries.', 'Independent remote return の Application return を Preferred NVA の IP ではなく既存 Transit VIP 10.80.3.10 に設定してください。Application transit、LB ID、Preferred NVA のみのヘルスを維持し、正確なパケット、両方向 Preferred NVA、Operations、テナント境界を検証します。'),
        l('Both original routing legs now use Preferred NVA through the same preserved-tuple HA-ports mechanism. This proves the first declared configuration, not a live probe transition or replicated vendor session state.', '元の両経路が同じタプル維持 HA ポート方式で Preferred NVA を使用します。これは最初の宣言構成の証明であり、実プローブ移行やベンダー セッション状態複製ではありません。'),
        configured(id, { ...steering, inventory: { loadBalancers: [{ ...steering.inventory.loadBalancers[0], probes: [{ id: 'transit-probe', health: [
          { target: { workloadId: 'primary-vm', nicId: 'primary-nic', ipConfigurationId: 'primary-ip' }, status: 'healthy' },
          { target: { workloadId: 'standby-vm', nicId: 'standby-nic', ipConfigurationId: 'standby-ip' }, status: 'unhealthy' },
        ] }] }] } }, curriculumV2HaRequirements('primary')),
        [g('route-table.configure', { vnetId: 'remote', subnetId: 'remote-work', routeTableId: 'remote-steering', routeId: 'remote-path' },
          'Edit the independent Partner return policy.', 'Partner の独立した応答ポリシーを編集します。')]),
      t('standby-snapshot', 25, l('Declare the second health snapshot', '2 つ目のヘルス状態を宣言'),
        l('In Transit LB’s Declared transit health controls, mark Preferred NVA unhealthy and Standby NVA healthy. Do not edit either repaired UDR, frontend, pool or HA-ports rule.', 'Transit LB の Declared transit health 設定で Preferred NVA を unhealthy、Standby NVA を healthy にしてください。修復済みの両 UDR、フロントエンド、プール、HA ポート規則は編集しません。'),
        l('The sole eligible original backend is now Standby NVA in a new steady-state declaration. Steering remains the original shared VIP in both directions. This is not a live failover experiment.', '新しい定常状態宣言では元の Standby NVA だけが適格です。両方向の誘導は元の共有 VIP のままです。実フェイルオーバー実験ではありません。'),
        configured(id, { ...steering, ...health }, curriculumV2HaRequirements('standby')),
        [g('load-balancer.configure', { vnetId: 'hub', loadBalancerId: 'transit-lb' }, 'Edit the original Transit LB health-probe declarations.', '元の Transit LB のヘルス プローブ宣言を編集します。')]),
      t('inspect-standby', 10, l('Re-run the unchanged original packet', '変更していない元のパケットを再実行'),
        l('Run a new completed native trace of the same original TCP 49152→443 packet. Verify Standby NVA in both directions using unchanged steering; do not reuse the first state’s trace.', '同じ元の TCP 49152→443 パケットをネイティブで新たにトレースし、完了させてください。変更していない誘導で両方向 Standby NVA を確認し、最初の状態のトレースを再利用しないでください。'),
        l('The same original VM/NIC tuple uses standby on both legs in the second declared state. Primary and standby evidence belong to different steps; they are not contradictory assertions against one current topology.', '同じ元の VM/NIC タプルが 2 つ目の宣言状態で両方向 standby を使用します。主系/待機系証拠は別のステップに属し、同じ現在トポロジに対する矛盾した判定ではありません。'),
        { kind: 'packet.inspected', params: { vnetId: 'application', packet: curriculumV2Packet, requirements: curriculumV2HaRequirements('standby') } }, [packetGuide]),
      t('checkpoint', 15, l('Explain two-state steering, not hard pins', '固定ではなく 2 状態誘導を説明'),
        l('Explain why pinning the reply to Preferred NVA could pass one snapshot but not this two-state objective.', '応答を Preferred NVA に固定すると 1 状態では通っても、この 2 状態目標には合格できない理由を説明してください。'),
        l('The unchanged shared frontend mechanism supports either declared eligible original backend. A primary IP pin fails when only standby is eligible. Native stable-ID selection is not Azure hash behavior; live health probes, convergence, vendor replication and session survival remain untested.', '変更していない共有フロントエンド方式が、どちらの宣言適格バックエンドにも対応します。primary IP 固定は standby だけが適格な状態で失敗します。ネイティブ安定 ID 選択は Azure ハッシュ動作ではなく、実プローブ、収束、ベンダー複製、セッション継続は未検証です。'),
        quiz(l('What makes the repaired mechanism qualify both snapshots?', '修復方式が両スナップショットに合格する理由は？'),
          l('Both directions keep the shared VIP next hop; declared health selects the eligible NVA.', '両方向が共有 VIP を次ホップとして維持し、宣言したヘルスが適格 NVA を選びます。'),
          l('The reply keeps the preferred backend IP next hop; declared health moves that IP to standby.', '応答は主系バックエンド IP を次ホップとして維持し、宣言したヘルスがその IP を待機系へ移します。'),
          l('The steering mechanism, not a first-state backend pin, survives this comparison.', '最初の状態の固定ではなく、誘導方式がこの比較に対応します。'), l('Health changes eligibility, not backend IP ownership. Both UDRs still target the unchanged shared VIP.', 'ヘルスは適格性を変えますが、バックエンド IP の所有は変えません。両 UDR は変更していない共有 VIP を指定します。'), { id: 'choice-a', position: 'first' })),
    ])
}

{
  const id = 'v2-segmentation', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  const local = curriculumV2Requirements[id].filter((r) => !['original-regional-service', 'source-regional-route', 'independent-reply-route'].includes(r.id))
  chapter(id, l('C11 · Publish services, not the tenant', 'C11 · テナントでなくサービスを公開'),
    l('Separate lookup association, local propagation and regional label imports.', 'ルックアップ関連付け、ローカル伝達、リージョン間ラベル インポートを区別します。'),
    l('Use a separate two-hub custom-table comparison with routing intent off, independent of C04. Association selects the lookup table for traffic entering from a connection; propagation publishes that connection’s prefixes into other tables or label scopes. West Application uses Workloads; Local shared service uses Local services; Operations works; the tenant uses a separate Restricted tenant table. Local-service and regional-service routes are incomplete in Workloads. East Regional services already has Application’s return prefix. Solve local publication before regional import, preserving the tenant boundary. This is routing isolation, not enforced security policy.',
      'C04 と独立した別の 2 ハブ カスタム テーブル比較を行い、ルーティング意図は無効にします。関連付けは接続から入るトラフィックのルックアップ テーブルを選び、伝達はその接続のプレフィックスを他のテーブルやラベル対象へ公開します。West Application は Workloads、Local shared service は Local services を使い、Operations は正常で、テナントは独立した Restricted tenant テーブルを使います。Workloads のローカル/リージョン サービス ルートは未完成です。East の Regional services には Application の応答プレフィックスが既にあります。テナント境界を維持し、先にローカル公開、次にリージョン インポートを解決します。これはルーティング分離であり、セキュリティ強制ではありません。'), [
      t('inspect-source', 10, l('Inspect the source lookup context', '送信元ルックアップを確認'),
        l('Inspect the Workloads table in West managed hub for Local shared service 10.102.0.0/16. Also note whether Regional shared service 10.103.0.0/16 appears in this same table, for the later regional comparison. Keep Application’s lookup association unchanged.', 'West managed hub の Workloads テーブルで Local shared service 10.102.0.0/16 を確認します。後のリージョン間比較のため、同じテーブルに Regional shared service 10.103.0.0/16 があるかも確認してください。Application のルックアップ関連付けは維持します。'),
        l('You inspected Application’s exact associated lookup table. Local service publication is missing there even though its VNet connection is enabled.', 'Application の正確な関連付けルックアップを確認しました。VNet 接続が有効でも、そこにはローカル サービス公開が不足しています。'),
        control({ hubId: 'west-hub', tableId: 'workloads', prefix: '10.102.0.0/16' }), [hubRoutes('west-hub', 'workloads', '10.102.0.0/16')]),
      t('lookup-export', 15, l('Explain lookup versus publication', 'ルックアップと公開を説明'),
        l('Explain the different effects of a connection’s association and propagation fields before editing the local service.', 'ローカル サービスを編集する前に、接続の関連付けと伝達フィールドの異なる効果を説明してください。'),
        l('Association chooses the table used by traffic entering from a connection. Propagation publishes that connection’s owned prefixes into destination tables or labeled contexts. Changing lookup alone does not publish the missing service.', '関連付けは接続から入るトラフィックが使用するテーブルを選びます。伝達は接続の所有プレフィックスを宛先テーブルやラベル対象へ公開します。ルックアップ変更だけでは不足サービスを公開できません。'),
        quiz(l('Which control publishes the local service without moving tenant lookup?', 'テナントのルックアップを移さずローカル サービスを公開する制御は？'),
          l('Add Workloads to Local shared service propagation; keep its Local services association.', 'Local shared service の伝達先に Workloads を追加し、関連付けは Local services のままにします。'),
          l('Change Local shared service association to Workloads; keep its Local services propagation.', 'Local shared service の関連付けを Workloads に変更し、伝達先は Local services のままにします。'),
          l('Publish selected prefixes rather than widening every lookup.', 'すべてのルックアップを広げるのではなく、選択プレフィックスを公開します。'), l('Changing Local shared service’s lookup association does not publish its prefix into Application’s Workloads table.', 'Local shared service のルックアップ関連付けを変えても、Application の Workloads テーブルへそのプレフィックスが公開されるわけではありません。'), { id: 'choice-b', position: 'second' })),
      t('publish-local', 25, l('Publish only the local shared service', 'ローカル共有サービスだけを公開'),
        l('Add Workloads to Local shared service’s propagation targets while retaining Local services and its association. Leave the Restricted tenant table and connection unchanged. Do not repair the regional label yet.', 'Local shared service の伝達先に Workloads を追加し、Local services と関連付けを維持してください。Restricted tenant のテーブルと接続は変更しません。リージョン ラベルはまだ修復しません。'),
        l('Local service now appears in the source Workloads context and has an independent return via Local services. Operations and both tenant initiation boundaries remain unchanged.', 'ローカル サービスが送信元 Workloads に現れ、Local services 経由の独立応答を持ちます。Operations と両テナント開始境界は変わりません。'),
        configured(id, { vnets: [
          { id: 'west-local', vwanHubAttachment: { hubId: 'west-hub', enabled: true, hubRouting: { associatedTableId: 'local-services', propagatedTableIds: ['local-services', 'workloads'] } } },
          { id: 'west-tenant', vwanHubAttachment: { hubRouting: { associatedTableId: 'tenant-only', propagatedTableIds: ['tenant-only'], labels: ['tenant'] } } },
        ] }, local), [g('hub.configure', { hubId: 'west-hub' }, 'Open the original local service connection propagation controls.', '元のローカル サービス接続の伝達設定を開きます。')]),
      t('inspect-local', 10, l('Inspect the repaired local table', '修復済みローカル テーブルを確認'),
        l('Freshly inspect Workloads table in West managed hub for 10.102.0.0/16. Review the local conversation, Operations, and both tenant initiation directions before progressing regionally.', 'West managed hub の Workloads テーブルで 10.102.0.0/16 を新たに確認し、リージョン間へ進む前にローカル通信、Operations、両テナント開始方向を確認してください。'),
        l('You inspected the repaired local publication in its exact context. This does not claim the regional service fault is already fixed.', '正確なコンテキストで修復済みローカル公開を確認しました。リージョン サービス障害が既に修復されたとは主張しません。'),
        control({ hubId: 'west-hub', tableId: 'workloads', prefix: '10.102.0.0/16' }), [hubRoutes('west-hub', 'workloads', '10.102.0.0/16')]),
      t('inspect-regional-reply', 10, l('Inspect independent regional return', '独立したリージョン応答を確認'),
        l('Inspect the Regional services table in East managed hub for Application 10.101.0.0/16. Compare this reply route with the regional-service absence you noted earlier in the West Workloads table.', 'East managed hub の Regional services テーブルで Application 10.101.0.0/16 を確認し、West の Workloads テーブルで先ほど確認したリージョン サービスの不足と比較してください。'),
        l('You inspected the remote return table. It can already contain Application’s prefix while the source table still lacks the regional service. The two table observations are not interchangeable.', 'リモート応答テーブルを確認しました。そこに Application が存在しても送信元テーブルにはリージョン サービスが不足する場合があります。2 つの観測を代用することはできません。'),
        control({ hubId: 'east-hub', tableId: 'regional-services', prefix: '10.101.0.0/16' }), [hubRoutes('east-hub', 'regional-services', '10.101.0.0/16')]),
      t('regional-label', 25, l('Correct the regional destination label', 'リージョン宛先ラベルを修正'),
        l('Add shared to the labels of the Workloads table in West managed hub, retaining workloads-local. Keep the current associations and Restricted tenant boundary; do not switch to Default or enable routing intent.', 'West managed hub の Workloads テーブルのラベルに shared を追加し、workloads-local は残してください。現在の関連付けと Restricted tenant の境界を維持し、Default への変更やルーティング意図の有効化は行いません。'),
        l('The original regional service and independent reply now have routes in their exact custom contexts. Local service, Operations and both tenant initiation boundaries remain qualified.', '元のリージョン サービスと独立応答が正確なカスタム コンテキストにルートを持ちます。ローカル サービス、Operations、両テナント開始境界も合格のままです。'),
        configured(id, { vwanHubs: [{ id: 'west-hub', routingIntent: { private: false, internet: false }, routeTables: [{ id: 'workloads', labels: ['shared'] }] }],
          vnets: [{ id: 'west-app', vwanHubAttachment: { hubRouting: { associatedTableId: 'workloads' } } },
            { id: 'east-service', vwanHubAttachment: { hubRouting: { associatedTableId: 'regional-services' } } },
            { id: 'west-tenant', vwanHubAttachment: { hubRouting: { associatedTableId: 'tenant-only', propagatedTableIds: ['tenant-only'], labels: ['tenant'] } } }] }, curriculumV2Requirements[id]),
        [g('hub.configure', { hubId: 'west-hub' }, 'Compare the destination workload-table label with the regional publication.', '宛先ワークロード テーブルのラベルとリージョン公開を比較します。')]),
      t('checkpoint', 15, l('Explain scoped publication and isolation', '限定公開と分離を説明'),
        l('Explain why local table IDs and regional labels are different propagation scopes, and why the tenant remains isolated.', 'ローカル テーブル ID とリージョン ラベルが異なる伝達範囲である理由と、テナント分離を維持できる理由を説明してください。'),
        l('Local propagation targets tables in the same hub; matching destination labels enable the regional publication. Tenant prefixes are not published into Workloads and the Restricted tenant table lacks Application’s initiation route. These are routing boundaries, not firewall/NSG enforcement.', 'ローカル伝達は同じハブのテーブルを対象にし、宛先ラベル一致がリージョン公開を可能にします。テナントは Workloads に公開されず、Restricted tenant テーブルに Application 開始ルートがありません。これはルーティング境界であり、ファイアウォール/NSG 強制ではありません。'),
        quiz(l('Which design preserves the declared boundaries?', '宣言した境界を維持する設計は？'),
          l('Keep tenant prefixes out of Workloads, preserving the tenant’s separate lookup and export scope.', 'テナントのプレフィックスを Workloads に公開せず、テナントのルックアップとエクスポート範囲を分離します。'),
          l('Publish tenant prefixes into Workloads; the tenant’s separate lookup scope will block incoming traffic.', 'テナントのプレフィックスを Workloads に公開しても、テナントの独立したルックアップが入る通信を遮断します。'),
          l('Export controls affect real modeled lookup reachability.', 'エクスポート制御はモデル化ルックアップの到達性に影響します。'), l('Tenant association chooses lookup for traffic from the tenant; it does not prevent Application from using a tenant prefix published into Workloads.', 'テナント関連付けはテナントからの通信のルックアップを選びます。Workloads に公開されたテナント プレフィックスを Application が使うことは防ぎません。'), { id: 'choice-a', position: 'second' })),
    ])
}

{
  const id = 'v2-handover', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = [], hints: Localized[] = []) => task(id, s, p, title, instruction, debrief, check, anchors, hints)
  const keep = { vnets: [
    { id: 'west-app', vwanHubAttachment: { hubId: 'west-hub', enabled: true, hubRouting: { associatedTableId: 'workloads', propagatedTableIds: ['workloads', 'local-services', 'defaultRouteTable'] } } },
    { id: 'east-service', vwanHubAttachment: { hubId: 'east-hub', enabled: true, hubRouting: { associatedTableId: 'regional-services', propagatedTableIds: ['regional-services'] } } },
    { id: 'west-tenant', vwanHubAttachment: { hubRouting: { associatedTableId: 'tenant-only', propagatedTableIds: ['tenant-only'], labels: ['tenant'] } } },
  ] }
  const firstRequirements = curriculumV2Requirements[id].filter((r) => !['original-regional-service', 'independent-reply-route'].includes(r.id))
  chapter(id, l('C12 · Take over the hybrid service', 'C12 · ハイブリッド サービスを引き継ぐ'),
    l('Diagnose two independent familiar faults, repair them without widening boundaries, and hand over bounded evidence.', '既知の独立した 2 障害を診断し、境界を広げず修復して限定証拠を引き渡します。'),
    l('An unfamiliar retailer deployment uses previously taught two-hub custom routing with working ExpressRoute warehouse connectivity. New checkout API 10.141.1.10 must converse with order service 10.143.1.10. Inventory 10.142.1.10 and Operations 10.144.1.10 work; tenant 10.145.1.10 must remain isolated in both initiation directions. The two service directions have independent routing faults. Original attachments, tables and gateway paths are prepared. Hybrid branches correctly use Default association; selective workload publication for their return is already prepared. No new technology is introduced. Inspect the original source and reply contexts before deciding on a repair.',
      '未知の小売環境は既習の 2 ハブ カスタム ルーティングと正常な ExpressRoute 倉庫接続を使用します。新 checkout API 10.141.1.10 と order service 10.143.1.10 が通信する必要があります。Inventory 10.142.1.10 と Operations 10.144.1.10 は正常で、tenant 10.145.1.10 は両開始方向で分離を維持します。サービス両方向には独立したルーティング障害があります。元の接続、テーブル、ゲートウェイは準備済みです。ハイブリッド拠点は正しく Default に関連付けられ、応答用の選択ワークロード公開も準備済みです。新技術は導入しません。修復判断前に元の送信元と応答コンテキストを確認してください。'), [
      t('inspect-source', 10, l('Inspect the original source boundary', '元の送信元境界を確認'),
        l('Inspect Workloads table in West managed hub for the original order-service prefix 10.143.0.0/16. Compare with working Inventory and Operations without changing anything.', '変更せず、West managed hub の Workloads テーブルで元の order-service プレフィックス 10.143.0.0/16 を確認し、正常な Inventory と Operations と比較してください。'),
        l('You inspected the original source context and working controls. A service-specific missing route is different from a general hub or gateway outage.', '元の送信元コンテキストと正常な対照を確認しました。サービス固有の不足ルートはハブ/ゲートウェイ全体の障害とは異なります。'),
        control({ hubId: 'west-hub', tableId: 'workloads', prefix: '10.143.0.0/16' }), [hubRoutes('west-hub', 'workloads', '10.143.0.0/16')]),
      t('inspect-reply', 10, l('Inspect the independent reply boundary', '独立した応答境界を確認'),
        l('Inspect Regional services table in East managed hub for the original checkout prefix 10.141.0.0/16. Do not assume the source observation proves the reply.', 'East managed hub の Regional services テーブルで元の checkout プレフィックス 10.141.0.0/16 を確認してください。送信元の観測で応答を証明したと考えないでください。'),
        l('You inspected a second, independent route context. The missing reply publication cannot be inferred solely from the source service lookup.', '2 つ目の独立ルート コンテキストを確認しました。応答公開不足は送信元サービス ルックアップだけから判断できません。'),
        control({ hubId: 'east-hub', tableId: 'regional-services', prefix: '10.141.0.0/16' }), [hubRoutes('east-hub', 'regional-services', '10.141.0.0/16')]),
      t('diagnose', 35, l('Commit an evidence-backed diagnosis', '証拠に基づく診断を確定'),
        l('Use the two exact observations to identify the independent forward and reply boundaries and the working invariants to preserve.', '正確な 2 観測から独立した要求/応答境界と維持すべき正常不変条件を特定してください。'),
        l('The missing regional service import and missing checkout return publication are independent. Working Inventory, Operations and Warehouse argue against replacing hubs or widening tenant routing.', 'リージョン サービス インポート不足と checkout 応答公開不足は独立しています。正常な Inventory、Operations、Warehouse はハブ置き換えやテナント経路拡大が不要な根拠です。'),
        quiz(l('Which diagnosis fits both scoped observations?', '両対象の観測に適合する診断は？'),
          l('Source import and reply publication both have gaps; repair them as separate boundaries.', '送信元インポートと応答公開の両方に不足があり、別々の境界として修復します。'),
          l('Source import has a gap; repairing it will automatically install the missing reply publication.', '送信元インポートに不足があり、修復すると不足した応答公開も自動的に導入されます。'),
          l('The two exact table gaps and working witnesses support two scoped repairs.', '正確な 2 テーブルの不足と正常対照が 2 つの限定修復を裏付けます。'), l('Restoring the source import does not publish the source prefix into the remote reply table. The two directions need separate repairs.', '送信元のインポートを復元しても、リモート応答テーブルに送信元プレフィックスが公開されるわけではありません。両方向に別々の修復が必要です。'), { id: 'choice-b', position: 'first' })),
      t('repair-forward', 25, l('Repair the first observed boundary', '最初の観測境界を修復'),
        l('Repair publication so the original 10.143.0.0/16 service appears in Workloads table in West managed hub. Keep endpoint ownership, current associations, working local/hybrid paths and tenant scope unchanged. The reply problem remains for the next action.', '元の 10.143.0.0/16 が West managed hub の Workloads テーブル に現れるよう公開を修復します。エンドポイント所有、現在の関連付け、正常ローカル/ハイブリッド経路、テナント範囲を維持してください。応答問題は次の操作で扱います。'),
        l('The source now has its original service route. This intermediate check does not claim the full conversation works before the independent reply repair.', '送信元が元のサービス ルートを持ちます。この途中確認は、独立応答の修復前に全通信が正常だとは主張しません。'),
        configured(id, { vnets: keep.vnets.map((v) => v.id === 'east-service'
          ? { ...v, vwanHubAttachment: { ...v.vwanHubAttachment, hubRouting: { ...v.vwanHubAttachment.hubRouting, labels: ['shared'] } } } : v) }, firstRequirements),
        [g('hub.configure', { hubId: 'east-hub' }, 'Open the original regional service publication controls.', '元のリージョン サービス公開設定を開きます。')], [l('Compare the original service connection’s publication scope with the destination Workloads label; do not move the source lookup.', '元のサービス接続の公開範囲と宛先 Workloads ラベルを比較し、送信元ルックアップを移さないでください。'),
          l('The existing destination labels match shared. Restore the original New order service publication to shared while keeping its table association.', '既存の宛先ラベルは shared です。テーブル関連付けを維持して元の New order service の shared 公開を復元します。')]),
      t('repair-reply', 25, l('Repair the independent reply boundary', '独立した応答境界を修復'),
        l('Repair the original checkout publication so 10.141.0.0/16 appears in Regional services table in East managed hub. Retain the first repair and all working/invariant scopes; do not rename endpoints or move tenant.', '元の checkout 公開を修復し、10.141.0.0/16 を East managed hub の Regional services テーブル に表示させてください。最初の修復と全正常/不変範囲を維持し、エンドポイント改名やテナント移動をしないでください。'),
        l('Both original service directions now qualify alongside Inventory, Operations, Warehouse and both tenant initiation boundaries. Two different connection publications—not an endpoint substitution—were repaired.', '元のサービス両方向、Inventory、Operations、Warehouse、両テナント開始境界が合格しました。エンドポイント代用ではなく、異なる 2 接続の公開を修復しました。'),
        configured(id, { vnets: keep.vnets.map((v) => v.id !== 'west-tenant'
          ? { ...v, vwanHubAttachment: { ...v.vwanHubAttachment, hubRouting: { ...v.vwanHubAttachment.hubRouting, labels: ['shared'] } } } : v) }, curriculumV2Requirements[id]),
        [g('hub.configure', { hubId: 'west-hub' }, 'Open the original checkout connection publication controls.', '元の checkout 接続の公開設定を開きます。')], [l('The reply uses Regional services table in East managed hub; inspect how the original New checkout API prefix reaches that labeled context.', '応答は East managed hub の Regional services テーブル を使用します。元の New checkout API がそのラベル対象へ届く公開方式を確認してください。'),
          l('Restore New checkout API’s shared label publication without removing its prepared local table targets.', '準備済みローカル テーブル宛先を削除せず、New checkout API の shared ラベル公開を復元します。')]),
      t('checkpoint', 50, l('Hand over bounded paired evidence', '限定された両方向証拠を引き渡す'),
        l('Review the repaired original checkout/order pair, working Inventory/Operations/Warehouse and both blocked tenant initiations. Choose the defensible handover conclusion, including what still needs production validation.', '修復済みの元 checkout/order、正常 Inventory/Operations/Warehouse、両テナント開始の遮断を確認し、本番で追加検証すべき点を含む妥当な引き継ぎ結論を選んでください。'),
        l('You diagnosed and repaired two independent familiar boundaries without changing ownership or widening the tenant. The modeled paired routing and preserved witnesses support a bounded handover—not production certification, security enforcement, physical diversity, live failover or application/session continuity.', '所有変更やテナント拡大なしで、既知の独立した 2 境界を診断・修復しました。モデル化された両方向ルーティングと維持した対照が限定引き継ぎを支えます。本番認定、セキュリティ強制、物理多様性、実フェイルオーバー、アプリ/セッション継続の証明ではありません。'),
        quiz(l('Which handover claim is supported?', '裏付けられる引き継ぎ主張は？'),
          l('Original two-way routes and tenant boundaries pass; security and live services still need checks.', '元の両方向ルートとテナント境界は合格ですが、セキュリティと実サービスには追加確認が必要です。'),
          l('Original two-way routes and tenant boundaries pass; security and live services are also verified.', '元の両方向ルートとテナント境界が合格したため、セキュリティと実サービスも確認されています。'),
          l('The conclusion names both what was evaluated and what was not.', '結論は評価済みと未評価の両方を明記します。'), l('A logical model cannot certify unexecuted production behavior.', '論理モデルは未実行の本番動作を認定できません。'), { id: 'choice-a', position: 'first' })),
    ])
}

export const curriculumV2Bundle: CourseBundle = {
  schemaVersion: 1, course: curriculumV2Course, lessons,
  scenarios: curriculumV2LessonIds.map((id) => ({ id, document: { mode: 'full', topology: curriculumV2Topologies[id] } })),
  checks, guidance,
}
