import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { accessibilityPlan } from './accessibility-scorecard.mjs'
import { digest } from './quality-scorecard.mjs'

// Each state uses a fresh context and only synthetic, locally created originals.
export async function auditAccessibility({ baseURL, artifacts }) {
  const { chromium, expect } = await import('@playwright/test')
  const { default: AxeBuilder } = await import('@axe-core/playwright')
  const browser = await chromium.launch({ timeout: 30_000 })
  const entries = []
  try {
    for (const sample of accessibilityPlan.samples) {
      const start = performance.now()
      const context = await browser.newContext({ viewport: { width: sample.viewport.width, height: sample.viewport.height } })
      const entry = { id: sample.id, status: 'failed' }
      let timeout
      try {
        await Promise.race([(async () => {
          // Fail on external requests rather than permitting topology or audit uploads.
          await context.route('**/*', (route) => new URL(route.request().url()).origin === new URL(baseURL).origin
            ? route.continue() : route.abort('blockedbyclient'))
          await context.addInitScript(({ language, originalLearning }) => {
            localStorage.setItem('vwan-visual-topology:language:v1', language)
            localStorage.setItem('aznet-workspace-tools:v1', 'closed')
            // Preserve the versioned two-vnets prediction fixture despite the new default edition.
            if (originalLearning) localStorage.setItem('network-simulator:learning-progress:v1', JSON.stringify({
              version: 1, policyVersion: 1, completions: [], enrollment: 'azure-networking-preview',
            }))
          }, {
            language: sample.state.startsWith('learning-') ? 'en' : sample.language,
            originalLearning: sample.state.startsWith('learning-'),
          })
          const page = await context.newPage()
          page.setDefaultTimeout(10_000)
          page.setDefaultNavigationTimeout(15_000)
          await page.goto(new URL(sample.path, baseURL).href)
          await expect(page.getByTestId(sample.state === 'vwan-workspace' ? 'vwan-app' : 'aznet-app')).toBeVisible()
          if (sample.state.startsWith('learning-')) {
            await page.getByTestId('learning-open').click()
            const sidebar = page.getByTestId('learning-sidebar')
            await expect(sidebar).toBeVisible()
            if (sample.state !== 'learning-sidebar') {
              await sidebar.getByRole('button', { name: 'Load practice network', exact: true }).click()
              if (sample.state === 'learning-prediction') {
                await sidebar.getByRole('button', { name: 'Open protected practice workspace', exact: true }).click()
                await sidebar.getByRole('button', { name: 'Check task', exact: true }).click()
                await sidebar.getByRole('button', { name: 'Complete task & continue', exact: true }).click()
                await expect(sidebar.getByRole('heading', { name: 'Predict connectivity', exact: true })).toBeVisible()
                await expect(page.getByTestId('aznet-subnet-work-a')).toBeVisible()
              } else await expect(sidebar.getByRole('button', { name: 'Open protected practice workspace', exact: true })).toBeVisible()
            }
          }
          await page.locator('.presentation-group:has([data-language-selector]) > summary').click()
          await page.locator('header [data-language-selector]').selectOption(sample.language)
          await expect(page.locator('html')).toHaveAttribute('lang', sample.language)
          // The existing theme control sets the application's own supported preference.
          await page.getByLabel('Theme', { exact: true }).selectOption(sample.viewport.theme)
          await page.keyboard.press('Escape')
          const controls = page.getByRole('button', {
            name: sample.language === 'ja' ? 'ワークスペースの操作' : 'Workspace controls', exact: true,
          })
          if (sample.state === 'command-palette' || sample.state === 'original-inspector') {
            await controls.click()
            const palette = page.locator('.workspace-tools-panel')
            await expect(palette).toBeVisible()
            if (sample.state === 'original-inspector') {
              await page.getByTestId('aznet-add-vnet-btn').click()
              if (await palette.isVisible()) await palette.getByRole('searchbox').press('Escape')
              await page.getByRole('button', { name: sample.language === 'ja' ? 'VNet の詳細' : 'VNet detail', exact: true }).click()
              await expect(page.getByTestId('network-detail-dialog')).toBeVisible()
            } else {
              await expect(palette.getByRole('searchbox')).toBeFocused()
            }
          }
          await page.evaluate(() => document.fonts.ready)
          const report = await new AxeBuilder({ page }).analyze()
          const rawReport = `axe-${sample.id}.json`
          await writeFile(join(artifacts, rawReport), `${JSON.stringify(report, null, 2)}\n`)
          Object.assign(entry, {
            status: 'completed', rawReport, rawSha256: digest(report),
            examinedScope: {
              document: 'whole document', url: page.url(), language: sample.language,
              viewport: sample.viewport, state: sample.state,
              fixture: sample.state === 'original-inspector' ? 'one locally created original VNet, no imported/customer data'
                : sample.state.startsWith('learning-') ? `built-in two-vnets protected-practice course: ${sample.state}` : sample.path,
              exclusions: [], disabledRules: [],
            },
          })
        })(), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Accessibility sample exceeded 45 seconds')), 45_000)
        })])
      } catch (error) {
        entry.error = error.message
      } finally {
        clearTimeout(timeout)
        entry.durationMs = performance.now() - start
        await context.close()
        entries.push(entry)
      }
    }
  } finally {
    await browser.close()
    await writeFile(join(artifacts, 'accessibility.json'), `${JSON.stringify({
      evidenceVersion: accessibilityPlan.version, planSha256: digest(accessibilityPlan), samples: entries,
    }, null, 2)}\n`)
  }
  // Reload persisted bytes: a missing/corrupt raw report must never earn credit.
  return Promise.all(entries.map(async (entry) => entry.status === 'completed'
    ? { ...entry, report: JSON.parse(await readFile(join(artifacts, entry.rawReport), 'utf8')) } : entry))
}
