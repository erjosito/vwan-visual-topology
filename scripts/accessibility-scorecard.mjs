import { digest } from './quality-scorecard.mjs'

export const accessibilityPlan = {
  id: 'automated-accessibility', version: 2,
  label: 'Local automated accessibility sample (not WCAG conformance)',
  engine: 'axe-core', engineVersion: '4.14.0',
  rules: 'all default-enabled axe rules; no exclusions or disabled rules',
  scope: 'whole document, including visible application chrome; axe decides applicable/hidden elements',
  gateImpacts: ['serious', 'critical'],
  samples: ['en', 'ja'].flatMap((language) => [
    { name: 'desktop', width: 1440, height: 1000, theme: 'light' },
    { name: 'narrow', width: 390, height: 844, theme: 'dark' },
  ].flatMap((viewport) => ['initial-workspace', 'original-inspector', 'command-palette', 'vwan-workspace',
    'learning-sidebar', 'learning-confirmation', 'learning-prediction'].map((state) => ({
    id: `${language}-${viewport.name}-${state}`, language, viewport, state,
    path: state === 'vwan-workspace' ? '/?mode=vwan&sample=hub-routing-preferences' : '/',
  })))),
}

const outcomes = ['violations', 'passes', 'incomplete', 'inapplicable']
const impacts = ['minor', 'moderate', 'serious', 'critical']

export function scoreAccessibility(evidence = [], { completed = true } = {}) {
  const expected = new Set(accessibilityPlan.samples.map(({ id }) => id))
  const seen = new Set()
  const rawPaths = new Set()
  const rawDigests = new Set()
  const samples = evidence.map(({ id, status, report, rawReport, rawSha256, durationMs, error, examinedScope }) => {
    if (!expected.has(id) || seen.has(id)) throw new Error(`Unknown or duplicate accessibility sample: ${id}`)
    seen.add(id)
    if (!['completed', 'failed', 'skipped'].includes(status)) throw new Error(`Invalid accessibility sample status: ${id}`)
    if (status !== 'completed') return { id, status, error, durationMs }
    const sample = accessibilityPlan.samples.find((sample) => sample.id === id)
    if (!report || rawReport !== `axe-${id}.json` || rawSha256 !== digest(report) || !Number.isFinite(durationMs) || durationMs < 0
      || !examinedScope || examinedScope.document !== 'whole document'
      || examinedScope.language !== sample.language || examinedScope.state !== sample.state
      || digest(examinedScope.viewport) !== digest(sample.viewport)
      || report.url !== examinedScope.url
      || report.testEngine?.name !== accessibilityPlan.engine || report.testEngine.version !== accessibilityPlan.engineVersion
      || report.testEnvironment?.windowWidth !== sample.viewport.width
      || report.testEnvironment?.windowHeight !== sample.viewport.height
      || !report.testEnvironment?.userAgent || !report.timestamp || !report.url
      || outcomes.some((key) => !Array.isArray(report[key]))) throw new Error(`Invalid accessibility evidence: ${id}`)
    if (rawPaths.has(rawReport) || rawDigests.has(rawSha256)) throw new Error(`Duplicate raw accessibility evidence: ${id}`)
    rawPaths.add(rawReport)
    rawDigests.add(rawSha256)
    const rules = outcomes.flatMap((outcome) => report[outcome].map((rule) => ({ ...rule, outcome })))
    // Axe can pass one node and fail another for the same rule; duplicates within one outcome are invalid.
    if (!report.passes.length || !rules.length
      || new Set(rules.map(({ id, outcome }) => `${outcome}:${id}`)).size !== rules.length
      || rules.some((rule) => !rule.id || !Array.isArray(rule.nodes)
        || (rule.outcome !== 'inapplicable' && !rule.nodes.length)
        || (rule.outcome === 'violations' && !impacts.includes(rule.impact)))) {
      throw new Error(`Empty or duplicate/invalid accessibility rules: ${id}`)
    }
    return {
      id, status, durationMs, rawReport, rawSha256, examinedScope,
      engine: report.testEngine, browser: report.testEnvironment, timestamp: report.timestamp,
      rulesExamined: new Set(rules.map(({ id }) => id)).size,
      ruleSetSha256: digest([...new Set(rules.map(({ id }) => id))].sort()),
      passedRules: report.passes.length, incompleteRules: report.incomplete.length,
      incompleteNodes: report.incomplete.reduce((sum, rule) => sum + rule.nodes.length, 0),
      inapplicableRules: report.inapplicable.length,
      violations: report.violations.map(({ id, impact, nodes, helpUrl }) => ({ id, impact, nodes: nodes.length, helpUrl })),
    }
  })
  const missingSamples = [...expected].filter((id) => !seen.has(id))
  const audited = samples.filter(({ status }) => status === 'completed')
  const assessed = completed && !missingSamples.length && audited.length === expected.size
  const counts = Object.fromEntries(impacts.map((impact) => [impact, {
    ruleOccurrences: audited.reduce((sum, sample) => sum + sample.violations.filter((rule) => rule.impact === impact).length, 0),
    nodeOccurrences: audited.reduce((sum, sample) => sum + sample.violations.filter((rule) => rule.impact === impact)
      .reduce((count, rule) => count + rule.nodes, 0), 0),
  }]))
  const blocked = accessibilityPlan.gateImpacts.some((impact) => counts[impact].ruleOccurrences > 0)
  return {
    id: accessibilityPlan.id, label: accessibilityPlan.label, evidenceVersion: accessibilityPlan.version,
    status: blocked ? 'failed' : !assessed ? 'not-assessed' : 'passed',
    score: null, unit: 'rule and affected-node occurrences per sampled state; not a compliance percentage',
    gate: blocked ? 'blocked' : !assessed ? 'incomplete' : 'no-serious-or-critical-findings-in-sampled-scope',
    gateImpacts: accessibilityPlan.gateImpacts, plannedSamples: expected.size, completedSamples: audited.length,
    sampleSetSha256: digest([...expected].sort()),
    missingSamples, counts, samples,
    limitations: 'Repeated nodes/rules across states are occurrences, not unique defects. Incomplete rules require human review. Zero violations does not establish WCAG conformance, usability or learning effectiveness.',
  }
}
