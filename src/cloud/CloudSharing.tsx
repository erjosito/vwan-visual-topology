import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import { CloudHttpError, type CloudClient } from './client'
import type { CloudEntry, CloudShare } from './contracts'
import './sharing.css'

export function CloudSharing({ api, entry, entries, refreshed }: { api: CloudClient; entry?: CloudEntry; entries: CloudEntry[]; refreshed: () => Promise<void> }) {
  const ja = useLanguage() === 'ja'
  const text = (en: string, jp: string) => ja ? jp : en
  const [shares, setShares] = useState<CloudShare[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [checkedAt, setCheckedAt] = useState(Date.now)
  const active = useRef(true)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [entry?.id])
  useEffect(() => {
    const timer = setInterval(() => setCheckedAt(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    active.current = true
    void api.listShares().then(values => { if (active.current) { setShares(values); setLoaded(true) } })
      .catch(() => { if (active.current) setNotice(ja ? '共有 API を利用できません。バックエンドを確認して再試行してください。' : 'Sharing API unavailable. Check the backend and retry.') })
    return () => { active.current = false }
  }, [api, ja])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setNotice('')
    try { await operation() }
    catch (error) {
      if (active.current) setNotice(error instanceof CloudHttpError && error.status === 412
        ? text('Cloud save changed. Refresh cloud topologies before sharing its latest saved version.', 'クラウドの保存が変更されました。クラウドの一覧を更新してから最新の保存を共有してください。')
        : text('Sharing did not complete. Refresh before retrying; keep your local copy.', '共有操作は完了しませんでした。更新して再試行し、ローカルのコピーを保持してください。'))
    }
    finally { if (active.current) setBusy(false) }
  }
  const link = (share: CloudShare) => {
    const url = new URL(location.pathname, location.origin)
    url.hash = `share=${share.token}`
    return url.href
  }
  return <section aria-label={text('Shared links', '共有リンク')} className="cloud-sharing">
    <h3 ref={heading} tabIndex={-1}>{text('Shared links', '共有リンク')}</h3>
    <p>{text('Links show the latest cloud-saved version, including later updates and renames, for 30 days. Unsaved edits are not shared. Anyone with the link can read the design; do not share secrets or confidential data. Viewers cannot change your save. Signed-in viewers can export or save their own copy.',
      'リンクは、以後の更新や名前変更を含むクラウドの最新の保存を 30 日間表示します。未保存の編集は共有しません。リンクを持つ全員が設計を閲覧できます。機密情報を共有しないでください。閲覧者は元の保存を変更できません。サインインした閲覧者はエクスポートや自分のコピーの保存が可能です。')}</p>
    <p>{text('Revoking a link or deleting its cloud save stops future access, not copies already obtained. Recreating a deleted save does not restore old links. Sign-out does not revoke links; revoke them here before deleting your account.',
      'リンクの取り消しやクラウドの保存の削除で以後のアクセスを停止しますが、取得済みのコピーは削除できません。削除した保存を作り直しても古いリンクは復活しません。サインアウトではリンクを取り消しません。アカウント削除の前にここで取り消してください。')}</p>
    {entry && <button type="button" disabled={busy || !loaded} onClick={() => {
      if (!window.confirm(text(`Make the latest cloud-saved "${entry.name}" readable by anyone with a new link for 30 days, including future saved changes? This does not save or upload your current workspace.`,
        `「${entry.name}」のクラウドの最新の保存と以後の更新を、新しいリンクを持つ全員に 30 日間公開しますか。現在のワークスペースは保存もアップロードもしません。`))) return
      void run(async () => {
        await api.createShare(crypto.randomUUID(), entry.id, entry.etag)
        const values = await api.listShares()
        if (active.current) setShares(values)
        await refreshed()
      })
    }}>{text('Enable a 30-day link', '30 日間のリンクを有効化')}: {entry.name}</button>}
    <button type="button" disabled={busy} onClick={() => { void run(async () => {
      const values = await api.listShares()
      if (active.current) { setShares(values); setLoaded(true) }
    }) }}>{text('Refresh shared links', '共有リンクを更新')}</button>
    {shares.map(share => <div key={share.id} className="cloud-share-entry">
      <h4>{entries.find(entry => entry.id === share.topologyId)?.name ?? text('Unavailable cloud save', 'クラウドの保存を利用不可')}</h4>
      <p>{text('Cloud save ID', 'クラウドの保存 ID')}: {share.topologyId}</p>
      <p>{text('Expires', '有効期限')}: <time dateTime={share.expiresAt}>{new Date(share.expiresAt).toLocaleString(ja ? 'ja' : 'en')}</time>
        {Date.parse(share.expiresAt) <= checkedAt ? text(' — Expired', ' — 期限切れ') : ''}</p>
      <label>{text('Read-only link', '読み取り専用リンク')}<input readOnly value={link(share)} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" disabled={busy || Date.parse(share.expiresAt) <= checkedAt} onClick={() => { void run(async () => {
        await navigator.clipboard.writeText(link(share))
        if (active.current) setNotice(text('Link copied.', 'リンクをコピーしました。'))
      }) }}>{text('Copy link', 'リンクをコピー')}</button>
      <button type="button" disabled={busy} onClick={() => {
        if (!window.confirm(text('Revoke this link? Copies already obtained are not erased.', 'このリンクを取り消しますか。取得済みのコピーは削除されません。'))) return
        void run(async () => {
          await api.revokeShare(share.id, share.etag)
          if (active.current) setShares(values => values.filter(value => value.id !== share.id))
        })
      }}>{text('Revoke link', 'リンクを取り消す')}</button>
    </div>)}
    {loaded && !shares.length && <p>{text('No shared links.', '共有リンクはありません。')}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
