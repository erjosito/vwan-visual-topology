import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { cloudLimits, parseCloudTopology, type SharedTopology as SharedDocument } from './contracts'
import { readCloudConfiguration } from './configuration'
import { useCloudSession } from './useCloudSession'
import { ThemeSelector } from '../ThemeSelector'
import { useCanvasPresentation } from '../useCanvasPresentation'
import './sharing.css'

const SharedDiagram = lazy(() => import('./SharedDiagram'))

export default function SharedTopology({ hash, modal, onReturn }: { hash: string; modal: boolean; onReturn: () => void }) {
  const ja = useLanguage() === 'ja', cloud = useCloudSession()
  const { style } = useCanvasPresentation()
  const text = (en: string, jp: string) => ja ? jp : en
  const [shared, setShared] = useState<SharedDocument>()
  const [status, setStatus] = useState('loading')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const active = useRef(true)
  const dialog = useRef<HTMLDialogElement>(null)
  const legacy = /(?:#|&)s=/.test(hash)
  useEffect(() => {
    if (!modal) return
    const element = dialog.current!
    const previous = document.activeElement
    element.showModal()
    return () => { element.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [modal])
  useEffect(() => { document.documentElement.lang = ja ? 'ja' : 'en' }, [ja])
  useEffect(() => {
    const controller = new AbortController()
    active.current = true
    async function load() {
      if (legacy) {
        const { loadAzWorkspace } = await import('../azure-net/workspace')
        const loaded = loadAzWorkspace({ getItem: () => null }, hash)
        if (!loaded.snapshotImported || loaded.recovery.length) throw new Error('Unavailable')
        return { document: parseCloudTopology({ version: 1, name: loaded.topology.name, topology: loaded.topology }), expiresAt: '' }
      }
      const configuration = readCloudConfiguration(), token = new URLSearchParams(hash.slice(1)).get('share')
      if (!configuration || window.desktopSimulator || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Unavailable')
      const response = await fetch(`${configuration.base}/shared`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      })
      if (!response.ok) throw new Error('Unavailable')
      const raw = await response.text()
      if (raw.length > cloudLimits.bytes + 4096) throw new Error('Unavailable')
      const value = JSON.parse(raw) as SharedDocument
      if (!value.expiresAt || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new Error('Unavailable')
      return { document: parseCloudTopology(value.document), expiresAt: value.expiresAt }
    }
    void load().then(value => {
      if (!controller.signal.aborted) { setShared(value); setStatus('ready') }
    }).catch(() => {
      if (!controller.signal.aborted) { setShared(undefined); setStatus('unavailable') }
    })
    return () => { active.current = false; controller.abort() }
  }, [hash, legacy, revision])
  const copy = async (download: boolean) => {
    const api = cloud?.api
    if (!api || !shared || busy) return
    setBusy(true); setNotice('')
    try {
      if (download) {
        const { downloadAzText } = await import('../azure-net/workspace')
        if (!active.current) return
        downloadAzText(JSON.stringify(shared.document.topology, null, 2), 'shared-topology.json')
      } else {
        if (!window.confirm(text('Save a copy to your own private cloud library? Your current workspace and the owner save will not change.',
          '自分のクラウド ライブラリにコピーを保存しますか。現在のワークスペースや所有者の保存は変更しません。'))) return
        await api.saveTopology(crypto.randomUUID(), shared.document, null)
        if (active.current) setNotice(text('Copy saved to your cloud library.', 'コピーを自分のクラウド ライブラリに保存しました。'))
      }
    } catch { if (active.current) setNotice(text('Copy failed. Your workspace and the owner save are unchanged.', 'コピーに失敗しました。ワークスペースや所有者の保存は変更されていません。')) }
    finally { if (active.current) setBusy(false) }
  }
  const content = <main className="shared-topology simulator-shell" data-canvas-style={style}>
    <h1 id="shared-view-title">{text('Shared topology — read only', '共有トポロジ — 読み取り専用')}</h1>
    <p>{text('Your workspace has not been replaced. This view cannot edit the owner save. A link grants access to the readable data, not protection against copying.',
      '現在のワークスペースは置き換えていません。このビューから所有者の保存を編集できません。リンクはデータの閲覧を許可するもので、複製を防止するものではありません。')}</p>
    {legacy && <p>{text('Legacy embedded snapshot: not the latest cloud save. These links cannot be revoked or expired. New links must be created from the cloud library.',
      '旧形式の埋め込みスナップショットです。クラウドの最新の保存ではありません。この形式は取り消しや期限設定ができません。新しいリンクはクラウド ライブラリで作成してください。')}</p>}
    <div className="shared-actions">
      <ThemeSelector />
      <button type="button" onClick={onReturn}>{text('Return to workspace', 'ワークスペースに戻る')}</button>
      <button type="button" disabled={busy || status === 'loading'} onClick={() => { setShared(undefined); setStatus('loading'); setRevision(value => value + 1) }}>{text('Refresh shared view', '共有ビューを更新')}</button>
      {!cloud?.account && cloud?.configured && <button type="button" disabled={cloud.status === 'connecting'} onClick={() => { void cloud.connect() }}>{text('Sign in with Microsoft', 'Microsoft でサインイン')}</button>}
      {cloud?.account && <span>{text('Signed in as', 'サインイン中')}: {cloud.account.name}
        <button type="button" disabled={busy} onClick={() => { void cloud.disconnect() }}>{text('Sign out of this app', 'このアプリからサインアウト')}</button></span>}
      <button type="button" disabled={!cloud?.api || !shared || busy} onClick={() => { void copy(true) }}>{text('Export a local copy', 'ローカル コピーをエクスポート')}</button>
      <button type="button" disabled={!cloud?.api || !shared || busy} onClick={() => { void copy(false) }}>{text('Save a copy to my cloud', '自分のクラウドにコピーを保存')}</button>
    </div>
    {!cloud?.api && <p>{text('Sign in to export or save your own copy. Ordinary local design import and export remain available without signing in.',
      'エクスポートや自分のコピーの保存にはサインインしてください。通常のローカル設計のインポートとエクスポートはサインインなしで利用できます。')}</p>}
    {cloud?.status === 'error' && <p role="alert">{text('Sign-in did not complete. Retry sign-in; your workspace is unchanged.', 'サインインは完了しませんでした。再試行してください。ワークスペースは変更されていません。')}</p>}
    {status === 'loading' && <p role="status">{text('Loading shared topology…', '共有トポロジを読み込み中…')}</p>}
    {status === 'unavailable' && <p role="alert">{text('Shared topology unavailable. It may be expired, revoked or deleted, or the service may be offline. Your workspace is unchanged.',
      '共有トポロジを利用できません。期限切れ、取り消し、削除、またはサービスがオフラインの可能性があります。ワークスペースは変更されていません。')}</p>}
    {notice && <p role="status">{notice}</p>}
    {shared && <>
      <h2>{shared.document.name}</h2>
      {!legacy && <p>{text('Latest saved version at last refresh. Later saves and renames appear after refreshing. Access expires', '最終更新時の最新の保存です。以後の保存や名前変更は更新後に表示します。有効期限')}: <time dateTime={shared.expiresAt}>{new Date(shared.expiresAt).toLocaleString(ja ? 'ja' : 'en')}</time></p>}
      <Suspense fallback={<p role="status">{text('Loading diagram…', '図を読み込み中…')}</p>}><SharedDiagram topology={shared.document.topology} /></Suspense>
    </>}
  </main>
  return modal ? <dialog ref={dialog} className="shared-view-dialog" aria-labelledby="shared-view-title"
    onCancel={event => { event.preventDefault(); onReturn() }}>{content}</dialog> : content
}
