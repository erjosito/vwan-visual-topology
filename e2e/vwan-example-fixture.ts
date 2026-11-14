import { test as base, expect } from '@playwright/test'
import { example } from '../src/model'
import { validateTopology } from '../src/validation'

export const test = base.extend({
  page: async ({ page }, runTest) => {
    await page.addInitScript((topology) => {
      // Arrange route-test data once without replacing saved edits or damaged data on reload.
      try {
        const arranged = 'vwan:e2e-example-arranged'
        if (sessionStorage.getItem(arranged)) return
        sessionStorage.setItem(arranged, '1')
        const key = 'vwan-visual-topology:v1'
        if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(topology))
      } catch {}
    }, validateTopology(structuredClone(example)))
    await runTest(page)
  },
})

export { expect }
