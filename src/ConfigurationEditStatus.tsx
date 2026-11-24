import { useCallback, useRef, useSyncExternalStore } from 'react'
import { hasPendingConfiguration } from './configuration-selection'
import { t } from './i18n'

export default function ConfigurationEditStatus({ section = false, form = false }: { section?: boolean; form?: boolean }) {
  const marker = useRef<HTMLSpanElement>(null)
  const scope = useCallback(() => marker.current?.closest(section ? '.presentation-inspector-section' : '[data-configuration-scope]') ?? null, [section])
  const snapshot = useCallback(() => {
    const root = scope()
    const invalid = !!root?.querySelector('[aria-invalid="true"], [data-configuration-invalid="true"], input:invalid, select:invalid, textarea:invalid, [role="alert"]')
    return Number(hasPendingConfiguration(root)) | (Number(invalid) << 1)
  }, [scope])
  const subscribe = useCallback((notify: () => void) => {
    const root = scope()
    if (!root) return () => {}
    const observer = new MutationObserver(notify)
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['data-configuration-pending', 'data-configuration-saved', 'data-configuration-invalid', 'aria-invalid', 'value', 'checked', 'selected', 'disabled'] })
    const events = ['input', 'change', 'focusout', 'invalid', 'reset']
    for (const event of events) root.addEventListener(event, notify, true)
    return () => {
      observer.disconnect()
      for (const event of events) root.removeEventListener(event, notify, true)
    }
  }, [scope])
  const state = useSyncExternalStore(subscribe, snapshot, () => 0)
  const pending = !!(state & 1)
  const invalid = !!(state & 2)
  return <span ref={marker} className={`configuration-edit-status${section ? ' configuration-section-status' : ''}`}
    hidden={section && !state} role={section ? undefined : 'status'} data-pending={pending} data-invalid={invalid}>
    {invalid && <strong>{t('Check configuration input.')}{' '}</strong>}
    {pending ? t('Unsaved configuration changes.') : !section && t('No pending configuration edits.')}
    {!section && <span className="configuration-save-hint">{t(form
      ? 'Use the Save button to apply this form to the workspace. Cloud saving is separate.'
      : 'Fields update this workspace as you edit, unless marked Save on blur or applied with a Save/Apply button. Cloud saving is separate.')}</span>}
  </span>
}
