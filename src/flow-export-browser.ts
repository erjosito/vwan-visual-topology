import { createFlowExportScene, flowSceneSvg } from './flow-export'
import type { FlowExportOptions } from './flow-export'
import type { PlatformResult } from './platform/contract'

export async function renderBrowserFlow(result: PlatformResult, assessmentId: string, options: FlowExportOptions, signal?: AbortSignal) {
  const scene = createFlowExportScene(result, assessmentId, options)
  const format = options.format ?? 'gif'
  if (signal?.aborted) throw new Error('Export cancelled.')
  if (format === 'svg') return new Blob([flowSceneSvg(scene, 0, true)], { type: 'image/svg+xml' })
  const canvas = document.createElement('canvas')
  canvas.width = scene.width; canvas.height = scene.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas rendering is unavailable.')
  const raster = (svg: string) => new Promise<Uint8ClampedArray<ArrayBuffer>>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Export cancelled.')); return }
    const image = new Image()
    const cleanup = () => { signal?.removeEventListener('abort', cancel) }
    const cancel = () => { cleanup(); image.src = ''; reject(new Error('Export cancelled.')) }
    signal?.addEventListener('abort', cancel, { once: true })
    image.onload = () => {
      try {
        context.clearRect(0, 0, scene.width, scene.height)
        context.drawImage(image, 0, 0)
        resolve(context.getImageData(0, 0, scene.width, scene.height).data)
      } catch (error) { reject(error) }
      finally { cleanup() }
    }
    image.onerror = () => { cleanup(); reject(new Error('Could not rasterize the flow scene.')) }
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
  if (format === 'png') {
    await raster(flowSceneSvg(scene))
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'))
  }
  const { encodeFlowGif } = await import('./flow-export-gif')
  return new Blob([await encodeFlowGif(scene, raster, signal)], { type: 'image/gif' })
}
