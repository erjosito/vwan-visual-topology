import { ThemeSelector } from './ThemeSelector'
import { LanguageSelector } from './LanguageSelector'
import { useWorkspaceSession } from './workspace-context'
import { t, useLanguage } from './i18n'
import { lazy, Suspense, useState } from 'react'
import { LearningStatus } from './learning/LearningStatus'
import { CloudMenu } from './cloud/CloudMenu'

const FeedbackDialog = lazy(() => import('./FeedbackDialog').then((module) => ({ default: module.FeedbackDialog })))

export function WorkspaceMenu() {
  const session = useWorkspaceSession()
  const language = useLanguage()
  const [feedbackOpen, setFeedbackOpen] = useState(() => !window.desktopSimulator && new URLSearchParams(location.search).get('feedback') === '1')
  return <>
    {session && <button type="button" data-testid="workspace-library-open" onClick={session.openLibrary}>{language === 'ja' ? 'ワークスペース' : 'Workspace'}</button>}
    <ThemeSelector />
    <LanguageSelector />
    <button disabled={!!window.desktopSimulator} onClick={() => setFeedbackOpen(true)}>{t('Feedback')}</button>
    <LearningStatus />
    <CloudMenu />
    {feedbackOpen && <Suspense fallback={null}><FeedbackDialog onClose={() => setFeedbackOpen(false)} /></Suspense>}
  </>
}
