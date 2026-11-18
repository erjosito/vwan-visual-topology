import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  base: './',
  server: { watch: { ignored: ['**/test-artifacts/**', '**/test-results/**', '**/release/**', '**/dist/**'] } },
  plugins: [
    react(),
    {
      name: 'application-version',
      transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'application-version', content: version } }],
    },
  ],
  build: {
    rollupOptions: {
      input: { main: resolve('index.html'), 'auth-redirect': resolve('auth-redirect.html') },
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          if (/\/node_modules\/@azure\/msal-/.test(normalized)) return 'microsoft-auth'
          if (normalized.includes('/node_modules/gifenc/')) return 'flow-gif-codec'
          if (normalized.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
