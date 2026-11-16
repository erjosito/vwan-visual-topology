import { Resvg } from '@resvg/resvg-js'
import { createFlowExportScene, flowExportOptions, flowSceneSvg } from '../src/flow-export'
import type { FlowExportOptions } from '../src/flow-export'
import { encodeFlowGif } from '../src/flow-export-gif'
import type { PlatformResult } from '../src/platform/contract'

export async function renderFlow(result: PlatformResult, assessmentId: string, input: FlowExportOptions = {}) {
  const options = flowExportOptions(input)
  const scene = createFlowExportScene(result, assessmentId, options)
  const raster = (svg: string) => new Resvg(svg, { font: { defaultFontFamily: 'Arial' } }).render()
  const bytes = options.format === 'svg'
    ? new TextEncoder().encode(flowSceneSvg(scene, 0, true))
    : options.format === 'png'
      ? new Uint8Array(raster(flowSceneSvg(scene)).asPng())
      : await encodeFlowGif(scene, async svg => new Uint8Array(raster(svg).pixels))
  return {
    scene, bytes,
    mimeType: { gif: 'image/gif', svg: 'image/svg+xml', png: 'image/png' }[options.format],
    format: options.format,
  }
}
