import { lazy, Suspense, useState } from 'react'
import { useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { useCloudSession } from './useCloudSession'

const CloudPanel = lazy(() => import('./CloudPanel').then(module => ({ default: module.CloudPanel })))

export function CloudMenu() {
  const cloud = useCloudSession(), session = useWorkspaceSession(), language = useLanguage()
  const [open, setOpen] = useState(false)
  if (!cloud?.configured) return null
  return <>
    <button type="button" onClick={() => setOpen(true)}>
      {language === 'ja' ? 'クラウド アカウント' : 'Cloud account'}
    </button>
    {cloud.account && <button type="button" disabled={!!session?.practice} onClick={() => setOpen(true)}>
      {language === 'ja' ? 'クラウドに保存' : 'Save to cloud'}
    </button>}
    {open && <Suspense fallback={<span role="status">{language === 'ja' ? '読み込み中...' : 'Loading cloud account...'}</span>}>
      <CloudPanel key={cloud.account?.id ?? 'anonymous'} onClose={() => setOpen(false)} />
    </Suspense>}
  </>
}
