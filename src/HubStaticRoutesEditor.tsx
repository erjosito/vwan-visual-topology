import { useEffect, useRef, useState } from 'react'
import type { Hub } from './model'
import { hubRouteTables, NONE_HUB_TABLE } from './hub-routing'
import { cidr } from './validation'
import { t } from './i18n'

type Owner = Pick<Hub, 'id' | 'firewall' | 'routeTables'>

export function HubStaticRoutesEditor({ hub, onChange, focusFirewall = false }: { hub: Owner; onChange: (hub: Owner) => void; focusFirewall?: boolean }) {
  const [error, setError] = useState('')
  const declaration = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusFirewall) {
      declaration.current?.focus()
      declaration.current?.scrollIntoView({ block: 'center' })
    }
  }, [focusFirewall])
  const update = (tableId: string, change: (table: NonNullable<Hub['routeTables']>[number]) => void) => {
    const tables = structuredClone(hubRouteTables(hub))
    change(tables.find((table) => table.id === tableId)!)
    onChange({ ...hub, routeTables: tables })
    setError('')
  }
  return <section aria-label={t('Static hub Firewall routing')}>
    <h4>{t('Static hub Firewall routing')}</h4>
    <p>{t('Single hub only. Declare the original local Firewall identity; disable both routing intents. Static routes select inspection, not Firewall permission or application delivery.')}</p>
    <label className="checkbox-field"><input ref={declaration} type="checkbox" checked={!!hub.firewall} onChange={(event) => {
      const owner = { ...hub }
      if (event.target.checked) owner.firewall = { id: `fw-${hub.id}`, name: 'Azure Firewall' }
      else delete owner.firewall
      onChange(owner)
    }} />{t('Declare local Azure Firewall')}</label>
    {hub.firewall && <>
      <label className="field"><span>{t('Local Firewall ID')}</span><input aria-label={t('Local Firewall ID')}
        key={hub.firewall.id} defaultValue={hub.firewall.id} maxLength={2048} onBlur={(event) => {
          const id = event.target.value.trim()
          if (!id) { setError(t('Local Firewall ID is required.')); return }
          onChange({ ...hub, firewall: { ...hub.firewall!, id } })
          setError('')
        }} /></label>
      <label className="field"><span>{t('Local Firewall name')}</span><input aria-label={t('Local Firewall name')}
        key={hub.firewall.name} defaultValue={hub.firewall.name} maxLength={120} onBlur={(event) => {
          const name = event.target.value.trim()
          if (!name) { setError(t('Local Firewall name is required.')); return }
          onChange({ ...hub, firewall: { ...hub.firewall!, name } })
          setError('')
        }} /></label>
    </>}
    {hubRouteTables(hub).filter((table) => table.id !== NONE_HUB_TABLE || table.staticRoutes?.length).map((table) =>
      <fieldset key={table.id}><legend>{table.name} · {table.id}</legend>
        {(table.staticRoutes ?? []).map((route, index) => <fieldset key={`${table.id}:${index}`}>
          <legend>{route.name}</legend>
          <label className="field"><span>{t('Static route name')}</span><input aria-label={`${t('Static route name')} ${table.id} ${index + 1}`}
            key={route.name} defaultValue={route.name} maxLength={120} onBlur={(event) => {
              const name = event.target.value.trim()
              if (!name) return
              update(table.id, (owner) => { owner.staticRoutes![index].name = name })
            }} /></label>
          <label className="field"><span>{t('Destination prefixes')}</span><input aria-label={`${t('Destination prefixes')} ${table.id} ${index + 1}`}
            key={route.destinations.join(',')} defaultValue={route.destinations.join(', ')}
            onChange={(event) => event.target.setCustomValidity('')} onBlur={(event) => {
              const destinations = [...new Set(event.target.value.split(/[,\s]+/).filter(Boolean))]
              if (!destinations.length || destinations.some((prefix) => !cidr(prefix))) {
                const message = t('Enter valid IPv4 CIDR prefixes.')
                event.target.setCustomValidity(message)
                setError(message)
                return
              }
              update(table.id, (owner) => { owner.staticRoutes![index].destinations = destinations })
            }} /></label>
          <label className="field"><span>{t('Next hop')}</span><select aria-label={`${t('Next hop')} ${table.id} ${index + 1}`}
            value={route.nextHop} onChange={(event) => update(table.id, (owner) => {
              Object.assign(owner.staticRoutes![index], { nextHop: event.target.value, destinationType: 'CIDR', nextHopType: 'ResourceId' })
            })}>
            {route.nextHop !== hub.firewall?.id && <option value={route.nextHop}>{route.nextHop || t('Unknown')}</option>}
            {hub.firewall && <option value={hub.firewall.id}>{hub.firewall.name} · {hub.firewall.id}</option>}
          </select></label>
          <button type="button" onClick={() => update(table.id, (owner) => { owner.staticRoutes!.splice(index, 1) })}>{t('Remove static route')}</button>
        </fieldset>)}
        <button type="button" disabled={!hub.firewall || table.id === NONE_HUB_TABLE} onClick={() => update(table.id, (owner) => {
          ;(owner.staticRoutes ??= []).push({ name: `inspect-${crypto.randomUUID()}`, destinationType: 'CIDR',
            destinations: ['10.0.0.0/8'], nextHopType: 'ResourceId', nextHop: hub.firewall!.id })
        })}>{t('Add static hub route')}</button>
      </fieldset>)}
    {error && <p role="alert">{error}</p>}
  </section>
}
