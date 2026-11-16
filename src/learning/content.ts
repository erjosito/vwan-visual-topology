import type { Language } from '../messages'

export type Localized = { en: string; ja: string }
export const text = (value: Localized, language: Language) => value[language]
export const contentVersion = 1
export type ConceptId = 'selection' | 'hrp' | 'contexts' | 'peering' | 'inspection' | 'coverage'

export const concepts: Record<ConceptId, { title: Localized; source: string }> = {
  selection: {
    title: { en: 'Routes and longest-prefix matching', ja: 'ルートと最長プレフィックス一致' },
    source: 'https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview',
  },
  hrp: {
    title: { en: 'Virtual hub routing preference', ja: '仮想ハブのルーティング優先設定' },
    source: 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing-preference',
  },
  contexts: {
    title: { en: 'Association, propagation and table scope', ja: '関連付け、伝達、テーブルのスコープ' },
    source: 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing',
  },
  peering: {
    title: { en: 'Peering and bidirectional connectivity', ja: 'ピアリングと双方向の接続' },
    source: 'https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview',
  },
  inspection: {
    title: { en: 'Routing intent and inspection', ja: 'ルーティング インテントと検査' },
    source: 'https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies',
  },
  coverage: {
    title: { en: 'Evidence, uncertainty and practice awards', ja: '根拠、不確実性、練習の達成' },
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
