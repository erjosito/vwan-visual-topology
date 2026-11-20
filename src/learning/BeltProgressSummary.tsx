import { useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { selectedEdition } from './editions'
import { beltProgress } from './progress-ledger'
import { nextBeltLabel } from './belt-progress-label'
import { stageForLesson } from './belt-stages'

export function BeltProgressSummary({ lessonId }: { lessonId: string }) {
  const language = useLanguage(), session = useWorkspaceSession()
  const ledger = session?.learningProgress?.ledger
  if (!ledger) return null
  const { course, assessments } = selectedEdition(ledger, session?.practice?.courseId)
  const progress = beltProgress(ledger, course, assessments)
  const stage = stageForLesson(course.id, lessonId)
  return <div className="learning-belt-progress" data-testid="learning-belt-progress">
    <p><strong>{stage ? stage.title[language] : language === 'ja' ? '専門トピックの練習' : 'Specialist practice'}</strong>
      {stage && ` · ${course.belts.find((belt) => belt.id === stage.beltId)!.name[language]}`}</p>
    <p>{progress.points} {language === 'ja' ? 'ポイント' : 'points'} · {nextBeltLabel(progress, language)}</p>
  </div>
}
