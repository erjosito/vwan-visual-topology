import { useEffect, useRef, useState } from 'react'
import type { FlowRequirement, PlatformDocument } from './platform/contract'
import type { FlowExportOptions } from './flow-export'
import { t } from './i18n'

type Props = { document: PlatformDocument; flow: FlowRequirement }

export function FlowExportControls(props: Props) {
  return <FlowExportContent key={JSON.stringify(props)} {...props} />
}

function FlowExportContent({ document, flow }: Props) {
  const [format, setFormat] = useState<'gif' | 'svg' | 'png'>('gif')
  const [durationMs, setDuration] = useState<1500 | 2000>(2000)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => { controller.current?.abort(); controller.current = null }, [])
  const exportFlow = async () => {
    const current = new AbortController()
    controller.current = current
    setBusy(true); setStatus(t('Rendering flow locally…'))
    const timer = setTimeout(() => current.abort(), 30000)
    try {
      const [{ runBrowserSimulation }, { renderBrowserFlow }] = await Promise.all([import('./platform/browser'), import('./flow-export-browser')])
      // UI projections carry optional undefined fields; the platform admits native JSON only.
      const request = JSON.parse(JSON.stringify({ contractVersion: 1, operation: 'evaluate', document, requirements: [flow] }))
      const result = await runBrowserSimulation(request, current.signal)
      const options: FlowExportOptions = { format, durationMs }
      const blob = await renderBrowserFlow(result, flow.id, options, current.signal)
      if (current.signal.aborted) return
      const url = URL.createObjectURL(blob), anchor = window.document.createElement('a')
      anchor.href = url; anchor.download = `flow-${flow.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.${format}`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus(t('Flow exported. Animation illustrates routing, not packet delivery.'))
    } catch (error) {
      if (controller.current === current) setStatus(current.signal.aborted ? t('Export cancelled.') : error instanceof Error ? error.message : t('Export failed.'))
    } finally {
      clearTimeout(timer)
      if (controller.current === current) { controller.current = null; setBusy(false) }
    }
  }
  return <div className="flow-export-controls">
    <div className="row">
      <label>{t('Flow export format')} <select aria-label={t('Flow export format')} disabled={busy} value={format} onChange={event => setFormat(event.target.value as typeof format)}>
        <option value="gif">GIF</option><option value="svg">SVG</option><option value="png">PNG</option>
      </select></label>
      <label>{t('Loop duration')} <select aria-label={t('Loop duration')} disabled={busy || format === 'png'} value={durationMs} onChange={event => setDuration(Number(event.target.value) as typeof durationMs)}>
        <option value={1500}>1.5 s</option><option value={2000}>2 s</option>
      </select></label>
      <button type="button" disabled={busy} onClick={() => { void exportFlow() }}>{t('Export flow diagram')}</button>
      {busy && <button type="button" onClick={() => controller.current?.abort()}>{t('Cancel export')}</button>}
    </div>
    <p className="muted">{t('Logical forwarding view with independent return routing; expanded firewall hops. No delivery or timing guarantee.')}</p>
    {status && <p role="status">{status}</p>}
  </div>
}
