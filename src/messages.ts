export type Language = 'en' | 'ja'
export type MessageRenderer = (message: string, ...values: unknown[]) => string

export const ja: Record<string, string> = {}
export const diagnosticJa: Record<string, string> = {}
export let japaneseLoaded = false
let japaneseLoading: Promise<void> | undefined

export function loadLanguage(locale: Language): Promise<void> {
  if (locale === 'en') return Promise.resolve()
  return japaneseLoading ??= import('./japanese-catalog')
    .then((catalog) => {
      // Optional features may have registered overrides before the base catalog arrives.
      for (const [message, translated] of Object.entries(catalog.ja)) ja[message] ??= translated
      Object.assign(diagnosticJa, catalog.diagnosticJa)
      japaneseLoaded = true
    }).catch((error) => { japaneseLoading = undefined; throw error })
}

export function registerJapaneseMessages(messages: Record<string, string>) {
  Object.assign(ja, messages)
}

export function translate(locale: Language, message: string, ...values: unknown[]): string {
  const template = locale === 'ja' ? ja[message] ?? diagnosticJa[message] ?? message : message
  return template.replace(/\{(\d+)\}/g, (slot, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : slot)
}

export const english: MessageRenderer = (message, ...values) => translate('en', message, ...values)
