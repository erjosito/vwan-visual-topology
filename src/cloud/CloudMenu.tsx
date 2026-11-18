import { lazy, Suspense, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { useWorkspaceSession } from '../workspace-context'
import { useCloudSession } from './useCloudSession'

const CloudPanel = lazy(() => import('./CloudPanel').then(module => ({ default: module.CloudPanel })))

export function CloudMenu({ status = false }: { status?: boolean }) {
  const cloud = useCloudSession(), session = useWorkspaceSession(), language = useLanguage()
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLElement>(null)
  const identity = cloud?.account?.name ?? (language === 'ja' ? '未サインイン' : 'Not signed in')
  const label = language === 'ja' ? 'クラウド アカウント' : 'Cloud account'
  if (!cloud?.configured) return status ? <span className="account-status-unavailable" title={language === 'ja'
    ? 'この環境ではサインインを利用できません。ローカルのシミュレーションと学習は引き続き使えます。'
    : 'Sign-in is unavailable in this environment. Local simulation and learning remain available.'}>
    {identity}<small>{language === 'ja' ? 'サインインを利用不可' : 'Sign-in unavailable'}</small>
  </span> : null
  return <>
    <button type="button" data-testid="cloud-account-open" className={status ? 'account-status-trigger' : undefined}
      aria-label={status ? `${label}: ${identity}` : undefined} title={status ? `${label}: ${identity}` : undefined}
      aria-haspopup="dialog" onClick={event => { trigger.current = event.currentTarget; setOpen(true) }}>
      {status ? <span className="account-status-name">{identity}</span> : label}
    </button>
    {!status && cloud.account && <button type="button" disabled={!!session?.practice}
      onClick={event => { trigger.current = event.currentTarget; setOpen(true) }}>
      {language === 'ja' ? 'クラウドに保存' : 'Save to cloud'}
    </button>}
    {open && <Suspense fallback={<span role="status">{language === 'ja' ? '読み込み中...' : 'Loading cloud account...'}</span>}>
      <CloudPanel key={cloud.account?.id ?? 'anonymous'} returnFocus={trigger} onClose={() => setOpen(false)} />
    </Suspense>}
  </>
}
