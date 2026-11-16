import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessibilityPlan, scoreAccessibility } from './accessibility-scorecard.mjs'
import { digest } from './quality-scorecard.mjs'

function evidence(violations = []) {
  return accessibilityPlan.samples.map(({ id, language, viewport, state }) => {
    const report = {
      testEngine: { name: 'axe-core', version: accessibilityPlan.engineVersion },
      testEnvironment: { userAgent: 'test-fixture', windowWidth: viewport.width, windowHeight: viewport.height },
      timestamp: `2026-11-16T00:00:00Z-${id}`, url: 'http://127.0.0.1/',
      violations, passes: [{ id: 'button-name', nodes: [{ target: ['button'] }] }],
      incomplete: [{ id: 'color-contrast', nodes: [{ target: ['span'] }] }], inapplicable: [],
    }
    return { id, status: 'completed', durationMs: 1, rawReport: `axe-${id}.json`, rawSha256: digest(report),
      examinedScope: { document: 'whole document', language, viewport, state, url: report.url }, report }
  })
}

test('missing, empty, skipped, aborted or failed audit evidence cannot pass', () => {
  assert.equal(scoreAccessibility([]).status, 'not-assessed')
  const entries = evidence()
  assert.equal(scoreAccessibility(entries.slice(1)).status, 'not-assessed')
  assert.equal(scoreAccessibility(entries, { completed: false }).status, 'not-assessed')
  for (const status of ['skipped', 'failed']) {
    assert.equal(scoreAccessibility([{ ...entries[0], status }, ...entries.slice(1)]).status, 'not-assessed')
  }
  entries[0].report.passes = []
  entries[0].rawSha256 = digest(entries[0].report)
  assert.throws(() => scoreAccessibility(entries), /Empty/)
})

test('actual severity and node occurrences gate independently of regression percentages', () => {
  const rule = { id: 'label', impact: 'serious', nodes: [{ target: ['input'] }, { target: ['select'] }] }
  const metric = scoreAccessibility(evidence([rule]))
  assert.equal(metric.score, null)
  assert.equal(metric.status, 'failed')
  assert.equal(metric.gate, 'blocked')
  assert.equal(metric.counts.serious.ruleOccurrences, accessibilityPlan.samples.length)
  assert.equal(metric.counts.serious.nodeOccurrences, accessibilityPlan.samples.length * 2)
  assert.equal(metric.samples[0].incompleteRules, 1)
  assert.equal(metric.samples[0].incompleteNodes, 1)
  assert.equal(scoreAccessibility(evidence([rule]).slice(1)).status, 'failed')
  assert.equal(scoreAccessibility(evidence([{ ...rule, impact: 'critical' }])).status, 'failed')
  const lowerSeverity = scoreAccessibility(evidence([{ ...rule, impact: 'moderate' }]))
  assert.equal(lowerSeverity.status, 'passed')
  assert.ok(lowerSeverity.counts.moderate.ruleOccurrences > 0)
  assert.equal(scoreAccessibility(evidence()).score, null)
})

test('duplicate/unregistered samples, duplicate rules and tampered/raw-less reports fail closed', () => {
  const entries = evidence()
  assert.throws(() => scoreAccessibility([...entries, entries[0]]), /duplicate/)
  assert.throws(() => scoreAccessibility([{ ...entries[0], id: 'unregistered' }]), /Unknown/)
  assert.throws(() => scoreAccessibility([{ ...entries[0], rawReport: null }, ...entries.slice(1)]), /Invalid/)
  entries[0].report.passes.push({ id: 'button-name', nodes: [{ target: ['button'] }] })
  assert.throws(() => scoreAccessibility(entries), /Invalid/)
  entries[0].rawSha256 = digest(entries[0].report)
  assert.throws(() => scoreAccessibility(entries), /duplicate/)
})

test('one rule may legitimately appear in multiple axe outcomes for different nodes', () => {
  const entries = evidence([{ id: 'color-contrast', impact: 'serious', nodes: [{ target: ['p'] }] }])
  entries[0].report.passes.push({ id: 'color-contrast', nodes: [{ target: ['button'] }] })
  entries[0].rawSha256 = digest(entries[0].report)
  const metric = scoreAccessibility(entries)
  assert.equal(metric.status, 'failed')
  assert.equal(metric.samples[0].rulesExamined, 2)
})

test('copied raw reports and mismatched engine/scope metadata cannot supply distinct samples', () => {
  const entries = evidence()
  entries[1].report.timestamp = entries[0].report.timestamp
  entries[1].rawSha256 = digest(entries[1].report)
  assert.throws(() => scoreAccessibility(entries), /Duplicate raw/)
  const wrongEngine = evidence()
  wrongEngine[0].report.testEngine.version = 'unregistered-version'
  wrongEngine[0].rawSha256 = digest(wrongEngine[0].report)
  assert.throws(() => scoreAccessibility(wrongEngine), /Invalid/)
  const wrongViewport = evidence()
  wrongViewport[0].examinedScope.viewport = { ...wrongViewport[0].examinedScope.viewport, width: 1 }
  assert.throws(() => scoreAccessibility(wrongViewport), /Invalid/)
})
