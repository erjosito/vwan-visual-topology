import { createHash } from 'node:crypto'

export const scorecardVersion = 10
// Keep document-derived contract fixtures distinct from regression and live Azure evidence.
export const modelContractPlan = {
  unit: [{ id: 'static-firewall-model-contracts', label: 'Document-derived static Firewall model-contract conformance',
    files: ['src/hub-firewall.test.ts'], qualification: 'Synthetic document-derived expectations; not live-Azure-qualified.' }],
  browser: [{ id: 'static-firewall-native-workflows', label: 'Static Firewall native handoff and evidence workflow conformance',
    files: ['e2e/hub-firewall.spec.ts'], qualification: 'Scripted native authoring/evidence checks; not human usability or live Azure fidelity.' }],
}
export const unitPlan = [
  { id: 'routing-packet-regressions', label: 'Routing/packet regression conformance', files: [
    'src/routing.test.ts', 'src/paths.test.ts', 'src/vpn-routing.test.ts', 'src/vpn-nat.test.ts', 'src/hub-routing.test.ts',
    'src/azure-net/engine.test.ts', 'src/packet-egress.test.ts', 'src/packet-ingress.test.ts',
    'src/packet-load-balancer.test.ts', 'src/ha-ports.test.ts', 'src/packet-security.test.ts', 'src/azure-comparison.test.ts',
  ] },
  { id: 'requirement-grading-regressions', label: 'Requirement grading regression conformance', files: [
    'platform/assessment.test.ts', 'platform/packet-assessment.test.ts',
  ] },
  { id: 'training-contract-regressions', label: 'Training contract regression conformance', files: [
    'src/learning/learning.test.ts', 'src/learning/connectivity-exercises.test.ts',
    'src/learning/course.test.ts', 'src/learning/course-routing.test.ts', 'src/learning/course-wan.test.ts', 'src/learning/scenario-course.test.ts', 'src/learning/ha-routing.test.ts', 'src/learning/guidance.test.ts',
    'src/learning/practice-workspace.test.ts', 'src/learning/runner.test.ts',
    'src/learning/practice-ownership.test.ts', 'src/learning/progress-ledger.test.ts',
  ] },
  { id: 'persistence-boundary-regressions', label: 'Persistence/local boundary regression conformance', files: [
    'src/workspace-session.test.ts', 'src/inventory.test.ts', 'platform/service.test.ts', 'platform/mcp.test.ts',
  ] },
  { id: 'localization-contract-regressions', label: 'Localization contract regression conformance', files: ['src/i18n.test.ts'] },
]
export const browserPlan = [
  { id: 'ui-workflow-regressions', label: 'Scripted UI workflow regression conformance', files: [
    'e2e/canvas-presentation.spec.ts', 'e2e/network-detail.spec.ts', 'e2e/single-workspace.spec.ts', 'e2e/vpn-nat.spec.ts', 'e2e/ha-ports.spec.ts',
    'e2e/accessibility-labels.spec.ts',
  ] },
  { id: 'training-workflow-regressions', label: 'Scripted training workflow regression conformance', files: ['e2e/learning.spec.ts', 'e2e/practice-workspace.spec.ts', 'e2e/learning-progress.spec.ts', 'e2e/learning-editions.spec.ts'] },
  { id: 'localization-workflow-regressions', label: 'Scripted localization workflow regression conformance', files: ['e2e/localization.spec.ts'] },
]
export const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const normalized = (file) => file.replaceAll('\\', '/')

export function unregisteredCriticalFiles(files) {
  const registered = new Set([...unitPlan, ...browserPlan].flatMap(({ files }) => files))
  return files.map(normalized).filter((file) => (
    /^src\/learning\/.*\.test\.tsx?$/.test(file)
    || /^e2e\/(?:[^/]*learning[^/]*|[^/]*practice-workspace[^/]*|accessibility-labels)\.spec\.ts$/.test(file)
  ) && !registered.has(file))
}

export function vitestCases(report) {
  if (!Array.isArray(report.testResults)) throw new Error('Invalid Vitest report')
  return report.testResults.flatMap((suite) => {
    if (typeof suite.name !== 'string' || !Array.isArray(suite.assertionResults)) throw new Error('Invalid Vitest suite')
    return suite.assertionResults.map((item) => ({
      file: normalized(suite.name), name: item.fullName,
      outcome: item.status === 'passed' ? 'passed' : item.status === 'failed' ? 'failed' : 'skipped',
      durationMs: item.duration ?? 0,
    }))
  })
}

export function playwrightCases(report) {
  if (!Array.isArray(report.suites)) throw new Error('Invalid Playwright report')
  const cases = []
  function visit(suite, parents = []) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
      const results = test.results ?? []
      const expectedPass = test.expectedStatus === 'passed'
      const finalPass = results.at(-1)?.status === 'passed'
      const outcome = !expectedPass || !results.length || results.at(-1)?.status === 'skipped' ? 'skipped'
        : !finalPass ? 'failed' : results.some((result) => result.status !== 'passed') ? 'flaky' : 'passed'
      const file = normalized(spec.file ?? suite.file ?? '')
      cases.push({
        file: /^(?:[A-Za-z]:|\/)/.test(file) ? file : `${normalized(report.config?.rootDir ?? 'e2e')}/${file}`,
        name: [...parents, spec.title, test.projectName].join(' > '), outcome,
        durationMs: results.reduce((sum, result) => sum + (result.duration ?? 0), 0),
      })
    }
    for (const child of suite.suites ?? []) visit(child, [...parents, child.title])
  }
  for (const suite of report.suites) visit(suite)
  return cases
}

export function scoreGroup(plan, cases, { completed = true } = {}) {
  const selected = []
  const missingFiles = []
  for (const file of plan.files) {
    const matches = cases.filter((item) => item.file === file || item.file.endsWith(`/${file}`))
    if (!matches.length) missingFiles.push(file)
    selected.push(...matches.map((item) => ({ ...item, file })))
  }
  const ids = selected.map((item) => `${item.file} > ${item.name}`)
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate test identities in ${plan.id}`)
  if (selected.some((item) => !['passed', 'failed', 'skipped', 'flaky'].includes(item.outcome) || !item.name)) {
    throw new Error(`Invalid test evidence in ${plan.id}`)
  }
  const counts = Object.fromEntries(['passed', 'failed', 'skipped', 'flaky'].map((status) =>
    [status, selected.filter((item) => item.outcome === status).length]))
  const total = selected.length
  const assessed = completed && !missingFiles.length && total > 0
  return {
    id: plan.id, label: plan.label, qualification: plan.qualification,
    status: !assessed ? 'not-assessed' : counts.failed ? 'failed' : counts.skipped || counts.flaky ? 'partial' : 'passed',
    score: assessed ? Math.round(10000 * counts.passed / total) / 100 : null,
    unit: 'percent first-attempt passing registered regression cases; not a product-quality rating',
    total, ...counts, missingFiles, durationMs: selected.reduce((sum, item) => sum + item.durationMs, 0),
    caseSetSha256: digest([...ids].sort()),
  }
}
