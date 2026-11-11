import { expect, test, type Locator, type Page } from '@playwright/test'

async function readable(root: Locator) {
  const failures = await root.evaluate((root) => {
    const rgb = (color: string) => {
      const channels = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
      return color.startsWith('color(srgb') ? channels.map((value, i) => i < 3 ? value * 255 : value) : channels
    }
    const luminance = (channels: number[]) => channels.slice(0, 3).map((value) => {
      const c = value / 255
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4
    }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
    const contrast = (a: number[], b: number[]) => {
      const x = luminance(a), y = luminance(b)
      return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
    }
    return [root, ...root.querySelectorAll('*')].flatMap((el) => {
      const hasText = [...el.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
      const textControl = el.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea')
      if (el.tagName === 'OPTION' || !el.checkVisibility() || (!hasText && !textControl)) return []
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) return []
      const style = getComputedStyle(el)
      let background = rgb(getComputedStyle(document.documentElement).backgroundColor)
      const parents = []
      for (let parent: Element | null = el; parent; parent = parent.parentElement) parents.push(parent)
      for (const parent of parents) {
        if (el instanceof SVGElement) {
          const rect = [...parent.children].filter((child) => ['rect', 'circle'].includes(child.tagName)).reverse().find((child) => {
            const bounds = child.getBoundingClientRect()
            return bounds.left <= box.left + box.width / 2 && bounds.right >= box.left + box.width / 2 &&
              bounds.top <= box.top + box.height / 2 && bounds.bottom >= box.top + box.height / 2 &&
              !getComputedStyle(child).fill.startsWith('url') && getComputedStyle(child).fill !== 'none'
          })
          if (rect) { background = rgb(getComputedStyle(rect).fill); break }
        }
        const color = rgb(getComputedStyle(parent).backgroundColor)
        if (color.length === 3 || color[3] === 1) { background = color; break }
      }
      const foreground = rgb(el instanceof SVGElement ? style.fill : style.color)
      const ratio = contrast(foreground, background)
      return ratio < 4.5 ? [{ text: el.textContent?.trim().slice(0, 65), ratio: +ratio.toFixed(2) }] : []
    })
  })
  expect(failures).toEqual([])
}

async function menu(page: Page, mode: string) {
  const node = mode === 'vwan'
    ? page.getByLabel('Select hub Europe hub', { exact: true })
    : page.getByTestId('aznet-subnet-sub-app-web')
  await node.focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
}

for (const theme of ['light', 'dark']) {
  for (const mode of ['vwan', 'hub-spoke', 'full']) {
    test(`${theme}: ${mode} diagrams, menus, route/path/analysis windows and shared popups`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.goto(`/?mode=${mode}${mode === 'vwan' ? '' : '&sample=hub-spoke-firewall-udr'}`)
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect(page.locator('html')).toHaveCSS('color-scheme', theme)
      await readable(page.locator('body'))
      const themeSelect = page.getByRole('combobox', { name: 'Theme', exact: true })
      await themeSelect.focus()
      await expect(themeSelect).toHaveCSS('outline-style', 'solid')
      await expect(themeSelect).toHaveCSS('outline-width', '3px')

      await menu(page, mode)
      await readable(page.getByRole('menu'))
      await page.getByRole('menuitem', { name: mode === 'vwan' ? 'BGP table' : 'Inspect Subnet Effective Routes', exact: true }).click()
      const window = page.locator('.canvas-overlay').last()
      await expect(window).toBeVisible()
      await readable(window)
      if (mode !== 'vwan') {
        await page.getByTestId('aznet-tab-tracer').click()
        await page.getByTestId('aznet-run-trace-btn').click()
        await readable(window)
        await readable(page.getByTestId('aznet-diagram-svg'))
        await page.getByTestId('aznet-tab-diagnostics').click()
        await readable(window)
      }
      await window.locator('.overlay-heading button').filter({ hasText: 'Close' }).click()
      await menu(page, mode)
      await page.getByRole('menuitem', { name: mode === 'vwan' ? 'Edit configuration' : 'Configure Subnet (Name, Prefix, Route Table, PE Policies)...', exact: true }).click()
      await readable(page.locator('.canvas-overlay').last())
      await page.locator('.canvas-overlay').last().locator('.overlay-heading button').filter({ hasText: 'Close' }).click()
      if (mode === 'vwan') {
        await page.getByLabel('Select spoke Europe applications', { exact: true }).focus()
        await page.keyboard.press('Shift+F10')
        await page.getByRole('menuitem', { name: 'Open path explorer', exact: true }).click()
        await page.getByLabel('Destination node', { exact: true }).selectOption('site:dc')
        await page.getByRole('button', { name: 'Show preferred path', exact: true }).click()
        await readable(page.getByRole('dialog', { name: 'Path explorer', exact: true }))
        await page.getByRole('button', { name: 'Close Path explorer', exact: true }).click()
        await menu(page, mode)
        await page.getByRole('menuitem', { name: 'Show path to', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Everywhere', exact: true }).click()
        await readable(page.locator('.diagram-scroll'))
        await page.getByRole('button', { name: 'Clear highlighting', exact: true }).click()
        await page.getByRole('button', { name: 'Check routing', exact: true }).click()
        await page.getByRole('button', { name: 'Advanced checks', exact: true }).click()
        await readable(page.getByRole('dialog', { name: 'Routing diagnostics', exact: true }))
        await page.getByRole('button', { name: 'Close Routing diagnostics', exact: true }).click()
      } else {
        await page.getByTestId('aznet-peering-pill-peer-hub-app').hover({ force: true })
        await expect(page.getByTestId('aznet-peering-hover-card')).toBeVisible()
        await readable(page.getByTestId('aznet-peering-hover-card'))
        await page.mouse.move(0, 0)
        await page.getByTestId('aznet-vnet-vnet-hub-weu').focus()
        await page.keyboard.press('Shift+F10')
        await page.getByRole('menuitem', { name: 'Configure VNet & Elements', exact: true }).click()
        const gatewayPrefixes = page.getByRole('textbox', { name: /^Advertised gateway prefixes / }).first()
        await expect(gatewayPrefixes).toBeVisible()
        await gatewayPrefixes.fill('10.0.0.0/8')
        await readable(page.locator('.canvas-overlay').last())
        await page.locator('.canvas-overlay').last().locator('.overlay-heading button').filter({ hasText: 'Close' }).click()
        await page.getByTestId('aznet-site-site-munich-hq').focus()
        await page.keyboard.press('Shift+F10')
        await page.getByRole('menuitem', { name: 'Inspect Site BGP Route Table', exact: true }).click()
        await expect(page.getByRole('table', { name: 'Requested router BGP table' })).toBeVisible()
        await readable(page.locator('.canvas-overlay').last())
        await page.locator('.canvas-overlay').last().locator('.overlay-heading button').filter({ hasText: 'Close' }).click()
      }

      await page.getByTestId(mode === 'vwan' ? 'vwan-topbar-er-locations-btn' : 'aznet-open-er-locations-btn').click()
      const catalog = page.getByTestId('er-location-info-modal')
      await catalog.getByTestId('er-catalog-search').fill('Amsterdam')
      await readable(catalog)
      const catalogScreenshot = testInfo.outputPath(`${mode}-${theme}-catalog.png`)
      await page.screenshot({ path: catalogScreenshot })
      await testInfo.attach(`${mode}-${theme}-catalog`, { path: catalogScreenshot, contentType: 'image/png' })
      await catalog.getByTestId('close-er-location-info-modal').click()

      if (mode === 'vwan') {
        await page.getByRole('button', { name: 'Sample topologies', exact: true }).click()
        await readable(page.locator('.canvas-overlay').last())
        await page.locator('.canvas-overlay').last().locator('.overlay-heading button').filter({ hasText: 'Close' }).click()
        await page.getByRole('button', { name: 'Feedback', exact: true }).click()
        await readable(page.getByRole('dialog'))
        await expect(page.getByRole('button', { name: 'Open issue on GitHub', exact: true })).toBeDisabled()
      } else {
        await page.getByTestId('aznet-open-sample-gallery-btn').click()
        await readable(page.getByTestId('aznet-sample-gallery-modal'))
      }
    })
  }
}

test('preference persists across reload/modes; system follows OS and storage updates', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('system')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark')
  await page.reload()
  for (const mode of ['hub-spoke', 'full', 'vwan']) {
    await page.getByTestId(`simulator-mode-${mode}`).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.getByRole('combobox', { name: 'Theme', exact: true })).toHaveValue('dark')
  }
  await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.evaluate(() => {
    localStorage.setItem('aznet-theme', 'dark')
    dispatchEvent(new StorageEvent('storage', { key: 'aznet-theme', newValue: 'dark' }))
  })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // The head script must resolve the preference even before the React bundle runs.
  await page.route(/\/src\/main\.tsx/, (route) => route.abort())
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('small screens retain legible themes, catalog details and light print output', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const mode of ['vwan', 'hub-spoke', 'full']) {
    await page.goto(`/?mode=${mode}`)
    for (const theme of ['light', 'dark']) {
      await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption(theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
      await page.getByTestId(mode === 'vwan' ? 'vwan-topbar-er-locations-btn' : 'aznet-open-er-locations-btn').click()
      const catalog = page.getByTestId('er-location-info-modal')
      await catalog.getByTestId('er-catalog-search').fill('Amsterdam')
      await catalog.getByTestId('er-location-detail-name').scrollIntoViewIfNeeded()
      await expect(catalog.getByTestId('er-location-detail-name')).toBeInViewport()
      await readable(catalog)
      const mobileScreenshot = testInfo.outputPath(`${mode}-${theme}-mobile.png`)
      await page.screenshot({ path: mobileScreenshot })
      await testInfo.attach(`${mode}-${theme}-mobile`, { path: mobileScreenshot, contentType: 'image/png' })
      await catalog.getByTestId('close-er-location-info-modal').click()
    }
  }
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.aznet-app')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
