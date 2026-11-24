import { t } from './i18n'
import { platformLinks } from './platform-links'

export function PlatformLinks() {
  if (window.desktopSimulator) return null
  return <>
    <a className="platform-link" href={platformLinks.windows} target="_blank" rel="noopener noreferrer"
      title={t('Windows x64 downloads (unsigned development installer)')}>{t('Windows app')}</a>
    <a className="platform-link" href={platformLinks.mcp} target="_blank" rel="noopener noreferrer"
      title={t('Local MCP setup for compatible AI clients (Node 22+)')}>{t('MCP server')}</a>
  </>
}

export function EmptyWorkspacePlatforms() {
  if (window.desktopSimulator) return null
  return <aside className="empty-workspace-platforms" aria-label={t('Windows app and MCP server')}>
    <h2>{t('Windows app and MCP server')}</h2>
    <p>{t('Use AzNetSim on Windows or from a compatible AI client. This browser and your design stay open.')}</p>
    <div><PlatformLinks /></div>
  </aside>
}
