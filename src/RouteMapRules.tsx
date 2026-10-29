import type { RouteMap, RouteMapRule } from './model'

function RuleAction({ rule }: { rule: RouteMapRule }) {
  if (rule.action === 'drop') return <strong className="policy-drop">Drop route</strong>
  if (rule.action === 'prepend') return <>Prepend ASNs<code>{rule.prepend.join(' ') || 'None'}</code></>
  if (rule.action === 'summarize') return <>Summarize to{rule.summaryPrefixes.map((prefix) => <code key={prefix}>{prefix}</code>)}</>
  return <>Permit unchanged</>
}

export function RouteMapRules({ map, label }: { map: RouteMap; label: string }) {
  return map.rules.length ? <div className="table-scroll"><table aria-label={label}>
    <thead><tr><th scope="col">#</th><th scope="col">Match</th><th scope="col">Action</th><th scope="col">Then</th></tr></thead>
    <tbody>{map.rules.map((rule, index) => <tr key={rule.id}>
      <td>{index + 1}</td>
      <td>{!rule.prefixes.length ? 'All prefixes' : <>{rule.match === 'equals' ? 'Equals' : 'Contains (including more specific)'}{rule.prefixes.map((prefix) => <code key={prefix}>{prefix}</code>)}</>}</td>
      <td><RuleAction rule={rule} /></td>
      <td>{rule.action === 'drop' ? 'Stop (drop)' : rule.nextStep === 'continue' ? 'Continue' : 'Stop'}</td>
    </tr>)}</tbody>
  </table></div> : <p className="muted">No rules; all routes pass unchanged.</p>
}
