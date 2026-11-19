import { t } from './i18n'

export function hasPendingConfiguration(root: Element | null): boolean {
  return !!(root?.matches('[data-configuration-pending="true"]')
    || root?.querySelector('[data-configuration-pending="true"]')
    || [...root?.querySelectorAll<HTMLInputElement>('[data-configuration-saved]') ?? []]
      .some(input => input.value !== input.dataset.configurationSaved)
    || [...root?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('form input, form textarea, form select') ?? []]
      .some(input => {
        if (input.hasAttribute('data-configuration-pending') || input.closest('form[data-configuration-tracked]')) return false
        if (input instanceof HTMLSelectElement) {
          const defaults = [...input.options].filter(option => option.defaultSelected)
          return defaults.length > 0 && [...input.selectedOptions].map(option => option.value).join('\0') !== defaults.map(option => option.value).join('\0')
        }
        return input instanceof HTMLInputElement && ['checkbox', 'radio'].includes(input.type)
          ? input.checked !== input.defaultChecked : input.value !== input.defaultValue
      }))
}

export function confirmConfigurationSwitch(selector: string): boolean {
  return !hasPendingConfiguration(document.querySelector(selector))
    || window.confirm(t('Discard unsaved configuration changes and switch resources? Save your changes first to keep them.'))
}
