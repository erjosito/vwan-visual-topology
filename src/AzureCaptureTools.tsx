import { useEffect, useRef, useState } from 'react'
import type { DesktopAccounts, DesktopTargets, LocalFile } from './platform/desktop'
import { t } from './i18n'
import { useWorkspaceSession } from './workspace-context'

export function AzureCaptureTools({ mode, onCapture }: {
  mode: 'vwan' | 'full'; onCapture: (file: NonNullable<LocalFile>, current: () => boolean) => Promise<void>
}) {
  const bridge = window.desktopSimulator
  const workspace = useWorkspaceSession()
  const [accounts, setAccounts] = useState<DesktopAccounts>()
  const [targets, setTargets] = useState<DesktopTargets>()
  const [subscription, setSubscription] = useState('')
  const [target, setTarget] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])
  const perform = async (action: (current: () => boolean) => Promise<void>) => {
    const ticket = ++request.current, version = workspace?.getRequestVersion()
    const current = () => ticket === request.current && (!workspace || version === workspace.getRequestVersion())
    setBusy(true); setNotice('')
    try { await action(current) }
    catch (error) { if (current()) setNotice(error instanceof Error ? error.message : t('Local operation failed.')) }
    finally { if (ticket === request.current) setBusy(false) }
  }
  const selected = accounts?.accounts.find((account) => account.id === subscription && account.state === 'Enabled')
  const suggestion = accounts?.accounts.find((account) => account.isDefault)
  const options = mode === 'vwan' ? targets?.wans : targets?.groups
  return <section className="azure-capture-tools" aria-label={t('Read-only local Azure collection')}>
    <h3>{t('Read-only local Azure collection')}</h3>
    <p>{t('Uses existing Azure CLI and PowerShell 7. No automatic installation, login or resource changes. Public Azure only.')}</p>
    <p>{t('Effective-route reads may require additional action permissions beyond Reader. Missing tools or expired sessions must be fixed outside the app; then read the session again. Denied or partial evidence remains unassessed.')}</p>
    {!bridge && <p id="azure-windows-explanation">{t('Local Azure CLI integration requires the Windows desktop app. On web, download the collector and load a capture below.')}</p>}
    <button disabled={!bridge || busy} aria-describedby={!bridge ? 'azure-windows-explanation' : undefined} onClick={() => { void perform(async (current) => {
      if (!bridge) return
      setAccounts(undefined); setSubscription(''); setTargets(undefined); setTarget(''); setConfirmed(false)
      const result = await bridge.accounts()
      if (!current()) return
      if (!result.ok) throw new Error(result.error)
      setAccounts(result.value)
      setNotice(t(result.value.accounts.some((account) => account.state === 'Enabled')
        ? 'Cached CLI accounts found; authentication is not yet verified. Select a subscription and read targets. The CLI default is not authorization.'
        : 'No enabled subscriptions found. Sign in using Azure CLI outside the app, then read the session again.'))
    }) }}>{t('Read existing Azure session')}</button>
    {accounts && <>
      <p>{t('Azure cloud')}: {accounts.cloud.name} · {accounts.cloud.resourceManager}</p>
      <p>{t('Current CLI subscription (suggestion only)')}: {suggestion ? `${suggestion.name} · ${suggestion.id} · ${suggestion.tenantId}` : t('Unknown')}</p>
      <label className="field"><span>{t('Select subscription and tenant')}</span><select value={subscription} disabled={busy} onChange={(event) => {
        setSubscription(event.target.value); setTargets(undefined); setTarget(''); setConfirmed(false)
      }}>
        <option value="">{t('Select explicitly')}</option>
        {accounts.accounts.filter((account) => account.state === 'Enabled').map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id} · {account.tenantId}</option>)}
      </select></label>
      <button disabled={busy || !selected} onClick={() => { void perform(async (current) => {
        if (!bridge || !selected) return
        setTargets(undefined); setTarget(''); setConfirmed(false)
        const result = await bridge.targets({ subscriptionId: selected.id, tenantId: selected.tenantId })
        if (!current()) return
        if (!result.ok) throw new Error(result.error)
        setTargets(result.value)
        setNotice(t('Scope read succeeded with the existing CLI session. Confirm the capture target; effective-route permissions may differ.'))
      }) }}>{t('Read available collection targets')}</button>
      <label className="field"><span>{mode === 'vwan' ? 'Virtual WAN' : t('Resource group')}</span><select value={target} disabled={busy} onChange={(event) => { setTarget(event.target.value); setConfirmed(false) }}>
        <option value="">{t('Select explicitly')}</option>
        {options?.map((option) => <option key={option.id} value={mode === 'vwan' ? option.id : option.name}>{option.name}</option>)}
      </select></label>
      {selected && target && <label className="checkbox-field azure-resource-id"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
        {t('Confirm read-only capture scope')}: {selected.name} · {selected.id} · {selected.tenantId} · {target}
      </label>}
    </>}
    <button disabled={!bridge || busy || !confirmed || !selected || !options?.some((option) => (mode === 'vwan' ? option.id : option.name) === target)} onClick={() => { void perform(async (current) => {
      if (!bridge || !selected || !confirmed) return
      setConfirmed(false)
      const result = await bridge.collect({ subscriptionId: selected.id, tenantId: selected.tenantId, mode, target })
      if (!current()) return
      if (!result.ok) throw new Error(result.error)
      if (!result.value) throw new Error(t('No capture returned. The current design is unchanged.'))
      await onCapture(result.value, current)
      if (current()) setNotice(t('Capture attached for comparison. The current design is unchanged.'))
    }) }}>{t('Capture → Compare current design')}</button>
    {busy && <p role="status">{t('Reading Azure… The current design is unchanged. Collection can take several minutes.')}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>
}
