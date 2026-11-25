import { useLayoutEffect, useRef, useState } from 'react'
import { t } from './i18n'
import { registerJapaneseMessages } from './messages'
import { createDiscrepancyBundle, discrepancyFiles, discrepancyIssueUrl, DISCREPANCY_MAX_BYTES, readDiscrepancyBundle } from './discrepancy-bundle'
import type { DiscrepancyBundle, DiscrepancySource } from './discrepancy-bundle'

registerJapaneseMessages({
  'Report a discrepancy': '相違を報告',
  'Download issue bundle': 'Issue 用バンドルをダウンロード',
  'Load issue bundle': 'Issue 用バンドルを読み込む',
  'Issue bundle ZIP file': 'Issue 用バンドルの ZIP ファイル',
  'Expected result': '期待する結果',
  'Actual result': '実際の結果',
  'Bundle contents': 'バンドルの内容',
  'Original comparison report': '元の比較レポート',
  'Original collector JSON is included when available. It may contain additional resource metadata; inspect evidence.json before sharing.': '元のコレクター JSON が利用可能な場合は含まれます。追加のリソース メタデータが含まれる可能性があります。共有する前に evidence.json を確認してください。',
  'Cancel bundle import': 'バンドルのインポートをキャンセル',
  'Replace workspace and replay bundle': 'ワークスペースを置き換えてバンドルを再実行',
  'I reviewed the contents and understand that names, resource IDs and network addresses are not anonymized.': '内容を確認し、名前、リソース ID、ネットワーク アドレスが匿名化されていないことを理解しました。',
  'I understand this replaces the current workspace. I have saved any work I need.': '現在のワークスペースが置き換えられることを理解し、必要な作業を保存しました。',
  'The ZIP contains the topology, available Azure evidence, mappings, current comparison results, description and app versions. No credentials or browser logs are collected. Nothing is uploaded automatically. Review the ZIP before attaching it to a public issue.': 'ZIP にはトポロジ、取得済みの Azure 証拠、マッピング、現在の比較結果、説明、アプリのバージョンが含まれます。資格情報やブラウザー ログは収集しません。自動アップロードは行いません。公開 Issue に添付する前に ZIP を確認してください。',
  'Open GitHub issue and attach ZIP manually': 'GitHub Issue を開き ZIP を手動で添付',
  'Review imported bundle': 'インポートするバンドルを確認',
  'Replay uses the current engine and recorded evidence, not a live Azure connection. Original results remain in report.json.': '再実行は現在のエンジンと記録済みの証拠を使用し、Azure には接続しません。元の結果は report.json に保持されます。',
  'Historical comparison replay at {0} using the current engine; not live Azure validation.': '現在のエンジンで {0} 時点の比較を再実行した結果です。現在の Azure の検証ではありません。',
  'Imported historical evidence from app {0}, revision {1}. Current-engine replay is not live Azure validation.': 'アプリ {0}、リビジョン {1} の過去の証拠をインポートしました。現在のエンジンによる再実行は、現在の Azure の検証ではありません。',
  'Use a bundle from the matching workspace mode: {0}. The current workspace is unchanged.': '現在のワークスペースと同じモード ({0}) のバンドルを使用してください。現在のワークスペースは変更されていません。',
})

export function DiscrepancyTools({ source, onImport }: { source: DiscrepancySource; onImport: (bundle: DiscrepancyBundle) => void }) {
  const [summary, setSummary] = useState(''), [expected, setExpected] = useState(''), [actual, setActual] = useState('')
  const [reviewedSource, setReviewedSource] = useState<DiscrepancySource>(), [replace, setReplace] = useState(false)
  const [downloadedSource, setDownloadedSource] = useState<DiscrepancySource>()
  const [failure, setFailure] = useState<{ source: DiscrepancySource; message: string }>()
  const [preview, setPreview] = useState<{ source: DiscrepancySource; bundle: DiscrepancyBundle }>()
  const input = useRef<HTMLInputElement>(null), request = useRef(0), currentSource = useRef(source)
  useLayoutEffect(() => {
    const operation = request
    currentSource.current = source
    operation.current++
    return () => { operation.current++ }
  }, [source])
  const reviewed = reviewedSource === source, downloaded = downloadedSource === source
  const pending = preview?.source === source ? preview.bundle : undefined
  const error = failure?.source === source ? failure.message : ''
  const setError = (message: string) => setFailure({ source, message })
  const changed = () => { setReviewedSource(undefined); setDownloadedSource(undefined); setError('') }
  return <details className="aznet-card">
    <summary>{t('Report a discrepancy')}</summary>
    <p className="notice">{t('The ZIP contains the topology, available Azure evidence, mappings, current comparison results, description and app versions. No credentials or browser logs are collected. Nothing is uploaded automatically. Review the ZIP before attaching it to a public issue.')}</p>
    <p>{t('Original collector JSON is included when available. It may contain additional resource metadata; inspect evidence.json before sharing.')}</p>
    <p>{t('Replay uses the current engine and recorded evidence, not a live Azure connection. Original results remain in report.json.')}</p>
    <details><summary>{t('Bundle contents')}</summary><ul>{discrepancyFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul>
      <p>{source.topology.name} · {source.mode}</p>
      <p>{source.mode === 'vwan'
        ? `${source.topology.hubs.length} hubs / ${source.topology.spokes.length} spokes / ${source.session?.observation.tables.length ?? 0} observed tables`
        : `${source.topology.vnets.length} VNets / ${source.observations?.nicEffectiveRoutes.length ?? 0} observed NICs`}</p>
    </details>
    <label className="field"><span>{t('Summary')}</span><input value={summary} minLength={5} maxLength={120} onChange={event => { setSummary(event.target.value); changed() }} /></label>
    <label className="field"><span>{t('Expected result')}</span><textarea aria-label={t('Expected result')} rows={3} maxLength={4000} value={expected} onChange={event => { setExpected(event.target.value); changed() }} /></label>
    <label className="field"><span>{t('Actual result')}</span><textarea aria-label={t('Actual result')} rows={3} maxLength={4000} value={actual} onChange={event => { setActual(event.target.value); changed() }} /></label>
    <label className="checkbox-field"><input type="checkbox" checked={reviewed} onChange={event => setReviewedSource(event.target.checked ? source : undefined)} />{t('I reviewed the contents and understand that names, resource IDs and network addresses are not anonymized.')}</label>
    <button disabled={!reviewed || summary.trim().length < 5 || !expected.trim() || !actual.trim()} onClick={() => {
      try {
        const revision = import.meta.env.VITE_APP_REVISION || 'development'
        const bytes = createDiscrepancyBundle(source, { summary, expected, actual }, {
          version: import.meta.env.VITE_APP_VERSION || 'development', revision, engineRevision: revision,
          host: window.desktopSimulator ? 'windows' : 'web',
        })
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }))
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'aznetsim-discrepancy.zip'; anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setDownloadedSource(source); setError('')
      } catch (error) { setError(error instanceof Error ? error.message : 'Discrepancy bundle export failed.') }
    }}>{t('Download issue bundle')}</button>
    {downloaded && <p><a href={discrepancyIssueUrl()} target="_blank" rel="noopener noreferrer">{t('Open GitHub issue and attach ZIP manually')}</a></p>}
    <hr />
    <button onClick={() => input.current?.click()}>{t('Load issue bundle')}</button>
    <input ref={input} type="file" hidden accept=".zip,application/zip" aria-label={t('Issue bundle ZIP file')} onChange={async event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      const id = ++request.current, originalSource = source
      setPreview(undefined); setReplace(false); setError('')
      try {
        if (file.size > DISCREPANCY_MAX_BYTES) throw new Error('The discrepancy bundle exceeds the 25 MB GitHub attachment limit.')
        const bundle = await readDiscrepancyBundle(new Uint8Array(await file.arrayBuffer()))
        if (id !== request.current || originalSource !== currentSource.current) return
        if (bundle.source.mode !== source.mode) throw new Error(t('Use a bundle from the matching workspace mode: {0}. The current workspace is unchanged.', bundle.source.mode))
        setPreview({ source, bundle })
      } catch (error) {
        if (id === request.current && originalSource === currentSource.current) setError(error instanceof Error ? error.message : 'Invalid discrepancy bundle. The current workspace is unchanged.')
      }
    }} />
    {error && <p className="notice error" role="alert">{error}</p>}
    {pending && <section aria-label={t('Review imported bundle')}>
      <h3>{pending.manifest.summary}</h3>
      <p>{pending.source.topology.name} · {pending.manifest.mode} · {pending.manifest.createdAt}</p>
      <p>{pending.manifest.app.version} · {pending.manifest.app.revision}</p>
      <p><strong>{t('Expected result')}: </strong>{pending.manifest.expected}</p>
      <p><strong>{t('Actual result')}: </strong>{pending.manifest.actual}</p>
      <details><summary>{t('Original comparison report')}</summary><pre className="azure-code">{JSON.stringify(pending.originalReport, null, 2)}</pre></details>
      <label className="checkbox-field"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />{t('I understand this replaces the current workspace. I have saved any work I need.')}</label>
      <button onClick={() => { request.current++; setPreview(undefined); setReplace(false) }}>{t('Cancel bundle import')}</button>
      <button disabled={!replace} onClick={() => {
        try {
          onImport(pending)
          setPreview(undefined); setReplace(false); setError('')
        } catch (error) { setError(error instanceof Error ? error.message : 'Discrepancy bundle import failed.') }
      }}>{t('Replace workspace and replay bundle')}</button>
    </section>}
  </details>
}
