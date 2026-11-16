import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/production/smoke.ts', '**/flow-export.spec.ts'],
  outputDir: 'test-artifacts/production-playwright',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
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
