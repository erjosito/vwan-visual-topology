import { useState } from 'react'
import { setLanguage, useLanguage } from './i18n'
import type { Language } from './i18n'

export function LanguageSelector() {
  const language = useLanguage()
  const [pending, setPending] = useState<Language>()
  const [failed, setFailed] = useState(false)
  return <><label className="language-selector">
    <span>{language === 'ja' ? '言語' : 'Language'}</span>
    <select aria-label={language === 'ja' ? '言語 / Language' : 'Language / 言語'} data-language-selector
      value={pending ?? language} aria-disabled={!!pending} aria-busy={!!pending} onChange={(event) => {
        if (pending) return
        const next = event.target.value === 'ja' ? 'ja' : 'en'
        setPending(next)
        setFailed(false)
        void setLanguage(next).catch(() => setFailed(true)).finally(() => setPending(undefined))
      }}>
      <option value="en" lang="en">English</option>
      <option value="ja" lang="ja">日本語</option>
    </select>
    {pending && <span role="status">{language === 'ja' ? '言語を読み込み中…' : 'Loading language…'}</span>}
  </label>
    {failed && <span role="alert">Language could not load. Your saved design is unchanged.{' '}
      <button type="button" onClick={() => window.location.reload()}>Reload workspace</button>
    </span>}
  </>
}
