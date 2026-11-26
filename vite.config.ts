import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  base: './',
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  server: { watch: { ignored: ['**/test-artifacts/**', '**/test-results/**', '**/release/**', '**/dist/**'] } },
  plugins: [
    react(),
    {
      name: 'application-version',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'application-version', content: version } }],
    },
  ],
  build: {
    modulePreload: {
      // Dynamic ESM imports load their JavaScript; preserve CSS preloads for first-open styles.
      resolveDependencies: (_filename, dependencies, { hostType }) =>
        hostType === 'html' ? dependencies : dependencies.filter(path => path.endsWith('.css')),
    },
    rollupOptions: {
      input: { main: resolve('index.html'), 'auth-redirect': resolve('auth-redirect.html') },
      output: {
        codeSplitting: {
          groups: [{
            name: 'azure-net-schema',
            test: /[\\/]src[\\/]azure-net[\\/](?:model|admission|addressing|subnet-peering|ars-route-maps)\.ts$/,
            // Shared dependencies must not pull the native schema into VWAN startup.
            includeDependenciesRecursively: false,
          }, {
            debugName: 'vendor-boundaries',
            name(id) {
              const normalized = id.replace(/\\/g, '/')
              if (/\/node_modules\/@azure\/msal-/.test(normalized)) return 'microsoft-auth'
              if (normalized.includes('/node_modules/gifenc/')) return 'flow-gif-codec'
              if (normalized.includes('/node_modules/fflate/')) return 'discrepancy-codec'
              if (normalized.includes('/node_modules/zod/')) return 'schema-validation'
              if (normalized.includes('node_modules')) return 'vendor'
            },
          }],
        },
      },
    },
  },
})
