import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'

const entries = {
  service: 'src/platform/service.ts',
  jobs: 'platform/jobs.ts',
  worker: 'platform/worker.ts',
  mcp: 'platform/mcp.ts',
  'render-worker': 'platform/renderer.ts',
  'electron/main': 'platform/electron/main.ts',
  'electron/preload': 'platform/electron/preload.ts',
}
await mkdir('platform-dist', { recursive: true })
for (const [name, entry] of Object.entries(entries)) {
  const result = await build({
    entryPoints: [entry], outfile: `platform-dist/${name}.cjs`,
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', metafile: true, external: ['electron', '@resvg/resvg-js'],
  })
  if (Object.keys(result.metafile.inputs).some((input) => /(?:^|\/)(?:react|react-dom|i18n\.ts|.*-worker\.ts)(?:\/|$)/.test(input.replaceAll('\\', '/')))) {
    throw new Error(`Browser/React dependency leaked into ${name}`)
  }
  await writeFile(`platform-dist/${name}.inputs.json`, JSON.stringify(Object.keys(result.metafile.inputs), null, 2))
}
await copyFile('platform/electron/azure-read.ps1', 'platform-dist/electron/azure-read.ps1')
