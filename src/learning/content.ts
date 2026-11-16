import type { Language } from '../messages'

export type Localized = { en: string; ja: string }
export const text = (value: Localized, language: Language) => value[language]
export const contentVersion = 1
export type ConceptId = 'selection' | 'hrp' | 'contexts' | 'peering' | 'inspection' | 'coverage'

export const concepts: Record<ConceptId, { title: Localized; body: Localized; source: string }> = {
  selection: {
    title: { en: 'Routes and longest-prefix matching', ja: 'ルートと最長プレフィックス一致' },
    body: {
      en: 'A forwarding lookup first finds the most specific matching destination prefix. Best-path selection compares candidates for the same prefix; it is not a comparison between a /24 and a /16. Inspect the selected table, its candidates and the return path. Equal-cost alternatives do not predict a particular traffic hash.',
      ja: '転送では宛先に一致する最も具体的なプレフィックスを選びます。ベストパス選択は同じプレフィックスの候補を比較するもので、/24 と /16 の比較ではありません。選択されたテーブル、候補、戻り経路を確認してください。等コスト経路から個々の通信のハッシュは予測できません。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview',
  },
  hrp: {
    title: { en: 'Virtual hub routing preference', ja: '仮想ハブのルーティング優先設定' },
    body: {
      en: 'Hub routing preference participates in Virtual WAN best-path selection for competing branch routes. It does not replace longest-prefix matching, route-table scope or routing intent. Use the engine reasons for the exact decision rather than assuming every route follows the preferred transport. The simulator reevaluates immediately; live Azure routes may need to be bounced after a preference change.',
      ja: 'ハブのルーティング優先設定は Virtual WAN の競合する拠点ルートの選択に関わります。最長プレフィックス一致、テーブルのスコープ、ルーティング インテントを置き換えるものではありません。すべてのルートが優先トランスポートを使うと仮定せず、エンジンの選択理由を確認してください。シミュレーターは即座に再評価しますが、実際の Azure では変更後にルートの再広告が必要になる場合があります。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference',
  },
  contexts: {
    title: { en: 'Association, propagation and table scope', ja: '関連付け、伝達、テーブルのスコープ' },
    body: {
      en: 'Association chooses the hub table used by a connection for forwarding. Propagation controls where its routes are exported; labels and table IDs are not interchangeable. A route visible in one table need not exist in another. Missing captured association or propagation controls are unknown, not proof of reachability or isolation.',
      ja: '関連付けは接続が転送に使うハブ テーブルを選びます。伝達はルートのエクスポート先を制御し、ラベルとテーブル ID は同じものではありません。あるテーブルに見えるルートが別のテーブルに存在するとは限りません。取得できなかった関連付けや伝達の設定は不明であり、到達性や分離の証明にはなりません。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing',
  },
  peering: {
    title: { en: 'Peering and bidirectional connectivity', ja: 'ピアリングと双方向の接続' },
    body: {
      en: 'VNet peering connects address spaces, but ordinary peering is not transitive. Forwarded traffic and gateway transit have separate controls. A visible address-space route is not proof that access is allowed. Check both directions and the actual forwarding result, not just route presence.',
      ja: 'VNet ピアリングはアドレス空間を接続しますが、通常のピアリングに推移性はありません。転送されたトラフィックとゲートウェイ転送には別々の設定があります。アドレス空間のルートが見えていても、アクセスが許可される証明にはなりません。ルートの有無だけでなく、両方向と実際の転送結果を確認してください。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview',
  },
  inspection: {
    title: { en: 'Routing intent and inspection', ja: 'ルーティング インテントと検査' },
    body: {
      en: 'Modeled firewall or appliance traversal describes the forwarding path, not a firewall-policy verdict. Return paths may differ from forward paths. This simulator does not verify firewall rules, NAT, session state, application delivery or a live packet capture.',
      ja: 'モデル上のファイアウォールやアプライアンスの通過は転送経路を表し、ファイアウォール ポリシーの判定ではありません。戻り経路は往路と異なる場合があります。このシミュレーターはファイアウォール規則、NAT、セッション状態、アプリケーション配信、実際のパケット キャプチャを検証しません。',
    },
    source: 'https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies',
  },
  coverage: {
    title: { en: 'Evidence, uncertainty and practice awards', ja: '根拠、不確実性、練習の達成' },
    body: {
      en: 'Satisfied means the explicit requirement passed in the modeled snapshot. Violated means the engine found contrary evidence. Not assessed means the inputs, ownership, scope or analysis do not justify a decision. A missing route is not automatically a verified deny. Local practice badges are editable local history, not certification or server-verified awards. Basic help and grading run locally without an AI subscription.',
      ja: '「達成」は明示された要件がモデルのスナップショットで満たされたことを示します。「未達成」はエンジンが反証を検出したことを示します。「評価不能」は入力、所有関係、スコープ、分析が判定に十分でないことを示します。ルートがないだけで拒否が検証されたとは限りません。ローカルの練習バッジは編集可能な履歴であり、認定やサーバー検証済みの賞ではありません。基本の説明と評価は AI 契約なしでローカルに実行されます。',
    },
    source: '/docs/index.html',
  },
}

export const labels = {
  explain: { en: 'Explain this', ja: '説明を表示' },
  source: { en: 'Source reference (opens only when selected)', ja: '参考資料（選択時のみ開きます）' },
  evidence: { en: 'Reasons from this modeled result', ja: 'このモデルの結果に基づく理由' },
  noEvidence: { en: 'No decision evidence is available here. This concept is not a claim about this route.', ja: 'ここには選択の根拠がありません。この概念の説明は、このルートの判定を主張するものではありません。' },
  snapshot: { en: 'Explanations describe this modeled snapshot, not verified live Azure behavior.', ja: '説明はこのモデルのスナップショットについてのもので、実際の Azure の動作を検証したものではありません。' },
} satisfies Record<string, Localized>
