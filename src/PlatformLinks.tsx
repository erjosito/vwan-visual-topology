import { t } from './i18n'
import { platformLinks } from './platform-links'

export function PlatformLinks() {
  if (window.desktopSimulator) return null
  return <>
    <a className="platform-link" href={platformLinks.windows} target="_blank" rel="noopener noreferrer"
      title={t('Get the Windows app from the Microsoft Store')}>{t('Windows app')}</a>
    <a className="platform-link" href={platformLinks.mcp} target="_blank" rel="noopener noreferrer"
      title={t('Local MCP setup for compatible AI clients (Node 22+)')}>{t('MCP server')}</a>
  </>
}
