import { t } from './i18n'
import type { RouteMap, RouteMapRule } from './model'

function RuleAction({ rule }: { rule: RouteMapRule }) {
  if (rule.action === 'drop') return <strong className="policy-drop">{t("Drop route")}</strong>
  if (rule.action === 'prepend') return <>{t("Prepend ASNs")}<code>{rule.prepend.join(' ') || t("None")}</code></>
  if (rule.action === 'summarize') return <>{t("Summarize to")}{rule.summaryPrefixes.map((prefix) => <code key={prefix}>{prefix}</code>)}</>
  return <>{t("Permit unchanged")}</>
}

export function RouteMapRules({ map, label }: { map: RouteMap; label: string }) {
  return map.rules.length ? <div className="table-scroll"><table aria-label={label}>
    <thead><tr><th scope="col">#</th><th scope="col">{t("Match")}</th><th scope="col">{t("Action")}</th><th scope="col">{t("Then")}</th></tr></thead>
    <tbody>{map.rules.map((rule, index) => <tr key={rule.id}>
      <td>{index + 1}</td>
      <td>{!rule.prefixes.length ? t("All prefixes") : <>{rule.match === 'equals' ? t("Equals") : t("Contains (including more specific)")}{rule.prefixes.map((prefix) => <code key={prefix}>{prefix}</code>)}</>}</td>
      <td><RuleAction rule={rule} /></td>
      <td>{rule.action === 'drop' ? t("Stop (drop)") : rule.nextStep === 'continue' ? t("Continue") : t("Stop")}</td>
    </tr>)}</tbody>
  </table></div> : <p className="muted">{t("No rules; all routes pass unchanged.")}</p>
}
