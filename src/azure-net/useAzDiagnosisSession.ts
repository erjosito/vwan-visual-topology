import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceEditorState } from '../workspace-context'
import type { AzNetTopology } from './model'
import type { AzConnectivityReport, AzConnectivityScope } from './diagnostics'
import { azDisplayResult } from './routing-input'
import { recordAzWork } from './performance'

export function useAzDiagnosisSession(activeTopology: AzNetTopology, activeRevision: string, displayNames: string[]) {
  const [analysisScope, setAnalysisScope] = useWorkspaceEditorState<AzConnectivityScope['scope']>('aznet.analysisScope', 'pair')
  const [analysisRequest, setAnalysisRequestState] = useWorkspaceEditorState<AzConnectivityScope | null>('aznet.analysisRequest', null)
  const [analysisEnabled, setAnalysisEnabled] = useState(false)
  const [analysisRun, setAnalysisRun] = useWorkspaceEditorState<{
    revision: string; request: AzConnectivityScope
    status: 'running' | 'ready' | 'cancelled' | 'failed'; report?: AzConnectivityReport
  } | undefined>('aznet.analysisRun', undefined, value => value && (value.status === 'running' || value.report?.continuation.status === 'paused')
    ? { ...value, status: 'cancelled', report: value.report ? { ...value.report, complete: false,
      continuation: { ...value.report.continuation, status: 'cancelled' } } : undefined } : value)
  const analysisWorker = useRef<Worker | undefined>(undefined)
  const setAnalysisRequest = (value: AzConnectivityScope | null) => {
    setAnalysisEnabled(!!value)
    setAnalysisRequestState(value)
    if (value) setAnalysisRun({ revision: activeRevision, request: value, status: 'running' })
  }
  useEffect(() => {
    if (!analysisEnabled || !analysisRequest) return
    let next: Worker | undefined
    let disposed = false
    const failed = () => {
      if (disposed || (next && analysisWorker.current !== next)) return
      setAnalysisRun({ revision: activeRevision, request: analysisRequest, status: 'failed' })
      next?.terminate(); analysisWorker.current = undefined
    }
    try {
      next = new Worker(new URL('./diagnostics-worker.ts', import.meta.url), { type: 'module' })
      const current = next
      analysisWorker.current = current
      current.onmessage = ({ data }: MessageEvent<{ report?: AzConnectivityReport; elapsedMillis?: number }>) => {
        if (analysisWorker.current !== current) return
        if (!data.report) { failed(); return }
        if (typeof data.elapsedMillis === 'number') recordAzWork('connectivity', data.elapsedMillis)
        setAnalysisRun({ revision: activeRevision, request: analysisRequest, status: 'ready', report: data.report })
        if (data.report.continuation.status !== 'paused') { current.terminate(); analysisWorker.current = undefined }
      }
      current.onerror = failed
      current.postMessage({ type: 'start', topology: activeTopology, scope: analysisRequest })
    } catch { queueMicrotask(failed) }
    return () => {
      disposed = true
      next?.terminate()
      if (analysisWorker.current === next) analysisWorker.current = undefined
    }
  }, [analysisRequest, analysisEnabled, activeTopology, activeRevision, setAnalysisRun])
  const currentAnalysisRun = analysisRun?.revision === activeRevision && analysisRun.request === analysisRequest ? analysisRun : undefined
  const rawAnalysis = currentAnalysisRun?.report ?? null
  const analysisRunning = Boolean(analysisEnabled && analysisRequest && (!currentAnalysisRun || currentAnalysisRun.status === 'running'))
  const continueAnalysis = () => {
    if (!analysisWorker.current || !currentAnalysisRun || analysisRunning || rawAnalysis?.continuation.status !== 'paused') return
    setAnalysisRun({ ...currentAnalysisRun, status: 'running' })
    analysisWorker.current.postMessage({ type: 'continue' })
  }
  const cancelAnalysis = () => {
    analysisWorker.current?.terminate(); analysisWorker.current = undefined
    if (!analysisRequest) return
    setAnalysisRun({
      revision: activeRevision, request: analysisRequest, status: 'cancelled',
      report: rawAnalysis ? { ...rawAnalysis, complete: false, continuation: { ...rawAnalysis.continuation, status: 'cancelled' } } : undefined,
    })
  }
  const analysis = useMemo(() => azDisplayResult(rawAnalysis, displayNames), [rawAnalysis, displayNames])
  return {
    analysisScope, setAnalysisScope, analysisRequest, setAnalysisRequest, setAnalysisEnabled,
    currentAnalysisRun, rawAnalysis, analysisRunning, continueAnalysis, cancelAnalysis, analysis,
  }
}
