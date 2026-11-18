import { defineConfig, devices } from '@playwright/test'

const deployedUrl = process.env.PLAYWRIGHT_BASE_URL

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: deployedUrl || 'http://127.0.0.1:4173', trace: 'retain-on-failure',
    // Retain legacy workflow coverage; workspace-presentation tests exercise the new default.
    storageState: { cookies: [], origins: [{ origin: new URL(deployedUrl || 'http://127.0.0.1:4173').origin,
      localStorage: [{ name: 'aznet-ui-preview:v1', value: 'false' }] }] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: deployedUrl ? undefined : { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
})
