import { useId, useState } from 'react'
import { t } from './i18n'
import { isVnetCommunity, vnetCommunityError, vnetCommunityHelp, type VnetBgpCommunities } from './vnet-communities'
import './vnet-community-messages-ja'

export default function VnetCommunityEditor({ value, onChange, formField = false }: {
  value?: VnetBgpCommunities
  onChange?: (value: VnetBgpCommunities | undefined) => void
  formField?: boolean
}) {
  const id = useId()
  const saved = value?.virtualNetworkCommunity ?? ''
  const [input, setInput] = useState({ saved, draft: saved })
  if (input.saved !== saved) setInput({ saved, draft: saved })
  const draft = input.draft
  const invalid = draft !== '' && !isVnetCommunity(draft)
  const commit = () => {
    if (invalid || draft === (value?.virtualNetworkCommunity ?? '')) return
    onChange?.(draft || value?.regionalCommunity
      ? { ...(draft ? { virtualNetworkCommunity: draft } : {}), ...(value?.regionalCommunity ? { regionalCommunity: value.regionalCommunity } : {}) }
      : undefined)
  }
  return <fieldset className="aznet-field">
    <legend>{t('VNet BGP community')}</legend>
    <input aria-label={t('VNet BGP community')} aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`}
      aria-invalid={invalid} name={formField ? 'virtualNetworkCommunity' : undefined}
      className="aznet-input" placeholder="12076:20001" maxLength={11} value={draft}
      ref={(element) => { element?.setCustomValidity(invalid ? t(vnetCommunityError) : '') }}
      onChange={(event) => {
        setInput({ saved, draft: event.target.value })
      }}
      onBlur={commit} onKeyDown={(event) => {
        if (!formField && event.key === 'Enter') { event.preventDefault(); commit() }
      }} />
    {invalid && <p id={`${id}-error`} role="alert">{t(vnetCommunityError)}</p>}
    <p>{t('Captured regional community')}: <output>{value?.regionalCommunity ?? t('Not captured')}</output></p>
    <p id={`${id}-help`} className="muted">{t(vnetCommunityHelp)}</p>
  </fieldset>
}
