import type { SelectHTMLAttributes } from 'react'
import { ALL_KNOWN_AZURE_REGIONS, normalizeAzureRegionName } from './er-locations-catalog'
import { t } from './i18n'

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'multiple' | 'value' | 'defaultValue'> & {
  value?: string
  defaultValue?: string
}

export function AzureRegionSelect({ value, defaultValue, ...props }: Props) {
  const current = value ?? defaultValue ?? ''
  const normalized = normalizeAzureRegionName(current)
  const known = ALL_KNOWN_AZURE_REGIONS.includes(normalized)
  return <select {...props} value={value} defaultValue={defaultValue}>
    {!known && <option value={current}>{current ? `${current} (${t('Unknown region')})` : t('Not specified')}</option>}
    {ALL_KNOWN_AZURE_REGIONS.map((region) => <option key={region}
      value={region === normalized ? current : region}>{region}</option>)}
  </select>
}
