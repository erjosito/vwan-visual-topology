import { useEffect, useRef, type ReactNode } from 'react'
import { t } from './i18n'
import { useWorkspaceSession } from './workspace-context'

export function PresentationToggle() {
  const session = useWorkspaceSession()
  return <button type="button" data-testid="ui-preview-toggle" aria-pressed={!!session?.presentationPreview}
    title={t('Try a less cluttered presentation. Your design and settings stay unchanged.')}
    onClick={() => session?.setPresentationPreview?.(!session.presentationPreview)}>{t('Preview UI')}</button>
}

export function PresentationGroup({ label, children }: { label: string; children: ReactNode }) {
  const preview = useWorkspaceSession()?.presentationPreview
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!preview) return
    const dismiss = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [preview])
  if (!preview) return children
  return <details ref={details} className="presentation-group" name="workspace-presentation-actions"
    onKeyDown={(event) => {
      if (event.key === 'Escape' && details.current?.open) {
        event.preventDefault(); event.stopPropagation()
        details.current.open = false
        details.current.querySelector('summary')?.focus()
      }
    }}>
    <summary>{label}</summary>
    <div className="presentation-group-content" onClick={(event) => {
      if ((event.target as Element).closest('button') && details.current) {
        details.current.open = false
        details.current.querySelector('summary')?.focus()
      }
    }}>
      <button type="button" className="presentation-group-close">{t('Close')}</button>
      {children}
    </div>
  </details>
}
