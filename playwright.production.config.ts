import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/production/smoke.ts', '**/flow-export.spec.ts', '**/accessibility-labels.spec.ts'],
  outputDir: 'test-artifacts/production-playwright',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    // Keep established legacy workflows alongside the explicit default-presentation smoke tests.
    storageState: { cookies: [], origins: [
      ...['127.0.0.1', 'vwan-simulator.com', 'www.vwan-simulator.com', 'aznet-simulator.com', 'www.aznet-simulator.com'].map(host => ({
        origin: `http://${host}:4174`, localStorage: [{ name: 'aznet-ui-preview:v1', value: 'false' }],
      })),
    ] },
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--no-proxy-server', '--host-resolver-rules=MAP vwan-simulator.com 127.0.0.1, MAP www.vwan-simulator.com 127.0.0.1, MAP aznet-simulator.com 127.0.0.1, MAP www.aznet-simulator.com 127.0.0.1'],
    },
  },
  projects: [{ name: 'production-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/production-server.mjs',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
})
