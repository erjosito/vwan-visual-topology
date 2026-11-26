import { useId, useState, type InputHTMLAttributes } from 'react'
import { t } from '../i18n'
import { cidr } from '../validation'
import { subnetAddressError, vnetAddressError } from './addressing'
import { resizeAzSubnet, subnetNeedsReaddressing } from './subnet-address-editing'
import type { AzNetTopology, AzSubnet, AzVNet } from './model'

interface EditorProps {
  topology: AzNetTopology
  vnet: AzVNet
  preview?: boolean
  onChange: (updater: (draft: AzNetTopology) => void) => boolean | void
}

const prefixes = (raw: string) => raw.split(',').map((prefix) => prefix.trim()).filter(Boolean)
const formatPrefixes = (raw: string) => prefixes(raw).join(', ')

function PrefixInput({ value, deferred, onCommit, validate, format, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur'> & {
  value: string; deferred: boolean; onCommit: (value: string) => boolean | void; validate: (value: string) => string | undefined
  format?: (value: string) => string
}) {
  const [draft, setDraft] = useState(value)
  const errorId = useId()
  const error = validate(deferred ? draft : value)
  return <><input {...props} value={deferred ? draft : value}
    data-configuration-pending={deferred && draft !== value}
    aria-invalid={!!error}
    aria-describedby={error ? [props['aria-describedby'], errorId].filter(Boolean).join(' ') : props['aria-describedby']}
    style={{ ...props.style, color: error ? 'var(--error)' : props.style?.color, borderColor: error ? 'var(--error)' : props.style?.borderColor }}
    onChange={(event) => deferred ? setDraft(event.target.value) : onCommit(event.target.value)}
    onBlur={() => {
      if (deferred && draft !== value && onCommit(draft) !== false) setDraft(format ? format(draft) : draft)
    }} />
    {deferred && <small className="configuration-save-hint">{t('Save on blur')}</small>}
    {error && <span id={errorId} role="alert" style={{ color: 'var(--error)', fontSize: 11, maxWidth: 250 }}>{t(error)}</span>}</>
}

export function VnetPrefixEditor({ vnet, preview, onChange }: EditorProps) {
  return <label className="presentation-vnet-field"><span hidden={!preview}>{t('Address spaces')}</span>
    <PrefixInput key={vnet.prefixes.join(', ')}
      type="text" className="aznet-input" value={vnet.prefixes.join(', ')} deferred
      format={formatPrefixes}
      aria-label={t('VNet CIDR prefixes {0}', vnet.name)} title="VNet CIDR prefixes (comma-separated)"
      validate={(raw) => vnetAddressError({ ...vnet, prefixes: prefixes(raw) })}
      onCommit={(raw) => onChange((draft) => {
        const target = draft.vnets.find((entry) => entry.id === vnet.id)
        if (target) target.prefixes = prefixes(raw)
      })}
      style={{ width: 130, fontSize: 11.5 }} />
  </label>
}

export function SitePrefixEditor({ site, onChange }: {
  site: AzNetTopology['sites'][number]; onChange: EditorProps['onChange']
}) {
  return <label className="presentation-vnet-field">
    <span>{t('Advertised prefixes')}</span>
    <PrefixInput key={site.prefixes.join(', ')} type="text" className="aznet-input"
      value={site.prefixes.join(', ')} deferred aria-label={t('Advertised prefixes')}
      format={formatPrefixes}
      title="Advertised prefixes (comma-separated)"
      validate={(raw) => prefixes(raw).some((prefix) => !cidr(prefix))
        ? 'Enter valid IPv4 CIDR prefixes.' : undefined}
      onCommit={(raw) => onChange((draft) => {
        const target = draft.sites.find((entry) => entry.id === site.id)
        if (target) target.prefixes = prefixes(raw)
      })}
      style={{ width: 150, fontSize: 11.5 }} />
  </label>
}

export function SubnetPrefixEditor({ topology, vnet, subnet, preview, onChange }: EditorProps & { subnet: AzSubnet }) {
  return <><label className="presentation-vnet-field"><span hidden={!preview}>{t('Subnet prefix')}</span>
    <PrefixInput key={topology.inventory ? subnet.prefix : undefined}
      type="text" className="aznet-input" data-testid={`aznet-subnet-prefix-${subnet.id}`}
      aria-label={t('Subnet prefix {0}', subnet.name)} value={subnet.prefix} deferred={topology.inventory !== undefined}
      validate={(prefix) => subnetAddressError(vnet.prefixes, prefix)}
      onCommit={(prefix) => onChange((draft) => resizeAzSubnet(draft, vnet.id, subnet.id, prefix))}
      style={{ width: 120, fontFamily: 'monospace', fontSize: 11.5 }} />
  </label>
    {subnetNeedsReaddressing(topology, vnet, subnet.id) && <button type="button" className="aznet-btn"
      title={t('Reassign stored resource IPs into this subnet and update matching next hops.')}
      onClick={() => onChange((draft) => resizeAzSubnet(draft, vnet.id, subnet.id, subnet.prefix))}>
      {t('Update resource addresses')}
    </button>}
  </>
}
