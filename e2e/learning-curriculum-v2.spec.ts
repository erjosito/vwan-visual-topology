import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { AzNetTopology } from '../src/azure-net/model'
import type { CourseBundle, CourseCheck, CourseGuidance } from '../src/learning/course-contract'
import { curriculumV2Bundle } from '../src/learning/curriculum-v2'
import { matchesConfiguration } from '../src/learning/configuration-check'
import { guidedProgressKey } from '../src/learning/progress-ledger'
import { practiceWorkspaceKey } from '../src/learning/practice-workspace'
import { sidebarLabels } from '../src/learning/sidebar-content'
import { runnerLabels } from '../src/learning/runner-content'
import { loadLanguage, translate } from '../src/messages'
import '../src/packet-messages-ja'
import '../src/network-detail-messages-ja'
import { advanceLearningTask, completeLearningTasks, createLessonPeering, learningAnchor, learningOptions, learningSidebar, loadLearningNetwork, openLearning } from './learning-helpers'

type Language = 'en' | 'ja'
type CourseTask = CourseBundle['lessons'][number]['tasks'][number]
test.use({ actionTimeout: 15_000 })
type PartialTree<T> = T extends (infer Item)[] ? PartialTree<Item>[] : T extends object ? { [Key in keyof T]?: PartialTree<T[Key]> } : T
const topology = (page: Page): Promise<AzNetTopology> => page.evaluate((key) =>
  JSON.parse(localStorage.getItem(key)!).document.topology, practiceWorkspaceKey)

async function show(page: Page, task: CourseTask, language: Language, accepts: (cue: CourseGuidance) => boolean) {
  const cue = task.guidanceIds.map((id) => curriculumV2Bundle.guidance.find((cue) => cue.id === id)!).find(accepts)
  if (!cue) throw new Error(`No native guidance for ${task.id}`)
  const panel = learningSidebar(page), button = panel.getByTestId(`learning-guide-${cue.id}`)
  if (task.guidanceIds.length === 1) await expect(button).toBeVisible()
  else if (!await button.isVisible()) {
    await learningOptions(page, language)
    const navigation = panel.getByText(sidebarLabels.navigationHelp[language], { exact: true })
    if (!await navigation.evaluate((element) => (element.parentElement as HTMLDetailsElement).open)) await navigation.click()
  }
  await button.click()
  return cue
}

async function configure(page: Page, task: CourseTask, check: Extract<CourseCheck, { kind: 'topology.configured' }>, language: Language) {
  const expected = check.params.expected as PartialTree<AzNetTopology>, before = await topology(page)
  for (const link of expected.erLinks ?? []) {
    if (matchesConfiguration(before.erLinks.find((item) => item.id === link.id), link)) continue
    await show(page, task, language, (cue) => cue.action === 'connection.configure' && cue.params.connectionId === link.id)
    const editor = page.getByTestId('aznet-hybrid-connection-editor')
    await editor.locator('input[name="enabled"]').setChecked(link.enabled!)
    await editor.getByRole('button', { name: translate(language, 'Save connection routing'), exact: true }).click()
  }
  for (const connection of expected.vpnConnections ?? []) {
    if (matchesConfiguration(before.vpnConnections.find((item) => item.id === connection.id), connection)) continue
    await show(page, task, language, (cue) => cue.action === 'connection.configure' && cue.params.connectionId === connection.id)
    const editor = page.getByTestId('aznet-hybrid-connection-editor')
    if (connection.enabled !== undefined) await editor.locator('input[name="enabled"]').setChecked(connection.enabled)
    if (connection.bgpEnabled !== undefined) await editor.locator('input[name="bgp"]').setChecked(connection.bgpEnabled)
    if (connection.staticPrefixes) await editor.locator('textarea[name="prefixes"]').fill(connection.staticPrefixes.join('\n'))
    await editor.getByRole('button', { name: translate(language, 'Save connection routing'), exact: true }).click()
  }
  for (const vnet of expected.vnets ?? []) {
    const original = before.vnets.find((item) => item.id === vnet.id)!
    if (matchesConfiguration(original, vnet)) continue
    const attachment = vnet.vwanHubAttachment
    if (attachment?.enabled !== undefined && attachment.enabled !== original.vwanHubAttachment?.enabled) {
      await show(page, task, language, (cue) => cue.action === 'network.configure' && cue.params.vnetId === vnet.id)
      await page.getByTestId(`aznet-vwan-connection-enabled-${vnet.id}`).setChecked(attachment.enabled)
    }
    if (attachment?.hubRouting && !matchesConfiguration(original.vwanHubAttachment?.hubRouting, attachment.hubRouting)) {
      const hub = before.vwanHubs.find((hub) => hub.id === original.vwanHubAttachment!.hubId)!
      await show(page, task, language, (cue) => cue.action === 'hub.configure' && cue.params.hubId === hub.id)
      const group = page.getByTestId('aznet-hub-tables-editor').getByRole('group', { name: original.name, exact: true })
      if (attachment.hubRouting.propagatedTableIds) {
        for (const table of hub.routeTables!) await group.getByRole('checkbox', { name: table.name, exact: true })
          .setChecked(attachment.hubRouting.propagatedTableIds.includes(table.id))
      }
      if (attachment.hubRouting.labels) {
        const labels = group.getByLabel(translate(language, 'Propagation labels'))
        await labels.fill(attachment.hubRouting.labels.join(', '))
        await labels.press('Tab')
      }
    }
  }
  for (const hub of expected.vwanHubs ?? []) {
    if (matchesConfiguration(before.vwanHubs.find((item) => item.id === hub.id), hub)) continue
    await show(page, task, language, (cue) => cue.action === 'hub.configure' && cue.params.hubId === hub.id)
    if (hub.routingIntent?.private !== undefined) await page.getByTestId(`aznet-private-routing-intent-${hub.id}`).setChecked(hub.routingIntent.private)
    for (const table of hub.routeTables ?? []) {
      const labels = page.getByTestId('aznet-hub-tables-editor').getByLabel(`${translate(language, 'Table labels')} ${table.id}`, { exact: true })
      const original = before.vwanHubs.find((item) => item.id === hub.id)!.routeTables!.find((item) => item.id === table.id)!
      await labels.fill([...new Set([...original.labels, ...table.labels!])].join(', '))
      await labels.press('Tab')
    }
  }
  for (const peering of expected.vnetPeerings ?? []) {
    const original = before.vnetPeerings.find((item) => item.id === peering.id)!
    if (matchesConfiguration(original, peering)) continue
    await show(page, task, language, (cue) => cue.action === 'peering.configure' && cue.params.peeringId === peering.id)
    const card = page.getByTestId(`aznet-peering-card-${peering.id}`)
    for (const direction of ['aToB', 'bToA'] as const) {
      const fields = peering[direction]
      if (!fields) continue
      const from = before.vnets.find((vnet) => vnet.id === (direction === 'aToB' ? original.vnetAId : original.vnetBId))!
      const to = before.vnets.find((vnet) => vnet.id === (direction === 'aToB' ? original.vnetBId : original.vnetAId))!
      const group = card.locator('.aznet-field-grid > div').filter({ has: page.getByText(`${from.name} → ${to.name}`, { exact: true }) })
      for (const [field, label] of [['allowGatewayTransit', 'Allow Gateway Transit'], ['useRemoteGateways', 'Use Remote Gateways']] as const) {
        if (fields[field] !== undefined && fields[field] !== original[direction][field]) await group.getByRole('checkbox', { name: label, exact: true }).setChecked(fields[field]!)
      }
    }
  }
  for (const table of expected.udrTables ?? []) {
    if (matchesConfiguration(before.udrTables.find((item) => item.id === table.id), table)) continue
    const cue = await show(page, task, language, (cue) => cue.action === 'route-table.configure' && cue.params.routeTableId === table.id)
    if (cue.action !== 'route-table.configure') throw new Error('Original UDR guidance required')
    if (table.disableBgpRoutePropagation !== undefined) await page.getByTestId(`aznet-rt-disable-bgp-${table.id}`).setChecked(table.disableBgpRoutePropagation)
    for (const route of table.routes ?? []) {
      const row = learningAnchor(page, 'udr-route', cue.params.vnetId, cue.params.subnetId, table.id!, route.id!)
      if (route.enabled !== undefined) await row.getByRole('checkbox').setChecked(route.enabled)
      if (route.nextHopIp !== undefined) {
        await row.locator('input[type="text"]').nth(2).fill(route.nextHopIp)
        await row.locator('input[type="text"]').nth(2).press('Tab')
      }
    }
  }
  for (const lb of expected.inventory?.loadBalancers ?? []) {
    const original = before.inventory!.loadBalancers!.find((item) => item.id === lb.id)!
    if (matchesConfiguration(original, lb)) continue
    await show(page, task, language, (cue) => cue.action === 'load-balancer.configure' && cue.params.loadBalancerId === lb.id)
    const section = learningAnchor(page, 'load-balancer-health', original.owner.id, original.id)
    await expect(section).toBeVisible()
    for (const probe of lb.probes ?? []) for (const health of probe.health ?? []) {
      const workload = before.inventory!.workloads.find((item) => item.id === health.target!.workloadId)!
      await section.locator('label').filter({ hasText: `${workload.name} /` }).getByRole('combobox').selectOption(health.status!)
    }
    await page.getByTestId('network-detail-dialog').getByRole('button', { name: translate(language, 'Close VNet detail'), exact: true }).click()
  }
  await expect.poll(async () => matchesConfiguration(await topology(page), check.params.expected), { message: task.id }).toBe(true)
}

async function inspectPacket(page: Page, task: CourseTask, check: Extract<CourseCheck, { kind: 'packet.inspected' }>, language: Language) {
  await show(page, task, language, (cue) => cue.action === 'packet-probe.open')
  const panel = page.getByTestId('network-detail-dialog').getByTestId('packet-flow-panel')
  for (const [endpoint, label] of [[check.params.packet.source, 'Packet source'], [check.params.packet.target, 'Packet destination']] as const) {
    if (endpoint.kind !== 'workload') throw new Error('Original workload packet required')
    await panel.getByLabel(translate(language, label), { exact: true })
      .selectOption(JSON.stringify(['workload', endpoint.workloadId, endpoint.nicId, endpoint.ipConfigurationId]))
  }
  await panel.getByLabel(translate(language, 'Protocol'), { exact: true }).selectOption(check.params.packet.protocol)
  await panel.getByLabel(translate(language, 'Source port'), { exact: true }).fill(String(check.params.packet.sourcePort))
  await panel.getByLabel(translate(language, 'Destination port'), { exact: true }).fill(String(check.params.packet.destinationPort))
  await panel.getByRole('button', { name: translate(language, 'Trace packet routing'), exact: true }).click()
  await expect(panel.getByTestId('packet-flow-result')).toBeVisible()
  await expect(learningSidebar(page).getByTestId('learning-debrief')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('network-detail-dialog').getByRole('button', { name: translate(language, 'Close VNet detail'), exact: true }).click()
}

for (const language of ['en', 'ja'] as const) for (const firstChapterOnly of [true, false]) {
  test(`${language}: ${firstChapterOnly ? 'peering chain demonstrates non-transitivity' : 'all twelve revised chapters qualify'} through native actions and fresh evidence`, async ({ page }) => {
    test.setTimeout(900_000)
    await loadLanguage(language)
    if (language === 'ja') {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(() => {
        localStorage.setItem('aznet-ui-preview:v1', 'true')
        localStorage.setItem('aznet-theme', 'dark')
        localStorage.setItem('vwan-visual-topology:language:v1', 'ja')
      })
    }
    await page.goto('/?mode=full')
    await expect(page.getByTestId('aznet-diagram-svg')).toBeVisible()
    if (language === 'en') await page.locator('header [data-language-selector]').selectOption(language)
    const normal = await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))
    await openLearning(page)
    const sidebar = learningSidebar(page)
    await loadLearningNetwork(page, language)
    await expect(page.getByTestId('learning-status')).toContainText(language === 'en' ? '0 points' : '0 ポイント')
    await expect(sidebar.getByTestId('learning-debrief')).toHaveCount(0)
    const hint = sidebar.getByTestId('learning-hint-1')
    await hint.locator('summary').click()
    await expect(hint.locator('p')).toHaveText(curriculumV2Bundle.lessons[0].tasks[0].hints[0][language])
    await expect(page.getByTestId('learning-status')).toContainText(language === 'en' ? '0 points' : '0 ポイント')
    await expect(sidebar.getByTestId('learning-debrief')).toHaveCount(0)
    await hint.locator('summary').click()
    let points = 0
    if (firstChapterOnly) {
      await completeLearningTasks(page, curriculumV2Bundle.lessons[0].tasks.length, language)
      points = 80
    }
    const lessons = firstChapterOnly ? [] : curriculumV2Bundle.lessons
    for (const [chapterIndex, lesson] of lessons.entries()) {
      for (const task of lesson.tasks) {
        console.info(`Native ${language}: ${task.id}`)
        await expect(sidebar.getByTestId('learning-task')).toHaveAttribute('data-task-id', task.id)
        await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).scenarioId, practiceWorkspaceKey)).toBe(lesson.scenarioId)
        const check = curriculumV2Bundle.checks.find((check) => check.id === task.checkId)!
        if (check.kind === 'quiz.answered') {
          if (task.guidanceIds.some((id) => curriculumV2Bundle.guidance.find((cue) => cue.id === id)?.action === 'routes.open')) {
            const cue = await show(page, task, language, (cue) => cue.action === 'routes.open')
            if (cue.action !== 'routes.open') throw new Error('Subnet route guidance required')
            await expect(learningAnchor(page, 'effective-table', cue.params.vnetId, cue.params.subnetId)).toBeVisible()
            await expect(sidebar.getByTestId('learning-debrief')).toHaveCount(0)
            await expect(page.getByTestId('learning-status')).toContainText(language === 'en' ? `${points} points` : `${points} ポイント`)
          }
          const choice = check.params.choices.find((choice) => choice.id === check.params.correctChoiceId)!
          await sidebar.getByRole('radio', { name: choice.text[language], exact: true }).check()
          await sidebar.getByRole('button', { name: runnerLabels.submit[language], exact: true }).click()
        } else if (check.kind === 'vnet.peered') {
          await createLessonPeering(page, language, check.params.vnetAId, check.params.vnetBId)
        } else if (check.kind === 'topology.configured') {
          await configure(page, task, check, language)
        } else if (check.kind === 'packet.inspected') {
          await inspectPacket(page, task, check, language)
        } else if (check.kind === 'routes.inspected' || check.kind === 'control-routes.inspected') {
          for (const id of task.guidanceIds) {
            const cue = curriculumV2Bundle.guidance.find((cue) => cue.id === id)!
            if (cue.action === 'peering.command') await createLessonPeering(page, language, cue.params.vnetAId, cue.params.vnetBId)
          }
          await show(page, task, language, (cue) => cue.action !== 'peering.command')
        } else throw new Error(`No native journey action for ${task.id}: ${check.kind}`)
        await expect(sidebar.getByTestId('learning-debrief'), task.id).toBeVisible({ timeout: 15_000 })
        await expect(sidebar.getByTestId('learning-task-instruction')).toHaveText(task.instruction[language])
        points += task.points
        await expect(page.getByTestId('learning-status')).toContainText(language === 'en' ? `${points} points` : `${points} ポイント`)
        await expect(sidebar.locator('pre')).toHaveCount(0)
        const belt = curriculumV2Bundle.course.belts[chapterIndex + 1]
        if (task.id === lesson.taskOrder.at(-1)) {
          await expect(sidebar.getByTestId('learning-belt-earned')).toContainText(belt.name[language])
          if (belt.secondaryColor) await expect(page.getByTestId('learning-belt-dialog')).toHaveCount(0)
          else {
            const dialog = page.getByTestId('learning-belt-dialog')
            await expect(dialog).toBeVisible()
            expect((await new AxeBuilder({ page }).include('.belt-achievement-dialog').analyze()).violations).toEqual([])
            await dialog.getByRole('button', { name: language === 'ja' ? '学習に戻る' : 'Continue learning', exact: true }).click()
          }
        }
        await advanceLearningTask(page, language)
      }
    }
    const record = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), guidedProgressKey)
    expect(record.completions).toHaveLength(firstChapterOnly ? 5 : 72)
    expect(record.completions.every((entry: { courseId: string }) => entry.courseId === curriculumV2Bundle.course.id)).toBe(true)
    expect(points).toBe(firstChapterOnly ? 80 : 1345)
    await expect(page.getByTestId('learning-status')).toContainText(language === 'en' ? `${points} points` : `${points} ポイント`)
    expect(await page.evaluate(() => localStorage.getItem('aznet-visual-topology:v1'))).toBe(normal)
    await page.reload()
    await expect(page.getByTestId('learning-status')).toContainText(curriculumV2Bundle.course.belts[firstChapterOnly ? 1 : curriculumV2Bundle.course.belts.length - 1].name[language])
    await expect(page.getByTestId('learning-belt-dialog')).toHaveCount(0)
  })
}
