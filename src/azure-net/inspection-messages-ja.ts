import { registerJapaneseMessages } from '../messages'

registerJapaneseMessages({
  'Representative pair: directional inspection and route evidence': '代表ペア: 方向別の検査とルートの根拠',
  'Modeled path': 'モデル上の経路',
  'Inspection': '検査',
  'No associated route table': '関連付けられたルート テーブルなし',
  'Bypasses {0}. Stateful inspection may drop traffic because both directions do not traverse the same appliance.': '{0} を迂回します。両方向が同じアプライアンスを通過しないため、ステートフル検査でトラフィックが破棄される可能性があります。',
  'Divergence evidence: compare the selected subnet routes above. Paths represent sampled addresses, not exhaustive ECMP, live delivery or firewall policy/session validation.': '分岐の根拠: 上記の選択済みサブネット ルートを比較してください。経路はサンプル アドレスの結果であり、ECMP の網羅、実際の配信、ファイアウォール ポリシーやセッションの検証ではありません。',
  'Proposed, unverified repair': '修正案 (未検証)',
  'Bypass route decision: {0}.': '迂回ルートの選択箇所: {0}。',
  'This steers the destination prefix toward the appliance missing from this direction. The proposed path has not been retraced.': 'この宛先プレフィックスを、この方向で通過していないアプライアンスに転送する案です。提案した経路の再検証は実施していません。',
  '{0}: {1} a {2} UDR in route table {3}.': '{0}: ルート テーブル {3} の {2} UDR を{1}してください。',
  '{0}: create a same-region route table, associate it with this subnet and add a {1} UDR.': '{0}: 同じリージョンにルート テーブルを作成してこのサブネットに関連付け、{1} UDR を追加してください。',
  'Next hop: VirtualAppliance {0} ({1}).': '次ホップ: VirtualAppliance {0} ({1})。',
  'This table affects {0} associated subnets. Keep required gateway/BGP routes; recheck both directions and other affected flows before adopting the change.': 'このテーブルは関連付けられた {0} 個のサブネットに影響します。必要なゲートウェイ/BGP ルートを維持し、変更を採用する前に両方向と他の影響を受けるフローを再確認してください。',
  'Configure {0}': '{0} を構成',
  'No safe subnet UDR proposal established. Inspect the directional routes and design the required service chain; do not assume a default route is a repair.': '安全なサブネット UDR 修正案は確立されていません。方向別のルートを確認し、必要なサービス チェーンを設計してください。既定のルートを追加すれば修正できるとは限りません。',
})
