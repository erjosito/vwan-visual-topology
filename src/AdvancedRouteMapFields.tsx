import { t } from './i18n'
import type { RouteMapCondition, RouteMapModification, RouteMapRule } from './model'

export function AdvancedRouteMapFields({ rule, index, onChange }: { rule: RouteMapRule; index: number; onChange: (rule: RouteMapRule) => void }) {
  const conditions = rule.matchConditions ?? []
  const modifications = rule.modifications ?? []
  return <section aria-label={t('Rule {0} advanced attributes', index)}>
    <p className="muted">{t('All match conditions must match (AND). Community Equals requires all listed communities; Contains requires any. AS-path Equals matches the ordered path; Contains matches any listed ASN.')}</p>
    {conditions.map((condition, row) => <div className="form-grid" key={condition.id}>
      <label className="field"><span>{t('Match property')}</span><select aria-label={t('Rule {0} condition {1} property', index, row + 1)}
        value={condition.property} onChange={(event) => onChange({ ...rule, matchConditions: conditions.map((entry, i) => i === row ? { ...entry, property: event.target.value as RouteMapCondition['property'], values: [] } : entry) })}>
        <option value="prefix">{t('Prefix')}</option><option value="asPath">{t('AS path')}</option><option value="community">{t('Communities')}</option>
      </select></label>
      <label className="field"><span>{t('Match mode')}</span><select aria-label={t('Rule {0} condition {1} match', index, row + 1)}
        value={condition.match} onChange={(event) => onChange({ ...rule, matchConditions: conditions.map((entry, i) => i === row ? { ...entry, match: event.target.value as RouteMapCondition['match'] } : entry) })}>
        <option value="equals">{t('Equals')}</option><option value="contains">{t('Contains')}</option>
      </select></label>
      <label className="field"><span>{t('Match values')}</span><input aria-label={t('Rule {0} condition {1} values', index, row + 1)}
        name={`${rule.id}-condition-${row}`} defaultValue={condition.values.join(' ')} key={condition.property} /></label>
      <button type="button" onClick={() => onChange({ ...rule, matchConditions: conditions.filter((_, i) => i !== row) })}>{t('Remove condition')} {row + 1}</button>
    </div>)}
    <button type="button" disabled={conditions.length >= 40} onClick={() => onChange({ ...rule, matchConditions: [...conditions, { id: crypto.randomUUID(), property: 'asPath', match: 'equals', values: [] }] })}>{t('Add match condition')}</button>
    {rule.action !== 'drop' && <>
      <p className="muted">{t('Multiple attribute modifications may accompany prefix summarization or prepend. Replace with an empty value clears the attribute; Azure-reserved communities are preserved. Summarization strips AS paths and communities, including same-rule modifications.')}</p>
      {modifications.map((modification, row) => <div className="form-grid" key={modification.id}>
        <label className="field"><span>{t('Modify property')}</span><select aria-label={t('Rule {0} modification {1} property', index, row + 1)}
          value={modification.property} onChange={(event) => onChange({ ...rule, modifications: modifications.map((entry, i) => i === row ? { ...entry, property: event.target.value as RouteMapModification['property'], action: 'replace', values: [] } : entry) })}>
          <option value="asPath">{t('AS path')}</option><option value="community">{t('Communities')}</option>
        </select></label>
        <label className="field"><span>{t('Action')}</span><select aria-label={t('Rule {0} modification {1} action', index, row + 1)}
          value={modification.action} onChange={(event) => onChange({ ...rule, modifications: modifications.map((entry, i) => i === row ? { ...entry, action: event.target.value as RouteMapModification['action'] } : entry) })}>
          <option value="add">{t('Add')}</option><option value="replace">{t('Replace / clear')}</option>
          {modification.property === 'community' && <option value="remove">{t('Remove')}</option>}
        </select></label>
        <label className="field"><span>{t('Modification values')}</span><input aria-label={t('Rule {0} modification {1} values', index, row + 1)}
          name={`${rule.id}-modification-${row}`} defaultValue={modification.values.join(' ')} key={modification.property} /></label>
        <button type="button" onClick={() => onChange({ ...rule, modifications: modifications.filter((_, i) => i !== row) })}>{t('Remove modification')} {row + 1}</button>
      </div>)}
      <button type="button" disabled={modifications.length >= 40} onClick={() => onChange({ ...rule, modifications: [...modifications, { id: crypto.randomUUID(), property: 'community', action: 'add', values: [] }] })}>{t('Add modification')}</button>
    </>}
  </section>
}
