import type { Localized } from './content'
import type { CourseBundle } from './course-contract'
import type { BeltAchievement } from './belt-achievement'

type BeltStage = { beltId: string; lessonIds: string[]; title: Localized; introduction: Localized; topics: Localized[] }
const l = (en: string, ja: string): Localized => ({ en, ja })

export const beltStages: Record<string, BeltStage[]> = {
  'azure-routing-scenarios': [
    { beltId: 'yellow', lessonIds: ['private-link'], title: l('Private connectivity', 'プライベート接続'),
      introduction: l('Your first stage builds a private path between two services: identify their address ranges, read effective routes, then connect their VNets.',
        '最初のステージでは、2 つのサービス間のプライベート経路を作ります。アドレス範囲を特定し、有効なルートを読み、VNet を接続します。'),
      topics: [
        l('Address ranges, default routes and effective-route sources', 'アドレス範囲、既定のルート、有効なルートの生成元'),
        l('VNet peering and its subnet-wide reach', 'VNet ピアリングと VNet 内のサブネットへの到達範囲'),
        l('Peering access permission versus the presence of a route', 'ピアリングのアクセス許可とルートの存在の違い'),
      ] },
    { beltId: 'orange', lessonIds: ['inspection-bypass'], title: l('Route selection and inspection', 'ルート選択と検査'),
      introduction: l('This stage turns private connectivity into deliberate routing policy. Build an inspection hub, introduce UDRs gradually, and explain which overlapping route wins.',
        'このステージでは、プライベート接続に明確なルーティング ポリシーを加えます。検査ハブを構築し、UDR を段階的に導入して、重複するルートの優先順位を説明します。'),
      topics: [
        l('Hub-and-spoke purpose and non-transitive peering', 'ハブアンドスポークの目的とピアリングの非推移性'),
        l('Subnet route-table associations and user-defined routes', 'サブネットのルート テーブル関連付けとユーザー定義ルート'),
        l('Longest-prefix matching, equal-prefix preference and independent replies', '最長プレフィックス一致、同一プレフィックスの優先順位、独立した復路'),
      ] },
    { beltId: 'green', lessonIds: ['colocated-chain'], title: l('Service chains within a VNet', 'VNet 内のサービス チェーン'),
      introduction: l('Now compose an inspection path inside one VNet. Follow forwarding from one appliance to the next instead of assuming that selecting the first hop completes the chain.',
        '次は、1 つの VNet 内に検査経路を組み立てます。最初のネクストホップを選ぶだけでチェーンが完成するとは考えず、アプライアンス間の転送を追います。'),
      topics: [
        l('Firewall and NVA placement within a shared VNet', '共通の VNet 内のファイアウォールと NVA の配置'),
        l('Appliance-subnet routing and modeled IP forwarding', 'アプライアンス サブネットのルーティングとモデル化された IP 転送'),
        l('Forward and return paths through a service chain', 'サービス チェーンを通る往路と復路'),
      ] },
    { beltId: 'blue', lessonIds: ['dedicated-chain'], title: l('Transit across VNet boundaries', 'VNet 境界を越える中継'),
      introduction: l('Move from colocated appliances to dedicated networks. Separate IP forwarding, peering permissions and route selection when building a cross-VNet service chain.',
        '同じ VNet 内のアプライアンスから専用ネットワークへ進みます。VNet をまたぐサービス チェーンで、IP 転送、ピアリングの許可、ルート選択を区別します。'),
      topics: [
        l('Dedicated appliance VNets and explicit transit paths', '専用アプライアンス VNet と明示的な中継経路'),
        l('Forwarded-traffic permission versus direct VNet access', '転送トラフィックの許可と直接の VNet アクセスの違い'),
        l('Forwarding and return routing across network boundaries', 'ネットワーク境界を越える転送と復路のルーティング'),
      ] },
    { beltId: 'brown', lessonIds: ['branch-advertisement', 'wan-isolation'], title: l('Branch connectivity and managed WAN', '拠点接続とマネージド WAN'),
      introduction: l('Extend your routing reasoning beyond VNet peers. Compare Azure and branch routes, then use managed hub tables to connect shared services without opening an isolated tenant.',
        'VNet 間のピアリングから、拠点を含むルーティングへ進みます。Azure と拠点のルートを比較し、マネージド ハブのテーブルを使って、分離されたテナントを開放せずに共有サービスへ接続します。'),
      topics: [
        l('Gateway/BGP routes and independent branch advertisements', 'ゲートウェイと BGP のルート、独立した拠点の広告'),
        l('Virtual WAN association as lookup and propagation as export', '検索先としての Virtual WAN の関連付け、伝達先としてのルート伝達'),
        l('Shared-service reachability with tenant isolation preserved', 'テナント分離を維持した共有サービスへの到達性'),
      ] },
    { beltId: 'black', lessonIds: ['tiered-incident', 'ha-return-path'], title: l('Multi-tier diagnosis and resilient paths', '多層構成の診断と冗長経路'),
      introduction: l('The core capstone combines the earlier ideas. Diagnose separate faults across application tiers, then compare HA intent with the actual selected forward and return paths.',
        '基礎コースの総合課題で、これまでの考え方を組み合わせます。アプリケーション層間の別々の障害を診断し、冗長化の意図と実際に選択された往路・復路を比較します。'),
      topics: [
        l('Original packet endpoints and independent multi-tier faults', '元のパケットのエンドポイントと多層構成の独立した障害'),
        l('HA appliance selection and return-path symmetry', '冗長アプライアンスの選択と復路の対称性'),
        l('Bounded routing evidence, not proof of production failover or session survival', '限定されたルートの根拠。本番のフェールオーバーやセッション維持の証明ではないこと'),
      ] },
  ],
  'azure-networking-preview': [
    { beltId: 'yellow', lessonIds: ['direct-peering'], title: l('Private connectivity', 'プライベート接続'),
      introduction: l('Begin with two isolated services. Build a private peering path and explain what it does, and what it does not connect automatically.',
        '分離された 2 つのサービスから始めます。プライベート ピアリング経路を構築し、接続できる範囲と自動では接続されない範囲を説明します。'),
      topics: [l('Effective routes and private VNet peering', '有効なルートとプライベート VNet ピアリング'),
        l('Independent return paths and non-transitive connectivity', '独立した復路と非推移的な接続性')] },
    { beltId: 'orange', lessonIds: ['route-override'], title: l('Routing policy', 'ルーティング ポリシー'),
      introduction: l('Next, distinguish connectivity from policy. Repair a subnet UDR and explain why equal-prefix route source preference changes the selected path.',
        '次に、接続性とポリシーを区別します。サブネットの UDR を修復し、同一プレフィックスで生成元の優先順位が経路を変える理由を説明します。'),
      topics: [l('Subnet-scoped UDRs and the None next hop', 'サブネット単位の UDR と None ネクストホップ'),
        l('Equal-prefix source preference and restored reachability', '同一プレフィックスでの生成元の優先順位と到達性の復旧')] },
    { beltId: 'green', lessonIds: ['prefix-outage'], title: l('Overlapping routes', '重複するルート'),
      introduction: l('Now compare destinations at different prefix lengths. A broad inspection policy can lose to a more specific route even when its source normally has priority.',
        '次は、異なる長さの宛先プレフィックスを比較します。生成元の優先順位が高い検査ポリシーでも、より具体的なルートが優先される場合があります。'),
      topics: [l('Longest-prefix matching before source preference', '生成元の優先順位より先に適用する最長プレフィックス一致'),
        l('Summary routes, inspection bypass and subnet-specific repairs', '集約ルート、検査の迂回、サブネット固有の修復')] },
    { beltId: 'blue', lessonIds: ['gateway-return'], title: l('Gateway and return routing', 'ゲートウェイと復路のルーティング'),
      introduction: l('Extend the path to a branch. Treat gateway transit, received BGP routes and the branch reply as separate routing questions.',
        '経路を拠点へ拡張します。ゲートウェイ中継、受信 BGP ルート、拠点からの応答を、別々のルーティングの問題として扱います。'),
      topics: [l('Gateway transit and workload BGP routes', 'ゲートウェイ中継とワークロードの BGP ルート'),
        l('Branch return advertisements and routing-evidence limits', '拠点の復路広告とルートの根拠の限界')] },
    { beltId: 'brown', lessonIds: ['secured-wan'], title: l('Managed WAN isolation', 'マネージド WAN の分離'),
      introduction: l('Apply the same reasoning to Virtual WAN. Choose lookup and propagation scopes deliberately while preserving an isolated connection.',
        '同じ考え方を Virtual WAN に適用します。分離された接続を維持しながら、検索先と伝達先の範囲を意図的に選びます。'),
      topics: [l('Hub lookup tables versus propagation targets', 'ハブの検索テーブルと伝達先の違い'),
        l('Secured paths and preserved isolation boundaries', 'セキュリティを備えた経路と分離境界の維持')] },
    { beltId: 'black', lessonIds: ['hybrid-incident'], title: l('Independent-fault diagnosis', '独立した障害の診断'),
      introduction: l('Finish the core path by diagnosing a hybrid incident. Separate independent faults, protect unrelated services, and state what the modeled evidence can actually support.',
        '最後はハイブリッド構成の障害を診断します。独立した障害を区別し、無関係なサービスを保護して、モデルの根拠が実際に裏付けられる範囲を明示します。'),
      topics: [l('Source-side policy, gateway transit and independent branch replies', '送信元のポリシー、ゲートウェイ中継、独立した拠点の応答'),
        l('Outcome-based repair and honest limits of modeled evidence', '結果に基づく修復とモデル化された根拠の限界')] },
  ],
}

export function stageForLesson(courseId: string, lessonId: string) {
  return beltStages[courseId]?.find((stage) => stage.lessonIds.includes(lessonId))
}

export function achievedStages(achievement: BeltAchievement) {
  const stages = beltStages[achievement.courseId] ?? []
  const previous = stages.findIndex((stage) => stage.beltId === achievement.previousBeltId)
  const next = stages.findIndex((stage) => stage.beltId === achievement.beltId)
  return stages.slice(previous + 1, next + 1)
}

export function introduceBeltStages(bundle: CourseBundle) {
  for (const stage of beltStages[bundle.course.id] ?? []) {
    const lesson = bundle.lessons.find((entry) => entry.id === stage.lessonIds[0])!
    const opening = lesson.tasks.find((task) => task.id === lesson.taskOrder[0])!.debrief!
    opening.paragraphs[0] = l(`${stage.introduction.en} ${opening.paragraphs[0].en}`, `${stage.introduction.ja} ${opening.paragraphs[0].ja}`)
  }
}
