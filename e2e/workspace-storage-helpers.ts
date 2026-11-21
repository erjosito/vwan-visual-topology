import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function replaceActiveSavedTopology(page: Page, provider: 'vwan' | 'azure-net', raw: string) {
  await expect(page.getByTestId(provider === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
  await page.evaluate(({ provider, raw }) => {
    const session = JSON.parse(localStorage.getItem('network-simulator:workspace-tabs:v1')!)
    const tab = session.tabs.find((tab: { id: string }) => tab.id === session.activeId)
    if (!tab || tab.provider !== provider) throw new Error('The fixture must replace its active native provider.')
    localStorage.setItem(`network-simulator:workspace-tab:v1:${tab.id}:topology`, raw)
    localStorage.setItem(provider === 'vwan' ? 'vwan-visual-topology:v1' : 'aznet-visual-topology:v1', raw)
  }, { provider, raw })
}

export async function waitForWorkspaceSample(page: Page, provider: 'vwan' | 'azure-net', sampleId: string) {
  const path = provider === 'vwan'
    ? resolve('public', 'docs', 'samples', `${sampleId}.json`)
    : resolve('public', 'docs', 'samples', 'azure-net', `${sampleId}.json`)
  const topology = JSON.parse(await readFile(path, 'utf8'))
  await expect(page.getByRole('tab', { name: topology.name, exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId(provider === 'vwan' ? 'vwan-app' : 'aznet-app')).toBeVisible()
}
