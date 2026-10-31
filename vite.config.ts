import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          if (normalized.includes('node_modules')) return 'vendor'
          if (normalized.includes('/src/i18n.ts')) return 'i18n'
          if (
            normalized.includes('/src/AzureFilesPanel.tsx') ||
            normalized.includes('/src/AzureComparisonPanel.tsx') ||
            normalized.includes('/src/azure-bicep.ts') ||
            normalized.includes('/src/azure-import.ts') ||
            normalized.includes('/src/azure-comparison.ts') ||
            normalized.includes('/src/collector-script.ts')
          ) {
            return 'azure-tools'
          }
          if (
            normalized.includes('/src/DiagnosticsPanel.tsx') ||
            normalized.includes('/src/RoutingIssuesPanel.tsx') ||
            normalized.includes('/src/RouteInspector.tsx') ||
            normalized.includes('/src/RouteMapsPanel.tsx') ||
            normalized.includes('/src/RouteMapInspector.tsx') ||
            normalized.includes('/src/StaticRoutingPanel.tsx') ||
            normalized.includes('/src/VpnRoutingWizard.tsx')
          ) {
            return 'inspector-panels'
          }
        },
      },
    },
  },
})
