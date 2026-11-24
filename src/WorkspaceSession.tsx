import { ThemeSelector } from './ThemeSelector'
import { LanguageSelector } from './LanguageSelector'
import { useWorkspaceSession } from './workspace-context'
import { t, useLanguage } from './i18n'
import { lazy, Suspense, useState } from 'react'
import { LearningStatus } from './learning/LearningStatus'
import { CloudMenu } from './cloud/CloudMenu'
import { PresentationGroup, PresentationToggle } from './WorkspacePresentation'
import { CanvasStyleSettings, WorkspaceActionsToggle } from './CanvasPresentation'
import { DocumentSaveStatus } from './cloud/DocumentSaveStatus'
import { DocumentArtifactStatus } from './DocumentActions'

const HelpDialog = lazy(() => import('./HelpDialog'))

export function WorkspaceMenu() {
  const session = useWorkspaceSession()
  const language = useLanguage()
  const [helpDialog, setHelpDialog] = useState<'feedback' | 'platforms' | undefined>(() =>
    !window.desktopSimulator && new URLSearchParams(location.search).get('feedback') === '1' ? 'feedback' : undefined)
  return <>
    <WorkspaceActionsToggle />
    {session && <button type="button" data-testid="workspace-library-open" onClick={session.openLibrary}>{language === 'ja' ? 'ワークスペース' : 'Workspace'}</button>}
    {!session?.presentationPreview && <DocumentSaveStatus />}
    <DocumentArtifactStatus />
    <PresentationGroup label={t(session?.presentationPreview ? 'Settings' : 'Settings & help')}>
    <ThemeSelector />
    <LanguageSelector />
    {session?.presentationPreview && <CanvasStyleSettings />}
    {session?.presentationPreview && <PresentationToggle />}
    </PresentationGroup>
    <PresentationGroup label={t('Help')} title={t('Help & feedback')}>
      {session?.presentationPreview && <button onClick={() => window.open(language === 'ja' ? '/docs/index.html?lang=ja' : '/docs/index.html', '_blank', 'noopener,noreferrer')}>{t('Docs')}</button>}
      <button disabled={!!window.desktopSimulator} onClick={() => setHelpDialog('feedback')}>{t('Feedback')}</button>
      {!window.desktopSimulator && <button type="button" onClick={() => setHelpDialog('platforms')}>
        {t('Use AzNetSim elsewhere')}
      </button>}
      <small className="muted" data-testid="app-version">AzNetSim {import.meta.env.VITE_APP_VERSION}</small>
    </PresentationGroup>
    {!session?.presentationPreview && <LearningStatus />}
    {!session?.presentationPreview && <CloudMenu />}
    {helpDialog && <Suspense fallback={null}><HelpDialog kind={helpDialog} onClose={() => setHelpDialog(undefined)} /></Suspense>}
  </>
}

export function WorkspaceAccountStatus() {
  return useWorkspaceSession()?.presentationPreview
    ? <div className="workspace-account-status" data-testid="account-belt-status"><CloudMenu status /><LearningStatus showIdentity={false} /></div> : null
}
