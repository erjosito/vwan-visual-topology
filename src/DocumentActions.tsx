import { Component, lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from './i18n'
import { useWorkspaceSession } from './workspace-context'
import { DocumentSaveStatus } from './cloud/DocumentSaveStatus'
import './document-actions.css'

const CloudPanel = lazy(() => import('./cloud/CloudPanel').then(module => ({ default: module.CloudPanel })))
export const DestinationDialog = lazy(() => import('./DocumentDialogs').then(module => ({ default: module.DestinationDialog })))
const LoadDialog = lazy(() => import('./DocumentDialogs').then(module => ({ default: module.LoadDialog })))
const noSubscribe = () => () => {}
const noSnapshot = () => undefined

export class DocumentDialogBoundary extends Component<{
  children: ReactNode; onClose: () => void; language: 'en' | 'ja'
}, { failed: boolean }> {
  state = { failed: false }
  private returnFocus = document.activeElement
  static getDerivedStateFromError() { return { failed: true } }
  componentWillUnmount() {
    if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) this.returnFocus.focus()
  }
  render() {
    if (!this.state.failed) return this.props.children
    return createPortal(<div role="alert" className="document-dialog-error" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.props.onClose() }
    }}>
      <p>{this.props.language === 'ja'
        ? 'ドキュメントのダイアログを読み込めませんでした。デザインは開いたままです。接続を確認し、再読み込みしてください。'
        : 'The document dialog could not load. Your design stays open. Reconnect and reload to try again.'}</p>
      <button type="button" autoFocus onClick={this.props.onClose}>{this.props.language === 'ja' ? '閉じる' : 'Close'}</button>
    </div>, document.body)
  }
}

export function DocumentArtifactStatus() {
  const commands = useWorkspaceSession()?.artifactCommands, language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const state = useSyncExternalStore(commands?.subscribe ?? noSubscribe, commands?.getSnapshot ?? noSnapshot)
  if (!state) return null
  const label = state.operation === 'saving' ? text('Saving…', '保存中…')
    : state.operation === 'failed' ? text('Save failed', '保存に失敗')
      : state.revision === 'matches' ? text('Saved', '保存済み') : text('Unsaved changes', '未保存の変更')
  const destination = state.destination?.kind === 'file' ? state.destination.location : state.destination?.name
  return <details className="presentation-group document-artifact-details">
    <summary title={destination} aria-label={`${text('Document save status', 'ドキュメントの保存状態')}: ${label}${state.destination ? ` · ${state.destination.name}` : ''}`}>
      <span className="document-artifact-status" aria-live="polite">{label}
      {state.destination && ` · ${state.destination.name}`}
      {state.notice?.kind === 'downloaded' && ` · ${text('Download unconfirmed', 'ダウンロード未確認')}`}</span></summary>
    <div className="presentation-group-content">
      <DocumentSaveStatus detail />
      <p>{label}{state.destination
        && ` · ${state.destination.kind === 'cloud' ? text('Cloud', 'クラウド') : text('File', 'ファイル')}: ${destination}`}</p>
      <p>{text('Profile recovery is separate from an explicitly saved file or cloud artifact.',
        'プロファイルの復元用コピーと、ファイルやクラウドへの明示的な保存は異なります。')}</p>
      {state.notice && <p role="status">{state.notice.kind === 'saved'
        ? text(`Saved to ${state.notice.location ?? state.notice.name}`, `${state.notice.location ?? state.notice.name} に保存しました`)
        : text('Copy downloaded; final location and overwrite are unconfirmed.', 'コピーをダウンロードしました。保存先と上書きは未確認です。')}</p>}
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  </details>
}

export function DocumentActions() {
  const session = useWorkspaceSession(), language = useLanguage()
  const text = (en: string, ja: string) => language === 'ja' ? ja : en
  const commands = session?.artifactCommands
  const state = useSyncExternalStore(commands?.subscribe ?? noSubscribe, commands?.getSnapshot ?? noSnapshot)
  const [dialog, setDialog] = useState<'save' | 'load' | 'cloud'>()
  const [error, setError] = useState('')
  const save = async () => {
    if (!commands) return
    const result = await commands.save()
    if (result === 'needs-destination') setDialog('save')
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      if (!commands || document.querySelector('dialog[open]') || event.repeat) return
      if (event.shiftKey) setDialog('save')
      else void save()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  return <>
    <button type="button" disabled={!commands || state?.operation === 'saving'} onClick={() => setDialog('load')}>{text('Load', '読み込み')}</button>
    <button type="button" disabled={!commands || state?.operation === 'saving'} onClick={() => { void save() }}
      aria-keyshortcuts="Control+s Meta+s">{text('Save', '保存')}</button>
    <button type="button" disabled={!commands || state?.operation === 'saving'} onClick={() => setDialog('save')}
      aria-keyshortcuts="Control+Shift+s Meta+Shift+s">{text('Save As', '名前を付けて保存')}</button>
    {(state?.error || error) && <span role="alert">{state?.error || error}</span>}
    {dialog === 'save' && commands && <DocumentDialogBoundary key="save" onClose={() => setDialog(undefined)} language={language}>
      <Suspense fallback={null}><DestinationDialog commands={commands}
      name={session?.getEditorHistory?.()?.topology.name ?? 'Topology'} onClose={() => setDialog(undefined)} /></Suspense></DocumentDialogBoundary>}
    {dialog === 'cloud' && createPortal(<Suspense fallback={null}><CloudPanel onClose={() => setDialog(undefined)} /></Suspense>, document.body)}
    {dialog === 'load' && <DocumentDialogBoundary key="load" onClose={() => setDialog(undefined)} language={language}>
      <Suspense fallback={null}><LoadDialog onClose={() => setDialog(undefined)}
      onLoad={() => {
        setDialog(undefined); setError('')
        void session?.loadFile?.().catch(error => setError(error instanceof Error ? error.message : text('Load failed', '読み込みに失敗')))
      }} onCloud={() => setDialog('cloud')} /></Suspense></DocumentDialogBoundary>}
  </>
}
