import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const workflow = await readFile(new URL('../.github/workflows/external-reports.yml', import.meta.url), 'utf8')
const script = workflow.match(/script: \|\r?\n([\s\S]*)$/)[1]
const run = new (Object.getPrototypeOf(async () => {}).constructor)('github', 'context', script)

for (const [name, login, type, expected] of [
  ['external human report', 'reporter', 'User', true],
  ['owner report', 'erjosito', 'User', false],
  ['owner report with different casing', 'ErJoSiTo', 'User', false],
  ['bot report', 'app[bot]', 'Bot', false],
]) {
  test(`external-report labeling: ${name}`, async () => {
    const calls = []
    await run({ rest: { issues: { addLabels: async (request) => { calls.push(request) } } } }, {
      repo: { owner: 'erjosito', repo: 'vwan-visual-topology' },
      payload: { issue: { number: 42, user: { login, type }, title: '${{ secrets.TOKEN }}', body: 'untrusted' } },
    })
    assert.deepEqual(calls, expected ? [{
      owner: 'erjosito', repo: 'vwan-visual-topology', issue_number: 42, labels: ['external-report'],
    }] : [])
  })
}
