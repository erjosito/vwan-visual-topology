import { t, useLanguage } from './i18n'
import { platformLinks } from './platform-links'

export function PlatformLinks() {
  const language = useLanguage()
  if (window.desktopSimulator) return null
  const mcpUrl = new URL(platformLinks.mcp, window.location.href)
  if (language === 'ja') mcpUrl.searchParams.set('lang', 'ja')
  return <>
    <a className="platform-link" href={platformLinks.windows} target="_blank" rel="noopener noreferrer"
      title={t('Get the Windows app from the Microsoft Store')}>{t('Windows app')}</a>
    <a className="platform-link" href={mcpUrl.href} target="_blank" rel="noopener noreferrer"
      title={t('Local MCP setup for compatible AI clients (Node 22+)')}>{t('MCP server')}</a>
  </>
}
