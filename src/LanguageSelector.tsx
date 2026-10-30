import { setLanguage, useLanguage } from './i18n'

export function LanguageSelector() {
  const language = useLanguage()
  return <label className="language-selector">
    <span>{language === 'ja' ? '言語' : 'Language'}</span>
    <select aria-label={language === 'ja' ? '言語 / Language' : 'Language / 言語'} data-language-selector
      value={language} onChange={(event) => setLanguage(event.target.value === 'ja' ? 'ja' : 'en')}>
      <option value="en" lang="en">English</option>
      <option value="ja" lang="ja">日本語</option>
    </select>
  </label>
}
