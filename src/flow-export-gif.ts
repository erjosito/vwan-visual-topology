import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { flowExportLimits, flowSceneSvg, flowFramePixels } from './flow-export'
import type { FlowExportScene } from './flow-export'

export async function encodeFlowGif(scene: FlowExportScene, rasterize: (svg: string) => Promise<Uint8Array | Uint8ClampedArray>, signal?: AbortSignal) {
  const encoder = GIFEncoder()
  const frames = scene.durationMs * flowExportLimits.fps / 1000
  const background = await rasterize(flowSceneSvg(scene, 0, false, false))
  if (background.length !== scene.width * scene.height * 4) throw new Error('Raster dimensions do not match the scene.')
  const palette = quantize(background, 256)
  for (let frame = 0; frame < frames; frame++) {
    if (signal?.aborted) throw new Error('Export cancelled.')
    const rgba = flowFramePixels(scene, background, frame * 1000 / flowExportLimits.fps)
    encoder.writeFrame(applyPalette(rgba, palette), scene.width, scene.height, {
      ...(frame === 0 ? { palette, repeat: 0 } : {}), delay: 1000 / flowExportLimits.fps, dispose: 1,
    })
    if (encoder.bytesView().length > flowExportLimits.maxBytes) throw new Error('Render exceeds the artifact byte limit.')
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  encoder.finish()
  return encoder.bytes()
}
