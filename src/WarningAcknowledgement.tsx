import { t } from './i18n'
import './warning-triage.css'

export function WarningAcknowledgement({ acknowledged, disabled, onChange }: { acknowledged: boolean; disabled?: boolean; onChange: (acknowledged: boolean) => void }) {
  return <div className="warning-triage-actions">
    {acknowledged && <span data-testid="warning-acknowledged">{t('Acknowledged warning — not fixed')}</span>}
    <button type="button" disabled={disabled} data-testid="warning-acknowledgement" onClick={() => onChange(!acknowledged)}>
      {t(acknowledged ? 'Restore attention' : 'Acknowledge warning')}
    </button>
  </div>
}
