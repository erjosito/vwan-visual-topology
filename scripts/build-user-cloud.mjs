import { build } from 'esbuild'
await build({
  entryPoints: ['functions/user-cloud/index.ts'],
  outfile: 'functions/user-cloud/dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
})
