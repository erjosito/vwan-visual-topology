import type { BeltPlan } from './course-contract'

// Planning budgets, not awarded points or a claim that these lessons have shipped.
export const courseOutline: BeltPlan[] = [
  {
    id: 'white', name: { en: 'White belt', ja: '白帯' }, color: '#ffffff',
    pointsRequired: 0, plannedTaskPoints: 150,
    objective: { en: 'Address ownership, exact routes and direct peering.', ja: 'アドレスの所有関係、完全一致ルート、直接ピアリング。' },
  },
  {
    id: 'yellow', name: { en: 'Yellow belt', ja: '黄帯' }, color: '#eab308',
    pointsRequired: 150, plannedTaskPoints: 200,
    objective: { en: 'Peering access, non-transitivity and forward/return evidence.', ja: 'ピアリングのアクセス、非推移性、往路と復路の根拠。' },
  },
  {
    id: 'orange', name: { en: 'Orange belt', ja: '橙帯' }, color: '#ea580c',
    pointsRequired: 350, plannedTaskPoints: 250,
    objective: { en: 'Longest-prefix matching, UDRs and equal-prefix preference.', ja: '最長プレフィックス一致、UDR、同じプレフィックスの優先順位。' },
  },
  {
    id: 'green', name: { en: 'Green belt', ja: '緑帯' }, color: '#15803d',
    pointsRequired: 600, plannedTaskPoints: 300,
    objective: { en: 'Gateway transit, Route Server and modeled BGP selection.', ja: 'ゲートウェイ転送、Route Server、モデル化された BGP 選択。' },
  },
  {
    id: 'blue', name: { en: 'Blue belt', ja: '青帯' }, color: '#2563eb',
    pointsRequired: 900, plannedTaskPoints: 350,
    objective: { en: 'Virtual WAN propagation, hub table scope and routing intent.', ja: 'Virtual WAN の伝達、ハブ テーブルの範囲、ルーティング インテント。' },
  },
  {
    id: 'brown', name: { en: 'Brown belt', ja: '茶帯' }, color: '#92400e',
    pointsRequired: 1250, plannedTaskPoints: 450,
    objective: { en: 'Mixed-network diagnosis, supported alternatives and independent transfer tasks.', ja: '混在ネットワークの診断、サポートされる代替設計、独立した応用課題。' },
  },
  {
    id: 'black', name: { en: 'Black belt', ja: '黒帯' }, color: '#171717',
    pointsRequired: 1700, plannedTaskPoints: 0,
    objective: { en: 'Complete the mixed-network capstone and explain uncertainty without treating unknown as success.', ja: '混在ネットワークの総合課題を完了し、不明を成功とせず不確実性を説明する。' },
  },
]
