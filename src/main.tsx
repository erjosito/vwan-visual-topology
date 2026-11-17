import { Component, lazy, StrictMode, Suspense, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import './azure-net/azure-net.css'
import './workspace-presentation.css'
import { CanvasPresentationProvider } from './CanvasPresentation'
import './theme.css'
import { loadLanguage, readLanguage, setLanguage } from './i18n'
export const UnifiedSimulatorRoot = lazy(() => Promise.all([
  import('./WorkspaceRoot'), loadLanguage(readLanguage()),
]).then(([module]) => ({ default: module.UnifiedSimulatorRoot })))

class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <main><section role="alert">
      <p>Workspace could not load. Your saved design has not been replaced.</p>
      <p lang="ja">ワークスペースを読み込めませんでした。保存した設計は変更されていません。</p>
      <button onClick={() => window.location.reload()}>Reload workspace</button>
      <button onClick={() => { void setLanguage('en').then(() => window.location.reload()) }}>Use English</button>
    </section></main>
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupBoundary><CanvasPresentationProvider><Suspense fallback={<p role="status">Loading workspace…</p>}><UnifiedSimulatorRoot /></Suspense></CanvasPresentationProvider></StartupBoundary>
  </StrictMode>,
)

