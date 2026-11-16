import { useEffect, useRef, useState } from 'react'
import type { SimulatorMode } from './SimulatorModeSwitch'
import type { DesktopAccounts, DesktopTargets, LocalFile } from './platform/desktop'
import { t } from './i18n'
import { useWorkspaceSession } from './workspace-context'

export function DesktopTools({ mode }: { mode: SimulatorMode }) {
  const bridge = window.desktopSimulator
  const [accounts, setAccounts] = useState<DesktopAccounts>()
  const [targets, setTargets] = useState<DesktopTargets>()
  const [subscription, setSubscription] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [collectionMode, setCollectionMode] = useState<SimulatorMode>(mode)
  const workspace = useWorkspaceSession()
  const lifetime = useRef({ active: false }), operation = useRef(0)
  useEffect(() => {
    const mount = { active: true }
    lifetime.current = mount
    return () => { mount.active = false }
  }, [])
  if (!bridge) return null
  const selected = accounts?.accounts.find((account) => account.id === subscription)
  const options = targets ? collectionMode === 'vwan' ? targets.wans : targets.groups : []
  const importFile = (file: LocalFile) => {
    if (!file) return
    const input = document.querySelector<HTMLInputElement>('[data-desktop-import]')
    if (!input) throw new Error('No active import control.')
    const transfer = new DataTransfer()
    transfer.items.add(new File([file.content], file.name, { type: 'application/json' }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    setNotice(t('Review the local file using the existing import workflow.'))
  }
  const perform = async (action: (current: () => boolean) => Promise<void>) => {
    const ticket = ++operation.current, version = workspace?.getRequestVersion()
    const mount = lifetime.current
    const current = () => mount.active && ticket === operation.current && (!workspace || workspace.getRequestVersion() === version)
    setBusy(true); setNotice('')
    try { await action(current) }
    catch (error) { if (current()) setNotice(error instanceof Error ? error.message : 'Local operation failed.') }
    finally { if (mount.active && ticket === operation.current) setBusy(false) }
  }
  return <section className="desktop-tools" aria-label={t('Local desktop tools')}>
    <strong>{t('Desktop · offline modeling · no automatic uploads')}</strong>
    <button disabled={busy} onClick={() => { void perform(async (current) => {
      const result = await bridge.openTopology()
      if (!current()) return
      if (!result.ok) throw new Error(result.error)
      importFile(result.value)
    }) }}>{t('Open local JSON')}</button>
    <details><summary>{t('Read-only local Azure collection')}</summary>
      <p>{t('Uses existing Azure CLI and PowerShell 7. No automatic installation, login or resource changes. Public Azure only.')}</p>
      <label>{t('Capture type')} <select value={collectionMode === 'vwan' ? 'vwan' : 'full'} disabled={busy}
        onChange={(event) => { setCollectionMode(event.target.value === 'vwan' ? 'vwan' : 'full'); setTarget('') }}>
        <option value="full">{t('Resource group')}</option><option value="vwan">Virtual WAN</option>
      </select></label>
      <button disabled={busy} onClick={() => { void perform(async (current) => {
        const result = await bridge.accounts()
        if (!current()) return
        if (!result.ok) throw new Error(result.error)
        setAccounts(result.value); setSubscription(''); setTargets(undefined); setTarget('')
      }) }}>{t('Read existing Azure session')}</button>
      {accounts && <p>{t('Azure cloud')}: {accounts.cloud.name} · {accounts.cloud.resourceManager}</p>}
      <label>{t('Select subscription and tenant')} <select value={subscription} disabled={busy} onChange={(event) => { setSubscription(event.target.value); setTargets(undefined); setTarget('') }}>
        <option value="">{t('Select explicitly')}</option>
        {accounts?.accounts.filter((account) => account.state === 'Enabled').map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id} · {account.tenantId}</option>)}
      </select></label>
      <button disabled={busy || !selected} onClick={() => { void perform(async (current) => {
        if (!selected) return
        const result = await bridge.targets({ subscriptionId: selected.id, tenantId: selected.tenantId })
        if (!current()) return
        if (!result.ok) throw new Error(result.error)
        setTargets(result.value); setTarget('')
      }) }}>{t('Read available collection targets')}</button>
      <label>{collectionMode === 'vwan' ? 'Virtual WAN' : t('Resource group')} <select value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}>
        <option value="">{t('Select explicitly')}</option>
        {options.map((option) => <option key={option.id} value={collectionMode === 'vwan' ? option.id : option.name}>{option.name}</option>)}
      </select></label>
      <button disabled={busy || !selected || !options.some((option) => (collectionMode === 'vwan' ? option.id : option.name) === target)} onClick={() => { void perform(async (current) => {
        if (!selected) return
        const result = await bridge.collect({ subscriptionId: selected.id, tenantId: selected.tenantId, mode: collectionMode, target })
        if (!current()) return
        if (!result.ok) throw new Error(result.error)
        importFile(result.value)
      }) }}>{t('Collect and review locally')}</button>
    </details>
    {notice && <p role="status">{notice}</p>}
  </section>
}
