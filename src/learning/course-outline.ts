import type { BeltPlan } from './course-contract'

// Reviewed chapter allocations; actual credit comes from first-earned task awards.
export const courseOutline: BeltPlan[] = [
  {
    id: 'white', name: { en: 'White belt', ja: '白帯' }, color: '#ffffff',
    pointsRequired: 0, plannedTaskPoints: 100,
    objective: { en: 'Address ownership, exact routes and direct peering.', ja: 'アドレスの所有関係、完全一致ルート、直接ピアリング。' },
  },
  {
    id: 'yellow', name: { en: 'Yellow belt', ja: '黄帯' }, color: '#eab308',
    pointsRequired: 100, plannedTaskPoints: 75,
    objective: { en: 'Diagnose and repair an equal-prefix UDR override.', ja: '同じプレフィックスの UDR による上書きを診断して修復。' },
  },
  {
    id: 'orange', name: { en: 'Orange belt', ja: '橙帯' }, color: '#ea580c',
    pointsRequired: 175, plannedTaskPoints: 150,
    objective: { en: 'Distinguish longest-prefix matching from equal-prefix preference.', ja: '最長プレフィックス一致と同じプレフィックスの優先順位を区別。' },
  },
  {
    id: 'green', name: { en: 'Green belt', ja: '緑帯' }, color: '#15803d',
    pointsRequired: 325, plannedTaskPoints: 225,
    objective: { en: 'Diagnose shared gateway/BGP transit and independent return routing.', ja: '共有ゲートウェイと BGP の転送、独立した復路を診断。' },
  },
  {
    id: 'blue', name: { en: 'Blue belt', ja: '青帯' }, color: '#2563eb',
    pointsRequired: 550, plannedTaskPoints: 325,
    objective: { en: 'Virtual WAN propagation, exact table scope and private routing intent.', ja: 'Virtual WAN の伝達、正確なテーブルの範囲、プライベート ルーティング インテント。' },
  },
  {
    id: 'brown', name: { en: 'Brown belt', ja: '茶帯' }, color: '#92400e',
    pointsRequired: 875, plannedTaskPoints: 450,
    objective: { en: 'Mixed-network diagnosis, supported alternatives and independent transfer tasks.', ja: '混在ネットワークの診断、サポートされる代替設計、独立した応用課題。' },
  },
  {
    id: 'black', name: { en: 'Black belt', ja: '黒帯' }, color: '#171717',
    pointsRequired: 1325, plannedTaskPoints: 0,
    objective: { en: 'Complete the mixed-network capstone and explain uncertainty without treating unknown as success.', ja: '混在ネットワークの総合課題を完了し、不明を成功とせず不確実性を説明する。' },
  },
]
