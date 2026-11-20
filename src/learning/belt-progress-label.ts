import type { beltProgress } from './progress-ledger'
import { translate } from '../messages'

export function nextBeltLabel(progress: ReturnType<typeof beltProgress>, language: 'en' | 'ja') {
  if (!progress.next) return translate(language, 'Core belts completed')
  const remaining = translate(language, '{0} points to {1}', progress.pointsRemaining, progress.next.name[language])
  return progress.pointsRemaining === 0 && progress.checkpointsRemaining.length
    ? `${remaining} · ${translate(language, 'Finish the stage to earn it')}`
    : remaining
}
