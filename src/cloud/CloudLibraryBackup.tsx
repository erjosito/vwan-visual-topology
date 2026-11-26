import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n'
import type { CloudClient } from './client'
import type { CloudEntry } from './contracts'
import {
  exportLibraryBackup, importLibraryBackup, LibraryBackupError, libraryBackupLimits, parseLibraryBackup,
  previewLibraryBackup, type BackupErrorCode, type LibraryImportEntry, type LibraryImportResult,
} from './library-backup'

export default function CloudLibraryBackup({ api, accountName, entries, onClose, onChanged }: {
  api: CloudClient; accountName: string; entries: CloudEntry[]; onClose: () => void; onChanged: () => void
}) {
  const language = useLanguage(), text = (en: string, ja: string) => language === 'ja' ? ja : en
  const dialog = useRef<HTMLDialogElement>(null), operation = useRef<AbortController | undefined>(undefined)
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [prepared, setPrepared] = useState<{ raw: string; count: number }>()
  const [preview, setPreview] = useState<LibraryImportEntry[]>([])
  const [overwrites, setOverwrites] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<LibraryImportResult[]>()
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    element?.showModal()
    return () => {
      operation.current?.abort(); operation.current = undefined
      element?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [api])
  const failure = (code?: BackupErrorCode | 'quota') => code === 'limit'
    ? text('Backup limit: 50 topologies and 32 MiB. Select a smaller batch.', 'バックアップの上限は50件、32 MiBです。件数を減らしてください。')
    : code === 'invalid' ? text('Invalid or unsupported backup/document. No backup file was imported.', 'バックアップまたはトポロジが無効、または未対応です。ファイルは取り込んでいません。')
      : code === 'changed' ? text('Cloud data changed or disappeared. Refresh the preview before retrying.', 'クラウドの内容が変更または削除されました。プレビューを更新してから再試行してください。')
        : code === 'quota' ? text('Cloud library record limit reached. No new record was written.', 'クラウドの保存件数の上限です。新しい保存は作成していません。')
          : code === 'access' ? text('Cloud access denied. Sign in again and reopen backup tools.', 'クラウドへのアクセスが拒否されました。再サインインして開き直してください。')
            : text('Cloud request failed. Check your connection and refresh the preview before retrying.', 'クラウドの要求に失敗しました。接続を確認し、プレビューを更新して再試行してください。')
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true); setError(''); setNotice('')
    try { await action(controller.signal) }
    catch (cause) {
      if (operation.current === controller) setError(controller.signal.aborted
        ? text('Cancelled. No partial backup was downloaded. A submitted upload may still complete; refresh the preview to verify it.',
          'キャンセルしました。不完全なバックアップはダウンロードしていません。送信済みのアップロードは完了する場合があるため、プレビューを更新して確認してください。')
        : `${failure(cause instanceof LibraryBackupError ? cause.code : undefined)}${cause instanceof LibraryBackupError && cause.id ? ` (${cause.id})` : ''}`)
    } finally {
      if (operation.current === controller) { operation.current = undefined; setBusy(false) }
    }
  }
  const prepare = (ids?: string[]) => {
    setPrepared(undefined)
    void run(async signal => {
      const backup = await exportLibraryBackup(api, ids, signal)
      signal.throwIfAborted()
      setPrepared(backup)
    })
  }
  const inspect = (rows: LibraryImportEntry[]) => {
    setResults(undefined); setOverwrites(new Set())
    void run(async signal => {
      const values = await previewLibraryBackup(api, {
        format: 'aznetsim-cloud-library', version: 1, entries: rows.map(({ id, document }) => ({ id, document })),
      }, signal)
      signal.throwIfAborted(); setPreview(values)
    })
  }
  const resultLabel = (result: LibraryImportResult) => result.status === 'imported'
    ? text('Imported', '取込済み')
    : result.status === 'confirmed' ? text('Matching cloud content confirmed', '同じクラウドの内容を確認済み')
      : result.status === 'identical' ? text('Skipped: identical at preview', 'スキップ: プレビュー時に同一')
        : result.status === 'kept' ? text('Kept existing save', '既存の保存を維持')
          : result.status === 'not-started' ? text('Not started: cancelled', '未開始: キャンセル')
            : result.status === 'unconfirmed' ? text('Upload outcome unconfirmed. Refresh preview before retrying.', 'アップロードの結果が未確認です。再試行前にプレビューを更新してください。')
              : failure(result.error)
  const imports = preview.filter(entry => entry.state === 'new' || entry.state === 'conflict' && overwrites.has(entry.id)).length
  return <dialog ref={dialog} className="object-dialog cloud-library-backup" aria-labelledby="cloud-backup-title"
    onClose={event => { event.stopPropagation(); if (!event.currentTarget.open) onClose() }}
    onCancel={event => { event.stopPropagation(); if (busy) event.preventDefault() }}>
    <h2 id="cloud-backup-title">{text('Library backup and import', 'ライブラリのバックアップと取込')}</h2>
    <p>{text('Destination account', '取込先アカウント')}: <strong>{accountName}</strong></p>
    <p>{text('The free cloud service provides no data guarantee. Keep this sensitive backup safely. Native topology content is retained; never store secrets in designs. Account credentials, sharing links, file permissions and learning history are not included.',
      '無料のクラウド サービスにデータの保証はありません。機密性のあるバックアップを安全に保管してください。ネイティブの構成内容を保持するため、秘密情報をデザインに保存しないでください。資格情報、共有リンク、ファイル権限、学習履歴は含みません。')}</p>
    <p>{text('Versioned JSON, up to 50 topologies / 32 MiB. Cloud save GUIDs and native resource IDs are preserved. Your active design, tabs and practice are not changed.',
      'バージョン付きJSON、最大50件・32 MiBです。クラウドの保存GUIDと元のリソースIDを保持します。現在のデザイン、タブ、練習は変更しません。')}</p>
    <section aria-labelledby="cloud-backup-export-title">
      <h3 id="cloud-backup-export-title">{text('Export', 'エクスポート')}</h3>
      <p>{text('Only a complete batch can be downloaded. Revisions are checked before and after collection, but this is not an atomic snapshot of concurrent edits.',
        'すべて取得できた場合のみダウンロードできます。取得前後にリビジョンを確認しますが、同時編集を含む一括トランザクションではありません。')}</p>
      <fieldset disabled={busy}><legend>{text('Select cloud saves to back up', 'バックアップするクラウドの保存を選択')}</legend>
        <div className="cloud-backup-selection">{entries.map(entry => <label key={entry.id}>
          <input type="checkbox" checked={selected.has(entry.id)} onChange={event => {
            const next = new Set(selected)
            if (event.target.checked) next.add(entry.id); else next.delete(entry.id)
            setSelected(next)
          }} />{entry.name} <small>({entry.id})</small>
        </label>)}</div>
      </fieldset>
      <button type="button" disabled={busy || !selected.size} onClick={() => prepare([...selected])}>{text('Prepare selected backup', '選択したバックアップを準備')}</button>
      <button type="button" disabled={busy} onClick={() => prepare()}>{text('Prepare whole-library backup', 'ライブラリ全体のバックアップを準備')}</button>
      {prepared && <div>
        <p role="status">{text(`${prepared.count} topologies prepared. Download and verify the file was saved.`, `${prepared.count}件を準備しました。ダウンロードして保存を確認してください。`)}</p>
        <button type="button" disabled={busy} onClick={() => {
          let url: string | undefined
          const anchor = document.createElement('a')
          try {
            url = URL.createObjectURL(new Blob([prepared.raw], { type: 'application/json' }))
            anchor.href = url; anchor.download = 'aznetsim-library-backup.json'
            document.body.append(anchor); anchor.click()
            setNotice(text('Download requested. The application cannot confirm that your browser or desktop saved the file.',
              'ダウンロードを要求しました。ブラウザーまたはデスクトップでの保存完了は確認できません。'))
          } catch {
            setError(text('The download could not be started. Retry downloading the prepared backup.', 'ダウンロードを開始できませんでした。準備済みのバックアップを再度ダウンロードしてください。'))
          } finally {
            anchor.remove()
            if (url) { const released = url; setTimeout(() => URL.revokeObjectURL(released), 0) }
          }
        }}>{text('Download backup', 'バックアップをダウンロード')}</button>
      </div>}
    </section>
    <section aria-labelledby="cloud-backup-import-title">
      <h3 id="cloud-backup-import-title">{text('Import', 'インポート')}</h3>
      <label>{text('Library backup JSON file', 'ライブラリのバックアップJSONファイル')}
        <input type="file" accept=".json,application/json" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setPreview([]); setResults(undefined); setOverwrites(new Set())
          void run(async signal => {
            if (file.size > libraryBackupLimits.bytes) throw new LibraryBackupError('limit')
            const raw = await file.text()
            signal.throwIfAborted()
            const backup = parseLibraryBackup(raw)
            const values = await previewLibraryBackup(api, backup, signal)
            signal.throwIfAborted(); setPreview(values)
            if (!values.length) setNotice(text('This backup contains no topologies.', 'このバックアップにトポロジはありません。'))
          })
        }} />
      </label>
      {!!preview.length && <>
        {!results && <p>{text('Preview only: nothing has been uploaded. Identical GUID/content pairs are skipped. Changed saves default to Keep existing. An overwrite can update what existing shared links show.',
          'プレビューのみで、まだアップロードしていません。同じGUIDと内容はスキップします。内容が異なる保存は既定で維持します。上書きは既存の共有リンクの表示も更新する場合があります。')}</p>
        }
        <button type="button" disabled={busy} onClick={() => inspect(preview)}>{text('Refresh import preview', '取込プレビューを更新')}</button>
        <div className="cloud-backup-preview">{preview.map(entry => <div key={entry.id} data-backup-id={entry.id}>
          <strong>{entry.document.name}</strong> <small>({entry.id})</small>
          {entry.document.description && <p>{entry.document.description}</p>}
          <p>{entry.state === 'new' ? text('New save: GUID will be retained', '新しい保存: GUIDを保持')
            : entry.state === 'identical' ? text('Identical: skip without writing', '同一: 書き込まずスキップ')
              : entry.state === 'error' ? failure(entry.error) : text('Conflict: same GUID, different content', '競合: 同じGUID、異なる内容')}</p>
          {entry.state === 'conflict' && <label>{text('Conflict action', '競合時の操作')}
            <select disabled={busy || !!results} value={overwrites.has(entry.id) ? 'overwrite' : 'keep'} onChange={event => {
              const next = new Set(overwrites)
              if (event.target.value === 'overwrite') next.add(entry.id); else next.delete(entry.id)
              setOverwrites(next)
            }}><option value="keep">{text('Keep existing', '既存の保存を維持')}</option>
              <option value="overwrite">{text('Overwrite reviewed cloud version', '確認したクラウドのバージョンを上書き')}</option></select>
          </label>}
        </div>)}</div>
        <button type="button" disabled={busy || !imports || !!results} onClick={() => {
          if (!window.confirm(text(`Import ${imports} topologies to ${accountName}, including ${overwrites.size} explicitly selected overwrites? Network configuration will upload. Existing shared links can show overwritten content. Your local design is unchanged.`,
            `${accountName}に${imports}件を取り込みますか。明示的に選択した上書き${overwrites.size}件を含みます。ネットワーク構成をアップロードし、既存の共有リンクの内容が変わる場合があります。ローカルのデザインは変更しません。`))) return
          setPrepared(undefined)
          void run(async signal => {
            const values = await importLibraryBackup(api, preview, overwrites, signal)
            if (operation.current?.signal !== signal) return
            setResults(values)
            onChanged()
          })
        }}>{text('Confirm batch import', '一括取込を確認')}</button>
      </>}
      {results && <div role="status">
        <p>{text(`Results: ${results.filter(row => row.status === 'imported').length} imported; ${results.filter(row => row.status === 'confirmed').length} matching confirmed; ${results.filter(row => ['identical', 'kept'].includes(row.status)).length} skipped; ${results.filter(row => row.status === 'failed').length} failed; ${results.filter(row => row.status === 'unconfirmed').length} unconfirmed; ${results.filter(row => row.status === 'not-started').length} not started.`,
          `結果: 取込${results.filter(row => row.status === 'imported').length}件、同一内容を確認${results.filter(row => row.status === 'confirmed').length}件、スキップ${results.filter(row => ['identical', 'kept'].includes(row.status)).length}件、失敗${results.filter(row => row.status === 'failed').length}件、未確認${results.filter(row => row.status === 'unconfirmed').length}件、未開始${results.filter(row => row.status === 'not-started').length}件。`)}</p>
        <ul>{results.map(result => <li key={result.id}>{result.id}: {resultLabel(result)}</li>)}</ul>
        <p>{text('Refresh the preview before retrying. Stable GUIDs prevent duplicate copies; any changed version requires a new overwrite choice.',
          '再試行前にプレビューを更新してください。同じGUIDで重複を防ぎ、変更されたバージョンの上書きは再選択が必要です。')}</p>
      </div>}
    </section>
    {busy && <p role="status">{text('Batch operation in progress. Cancellation stops further work; a submitted request may finish.',
      '一括処理中です。キャンセルは後続の処理を停止しますが、送信済みの要求は完了する場合があります。')}</p>}
    {busy && <button type="button" onClick={() => operation.current?.abort()}>{text('Cancel batch operation', '一括処理をキャンセル')}</button>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <button type="button" disabled={busy} onClick={onClose}>{text('Close backup tools', 'バックアップを閉じる')}</button>
  </dialog>
}
