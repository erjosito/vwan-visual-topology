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
        l('Locate VPN VNG vpn-gateway, GatewaySubnet, warehouse edge, owned remote /24 and warehouse-vpn connection. Choose what each contributes.', 'VPN VNG vpn-gateway、GatewaySubnet、warehouse エッジ、リモート所有 /24、warehouse-vpn 接続を確認し、それぞれの役割を選んでください。'),
        l('The Azure VPN gateway terminates the Azure side; Warehouse declares remote ownership; the connection joins the modeled edge and gateway. The site abstraction is not a complete Azure Local Network Gateway provisioning workflow.', 'Azure VPN ゲートウェイが Azure 側を終端し、Warehouse がリモート所有範囲を宣言し、接続が両者を結びます。このサイト抽象は Azure Local Network Gateway の完全なプロビジョニング手順ではありません。'),
        quiz(l('Which object declares the remote private destination?', 'リモート プライベート宛先を宣言するものは？'),
          l('Warehouse owns 172.22.0.0/24; its VPN connection publishes the static route.', 'Warehouse が 172.22.0.0/24 を所有し、VPN 接続が静的ルートを公開します。'),
          l('GatewaySubnet owns every remote destination and replaces the on-premises edge.', 'GatewaySubnet がすべてのリモート宛先を所有し、オンプレミス エッジを置き換えます。'),
          l('Gateway placement and remote prefix ownership are different roles.', 'ゲートウェイ配置とリモート プレフィックス所有は異なる役割です。'), l('GatewaySubnet is an Azure gateway subnet, not the Warehouse address space.', 'GatewaySubnet は Azure ゲートウェイのサブネットであり、Warehouse のアドレス空間ではありません。')),
        [network('hybrid-hub'), connection('vpn-connection', 'warehouse-vpn')]),
      t('prefix', 25, l('Declare the static Warehouse prefix', '静的 Warehouse プレフィックスを宣言'),
        l('Replace warehouse-vpn’s prepared remote static prefix with the owned 172.22.0.0/24. Keep the tunnel disabled and connection BGP off for this step.', 'warehouse-vpn の準備済みリモート静的プレフィックスを所有範囲 172.22.0.0/24 に置き換えます。この段階ではトンネルを無効、接続 BGP を無効のままにしてください。'),
        l('The remote route declaration now matches the original Warehouse destination. Static VPN prefixes are connection-level remote routing information, not subnet UDRs.', 'リモート ルート宣言が元の Warehouse 宛先に一致します。静的 VPN プレフィックスは接続レベルのリモート情報であり、サブネット UDR ではありません。'),
        configured(id, vpn({ staticPrefixes: ['172.22.0.0/24'], enabled: false, bgpEnabled: false })), [connection('vpn-connection', 'warehouse-vpn')]),
      t('enable', 25, l('Enable static S2S connectivity', '静的 S2S 接続を有効化'),
        l('Enable the original warehouse-vpn connection. Do not enable BGP or add a subnet UDR.', '元の warehouse-vpn 接続を有効にします。BGP を有効にしたりサブネット UDR を追加したりしないでください。'),
        l('The modeled static connection is available to the hub gateway. Application still needs the explicit shared-gateway setting before inspecting its remote workload route.', 'モデル化された静的接続がハブ ゲートウェイで利用可能になりました。Application のリモート ワークロード ルート確認前に、共有ゲートウェイ設定が必要です。'),
        configured(id, vpn({ staticPrefixes: ['172.22.0.0/24'], enabled: true, bgpEnabled: false })), [connection('vpn-connection', 'warehouse-vpn')]),
      t('share-gateway', 25, l('Use the shared hub gateway', '共有ハブ ゲートウェイを使用'),
        l('The hub side already allows gateway transit. Enable Application’s useRemoteGateways on peer-hybrid-hub-app, without changing the tenant or direct Partner connection.', 'ハブ側のゲートウェイ転送は許可済みです。テナントや Partner 直接接続を変えず、peer-hybrid-hub-app の Application 側 useRemoteGateways を有効にしてください。'),
        l('Gateway transit and spoke use of the remote gateway are separate directional settings. Application now has the specific Warehouse static route and an independently modeled reply.', 'ゲートウェイ転送とスポークのリモート ゲートウェイ使用は別の方向設定です。Application に Warehouse の静的ルートと独立した応答が成立します。'),
        configured(id, { vnetPeerings: [{ id: 'peer-hybrid-hub-app', aToB: { allowGatewayTransit: true }, bToA: { useRemoteGateways: true } }] }, curriculumV2Requirements[id]),
        [g('peering.configure', { peeringId: 'peer-hybrid-hub-app' }, 'Open the original Application–hub peering settings.', '元の Application–ハブ ピアリング設定を開きます。')]),
      t('inspect-static', 10, l('Inspect the workload’s static VPN route', 'ワークロードの静的 VPN ルートを確認'),
        l('Now inspect app/app-work for 172.22.0.0/24. Identify the VPN gateway next hop and static connection origin, then review Application–Warehouse and its reply.', 'app/app-work の 172.22.0.0/24 を確認してください。VPN ゲートウェイの次ホップと静的接続の起点を識別し、Application–Warehouse と応答を確認します。'),
        l('You inspected the workload scope after sharing was enabled. A common internal gateway RIB representation does not turn this static VPN route into evidence of a BGP session.', '共有を有効にした後のワークロード対象を確認しました。共通の内部ゲートウェイ RIB 表現を使っても、この静的 VPN ルートは BGP セッションの証拠ではありません。'),
        inspect('app', 'app-work', '172.22.0.0/24'), [routes('app', 'app-work', '172.22.0.0/24')]),
      t('checkpoint', 15, l('Explain static routing and replies', '静的ルーティングと応答を説明'),
        l('Explain why the Azure remote prefix and the independently prepared on-premises return path are both required.', 'Azure 側のリモート プレフィックスと、別に準備されたオンプレミス応答経路の両方が必要な理由を説明してください。'),
        l('The connection supplies static remote prefixes to Azure; Warehouse’s modeled connection supplies its Azure return context. Real on-premises route installation, IPsec selectors and tunnel establishment are not provisioned or measured here.', '接続が Azure へ静的リモート プレフィックスを提供し、Warehouse のモデル化された接続が Azure への応答コンテキストを提供します。実オンプレミスのルート導入、IPsec セレクター、トンネル確立はここでは実行・測定していません。'),
        quiz(l('Which statement explains the working conversation?', '動作した会話を説明するものは？'),
          l('Static remote prefixes and shared-gateway use support Azure routing; Warehouse needs its own Azure return route.', '静的リモート プレフィックスと共有ゲートウェイ使用が Azure ルーティングを支え、Warehouse にも Azure への応答ルートが必要です。'),
          l('The Application UDR automatically creates an on-premises BGP session and all replies.', 'Application UDR がオンプレミス BGP セッションとすべての応答を自動作成します。'),
          l('Each side’s routing role remains independent.', '各側のルーティングの役割は独立しています。'), l('This connection uses static routing, not a subnet UDR or enabled BGP.', 'この接続は静的ルーティングで、サブネット UDR や有効な BGP ではありません。'))),
    ])
}

{
  const id = 'v2-bgp', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C06 · Learn routes, then publish them', 'C06 · ルートを学習して公開'),
    l('Separate BGP prefix learning at the VPN gateway from workload propagation.', 'VPN ゲートウェイの BGP プレフィックス学習とワークロード伝達を区別します。'),
    l('The classic VPN snapshot retains the active tunnel, gateway sharing and original Warehouse prefix. Warehouse now also owns 172.22.1.0/24. Gateway BGP capability and ASN 65515 are prepared; connection BGP is off. Application’s empty workload-routes table suppresses BGP propagation. BGP exchanges reachable prefixes between neighbors identified by autonomous-system numbers; it is not a security permission.',
      '通常 VPN スナップショットで有効トンネル、ゲートウェイ共有、元の Warehouse プレフィックスを維持します。Warehouse は 172.22.1.0/24 も所有します。ゲートウェイの BGP 能力と ASN 65515 は準備済みですが接続 BGP は無効です。Application の空の workload-routes テーブルは BGP 伝達を抑制します。BGP は自律システム番号で識別する隣接間で到達プレフィックスを交換するもので、セキュリティ許可ではありません。'), [
      t('enable-bgp', 25, l('Enable prefix exchange', 'プレフィックス交換を有効化'),
        l('Enable BGP on the original active warehouse-vpn connection. Gateway capability is already prepared; do not remove workload-routes or change its propagation yet.', '元の有効な warehouse-vpn 接続で BGP を有効にします。ゲートウェイ能力は準備済みです。workload-routes の削除や伝達の変更はまだ行わないでください。'),
        l('The configured gateway can now learn Warehouse’s advertised prefixes. An enabled exchange does not guarantee every subnet publishes those learned routes.', '設定済みゲートウェイが Warehouse の広告プレフィックスを学習できます。交換を有効にしても、すべてのサブネットに学習ルートが公開される保証はありません。'),
        configured(id, { ...vpn({ enabled: true, bgpEnabled: true }),
          vnets: [{ id: 'hybrid-hub', gateways: [{ id: 'vpn-gateway', enabled: true, bgpEnabled: true }] }] }), [connection('vpn-connection', 'warehouse-vpn')]),
      t('inspect-gateway', 10, l('Inspect gateway learning', 'ゲートウェイの学習を確認'),
        l('Inspect vpn-gateway’s native routes for new Warehouse 172.22.1.0/24 in hybrid-hub. Do not substitute app-work evidence.', 'hybrid-hub の vpn-gateway のネイティブ ルートで、新しい Warehouse 172.22.1.0/24 を確認してください。app-work の証拠で代用しないでください。'),
        l('You inspected the gateway’s learned route context. This establishes where the new prefix was received, not whether the workload route table uses it.', 'ゲートウェイの学習ルート コンテキストを確認しました。新しいプレフィックスの受信位置を示しますが、ワークロード テーブルが使用するかは別です。'),
        control({ vnetId: 'hybrid-hub', gatewayId: 'vpn-gateway', prefix: '172.22.1.0/24' }), [gatewayRoutes('vpn-gateway', '172.22.1.0/24')]),
      t('inspect-workload', 10, l('Inspect missing workload publication', '不足するワークロード公開を確認'),
        l('Inspect app/app-work for the same 172.22.1.0/24. Compare the missing specific row with the gateway learning you just inspected.', 'app/app-work の同じ 172.22.1.0/24 を確認し、不足する具体的な行を先ほどのゲートウェイ学習と比較してください。'),
        l('You inspected the independent workload lookup. Absence of the learned prefix here can coexist with successful gateway learning.', '独立したワークロード ルックアップを確認しました。ここに学習プレフィックスがなくても、ゲートウェイでは学習済みの場合があります。'),
        inspect('app', 'app-work', '172.22.1.0/24'), [routes('app', 'app-work', '172.22.1.0/24')]),
      t('diagnose', 35, l('Diagnose the publication boundary', '公開境界を診断'),
        l('Commit a diagnosis from the gateway/workload comparison before changing the table.', 'テーブルを変更する前に、ゲートウェイとワークロードの比較から診断を確定してください。'),
        l('Gateway learning and workload BGP propagation are different stages. The active tunnel and gateway exchange do not override an explicit workload propagation suppression.', 'ゲートウェイ学習とワークロード BGP 伝達は異なる段階です。有効トンネルやゲートウェイ交換は、明示的なワークロード伝達抑制を上書きしません。'),
        quiz(l('Where does the observed route stop?', '観測したルートはどこで止まっていますか？'),
          l('It is learned at vpn-gateway but suppressed from app-work by workload-routes.', 'vpn-gateway では学習済みですが、workload-routes が app-work への伝達を抑制しています。'),
          l('Warehouse cannot advertise the prefix because any static VPN history permanently disables BGP.', '静的 VPN の履歴が BGP を永久に無効にするため、Warehouse は広告できません。'),
          l('The two inspected contexts isolate the publication boundary.', '確認した 2 つのコンテキストから公開境界を特定できます。'), l('Prior static use does not prevent configured BGP exchange.', '以前の静的使用は設定した BGP 交換を妨げません。'))),
      t('propagate', 25, l('Publish learned routes to the workload', '学習ルートをワークロードへ公開'),
        l('Enable BGP propagation on the original workload-routes table; keep its empty UDR list and subnet association. Verify both original and new Warehouse services plus Operations and tenant boundaries.', '元の workload-routes テーブルで BGP 伝達を有効にし、空の UDR リストとサブネット関連付けを維持してください。元の Warehouse サービスと新サービス、Operations、テナント境界を検証します。'),
        l('Both advertised Warehouse prefixes now reach the workload routing context. The same original service pair and the added service have independent request/reply evidence.', '広告された両 Warehouse プレフィックスがワークロード コンテキストへ届きます。元のサービス間と追加サービスの要求/応答をそれぞれ確認しました。'),
        configured(id, { udrTables: [{ id: 'workload-routes', disableBgpRoutePropagation: false, routes: [] }],
          vnets: [{ id: 'app', subnets: [{ id: 'app-work', prefix: '10.21.1.0/24', routeTableId: 'workload-routes' }] }] }, curriculumV2Requirements[id]),
        [policy('app', 'workload-routes')]),
      t('checkpoint', 15, l('Explain static-to-dynamic transfer', '静的から動的への変化を説明'),
        l('Explain what changed from C05 and why forward learning alone is insufficient evidence for a conversation.', 'C05 からの変更点と、要求側の学習だけでは会話の証明に不十分な理由を説明してください。'),
        l('BGP replaces manual remote-prefix publication with neighbor advertisements. Workload propagation still matters, and independently evaluated Warehouse replies—not tunnel enablement alone—support the paired routing result. Timers and live convergence are not assessed.', 'BGP は手動リモート プレフィックス公開を隣接広告に置き換えます。ワークロード伝達も必要です。有効トンネルだけでなく、独立評価した Warehouse 応答が両方向の結果を支えます。タイマーや実収束は評価していません。'),
        quiz(l('What proves the new dynamic routing objective?', '新しい動的ルーティング目標を裏付けるものは？'),
          l('Gateway learning, workload propagation, and independently checked service replies.', 'ゲートウェイ学習、ワークロード伝達、独立して確認したサービス応答。'),
          l('An enabled tunnel alone proves every new advertised prefix and reply.', '有効トンネルだけですべての新規広告プレフィックスと応答を証明できます。'),
          l('Each routing boundary needs its own evidence.', '各ルーティング境界に独自の証拠が必要です。'), l('Tunnel availability is not a complete route-publication check.', 'トンネルの利用可能性はルート公開全体の確認ではありません。'))),
    ])
}

{
  const id = 'v2-expressroute', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C07 · Walk an ExpressRoute prefix', 'C07 · ExpressRoute プレフィックスを追跡'),
    l('Distinguish circuit, private peering, location, MSEE evidence and Azure gateway.', '回線、プライベート ピアリング、拠点、MSEE 証拠、Azure ゲートウェイを区別します。'),
    l('Retain the Azure/warehouse addresses and gateway sharing in a classic ER comparison. A prepared ER gateway replaces the VPN transport; original Warehouse and Azure attachments at Amsterdam start disabled. Standard-circuit dual MSEEs are conceptual: the native location view aggregates the modeled private-peering paths and does not expose two routers or physical BGP sessions.',
      '通常 ER 比較で Azure/倉庫アドレスとゲートウェイ共有を維持します。準備済み ER ゲートウェイが VPN を置き換え、Amsterdam の元の Warehouse/Azure 接続は無効から開始します。標準回線の二重 MSEE は概念として扱います。ネイティブ拠点ビューはモデル化されたプライベート ピアリングを集約し、2 台のルーターや物理 BGP セッションは表示しません。'), [
      t('architecture', 15, l('Map the ExpressRoute architecture', 'ExpressRoute 構成を整理'),
        l('Identify the service circuit/private peering, Amsterdam peering location, MSEE boundary, Azure er-gateway and its VNet attachment. Distinguish the location from Sweden Central.', 'サービス回線/プライベート ピアリング、Amsterdam 拠点、MSEE 境界、Azure er-gateway、VNet 接続を識別し、拠点と Sweden Central を区別してください。'),
        l('The circuit carries connectivity via a provider/peering location; private peering exchanges private prefixes; the ER gateway connects the Azure VNet. A peering location is not the application’s Azure region.', '回線はプロバイダー/ピアリング拠点経由の接続、プライベート ピアリングはプライベート プレフィックス交換、ER ゲートウェイは Azure VNet 接続を担います。ピアリング拠点はアプリの Azure リージョンではありません。'),
        quiz(l('Which mapping is accurate?', '正しい対応は？'),
          l('Amsterdam is a peering location; er-gateway connects the Azure VNet to private peering.', 'Amsterdam はピアリング拠点で、er-gateway は Azure VNet をプライベート ピアリングへ接続します。'),
          l('The peering location is the Application subnet and er-gateway is an on-premises MSEE.', 'ピアリング拠点は Application サブネットで、er-gateway はオンプレミス MSEE です。'),
          l('These are different ownership and routing boundaries.', 'それぞれ所有とルーティングの境界が異なります。'), l('A gateway and peering location are not interchangeable objects.', 'ゲートウェイとピアリング拠点は交換可能なオブジェクトではありません。')),
        [network('hybrid-hub'), erRoutes('location-a', '172.22.0.0/24')]),
      t('attach-warehouse', 25, l('Activate original private peering', '元のプライベート ピアリングを有効化'),
        l('Enable warehouse-er-a at the original Amsterdam location. Leave azure-er-a disabled for this step.', '元の Amsterdam 拠点の warehouse-er-a を有効にします。この段階では azure-er-a は無効のままにしてください。'),
        l('The original on-premises attachment is available. The Azure gateway still needs its separate connection; one attachment alone is not an end-to-end route.', '元のオンプレミス接続が利用可能になりました。Azure ゲートウェイには別の接続が必要で、一方だけではエンドツーエンドのルートになりません。'),
        configured(id, erLink('warehouse-er-a', true)), [connection('er-link', 'warehouse-er-a')]),
      t('attach-azure', 25, l('Connect the original ER gateway', '元の ER ゲートウェイを接続'),
        l('Enable azure-er-a, retaining Warehouse’s original enabled attachment and all endpoint ownership.', 'azure-er-a を有効にし、Warehouse の元の有効な接続と全エンドポイント所有を維持してください。'),
        l('Both original attachments are available. Native routing can now carry the Warehouse prefix to Azure and the Azure prefix back toward Warehouse.', '両方の元の接続が利用可能になりました。ネイティブ ルーティングが Warehouse プレフィックスを Azure へ、Azure プレフィックスを Warehouse 側へ運べます。'),
        configured(id, { erLinks: [{ id: 'warehouse-er-a', enabled: true }, { id: 'azure-er-a', enabled: true }] }, curriculumV2Requirements[id]), [connection('er-link', 'azure-er-a')]),
      t('inspect-msee-remote', 10, l('Inspect the aggregate MSEE boundary', '集約 MSEE 境界を確認'),
        l('Inspect location-a’s native ER routes for Warehouse 172.22.0.0/24. Identify the on-premises attachment that supplies it.', 'location-a のネイティブ ER ルートで Warehouse 172.22.0.0/24 を確認し、供給元のオンプレミス接続を識別してください。'),
        l('You inspected the modeled MSEE/location prefix boundary. This aggregate evidence cannot be split into invented primary and secondary MSEE observations.', 'モデル化された MSEE/拠点のプレフィックス境界を確認しました。この集約証拠を架空の主系/副系 MSEE 観測に分割することはできません。'),
        control({ locationId: 'location-a', prefix: '172.22.0.0/24' }), [erRoutes('location-a', '172.22.0.0/24')]),
      t('inspect-gateway', 10, l('Compare the ER gateway’s learned route', 'ER ゲートウェイの学習ルートを比較'),
        l('Inspect hybrid-hub/er-gateway for that same Warehouse /24. Compare gateway next-hop ownership with the location evidence.', '同じ Warehouse /24 を hybrid-hub/er-gateway で確認し、ゲートウェイの次ホップ所有と拠点の証拠を比較してください。'),
        l('You inspected a different control-plane scope. The gateway’s Azure attachment and the location’s on-premises attachment play different roles in the route walk.', '異なる制御プレーン対象を確認しました。ゲートウェイの Azure 接続と拠点のオンプレミス接続は、ルート追跡で別の役割を持ちます。'),
        control({ vnetId: 'hybrid-hub', gatewayId: 'er-gateway', prefix: '172.22.0.0/24' }), [gatewayRoutes('er-gateway', '172.22.0.0/24')]),
      t('inspect-msee-azure', 10, l('Inspect Azure export and independent reply', 'Azure のエクスポートと独立応答を確認'),
        l('Inspect location-a for Application 10.21.0.0/16, then review the original Warehouse conversation’s independently evaluated reply.', 'location-a の Application 10.21.0.0/16 を確認し、元の Warehouse 会話の独立評価した応答を確認してください。'),
        l('You inspected Azure’s exported prefix at the location boundary. The separately modeled reverse path, rather than a forward row alone, supports the paired routing result.', '拠点境界で Azure のエクスポート プレフィックスを確認しました。要求の行だけでなく、別にモデル化した逆方向経路が両方向の結果を支えます。'),
        control({ locationId: 'location-a', prefix: '10.21.0.0/16' }), [erRoutes('location-a', '10.21.0.0/16')]),
      t('checkpoint', 15, l('Distinguish circuit and location redundancy', '回線と拠点の冗長性を区別'),
        l('Explain the standard circuit’s redundant MSEE connections without pretending that this aggregate model separately observed both routers.', 'この集約モデルが両ルーターを個別観測したと主張せず、標準回線の冗長 MSEE 接続を説明してください。'),
        l('A standard circuit has redundant connections to MSEEs within its peering location. That local redundancy does not protect against losing the entire location. The dual-MSEE statement is conceptual here; per-router sessions and link failure behavior are not modeled.', '標準回線にはピアリング拠点内の MSEE への冗長接続があります。この局所冗長性は拠点全体の喪失には対応しません。二重 MSEE はここでは概念であり、ルーター別セッションやリンク障害動作はモデル化していません。'),
        quiz(l('What does standard-circuit redundancy protect conceptually?', '標準回線の冗長性が概念上保護する範囲は？'),
          l('Redundant local MSEE connections, not loss of the whole peering location.', '局所 MSEE 接続の冗長性であり、ピアリング拠点全体の喪失ではありません。'),
          l('A second geographic location was automatically created and separately observed.', '2 つ目の地理的拠点が自動作成され、個別観測されています。'),
          l('Local components and a location-wide failure are different domains.', '局所コンポーネントと拠点全体の障害は異なるドメインです。'), l('The native view is one aggregate location, not two independent locations.', 'ネイティブ ビューは 1 つの集約拠点であり、独立した 2 拠点ではありません。'))),
    ])
}

{
  const id = 'v2-er-locations', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C08 · A second peering location', 'C08 · 2 つ目のピアリング拠点'),
    l('Declare Location A unavailable and prove surviving routing via Location B.', '拠点 A を利用不可と宣言し、拠点 B の残存ルーティングを確認します。'),
    l('Retain working Amsterdam A and the original endpoints. London B is prepared with an enabled Azure attachment and disabled Warehouse attachment. Two original attachments at A must be disabled for this bounded declaration; no real facility outage or elapsed failover is measured.',
      '正常な Amsterdam A と元のエンドポイントを維持します。London B は Azure 接続が有効、Warehouse 接続が無効で準備済みです。この限定宣言には A の元の 2 接続を無効にする必要があります。実施設障害や経過時間付きフェイルオーバーは測定しません。'), [
      t('attach-location-b', 25, l('Complete the second location path', '2 つ目の拠点経路を完成'),
        l('Enable warehouse-er-b, leaving both original A attachments enabled.', '元の A の両接続を有効のまま、warehouse-er-b を有効にしてください。'),
        l('Both locations now have the original Azure and Warehouse attachment roles. A second location needs both sides; an Azure-only connection is not a usable Warehouse path.', '両拠点に元の Azure/Warehouse 接続役割が揃いました。2 拠点目も両側が必要で、Azure 側だけでは Warehouse 経路として使えません。'),
        configured(id, { erLinks: [{ id: 'warehouse-er-b', enabled: true }, { id: 'azure-er-b', enabled: true },
          { id: 'warehouse-er-a', enabled: true }, { id: 'azure-er-a', enabled: true }] }, curriculumV2Requirements[id]), [connection('er-link', 'warehouse-er-b')]),
      t('inspect-candidates', 10, l('Compare eligible location routes', '候補拠点ルートを比較'),
        l('Inspect er-gateway’s Warehouse /24 candidates and compare their A/B location ownership before withdrawing anything.', '何も撤回する前に、er-gateway の Warehouse /24 候補と A/B 拠点所有を比較してください。'),
        l('You inspected the distinct modeled location candidates. Their presence does not establish provider diversity, spare bandwidth or physical facility independence.', '異なるモデル化拠点候補を確認しました。候補の存在だけではプロバイダー多様性、予備帯域、物理施設の独立性を証明できません。'),
        control({ vnetId: 'hybrid-hub', gatewayId: 'er-gateway', prefix: '172.22.0.0/24' }), [gatewayRoutes('er-gateway', '172.22.0.0/24')]),
      t('withdraw-warehouse-a', 25, l('Declare Warehouse attachment A unavailable', 'Warehouse 接続 A を利用不可に宣言'),
        l('Disable original warehouse-er-a as the first part of this lab’s Location A outage declaration. Do not disable B or alter prefixes.', 'このラボの拠点 A 障害宣言の第 1 段階として、元の warehouse-er-a を無効にします。B の無効化やプレフィックス変更はしないでください。'),
        l('Warehouse connectivity at A is withdrawn. This is an intermediate declared configuration, not yet the complete A-location declaration.', 'A の Warehouse 接続を撤回しました。これは途中の宣言構成で、A 拠点全体の宣言はまだ完了していません。'),
        configured(id, erLink('warehouse-er-a', false), curriculumV2Requirements[id]), [connection('er-link', 'warehouse-er-a')]),
      t('withdraw-azure-a', 25, l('Complete the bounded Location A declaration', '限定された拠点 A 宣言を完了'),
        l('Disable original azure-er-a. Confirm both original A attachments are now unavailable and both B attachments remain enabled.', '元の azure-er-a を無効にし、元の A の両接続が利用不可で、B の両接続が有効であることを確認してください。'),
        l('Every original attachment at A in this lab is disabled. The original service conversation remains routed through the surviving B configuration.', 'このラボの A にあるすべての元の接続を無効にしました。元のサービス会話は残存する B 構成を通じてルーティングされます。'),
        configured(id, { erLinks: [{ id: 'warehouse-er-a', enabled: false }, { id: 'azure-er-a', enabled: false },
          { id: 'warehouse-er-b', enabled: true }, { id: 'azure-er-b', enabled: true }] }, curriculumV2Requirements[id]), [connection('er-link', 'azure-er-a')]),
      t('inspect-survivor', 10, l('Inspect the surviving B export', '残存 B エクスポートを確認'),
        l('Inspect location-b for Warehouse 172.22.0.0/24 and review the original Azure↔Warehouse routing legs. Do not substitute new endpoints.', 'location-b の Warehouse 172.22.0.0/24 を確認し、元の Azure↔Warehouse 両経路を確認してください。新しいエンドポイントで代用しないでください。'),
        l('You inspected the surviving modeled location and original two-direction conversation. The result is steady-state routing availability, not elapsed recovery or session continuity.', '残存するモデル化拠点と元の両方向会話を確認しました。結果は定常状態のルーティング利用可能性であり、回復時間やセッション継続ではありません。'),
        control({ locationId: 'location-b', prefix: '172.22.0.0/24' }), [erRoutes('location-b', '172.22.0.0/24')]),
      t('checkpoint', 15, l('Explain the failure-domain difference', '障害ドメインの違いを説明'),
        l('Explain what the second location adds beyond the circuit’s local dual-MSEE redundancy.', '2 拠点目が回線内の二重 MSEE 冗長性に加えるものを説明してください。'),
        l('The second modeled peering location provides another attachment path after all original A attachments are unavailable. Production claims about provider diversity, capacity and real facility failures require separate evidence.', '2 つ目のモデル化ピアリング拠点が、元の A の全接続を利用不可にした後の別接続経路を提供します。本番のプロバイダー多様性、容量、実施設障害には別の証拠が必要です。'),
        quiz(l('Why does B add a different routing failure boundary?', 'B が異なるルーティング障害境界を追加する理由は？'),
          l('Its original end-to-end attachments remain available when all A attachments are disabled.', 'A の全接続が無効でも、B の元のエンドツーエンド接続が利用可能です。'),
          l('B is simply the second MSEE inside A and cannot have independent attachments.', 'B は A 内の 2 台目 MSEE だけで、独立した接続を持てません。'),
          l('Location diversity is not the same as redundant local connections.', '拠点の多様性と局所接続の冗長性は同じではありません。'), l('A and B are explicitly distinct modeled locations.', 'A と B は明示的に異なるモデル化拠点です。'))),
    ])
}

{
  const id = 'v2-vpn-backup', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C09 · A backup must be usable', 'C09 · 使用可能なバックアップ'),
    l('Assess equal-prefix ER preference and a bidirectionally usable VPN backup.', '同一プレフィックスの ER 優先と両方向に使える VPN バックアップを評価します。'),
    l('Reset to a deliberately smaller one-location ER/VPN transport comparison, not a recommendation to replace C08 resilience. Original Warehouse /24 is identical on both transports. ER works; the prepared BGP VPN backup is disabled. No summarization, prefix-length puzzle or ARS is introduced.',
      'C08 の回復性を置き換える推奨ではなく、意図的に小さい 1 拠点 ER/VPN 比較へ切り替えます。元の Warehouse /24 は両トランスポートで同一です。ER は正常で準備済み BGP VPN バックアップは無効です。要約、プレフィックス長パズル、ARS は導入しません。'), [
      t('enable-backup', 25, l('Ready the original VPN backup', '元の VPN バックアップを準備'),
        l('Enable original warehouse-vpn with BGP while preserving both working ER A attachments.', '正常な ER A の両接続を維持し、元の warehouse-vpn を BGP で有効にしてください。'),
        l('Both transports can advertise the same owned remote /24. Preparing backup connectivity does not require withdrawing the primary.', '両トランスポートが同じ所有リモート /24 を広告できます。バックアップ準備のために主系を撤回する必要はありません。'),
        configured(id, { ...vpn({ enabled: true, bgpEnabled: true }), erLinks: [{ id: 'warehouse-er-a', enabled: true }, { id: 'azure-er-a', enabled: true }] }, curriculumV2Requirements[id],
          [{ vnetId: 'app', subnetId: 'app-work', prefix: '172.22.0.0/24', nextHopResourceId: 'er-gateway', destinationAddress: '172.22.0.10' }]),
        [connection('vpn-connection', 'warehouse-vpn')]),
      t('inspect-primary', 10, l('Inspect equal-prefix primary selection', '同一プレフィックスの主系選択を確認'),
        l('Inspect app/app-work for 172.22.0.0/24. Identify er-gateway as the selected primary with the VPN ready for that same prefix.', 'app/app-work の 172.22.0.0/24 を確認し、同じプレフィックスで VPN が準備済みの状態で、er-gateway が主系に選択されることを識別してください。'),
        l('You inspected equal-prefix transport selection: ER is preferred in this no-ARS classic coexistence case. This is not another longest-prefix matching exercise.', '同一プレフィックスのトランスポート選択を確認しました。この ARS なしの通常共存ケースでは ER が優先されます。最長プレフィックス一致の再演習ではありません。'),
        inspect('app', 'app-work', '172.22.0.0/24'), [routes('app', 'app-work', '172.22.0.0/24')]),
      t('withdraw-er', 25, l('Withdraw original on-premises ER', '元のオンプレミス ER を撤回'),
        l('Disable warehouse-er-a only. Preserve the original enabled BGP VPN and original owned prefixes.', 'warehouse-er-a のみを無効にし、元の有効な BGP VPN と所有プレフィックスを維持してください。'),
        l('The original Warehouse ER advertisement is withdrawn in this declared snapshot. Native routes can select the prepared VPN without changing the destination prefix.', '宣言スナップショットで元の Warehouse ER 広告を撤回しました。宛先プレフィックスを変えず、準備済み VPN をネイティブ ルートが選択できます。'),
        configured(id, { ...erLink('warehouse-er-a', false), ...vpn({ enabled: true, bgpEnabled: true }) }, curriculumV2Requirements[id],
          [{ vnetId: 'app', subnetId: 'app-work', prefix: '172.22.0.0/24', nextHopResourceId: 'vpn-gateway', destinationAddress: '172.22.0.10' }]), [connection('er-link', 'warehouse-er-a')]),
      t('inspect-backup', 10, l('Inspect VPN selection and reply', 'VPN 選択と応答を確認'),
        l('Freshly inspect app/app-work for the unchanged Warehouse /24. Identify vpn-gateway and independently review Warehouse’s reply, Operations and both tenant initiation boundaries.', '変更していない Warehouse /24 を app/app-work で新たに確認します。vpn-gateway を識別し、Warehouse 応答、Operations、両テナント開始境界を独立して確認してください。'),
        l('You inspected the newly selected VPN route after the declaration. Both modeled directions are usable. This is not measured live failover, Internet underlay readiness or session survival.', '宣言後に新しく選択された VPN ルートを確認しました。モデル化された両方向が利用可能です。実フェイルオーバー、インターネット下位接続、セッション継続の測定ではありません。'),
        inspect('app', 'app-work', '172.22.0.0/24'), [routes('app', 'app-work', '172.22.0.0/24')]),
      t('checkpoint', 15, l('Explain usable backup evidence', '使用可能なバックアップ証拠を説明'),
        l('Explain why this backup is usable, rather than relying on a green connection icon alone.', '接続の緑アイコンだけに頼らず、バックアップが使用可能である理由を説明してください。'),
        l('Usability depends on the original remote prefix being learned, selected at the workload after ER withdrawal, and supported by an independent Warehouse reply. Azure’s forward preference does not by itself configure on-premises return policy.', '使用可能性には元のリモート プレフィックスの学習、ER 撤回後のワークロード選択、独立した Warehouse 応答が必要です。Azure の要求優先だけでオンプレミス応答ポリシーが設定されるわけではありません。'),
        quiz(l('Which evidence supports the backup objective?', 'バックアップ目標を裏付ける証拠は？'),
          l('Same owned /24 selected via VPN after ER withdrawal, plus the independent working reply.', 'ER 撤回後に同じ所有 /24 を VPN 経由で選択し、独立した応答も正常です。'),
          l('VPN enabled alone, regardless of learned prefixes or the reply route.', '学習プレフィックスや応答ルートに関係なく VPN が有効であることだけです。'),
          l('The original destination and both routing legs qualify readiness.', '元の宛先と両ルーティング経路が準備を裏付けます。'), l('An enabled connection can still have missing or unusable routes.', '有効な接続でもルートが不足または利用不可の場合があります。'))),
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
const wanAttachment = (id: string) => ({ vnets: [{ id, vwanHubAttachment: { hubId: 'wan-hub', enabled: true,
  hubRouting: { status: 'configured', associatedTableId: 'defaultRouteTable', propagatedTableIds: ['defaultRouteTable'], labels: [] } } }] })
const enablePolicy = (table: string, route: string, prefix: string) => ({ udrTables: [{ id: table, routes: [
  { id: route, prefix, nextHopType: 'VirtualAppliance', nextHopIp: '10.20.1.4', enabled: true },
] }] })
let quizPosition = 0
function quiz(question: Localized, correct: Localized, wrong: Localized, explanation: Localized, wrongExplanation: Localized) {
  const correctFirst = quizPosition++ % 2 === 0
  const choices = [
    { id: correctFirst ? 'choice-a' : 'choice-b', text: correct, feedback: explanation },
    { id: correctFirst ? 'choice-b' : 'choice-a', text: wrong, feedback: wrongExplanation },
  ]
  return { kind: 'quiz.answered', params: { question, choices: [
    ...(correctFirst ? choices : choices.reverse()),
  ], correctChoiceId: correctFirst ? 'choice-a' : 'choice-b' } }
}
type CheckSpec = { kind: string; params: Record<string, unknown> }
function task(lessonId: CurriculumV2LessonId, suffix: string, points: number, title: Localized, instruction: Localized, debrief: Localized,
  check: CheckSpec, anchors: NativeGuidance[] = [], hints: Localized[] = []): CourseTask {
  const id = `${lessonId}.${suffix}`, checkId = `${id}.check`
  checks.push({ id: checkId, ...check } as CourseCheck)
  const guidanceIds = anchors.map((anchor, index) => {
    const guideId = `${id}.guide-${index + 1}`
    guidance.push({ id: guideId, ...anchor } as CourseGuidance)
    return guideId
  })
  return { id, assessmentVersion: 1, awardId: `${id}.award`, points, title, instruction, checkId, guidanceIds,
    hints: hints.length ? hints : [l('Use the named original scope and compare request and reply independently. Inspection and retries are free.',
      '指定された元の対象で、要求と応答を別々に比較します。確認と再試行は無料です。')],
    debrief: { paragraphs: [debrief], references: references[lessonId] } }
}
function chapter(id: CurriculumV2LessonId, title: Localized, objective: Localized, context: Localized, tasks: CourseTask[]) {
  const index = curriculumV2LessonIds.indexOf(id)
  lessons.push({ id, contentVersion: 1, title, objective, context, scenarioId: id,
    prerequisites: index ? [curriculumV2LessonIds[index - 1]] : [], taskOrder: tasks.map((t) => t.id), tasks })
}

{
  const id = 'v2-peering', t = (suffix: string, points: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) =>
    task(id, suffix, points, title, instruction, debrief, check, anchors)
  chapter(id, l('C01 · Two services, two VNets', 'C01 · 2 つのサービスと VNet'),
    l('Identify address ownership and establish ordinary private VNet peering.', 'アドレスの所有範囲を確認し、通常のプライベート VNet ピアリングを確立します。'),
    l('The retailer has Application 10.21.0.0/16 and Partner 10.22.0.0/16 in the same region. Application Operations is 10.21.2.0/24; Restricted tenant 10.23.0.0/16 is separate. This fresh comparison starts without peerings. Preparing it earns no XP.',
      '小売企業の Application は 10.21.0.0/16、Partner は 10.22.0.0/16 で同一リージョンです。Application の Operations は 10.21.2.0/24、Restricted tenant は独立した 10.23.0.0/16 です。この比較はピアリングなしで開始します。準備だけでは XP は付与されません。'), [
      t('inspect-local', 10, l('Inspect local ownership', 'ローカルの所有範囲を確認'),
        l('Inspect Application/app-work and select its 10.21.0.0/16 effective route. Which address space does this local row cover?', 'Application/app-work の実効ルート 10.21.0.0/16 を選択し、この行が対象とするアドレス空間を確認してください。'),
        l('You inspected the local VNet route. A local row covers Application address ownership, not every private address in the region.', 'ローカル VNet ルートを確認しました。この行は Application の所有範囲を示し、同一リージョンのすべてのプライベート アドレスを対象にするものではありません。'),
        inspect('app', 'app-work', '10.21.0.0/16'), [routes('app', 'app-work', '10.21.0.0/16')]),
      t('address', 15, l('Check the local route’s scope', 'ローカル ルートの範囲を確認'),
        l('Use the 10.21.0.0/16 local VNet route you inspected in Application. Compare its address range with destination 10.22.1.10.', 'Application で確認したローカル VNet ルート 10.21.0.0/16 を使い、そのアドレス範囲と宛先 10.22.1.10 を比較してください。'),
        l('10.21.0.0/16 covers 10.21.0.0 through 10.21.255.255, so it does not cover 10.22.1.10. A private IP address is not automatically local to this VNet. Connecting the two VNets is a separate question.', '10.21.0.0/16 の範囲は 10.21.0.0 から 10.21.255.255 であり、10.22.1.10 は含まれません。プライベート IP アドレスでも、この VNet のローカル アドレスになるわけではありません。2 つの VNet の接続は別の問題です。'),
        quiz(l('Application has a local VNet route for 10.21.0.0/16. Does that route cover destination 10.22.1.10?', 'Application には 10.21.0.0/16 のローカル VNet ルートがあります。このルートは宛先 10.22.1.10 を対象にしますか？'),
          l('No. The destination is outside 10.21.0.0/16.', 'いいえ。宛先は 10.21.0.0/16 の範囲外です。'),
          l('Yes. Both addresses are private, so the local route covers them.', 'はい。どちらもプライベート アドレスなので、ローカル ルートの対象です。'),
          l('The route covers 10.21.0.0 through 10.21.255.255, not 10.22.1.10.', 'このルートの範囲は 10.21.0.0 から 10.21.255.255 であり、10.22.1.10 は含まれません。'),
          l('A route matches its destination prefix, not every private IP address. 10.22.1.10 is outside 10.21.0.0/16.', 'ルートは宛先プレフィックスに一致するアドレスを対象とし、すべてのプライベート IP アドレスを対象にするものではありません。10.22.1.10 は 10.21.0.0/16 の範囲外です。'))),
      t('predict', 15, l('Predict the unconnected path', '未接続の経路を予測'),
        l('Before editing anything, predict whether Application can reach Partner just because both use private addresses in Sweden Central.', '編集前に、両者が Sweden Central のプライベート アドレスを使用しているだけで接続できるか予測してください。'),
        l('Separate VNets require an explicit connectivity design. A common Azure region does not join their private routing domains.', '別々の VNet には明示的な接続設計が必要です。同一 Azure リージョンでもプライベート ルーティング ドメインは結合されません。'),
        quiz(l('What provides the missing private connection?', '不足しているプライベート接続を提供するものは？'),
          l('An explicit connection, such as VNet peering', 'VNet ピアリングなどの明示的な接続'), l('Same-region placement alone', '同一リージョンへの配置だけ'),
          l('Non-overlapping ownership is necessary but is not a connection.', '重複しない所有範囲は必要ですが、それ自体は接続ではありません。'), l('Region placement does not create routes between VNets.', 'リージョンへの配置だけでは VNet 間のルートは作成されません。'))),
      t('connect', 25, l('Connect the original services', '元のサービスを接続'),
        l('Create whole-VNet Application–Partner peering using the native peering command. Keep tenant separate. Verify the original 10.21.1.10 ↔ 10.22.1.10 conversation and Operations.', 'ネイティブのピアリング操作で Application–Partner の VNet 全体のピアリングを作成してください。テナントは分離したまま、元の 10.21.1.10 ↔ 10.22.1.10 と Operations を検証します。'),
        l('The original service pair now has independent delivered request and reply paths. Operations still works; neither tenant initiation has gained a route.', '元のサービス間で要求と応答の経路をそれぞれ確認できました。Operations は正常で、テナントからもテナントへも開始経路は追加されていません。'),
        { kind: 'vnet.peered', params: { vnetAId: 'app', vnetBId: 'partner', requirements: curriculumV2Requirements[id] } },
        [g('peering.command', { vnetAId: 'app', vnetBId: 'partner' }, 'Create Application–Partner peering.', 'Application–Partner のピアリングを作成します。')]),
      t('checkpoint', 15, l('Explain peering scope', 'ピアリングの範囲を説明'),
        l('Partner later peers to another VNet. Explain what the current whole-VNet peering grants and what it does not.', 'Partner が別の VNet とピアリングするとき、現在の VNet 全体のピアリングが提供する範囲と提供しない範囲を説明してください。'),
        l('Ordinary whole-VNet peering connects the two address spaces, including their participating workloads. It is not automatic third-VNet transit and is not the Azure Private Link service.', '通常の VNet 全体のピアリングは 2 つのアドレス空間を接続します。3 つ目の VNet への自動転送ではなく、Azure Private Link サービスでもありません。'),
        quiz(l('Does this peering make a third VNet automatically reachable?', 'このピアリングで 3 つ目の VNet に自動的に到達できますか？'),
          l('No; peering is not transitive, and this whole-VNet connection covers Application and Partner.', 'いいえ。ピアリングは推移的ではなく、この接続は Application と Partner を対象にします。'),
          l('Yes; every VNet connected to Partner becomes a direct peer of Application.', 'はい。Partner に接続したすべての VNet が Application の直接のピアになります。'),
          l('Transit needs a separate supported design.', '転送には別の対応した設計が必要です。'), l('A chain of ordinary peerings is not a managed transit hub.', '通常のピアリングの連鎖はマネージド転送ハブではありません。'))),
    ])
}

{
  const id = 'v2-firewall', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C02 · Connected is not inspected', 'C02 · 接続と検査は別'),
    l('Use Azure Firewall, deliberate UDRs and independent reply reasoning.', 'Azure Firewall、意図的な UDR、独立した応答経路の検討を適用します。'),
    l('Retain Application, Partner, Operations and their direct peering. The prepared customer hub has actual Azure Firewall in AzureFirewallSubnet and Partner–hub peering. Application–hub is missing; named UDR rows are prepared but disabled. This reset compares routing mechanisms, not a recommended migration.',
      'Application、Partner、Operations と直接ピアリングを維持します。顧客所有ハブには AzureFirewallSubnet の実際の Azure Firewall と Partner–hub ピアリングが準備済みです。Application–hub は未接続で、指定 UDR は無効です。これはルーティング方式の比較であり、推奨移行ではありません。'), [
      t('role', 15, l('Identify managed inspection', 'マネージド検査を識別'),
        l('Find Azure Firewall 10.20.1.4 in AzureFirewallSubnet. Distinguish its routing role from a rule allowing HTTPS.', 'AzureFirewallSubnet の Azure Firewall 10.20.1.4 を確認し、ルーティング上の役割と HTTPS の許可規則を区別してください。'),
        l('Azure Firewall is a managed appliance here, not a vendor VM whose NIC forwarding or instance HA you must configure. Steering toward it does not demonstrate security-rule permission.', 'ここでは Azure Firewall はマネージド アプライアンスです。NIC 転送やインスタンス HA を設定するベンダー VM ではありません。そこへ誘導してもセキュリティ規則の許可は証明されません。'),
        quiz(l('What does a UDR toward Azure Firewall establish?', 'Azure Firewall への UDR が確立するものは？'),
          l('A routing next hop; firewall rules and NSGs are separate.', 'ルーティングの次ホップです。ファイアウォール規則と NSG は別です。'),
          l('An implicit HTTPS allow rule and verified session handling.', '暗黙の HTTPS 許可規則と検証済みのセッション処理です。'),
          l('Routing and security authorization are different checks.', 'ルーティングとセキュリティの許可は別々に確認します。'), l('A next hop is not an allow rule.', '次ホップは許可規則ではありません。')), [network('hub')]),
      t('connect-hub', 25, l('Connect Application to the hub', 'Application をハブへ接続'),
        l('Create the Application–hub whole-VNet peering. Leave the Application–Partner peering in place for the next comparison.', 'Application–hub の VNet 全体のピアリングを作成してください。次の比較のため Application–Partner のピアリングは残します。'),
        l('The firewall is now reachable as a next hop, but the original direct service route remains. Infrastructure reachability is not inspection policy.', 'ファイアウォールへ次ホップとして到達できますが、元の直接サービス ルートは残っています。インフラへの到達性だけでは検査ポリシーにはなりません。'),
        { kind: 'vnet.peered', params: { vnetAId: 'app', vnetBId: 'hub', requirements: invariantRequirements(id) } },
        [g('peering.command', { vnetAId: 'app', vnetBId: 'hub' }, 'Create Application–hub peering.', 'Application–hub のピアリングを作成します。')]),
      t('summary', 25, l('Enable a broad inspection policy', '広い検査ポリシーを有効化'),
        l('Enable prepared private-summary in app-policy: 10.0.0.0/8 toward Azure Firewall 10.20.1.4. Do not remove direct peering.', 'app-policy の private-summary を有効にします。10.0.0.0/8 を Azure Firewall 10.20.1.4 へ向け、直接ピアリングは削除しないでください。'),
        l('The broad UDR is configured. It is not yet proof that the more-specific Partner destination uses the firewall.', '広い UDR を設定しました。ただし、より具体的な Partner の宛先がファイアウォールを通る証明にはなっていません。'),
        configured(id, enablePolicy('app-policy', 'private-summary', '10.0.0.0/8')), [policy('app', 'app-policy', 'private-summary')]),
      t('predict-prefix', 15, l('Compare competing prefixes', '競合するプレフィックスを比較'),
        l('Inspect the route for 10.22.1.10 after the /8 UDR. Predict the selected path while the /16 direct peering route remains.', '/8 UDR 設定後に 10.22.1.10 のルートを確認してください。直接ピアリングの /16 が残る状態で選択される経路を予測します。'),
        l('Azure first compares prefix length. Partner /16 beats private-summary /8 even though the latter is a UDR. Equal-prefix route source precedence is a separate comparison.', 'Azure はまずプレフィックス長を比較します。Partner /16 は UDR の private-summary /8 より優先されます。同じプレフィックスでのルート ソース優先順位は別の比較です。'),
        quiz(l('Which path wins for 10.22.1.10?', '10.22.1.10 ではどちらが選択されますか？'),
          l('Direct Partner peering /16, not the firewall /8.', 'ファイアウォール /8 ではなく、Partner 直接ピアリング /16。'),
          l('The /8 UDR, because user routes always override all prefix lengths.', 'ユーザー ルートはすべての長さを上書きするので /8 UDR。'),
          l('Longest-prefix matching happens before route-source precedence.', '最長プレフィックス一致はルート ソース優先順位より先です。'), l('UDR priority applies after matching prefix specificity.', 'UDR の優先順位はプレフィックスの具体性を比較した後に適用されます。')),
        [routes('app', 'app-work', '10.22.0.0/16')]),
      t('forward', 25, l('Steer the original request', '元の要求を誘導'),
        l('Enable partner-inspection in app-policy for the original Partner /16 toward 10.20.1.4. Do not edit Partner return yet.', '元の Partner /16 を 10.20.1.4 に向ける app-policy の partner-inspection を有効にしてください。Partner の応答はまだ編集しません。'),
        l('The destination-specific request policy now overrides equal-prefix peering selection. Partner still chooses its reply independently; one repaired direction is not the completed inspection objective.', '宛先固有の要求ポリシーが同じプレフィックスのピアリングより優先されます。Partner は応答を独立して選択するため、一方向の修復だけでは検査目標は完了しません。'),
        configured(id, enablePolicy('app-policy', 'partner-inspection', '10.22.0.0/16')), [policy('app', 'app-policy', 'partner-inspection')]),
      t('return', 25, l('Repair independent reply steering', '独立した応答誘導を修復'),
        l('Enable application-return in partner-policy for Application /16 toward 10.20.1.4. Verify the original service pair through azure-firewall on both legs and retain Operations and tenant boundaries.', 'partner-policy の application-return を有効にし、Application /16 を 10.20.1.4 へ向けてください。元の会話が両方向で azure-firewall を通り、Operations とテナント境界を維持することを検証します。'),
        l('Both delivered routing traces now include the original Azure Firewall. The reply required its own policy; the request UDR did not install it automatically.', '両方向のルーティング トレースに元の Azure Firewall が含まれます。応答には独自のポリシーが必要で、要求 UDR から自動作成されるものではありません。'),
        configured(id, enablePolicy('partner-policy', 'application-return', '10.21.0.0/16'), curriculumV2Requirements[id]), [policy('partner', 'partner-policy', 'application-return')]),
      t('checkpoint', 15, l('State the evidence boundary', '証拠の範囲を説明'),
        l('State what the paired firewall routing evidence supports before handing this comparison to a security reviewer.', 'セキュリティ レビューへ渡す前に、両方向のファイアウォール経路の証拠が裏付ける範囲を述べてください。'),
        l('The managed inspection waypoint is on both modeled routing legs. Actual firewall/NSG permissions, NAT, stateful session handling and application delivery still need independent validation.', 'マネージド検査の経由点がモデル化された両経路に存在します。実際のファイアウォール/NSG 許可、NAT、ステートフル セッション処理、アプリケーション配信には独立した検証が必要です。'),
        quiz(l('What can this result establish?', 'この結果で確認できるものは？'), l('Both routing legs traverse Azure Firewall; security permissions remain separate.', '両ルーティング経路が Azure Firewall を通ります。セキュリティ許可は別です。'),
          l('HTTPS is authorized and a real application session survived.', 'HTTPS が許可され、実アプリケーション セッションが継続しました。'),
          l('This is routing evidence, not packet delivery through enforced policy.', 'これはルーティングの証拠であり、適用されたポリシーを通じた実配信の証明ではありません。'), l('The routing model does not execute firewall security policy.', 'ルーティング モデルはファイアウォールのセキュリティ ポリシーを実行しません。'))),
    ])
}

{
  const id = 'v2-wan', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C03 · Managed spoke transit', 'C03 · マネージド スポーク転送'),
    l('Attach VNets to a Standard Virtual WAN managed hub and inspect Default transit.', 'Standard Virtual WAN のマネージド ハブへ VNet を接続し、Default 転送を確認します。'),
    l('A separate managed-hub comparison retains the service addresses, Operations and detached tenant. Partner is attached; Application and Shared are prepared but disabled. No classic peerings, NVA, BGP or routing intent are present. “Basic” here means introductory routing, not the Basic Virtual WAN product tier.',
      '別のマネージド ハブ比較でサービス アドレス、Operations、未接続テナントを維持します。Partner は接続済みで、Application と Shared は準備済みですが無効です。通常ピアリング、NVA、BGP、ルーティング意図はありません。ここでの「基礎」は入門を意味し、Basic Virtual WAN 製品階層ではありません。'), [
      t('attach-application', 25, l('Attach Application', 'Application を接続'),
        l('Enable Application’s prepared VNet connection to wan-hub. Keep association and propagation on Default. Virtual WAN is the service; wan-hub is its managed regional router; the VNet connection joins Application to it.', 'Application の準備済み wan-hub 接続を有効にします。関連付けと伝達は Default のままにしてください。Virtual WAN はサービス、wan-hub はマネージド リージョナル ルーター、VNet 接続は Application を結ぶ接続です。'),
        l('Application now uses managed hub connectivity to Partner without a direct spoke peering or customer transit VM.', 'Application は直接スポーク ピアリングや顧客転送 VM なしで、マネージド ハブ経由で Partner に接続します。'),
        configured(id, wanAttachment('app'), curriculumV2Requirements[id].slice(0, 4)), [network('app')]),
      t('inspect-default', 10, l('Inspect Default transit', 'Default 転送を確認'),
        l('Inspect wan-hub/defaultRouteTable for Partner 10.22.0.0/16. Compare this hub entry with Application’s workload route.', 'wan-hub/defaultRouteTable の Partner 10.22.0.0/16 を確認し、Application のワークロード ルートと比較してください。'),
        l('You inspected the exact Default hub context. The workload and managed hub are different lookup layers, even when both describe the same destination.', '正確な Default ハブのコンテキストを確認しました。同じ宛先でもワークロードとマネージド ハブは異なるルックアップ階層です。'),
        control({ hubId: 'wan-hub', tableId: 'defaultRouteTable', prefix: '10.22.0.0/16' }), [hubRoutes('wan-hub', 'defaultRouteTable', '10.22.0.0/16')]),
      t('transit', 15, l('Explain the managed alternative', 'マネージドの代替を説明'),
        l('Compare this attached-spoke conversation with the nontransitive ordinary peerings from C01.', 'この接続済みスポーク間の会話と、C01 の推移的でない通常ピアリングを比較してください。'),
        l('The Standard virtual hub provides managed spoke transit. A VNet connection is not a new direct peering between every pair of spokes.', 'Standard 仮想ハブがマネージド スポーク転送を提供します。VNet 接続はすべてのスポーク間に直接ピアリングを作成するものではありません。'),
        quiz(l('Why can attached spokes communicate here?', '接続済みスポークが通信できる理由は？'),
          l('The managed virtual hub supplies transit between its VNet connections.', 'マネージド仮想ハブが VNet 接続間の転送を提供します。'),
          l('Azure made ordinary VNet peering transitive.', 'Azure が通常の VNet ピアリングを推移的にしたためです。'),
          l('The hub router supplies the missing transit function.', 'ハブ ルーターが必要な転送機能を提供します。'), l('Ordinary peering behavior has not changed.', '通常ピアリングの動作は変わっていません。'))),
      t('checkpoint', 25, l('Add a third spoke without peerings', 'ピアリングなしで 3 つ目を追加'),
        l('Enable Shared’s original wan-hub connection on Default. Verify Application–Partner, Application–Shared, Operations and both tenant initiation boundaries without direct spoke peerings.', 'Shared の元の wan-hub 接続を Default で有効にしてください。直接スポーク ピアリングを追加せず、Application–Partner、Application–Shared、Operations、両テナント開始境界を検証します。'),
        l('A third original spoke now participates in managed transit through its connection. This checkpoint verifies the declared conversations; it does not certify every possible spoke or security policy.', '3 つ目の元のスポークが接続経由でマネージド転送に参加します。このチェックポイントは宣言された会話を検証し、あらゆるスポークやセキュリティ ポリシーを認定するものではありません。'),
        configured(id, { ...wanAttachment('shared'), vnetPeerings: [] }, curriculumV2Requirements[id]), [network('shared')]),
    ])
}

{
  const id = 'v2-secured-wan', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  chapter(id, l('C04 · Managed private inspection', 'C04 · マネージド プライベート検査'),
    l('Apply private routing intent through hub Azure Firewall using Default connections.', 'Default 接続でハブ Azure Firewall のプライベート ルーティング意図を適用します。'),
    l('Continue the managed pattern in a prepared snapshot: Application and Partner attached, Shared disabled, tenant detached, hub Azure Firewall ready. All connections use Default. Private intent is off; no custom tables, hybrid gateways, NVA or Internet policy are introduced.',
      '準備済みスナップショットでマネージド構成を継続します。Application と Partner は接続済み、Shared は無効、テナントは未接続でハブ Azure Firewall は準備済みです。すべて Default を使用します。プライベート意図は無効で、カスタム テーブル、ハイブリッド ゲートウェイ、NVA、インターネット ポリシーは導入しません。'), [
      t('placement', 15, l('Compare Firewall placement', 'Firewall の配置を比較'),
        l('Identify hub-firewall and compare it with C02’s AzureFirewallSubnet deployment.', 'hub-firewall を識別し、C02 の AzureFirewallSubnet 配置と比較してください。'),
        l('Both are Azure Firewall, but this one belongs to the managed virtual hub. Private routing intent manages hub steering rather than reproducing C02’s per-workload policies.', 'どちらも Azure Firewall ですが、今回はマネージド仮想ハブに属します。プライベート ルーティング意図がハブ誘導を管理し、C02 のワークロードごとのポリシーを再作成する必要はありません。'),
        quiz(l('Which comparison is accurate?', '正しい比較は？'), l('Same managed firewall service, different hub ownership and steering controls.', '同じマネージド ファイアウォール サービスで、ハブ所有と誘導制御が異なります。'),
          l('This is a vendor NVA requiring guest NIC forwarding and customer HA.', 'これはゲスト NIC 転送と顧客 HA が必要なベンダー NVA です。'),
          l('Hub Azure Firewall is not a customer NVA VM.', 'ハブ Azure Firewall は顧客 NVA VM ではありません。'), l('Do not transfer NVA instance responsibilities to Azure Firewall.', 'NVA インスタンスの責任を Azure Firewall に当てはめないでください。')),
        [g('hub.configure', { hubId: 'wan-hub' }, 'Find the prepared hub Azure Firewall.', '準備済みのハブ Azure Firewall を確認します。')]),
      t('private-intent', 25, l('Enable private routing intent', 'プライベート ルーティング意図を有効化'),
        l('Enable wan-hub’s private routing intent through hub-firewall. Keep Internet intent off and all connections on Default.', 'hub-firewall を使用する wan-hub のプライベート ルーティング意図を有効にします。インターネット意図は無効で、接続はすべて Default のままにしてください。'),
        l('The original private conversation is now routed through the managed hub firewall in both directions. This is not a custom-table segmentation lesson.', '元のプライベート会話が両方向でマネージド ハブ ファイアウォール経由になります。これはカスタム テーブル分離の課題ではありません。'),
        configured(id, { vwanHubs: [{ id: 'wan-hub', firewall: { id: 'hub-firewall' }, routingIntent: { private: true, internet: false } }] }, curriculumV2Requirements[id].slice(0, 4)),
        [g('hub.configure', { hubId: 'wan-hub' }, 'Enable private routing intent only.', 'プライベート ルーティング意図のみを有効にします。')]),
      t('verify-original', 10, l('Check both original private legs', '元のプライベート経路を両方向で確認'),
        l('Freshly inspect app/app-work’s original Partner route 10.22.0.0/16. Then evaluate Application 10.21.1.10 ↔ Partner 10.22.1.10 and inspect independent request/reply traces for wan-hub’s firewall, retaining Operations and tenant boundaries.', 'app/app-work の元の Partner ルート 10.22.0.0/16 を新たに確認してください。続けて Application 10.21.1.10 ↔ Partner 10.22.1.10 を評価し、Operations とテナント境界を維持して wan-hub のファイアウォールを通る要求/応答トレースを独立して確認します。'),
        l('Both modeled private paths have the required hub firewall waypoint. Security policy, NAT and real sessions remain outside this routing assessment.', 'モデル化された両プライベート経路に必要なハブ ファイアウォール経由点があります。セキュリティ ポリシー、NAT、実セッションはこの評価の対象外です。'),
        inspect('app', 'app-work', '10.22.0.0/16', curriculumV2Requirements[id].slice(0, 4)), [routes('app', 'app-work', '10.22.0.0/16')]),
      t('attach-service', 25, l('Attach the new private spoke', '新しいプライベート スポークを接続'),
        l('Enable Shared’s original Default connection. Do not add a workload firewall UDR or direct spoke peering.', 'Shared の元の Default 接続を有効にします。ワークロード ファイアウォール UDR や直接スポーク ピアリングは追加しないでください。'),
        l('The new private spoke inherits managed private steering through the hub policy. No per-spoke UDR was needed for this Default-table pattern.', '新しいプライベート スポークがハブ ポリシーによるマネージド誘導を利用します。この Default 構成にはスポークごとの UDR は不要でした。'),
        configured(id, { ...wanAttachment('shared'), udrTables: [], vnetPeerings: [] }, curriculumV2Requirements[id]), [network('shared')]),
      t('checkpoint', 15, l('Explain policy scope', 'ポリシーの範囲を説明'),
        l('Explain why the newly attached Shared conversation is privately inspected and what this routing result does not say about Internet traffic.', '新たに接続した Shared との会話が検査される理由と、この結果がインターネット トラフィックについて説明しない点を述べてください。'),
        l('Private routing intent governs the declared private Default connections, including Shared. Internet policy is still off. Firewall/NSG permission checks are separate from routing evidence.', 'プライベート ルーティング意図は Shared を含む宣言済みのプライベート Default 接続に適用されます。インターネット ポリシーは無効のままで、ファイアウォール/NSG の許可はルーティング証拠とは別に確認します。'),
        quiz(l('Why does Shared use the firewall without its own UDR?', 'Shared が独自 UDR なしでファイアウォールを使用する理由は？'),
          l('The hub private policy applies to the new Default connection; it does not enable Internet inspection.', 'ハブのプライベート ポリシーが新しい Default 接続に適用されます。インターネット検査は有効になりません。'),
          l('Every private and Internet packet is now permitted by a copied workload UDR.', '複製されたワークロード UDR がすべてのプライベート/インターネット パケットを許可するためです。'),
          l('Managed private steering, not copied workload UDRs, explains this route.', '複製 UDR ではなくマネージド プライベート誘導がこのルートを説明します。'), l('Neither security authorization nor Internet intent was configured.', 'セキュリティ許可もインターネット意図も設定していません。'))),
    ])
}

hybridChapters()

{
  const id = 'v2-nva-ha', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  const packetGuide = g('packet-probe.open', { vnetId: 'application' }, 'Run the original client/client-nic/client-ip → server/server-nic/server-ip TCP 49152→443 probe.', '元の client/client-nic/client-ip → server/server-nic/server-ip の TCP 49152→443 プローブを実行します。')
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
    l('A fictional vendor-only inspection requirement motivates this separate NVA comparison; it is not an Azure Firewall upgrade or a VWAN prerequisite. Existing ER/Warehouse connectivity is context. Original VM/NIC service endpoints are client 10.81.1.10 and server 10.82.1.10. Two forwarding-enabled NVAs and an internal Standard floating HA-ports LB are prepared. Primary is solely eligible, but Partner’s reply is pinned to standby. Operations is local and tenant is detached. Ungraded comparison: Azure Route Server exchanges BGP control-plane routes; it is not a data-plane forwarder or an HA/session solution, and no ARS lab is required.',
      '架空のベンダー専用検査要件により別の NVA 比較を行います。Azure Firewall のアップグレードでも VWAN の前提でもありません。既存 ER/Warehouse 接続は背景です。元の VM/NIC は client 10.81.1.10 と server 10.82.1.10 です。転送有効の 2 NVA と内部 Standard 浮動 HA ポート LB は準備済みです。主系だけが適格ですが、Partner 応答は待機系に固定されています。Operations はローカル、テナントは未接続です。無採点の比較：Azure Route Server は BGP 制御プレーンを交換しますが、データ転送装置でも HA/セッション解決策でもなく、ARS ラボは不要です。'), [
      t('responsibilities', 15, l('Identify customer HA responsibilities', '顧客 HA 責任を識別'),
        l('Compare the prepared vendor NVA pair with C02/C04 Azure Firewall. Identify which responsibilities now belong to the customer.', '準備済みベンダー NVA ペアと C02/C04 の Azure Firewall を比較し、新たな顧客責任を識別してください。'),
        l('NVA instances, health eligibility, forwarding, steering and vendor state compatibility need customer design. Routine NIC forwarding and peering permissions are already prepared; two VMs alone do not create stateful resilience.', 'NVA インスタンス、ヘルス適格性、転送、誘導、ベンダー状態互換性は顧客設計が必要です。通常 NIC 転送とピアリング許可は準備済みで、2 VM だけではステートフル回復性は成立しません。'),
        quiz(l('What changes with customer-managed NVAs?', '顧客管理 NVA で変わるものは？'),
          l('The customer must design backend health, steering, forwarding and vendor state behavior.', '顧客がバックエンド ヘルス、誘導、転送、ベンダー状態動作を設計します。'),
          l('Two VMs automatically inherit Azure Firewall managed HA and session replication.', '2 VM が Azure Firewall のマネージド HA とセッション複製を自動継承します。'),
          l('Redundancy intent and usable symmetric paths are separate.', '冗長化意図と使用可能な対称経路は別です。'), l('A vendor pair is not managed Azure Firewall.', 'ベンダー ペアはマネージド Azure Firewall ではありません。')), [network('hub')]),
      t('inspect-packet', 10, l('Inspect the original selected backend', '元の選択バックエンドを確認'),
        l('Run a fresh native TCP probe using original client/client-nic/client-ip and server/server-nic/server-ip, source port 49152 and destination 443. Inspect the selected forward backend without changing health or return policy.', '元の client/client-nic/client-ip と server/server-nic/server-ip、送信元 49152、宛先 443 の TCP プローブを新たに実行してください。ヘルスや応答ポリシーを変更せず、要求側の選択バックエンドを確認します。'),
        l('You inspected the exact original tuple. The declared primary-only health selects primary for the request; this observation is not yet a symmetric HA qualification.', '正確な元のタプルを確認しました。主系のみの宣言ヘルスが要求に primary を選択しますが、対称 HA の合格ではありません。'),
        { kind: 'packet.inspected', params: { vnetId: 'application', packet: curriculumV2Packet, requirements: invariantRequirements(id) } }, [packetGuide]),
      t('predict-reply', 15, l('Predict the independent reply backend', '独立した応答バックエンドを予測'),
        l('Read remote/remote-work’s Application return policy and the probe’s independent reply evidence. Predict the appliance receiving the reply before making a repair.', 'remote/remote-work の Application 応答ポリシーと独立した応答証拠を読み、修復前に応答を受けるアプライアンスを予測してください。'),
        l('The original reply UDR targets standby 10.80.2.4 directly. Forward primary selection does not rewrite Partner’s independent route.', '元の応答 UDR は standby 10.80.2.4 を直接指定します。要求の primary 選択が Partner の独立ルートを書き換えることはありません。'),
        quiz(l('Where does the unrepaired reply steer?', '未修復の応答はどこへ向かいますか？'),
          l('Directly to standby, independently of the request’s primary selection.', '要求の primary 選択とは独立に standby へ直接向かいます。'),
          l('Automatically to primary because the request used it.', '要求が primary を使用したため自動的に primary へ向かいます。'),
          l('Reply lookup uses its own UDR.', '応答ルックアップは独自 UDR を使います。'), l('A selected forward backend does not install the reverse route.', '要求バックエンドの選択は逆ルートを作成しません。')),
        [routes('remote', 'remote-work', '10.81.0.0/16')]),
      t('diagnose', 35, l('Diagnose asymmetric steering', '非対称誘導を診断'),
        l('Commit the reason this first snapshot does not meet the same-appliance request/reply objective. Preserve Operations and original endpoint identities.', '最初のスナップショットが要求/応答の同一アプライアンス目標を満たさない理由を確定してください。Operations と元のエンドポイント ID を維持します。'),
        l('The asymmetric direct reply pin bypasses the HA-ports selection mechanism. More instances or a forward route alone cannot repair that boundary.', '非対称の直接応答固定が HA ポート選択方式を迂回しています。インスタンス増加や要求ルートだけではこの境界を修復できません。'),
        quiz(l('Which boundary needs repair?', '修復が必要な境界は？'),
          l('Partner return steering bypasses the shared HA-ports frontend.', 'Partner 応答誘導が共有 HA ポート フロントエンドを迂回しています。'),
          l('The original VM identities must be replaced until the selected route happens to pass.', '選択ルートが通るまで元の VM ID を置き換える必要があります。'),
          l('Keep ownership; correct the independent steering mechanism.', '所有を維持し、独立した誘導方式を修正します。'), l('Changing endpoints would evade, not repair, the objective.', 'エンドポイント変更は目標の回避であり修復ではありません。'))),
      t('repair-return', 25, l('Repair reply through the shared frontend', '共有フロントエンド経由の応答を修復'),
        l('Set original remote-path in remote-steering to the existing transit VIP 10.80.3.10, not primary’s IP. Keep Application steering, LB identities and primary-only health unchanged. Verify the exact packet, primary on both legs, Operations and tenant boundaries.', '元の remote-steering の remote-path を primary IP ではなく既存 transit VIP 10.80.3.10 に設定してください。Application 誘導、LB ID、主系のみのヘルスを維持し、正確なパケット、両方向 primary、Operations、テナント境界を検証します。'),
        l('Both original routing legs now use primary through the same preserved-tuple HA-ports mechanism. This proves the first declared configuration, not a live probe transition or replicated vendor session state.', '元の両経路が同じタプル維持 HA ポート方式で primary を使用します。これは最初の宣言構成の証明であり、実プローブ移行やベンダー セッション状態複製ではありません。'),
        configured(id, { ...steering, inventory: { loadBalancers: [{ ...steering.inventory.loadBalancers[0], probes: [{ id: 'transit-probe', health: [
          { target: { workloadId: 'primary-vm', nicId: 'primary-nic', ipConfigurationId: 'primary-ip' }, status: 'healthy' },
          { target: { workloadId: 'standby-vm', nicId: 'standby-nic', ipConfigurationId: 'standby-ip' }, status: 'unhealthy' },
        ] }] }] } }, curriculumV2HaRequirements('primary')),
        [g('route-table.configure', { vnetId: 'remote', subnetId: 'remote-work', routeTableId: 'remote-steering', routeId: 'remote-path' },
          'Edit the independent Partner return policy.', 'Partner の独立した応答ポリシーを編集します。')]),
      t('standby-snapshot', 25, l('Declare the second health snapshot', '2 つ目のヘルス状態を宣言'),
        l('In transit-lb’s original transit-probe health controls, mark primary unhealthy and standby healthy. Do not edit either repaired UDR, frontend, pool or HA-ports rule.', 'transit-lb の元の transit-probe ヘルス設定で primary を unhealthy、standby を healthy にしてください。修復済みの両 UDR、フロントエンド、プール、HA ポート規則は編集しません。'),
        l('The sole eligible original backend is now standby in a new steady-state declaration. Steering remains the original shared VIP in both directions. This is not a live failover experiment.', '新しい定常状態宣言では元の standby だけが適格です。両方向の誘導は元の共有 VIP のままです。実フェイルオーバー実験ではありません。'),
        configured(id, { ...steering, ...health }, curriculumV2HaRequirements('standby')),
        [g('load-balancer.configure', { vnetId: 'hub', loadBalancerId: 'transit-lb' }, 'Edit the original transit-lb health-probe declarations.', '元の transit-lb のヘルス プローブ宣言を編集します。')]),
      t('inspect-standby', 10, l('Re-run the unchanged original packet', '変更していない元のパケットを再実行'),
        l('Run a new completed native trace of the same original TCP 49152→443 packet. Verify standby in both directions using unchanged steering; do not reuse the first state’s trace.', '同じ元の TCP 49152→443 パケットをネイティブで新たにトレースし、完了させてください。変更していない誘導で両方向 standby を確認し、最初の状態のトレースを再利用しないでください。'),
        l('The same original VM/NIC tuple uses standby on both legs in the second declared state. Primary and standby evidence belong to different steps; they are not contradictory assertions against one current topology.', '同じ元の VM/NIC タプルが 2 つ目の宣言状態で両方向 standby を使用します。主系/待機系証拠は別のステップに属し、同じ現在トポロジに対する矛盾した判定ではありません。'),
        { kind: 'packet.inspected', params: { vnetId: 'application', packet: curriculumV2Packet, requirements: curriculumV2HaRequirements('standby') } }, [packetGuide]),
      t('checkpoint', 15, l('Explain two-state steering, not hard pins', '固定ではなく 2 状態誘導を説明'),
        l('Explain why pinning the reply to primary could pass one snapshot but not this two-state objective.', '応答を primary に固定すると 1 状態では通っても、この 2 状態目標には合格できない理由を説明してください。'),
        l('The unchanged shared frontend mechanism supports either declared eligible original backend. A primary IP pin fails when only standby is eligible. Native stable-ID selection is not Azure hash behavior; live health probes, convergence, vendor replication and session survival remain untested.', '変更していない共有フロントエンド方式が、どちらの宣言適格バックエンドにも対応します。primary IP 固定は standby だけが適格な状態で失敗します。ネイティブ安定 ID 選択は Azure ハッシュ動作ではなく、実プローブ、収束、ベンダー複製、セッション継続は未検証です。'),
        quiz(l('What makes the repaired mechanism qualify both snapshots?', '修復方式が両スナップショットに合格する理由は？'),
          l('Both directions use the unchanged shared HA-ports frontend, selecting the eligible backend in each state.', '両方向が変更していない共有 HA ポート フロントエンドを使用し、各状態の適格バックエンドを選択します。'),
          l('A reply pin to primary is resilient because primary was initially healthy.', '最初に primary が正常だったため、primary への応答固定は回復性があります。'),
          l('The steering mechanism, not a first-state backend pin, survives this comparison.', '最初の状態の固定ではなく、誘導方式がこの比較に対応します。'), l('The second state explicitly makes primary ineligible.', '2 つ目の状態では primary は明示的に不適格です。'))),
    ])
}

{
  const id = 'v2-segmentation', t = (s: string, p: number, title: Localized, instruction: Localized, debrief: Localized, check: CheckSpec, anchors: NativeGuidance[] = []) => task(id, s, p, title, instruction, debrief, check, anchors)
  const local = curriculumV2Requirements[id].filter((r) => !['original-regional-service', 'source-regional-route', 'independent-reply-route'].includes(r.id))
  chapter(id, l('C11 · Publish services, not the tenant', 'C11 · テナントでなくサービスを公開'),
    l('Separate lookup association, local propagation and regional label imports.', 'ルックアップ関連付け、ローカル伝達、リージョン間ラベル インポートを区別します。'),
    l('Reset to a separate two-hub custom-table comparison. Routing intent is off to keep this supported segmentation design independent of C04. West Application uses workloads; Local service uses local-services and does not publish into workloads; Operations is already reachable; tenant uses tenant-only. East regional-services already has Application’s return prefix, but West’s destination table has only the local label workloads-local, not the regional publication label shared. Solve local publication before regional import. This is routing isolation, not enforced security policy.',
      '別の 2 ハブ カスタム テーブル比較に切り替えます。C04 と独立した対応済み分離設計にするためルーティング意図は無効です。West Application は workloads、Local は local-services を使用し workloads への公開が不足、Operations は到達可能、テナントは tenant-only です。East regional-services は Application 応答を受信済みですが、West 宛先テーブルは workloads-local ラベルだけでリージョン公開ラベル shared がありません。先にローカル公開、次にリージョン インポートを解決します。これはルーティング分離で、セキュリティ強制ではありません。'), [
      t('inspect-source', 10, l('Inspect the source lookup context', '送信元ルックアップを確認'),
        l('Inspect west-hub/workloads for local service 10.102.0.0/16. Confirm west-app’s association without switching it to Default.', 'west-hub/workloads のローカル サービス 10.102.0.0/16 を確認し、Default に切り替えず west-app の関連付けを確認してください。'),
        l('You inspected Application’s exact associated lookup table. Local service publication is missing there even though its VNet connection is enabled.', 'Application の正確な関連付けルックアップを確認しました。VNet 接続が有効でも、そこにはローカル サービス公開が不足しています。'),
        control({ hubId: 'west-hub', tableId: 'workloads', prefix: '10.102.0.0/16' }), [hubRoutes('west-hub', 'workloads', '10.102.0.0/16')]),
      t('lookup-export', 15, l('Explain lookup versus publication', 'ルックアップと公開を説明'),
        l('Explain the different effects of a connection’s association and propagation fields before editing the local service.', 'ローカル サービスを編集する前に、接続の関連付けと伝達フィールドの異なる効果を説明してください。'),
        l('Association chooses the table used by traffic entering from a connection. Propagation publishes that connection’s owned prefixes into destination tables or labeled contexts. Changing lookup alone does not publish the missing service.', '関連付けは接続から入るトラフィックが使用するテーブルを選びます。伝達は接続の所有プレフィックスを宛先テーブルやラベル対象へ公開します。ルックアップ変更だけでは不足サービスを公開できません。'),
        quiz(l('Which control publishes the local service without moving tenant lookup?', 'テナントのルックアップを移さずローカル サービスを公開する制御は？'),
          l('Local service propagation into workloads; association stays local-services.', 'ローカル サービスを workloads へ伝達し、関連付けは local-services のままにします。'),
          l('Move every connection, including tenant, to Default.', 'テナントを含むすべての接続を Default に移します。'),
          l('Publish selected prefixes rather than widening every lookup.', 'すべてのルックアップを広げるのではなく、選択プレフィックスを公開します。'), l('A blanket Default change abandons the declared boundary.', '一括 Default 変更は宣言した境界を破棄します。'))),
      t('publish-local', 25, l('Publish only the local shared service', 'ローカル共有サービスだけを公開'),
        l('Add workloads to west-local’s propagated table IDs while retaining local-services, its association and tenant-only. Do not repair the regional label yet.', 'west-local の伝達先に workloads を追加し、local-services、関連付け、tenant-only を維持してください。リージョン ラベルはまだ修復しません。'),
        l('Local service now appears in the source workloads context and has an independent return via local-services. Operations and both tenant initiation boundaries remain unchanged.', 'ローカル サービスが送信元 workloads に現れ、local-services 経由の独立応答を持ちます。Operations と両テナント開始境界は変わりません。'),
        configured(id, { vnets: [
          { id: 'west-local', vwanHubAttachment: { hubId: 'west-hub', enabled: true, hubRouting: { associatedTableId: 'local-services', propagatedTableIds: ['local-services', 'workloads'] } } },
          { id: 'west-tenant', vwanHubAttachment: { hubRouting: { associatedTableId: 'tenant-only', propagatedTableIds: ['tenant-only'], labels: ['tenant'] } } },
        ] }, local), [g('hub.configure', { hubId: 'west-hub' }, 'Open the original local service connection propagation controls.', '元のローカル サービス接続の伝達設定を開きます。')]),
      t('inspect-local', 10, l('Inspect the repaired local table', '修復済みローカル テーブルを確認'),
        l('Freshly inspect west-hub/workloads for 10.102.0.0/16. Review the local conversation, Operations, and both tenant initiation directions before progressing regionally.', 'west-hub/workloads の 10.102.0.0/16 を新たに確認し、リージョン間へ進む前にローカル会話、Operations、両テナント開始方向を確認してください。'),
        l('You inspected the repaired local publication in its exact context. This does not claim the regional service fault is already fixed.', '正確なコンテキストで修復済みローカル公開を確認しました。リージョン サービス障害が既に修復されたとは主張しません。'),
        control({ hubId: 'west-hub', tableId: 'workloads', prefix: '10.102.0.0/16' }), [hubRoutes('west-hub', 'workloads', '10.102.0.0/16')]),
      t('inspect-regional-reply', 10, l('Inspect independent regional return', '独立したリージョン応答を確認'),
        l('Inspect east-hub/regional-services for Application 10.101.0.0/16, then compare the missing 10.103.0.0/16 entry in west-hub/workloads.', 'east-hub/regional-services の Application 10.101.0.0/16 を確認し、west-hub/workloads の不足 10.103.0.0/16 と比較してください。'),
        l('You inspected the remote return table. It can already contain Application’s prefix while the source table still lacks the regional service. The two table observations are not interchangeable.', 'リモート応答テーブルを確認しました。そこに Application が存在しても送信元テーブルにはリージョン サービスが不足する場合があります。2 つの観測を代用することはできません。'),
        control({ hubId: 'east-hub', tableId: 'regional-services', prefix: '10.101.0.0/16' }), [hubRoutes('east-hub', 'regional-services', '10.101.0.0/16')]),
      t('regional-label', 25, l('Correct the regional destination label', 'リージョン宛先ラベルを修正'),
        l('Match west-hub/workloads’ destination label to the original regional publication label shared. Keep exact associations and tenant-only; do not substitute Default or enable routing intent.', 'west-hub/workloads の宛先ラベルを元のリージョン公開ラベル shared に一致させます。正確な関連付けと tenant-only を維持し、Default への置き換えやルーティング意図の有効化はしないでください。'),
        l('The original regional service and independent reply now have routes in their exact custom contexts. Local service, Operations and both tenant initiation boundaries remain qualified.', '元のリージョン サービスと独立応答が正確なカスタム コンテキストにルートを持ちます。ローカル サービス、Operations、両テナント開始境界も合格のままです。'),
        configured(id, { vwanHubs: [{ id: 'west-hub', routingIntent: { private: false, internet: false }, routeTables: [{ id: 'workloads', labels: ['shared'] }] }],
          vnets: [{ id: 'west-app', vwanHubAttachment: { hubRouting: { associatedTableId: 'workloads' } } },
            { id: 'east-service', vwanHubAttachment: { hubRouting: { associatedTableId: 'regional-services' } } },
            { id: 'west-tenant', vwanHubAttachment: { hubRouting: { associatedTableId: 'tenant-only', propagatedTableIds: ['tenant-only'], labels: ['tenant'] } } }] }, curriculumV2Requirements[id]),
        [g('hub.configure', { hubId: 'west-hub' }, 'Compare the destination workload-table label with the regional publication.', '宛先ワークロード テーブルのラベルとリージョン公開を比較します。')]),
      t('checkpoint', 15, l('Explain scoped publication and isolation', '限定公開と分離を説明'),
        l('Explain why local table IDs and regional labels are different propagation scopes, and why the tenant remains isolated.', 'ローカル テーブル ID とリージョン ラベルが異なる伝達範囲である理由と、テナント分離を維持できる理由を説明してください。'),
        l('Local propagation targets owned hub table IDs; matching destination labels enable the regional publication. Tenant prefixes are not published into workloads and tenant-only lacks Application’s initiation route. These are routing boundaries, not firewall/NSG enforcement.', 'ローカル伝達は所有ハブ テーブル ID を対象にし、宛先ラベル一致がリージョン公開を可能にします。テナントは workloads に公開されず、tenant-only に Application 開始ルートがありません。これはルーティング境界であり、ファイアウォール/NSG 強制ではありません。'),
        quiz(l('Which design preserves the declared boundaries?', '宣言した境界を維持する設計は？'),
          l('Selected local table publication and matching regional labels, with tenant association/export kept separate.', '選択したローカル テーブル公開と一致するリージョン ラベルを使い、テナント関連付け/エクスポートを分離します。'),
          l('Publish every prefix everywhere because propagation is only a display setting.', '伝達は表示設定だけなので、すべてのプレフィックスを全対象へ公開します。'),
          l('Export controls affect real modeled lookup reachability.', 'エクスポート制御はモデル化ルックアップの到達性に影響します。'), l('Unrestricted propagation would invalidate tenant routing isolation.', '無制限伝達はテナントのルーティング分離を無効にします。'))),
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
      '未知の小売環境は既習の 2 ハブ カスタム ルーティングと正常な ExpressRoute 倉庫接続を使用します。新 checkout API 10.141.1.10 と order service 10.143.1.10 が会話する必要があります。Inventory 10.142.1.10 と Operations 10.144.1.10 は正常で、tenant 10.145.1.10 は両開始方向で分離を維持します。サービス両方向には独立したルーティング障害があります。元の接続、テーブル、ゲートウェイは準備済みです。ハイブリッド拠点は正しく Default に関連付けられ、応答用の選択ワークロード公開も準備済みです。新技術は導入しません。修復判断前に元の送信元と応答コンテキストを確認してください。'), [
      t('inspect-source', 10, l('Inspect the original source boundary', '元の送信元境界を確認'),
        l('Inspect west-hub/workloads for the original order-service prefix 10.143.0.0/16. Compare with working Inventory and Operations without changing anything.', '変更せず、west-hub/workloads の元の order-service プレフィックス 10.143.0.0/16 を確認し、正常な Inventory と Operations と比較してください。'),
        l('You inspected the original source context and working controls. A service-specific missing route is different from a general hub or gateway outage.', '元の送信元コンテキストと正常な対照を確認しました。サービス固有の不足ルートはハブ/ゲートウェイ全体の障害とは異なります。'),
        control({ hubId: 'west-hub', tableId: 'workloads', prefix: '10.143.0.0/16' }), [hubRoutes('west-hub', 'workloads', '10.143.0.0/16')]),
      t('inspect-reply', 10, l('Inspect the independent reply boundary', '独立した応答境界を確認'),
        l('Inspect east-hub/regional-services for the original checkout prefix 10.141.0.0/16. Do not assume the source observation proves the reply.', 'east-hub/regional-services の元の checkout プレフィックス 10.141.0.0/16 を確認してください。送信元の観測で応答を証明したと考えないでください。'),
        l('You inspected a second, independent route context. The missing reply publication cannot be inferred solely from the source service lookup.', '2 つ目の独立ルート コンテキストを確認しました。応答公開不足は送信元サービス ルックアップだけから判断できません。'),
        control({ hubId: 'east-hub', tableId: 'regional-services', prefix: '10.141.0.0/16' }), [hubRoutes('east-hub', 'regional-services', '10.141.0.0/16')]),
      t('diagnose', 35, l('Commit an evidence-backed diagnosis', '証拠に基づく診断を確定'),
        l('Use the two exact observations to identify the independent forward and reply boundaries and the working invariants to preserve.', '正確な 2 観測から独立した要求/応答境界と維持すべき正常不変条件を特定してください。'),
        l('The missing regional service import and missing checkout return publication are independent. Working Inventory, Operations and Warehouse argue against replacing hubs or widening tenant routing.', 'リージョン サービス インポート不足と checkout 応答公開不足は独立しています。正常な Inventory、Operations、Warehouse はハブ置き換えやテナント経路拡大が不要な根拠です。'),
        quiz(l('Which diagnosis fits both scoped observations?', '両対象の観測に適合する診断は？'),
          l('Independent service publication/import gaps affect forward and reply; preserve working services, ownership and tenant scope.', '独立したサービス公開/インポート不足が要求と応答に影響しています。正常サービス、所有、テナント範囲を維持します。'),
          l('A single dead ER gateway explains all traffic, so move tenant and services into Default.', '単一 ER ゲートウェイ停止が全トラフィックを説明するため、テナントとサービスを Default へ移します。'),
          l('The two exact table gaps and working witnesses support two scoped repairs.', '正確な 2 テーブルの不足と正常対照が 2 つの限定修復を裏付けます。'), l('Warehouse works and the failed service is an independent regional routing problem.', 'Warehouse は正常で、障害サービスは独立したリージョン ルーティング問題です。'))),
      t('repair-forward', 25, l('Repair the first observed boundary', '最初の観測境界を修復'),
        l('Repair publication so the original 10.143.0.0/16 service appears in west-hub/workloads. Keep endpoint ownership, current associations, working local/hybrid paths and tenant scope unchanged. The reply problem remains for the next action.', '元の 10.143.0.0/16 が west-hub/workloads に現れるよう公開を修復します。エンドポイント所有、現在の関連付け、正常ローカル/ハイブリッド経路、テナント範囲を維持してください。応答問題は次の操作で扱います。'),
        l('The source now has its original service route. This intermediate check does not claim the full conversation works before the independent reply repair.', '送信元が元のサービス ルートを持ちます。この途中確認は、独立応答の修復前に全会話が正常だとは主張しません。'),
        configured(id, { vnets: keep.vnets.map((v) => v.id === 'east-service'
          ? { ...v, vwanHubAttachment: { ...v.vwanHubAttachment, hubRouting: { ...v.vwanHubAttachment.hubRouting, labels: ['shared'] } } } : v) }, firstRequirements),
        [g('hub.configure', { hubId: 'east-hub' }, 'Open the original regional service publication controls.', '元のリージョン サービス公開設定を開きます。')], [l('Compare the original service connection’s publication scope with the destination workloads label; do not move the source lookup.', '元のサービス接続の公開範囲と宛先 workloads ラベルを比較し、送信元ルックアップを移さないでください。'),
          l('The existing destination labels match shared. Restore the original east-service publication to shared while keeping its table association.', '既存の宛先ラベルは shared です。テーブル関連付けを維持して元の east-service の shared 公開を復元します。')]),
      t('repair-reply', 25, l('Repair the independent reply boundary', '独立した応答境界を修復'),
        l('Repair the original checkout publication so 10.141.0.0/16 appears in east-hub/regional-services. Retain the first repair and all working/invariant scopes; do not rename endpoints or move tenant.', '元の checkout 公開を修復し、10.141.0.0/16 を east-hub/regional-services に表示させてください。最初の修復と全正常/不変範囲を維持し、エンドポイント改名やテナント移動をしないでください。'),
        l('Both original service directions now qualify alongside Inventory, Operations, Warehouse and both tenant initiation boundaries. Two different connection publications—not an endpoint substitution—were repaired.', '元のサービス両方向、Inventory、Operations、Warehouse、両テナント開始境界が合格しました。エンドポイント代用ではなく、異なる 2 接続の公開を修復しました。'),
        configured(id, { vnets: keep.vnets.map((v) => v.id !== 'west-tenant'
          ? { ...v, vwanHubAttachment: { ...v.vwanHubAttachment, hubRouting: { ...v.vwanHubAttachment.hubRouting, labels: ['shared'] } } } : v) }, curriculumV2Requirements[id]),
        [g('hub.configure', { hubId: 'west-hub' }, 'Open the original checkout connection publication controls.', '元の checkout 接続の公開設定を開きます。')], [l('The reply uses east-hub/regional-services; inspect how the original west-app prefix reaches that labeled context.', '応答は east-hub/regional-services を使用します。元の west-app がそのラベル対象へ届く公開方式を確認してください。'),
          l('Restore west-app’s shared label publication without removing its prepared local table targets.', '準備済みローカル テーブル宛先を削除せず、west-app の shared ラベル公開を復元します。')]),
      t('checkpoint', 50, l('Hand over bounded paired evidence', '限定された両方向証拠を引き渡す'),
        l('Review the repaired original checkout/order pair, working Inventory/Operations/Warehouse and both blocked tenant initiations. Choose the defensible handover conclusion, including what still needs production validation.', '修復済みの元 checkout/order、正常 Inventory/Operations/Warehouse、両テナント開始の遮断を確認し、本番で追加検証すべき点を含む妥当な引き継ぎ結論を選んでください。'),
        l('You diagnosed and repaired two independent familiar boundaries without changing ownership or widening the tenant. The modeled paired routing and preserved witnesses support a bounded handover—not production certification, security enforcement, physical diversity, live failover or application/session continuity.', '所有変更やテナント拡大なしで、既知の独立した 2 境界を診断・修復しました。モデル化された両方向ルーティングと維持した対照が限定引き継ぎを支えます。本番認定、セキュリティ強制、物理多様性、実フェイルオーバー、アプリ/セッション継続の証明ではありません。'),
        quiz(l('Which handover claim is supported?', '裏付けられる引き継ぎ主張は？'),
          l('Original paired routing and declared boundaries pass; security, live delivery and resilience claims need independent validation.', '元の両方向ルーティングと宣言境界は合格です。セキュリティ、実配信、回復性主張には独立検証が必要です。'),
          l('Passing logical routes certifies all production security rules and outage/session behavior.', '論理ルート合格ですべての本番セキュリティ規則と障害/セッション動作が認定されます。'),
          l('The conclusion names both what was evaluated and what was not.', '結論は評価済みと未評価の両方を明記します。'), l('A logical model cannot certify unexecuted production behavior.', '論理モデルは未実行の本番動作を認定できません。'))),
    ])
}

export const curriculumV2Bundle: CourseBundle = {
  schemaVersion: 1, course: curriculumV2Course, lessons,
  scenarios: curriculumV2LessonIds.map((id) => ({ id, document: { mode: 'full', topology: curriculumV2Topologies[id] } })),
  checks, guidance,
}
