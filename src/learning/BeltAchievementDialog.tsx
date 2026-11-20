import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../i18n'
import type { BeltAchievement } from './belt-achievement'
import { achievedStages } from './belt-stages'
import { editions } from './editions'
import './belt-achievement.css'

export function BeltAchievementDialog({ achievement, onClose }: { achievement: BeltAchievement; onClose: () => void }) {
  const language = useLanguage(), dialog = useRef<HTMLDialogElement>(null)
  const edition = editions.find((entry) => entry.course.id === achievement.courseId)!
  const belt = edition.course.belts.find((entry) => entry.id === achievement.beltId)!
  const stages = achievedStages(achievement)
  const topics = stages.length === 1 ? stages[0].topics : stages.map((stage) => stage.title)
  useEffect(() => {
    const element = dialog.current!, previous = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected && !previous.matches(':disabled')) previous.focus({ preventScroll: true })
      else document.getElementById('learning-debrief-title')?.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(<dialog ref={dialog} className="belt-achievement-dialog" data-testid="learning-belt-dialog"
    aria-labelledby="belt-achievement-title" aria-describedby="belt-achievement-summary"
    onKeyDown={(event) => {
      if (event.key === 'Escape') event.stopPropagation()
      if (event.key === 'Tab') {
        event.preventDefault()
        dialog.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }}
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className="belt-confetti" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
    <svg aria-hidden="true" width="96" height="80" viewBox="0 0 24 20">
      <path d="M2 5h20v6H2zM10 10l-3 8 5-2 2-6 3 8 4-2-5-7" fill={belt.color} stroke="currentColor" strokeWidth=".5" />
    </svg>
    <h2 id="belt-achievement-title">{language === 'ja' ? `${belt.name.ja}を獲得！` : `${belt.name.en} earned!`}</h2>
    <p>{edition.course.title[language]} · {edition.name[language]}</p>
    <p id="belt-achievement-summary">{language === 'ja' ? '前の帯からここまでに練習したトピック：' : 'Topics you practiced since your previous belt:'}</p>
    <ul>{topics.map((topic) => <li key={topic.en}>{topic[language]}</li>)}</ul>
    {belt.id === 'black' && <p>{language === 'ja'
      ? 'ルーティングの基礎コースの帯をすべて獲得しました。これはすべての Azure ネットワーク分野の修了や専門資格ではありません。'
      : 'You completed the core routing belts—not every Azure networking topic or a professional certification.'}</p>}
    <button type="button" autoFocus onClick={onClose}>{language === 'ja' ? '学習に戻る' : 'Continue learning'}</button>
  </dialog>, document.body)
}
