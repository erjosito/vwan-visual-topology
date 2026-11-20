import type { beltProgress } from './progress-ledger'

export function nextBeltLabel(progress: ReturnType<typeof beltProgress>, language: 'en' | 'ja') {
  if (!progress.next) return language === 'ja' ? '基礎コースの帯をすべて獲得' : 'Core belts completed'
  const remaining = language === 'ja'
    ? `${progress.next.name.ja}まであと ${progress.pointsRemaining} ポイント`
    : `${progress.pointsRemaining} points to ${progress.next.name.en}`
  return progress.pointsRemaining === 0 && progress.checkpointsRemaining.length
    ? `${remaining} · ${language === 'ja' ? 'ステージを完了して帯を獲得' : 'Finish the stage to earn it'}`
    : remaining
}
