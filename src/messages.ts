import { ja } from './i18n-ja'
import { diagnosticJa } from './i18n-diagnostics-ja'

export type Language = 'en' | 'ja'
export type MessageRenderer = (message: string, ...values: unknown[]) => string

export function registerJapaneseMessages(messages: Record<string, string>) {
  Object.assign(ja, messages)
}

export function translate(locale: Language, message: string, ...values: unknown[]): string {
  const template = locale === 'ja' ? ja[message] ?? diagnosticJa[message] ?? message : message
  return template.replace(/\{(\d+)\}/g, (slot, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : slot)
}

export const english: MessageRenderer = (message, ...values) => translate('en', message, ...values)
