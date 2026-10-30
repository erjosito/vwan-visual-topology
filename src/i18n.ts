import { useSyncExternalStore } from 'react'
import { ja } from './i18n-ja'
import { diagnosticJa } from './i18n-diagnostics-ja'

export type Language = 'en' | 'ja'
export const languageStorageKey = 'vwan-visual-topology:language:v1'
export const documentTitles: Record<Language, string> = {
  en: 'Virtual WAN Topology Lab',
  ja: 'Virtual WAN トポロジ ラボ',
}
export function readLanguage(storage?: Pick<Storage, 'getItem'>): Language {
  try { return (storage ?? localStorage).getItem(languageStorageKey) === 'ja' ? 'ja' : 'en' }
  catch { return 'en' }
}
let language: Language = readLanguage()
// App subscribes without a locale-dependent key, so its existing subtree and drafts survive.
// Catalog lookups are presentation-only; routing/model modules never import this module.
const listeners = new Set<() => void>()
function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function setLanguage(next: Language) {
  language = next === 'ja' ? 'ja' : 'en'
  try { localStorage.setItem(languageStorageKey, language) } catch { /* In-memory switching still works. */ }
  document.documentElement.lang = language
  document.title = documentTitles[language]
  listeners.forEach((listener) => listener())
}
export function useLanguage() {
  return useSyncExternalStore(subscribe, () => language, () => 'en' as Language)
}
export function translate(locale: Language, message: string, ...values: unknown[]): string {
  const template = locale === 'ja' ? ja[message] ?? diagnosticJa[message] ?? message : message
  // Substitute once: placeholder-looking content inside user data must remain opaque.
  return template.replace(/\{(\d+)\}/g, (slot, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? '') : slot)
}
export function t(message: string, ...values: unknown[]) {
  return translate(language, message, ...values)
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const azureLimitationMessages = [
  'Route tables could not be read; configuration is incomplete.',
  'Route maps could not be read; configuration is incomplete.',
  'Routing intent could not be read; configuration is incomplete.',
  'VNet connections could not be read; configuration is incomplete.',
  'Capture is incomplete; configuration reads failed or were unavailable.',
  'WAN transit flags differ from, or cannot confirm, the simulator full-mesh defaults.',
  'Unsupported routing-intent destination; only structure is imported.',
  'Routing intent targets a non-Azure-Firewall provider; its policy is not simulated.',
  'A VNet connection has custom or unknown association/propagation settings.',
  'A referenced VNet could not be read; its spoke is omitted.',
  'IPv6 VNet prefixes are omitted; IPv6 is not simulated.',
  'A VNet has no usable IPv4 prefixes; its spoke is omitted.',
  'Hub provisioning is not Succeeded.',
  'Hub branch-to-branch transit is disabled.',
  'Custom hub route tables or static routes are not reconstructed.',
  'Azure route maps are not reconstructed.',
  'Security partner/NVA settings are not reconstructed.',
  'Cross-subscription VNet read skipped. Opt in with -AllowCrossSubscriptionVnets to read only referenced VNets.',
  'A referenced VNet read failed; check read permissions.',
]
const prefixedAzureDiagnostics = Object.fromEntries(azureLimitationMessages.map((message) =>
  [`{0}: ${message}`, `{0}: ${diagnosticJa[message]}`]))
const networkPrefix = '(?:\\d{1,3}\\.){3}\\d{1,3}/\\d{1,2}'
const diagnosticShapes: Record<string, { priority?: number; slots: Record<string, string> }> = {
  // Match structural envelopes before atomic reasons. Greedy router slots preserve names
  // that themselves contain diagnostic-looking text; the final CIDR delimiter is structural.
  '{0}: longest prefix {1}. {2}': { priority: 10, slots: { 0: '[\\s\\S]*', 1: networkPrefix } },
  'Azure Firewall in {0}: longest prefix {1}. {2}': { priority: 11, slots: { 0: '[\\s\\S]*', 1: networkPrefix } },
  '{0} wins the ExpressRoute versus S2S VPN comparison.': { slots: { 0: 'ExpressRoute|VPN' } },
  '{0} equal-cost paths remain; no single traffic hash is predicted.': { slots: { 0: '\\d+' } },
  '{0} equal-cost paths remain (maximum 32).': { slots: { 0: '\\d+' } },
  'Shortest learned AS path ({0} ASNs).': { slots: { 0: '\\d+' } },
  'Shortest learned AS path ({0} ASNs, including inter-hub prepends).': { slots: { 0: '\\d+' } },
  'Shortest ER AS path ({0} ASNs).': { slots: { 0: '\\d+' } },
  'Shortest site AS path ({0} ASN{1}).': { slots: { 0: '\\d+', 1: 's?' } },
  'Source site: longest prefix {0}, shortest AS path {1}.': { slots: { 0: networkPrefix, 1: 'local|\\d+(?: \\d+)*' } },
}
const selectionReasonMessages = new Set([
  'Directly connected spoke system routes override BGP routes for the same prefix.',
  'Remote routes from private-routing-intent hubs take precedence over unsecured remote ExpressRoute paths.',
  'Shortest learned AS path ({0} ASNs, including inter-hub prepends).',
  'Local connections are preferred over remote-hub connections.',
  '{0} wins the ExpressRoute versus S2S VPN comparison.',
  'Shortest learned AS path ({0} ASNs).',
  'Only available path, or all paths have equal modeled preference.',
  '{0} equal-cost paths remain; no single traffic hash is predicted.',
  'Routing intent redirects this prefix to Azure Firewall. The firewall uses its separate routing table.',
  'Internet routing intent uses direct Internet egress from Azure Firewall.',
  'Azure Firewall has a direct Internet fallback when no default is learned. This does not install a hub default route.',
])
const templates = Object.entries({ ...ja, ...diagnosticJa, ...prefixedAzureDiagnostics })
  .map(([message, translated]) => {
    const slots: string[] = []
    let pattern = '', position = 0
    for (const match of message.matchAll(/\{(\d+)\}/g)) {
      pattern += escape(message.slice(position, match.index)) + '(' + (diagnosticShapes[message]?.slots[match[1]] ?? '[\\s\\S]*?') + ')'
      slots.push(match[1])
      position = match.index! + match[0].length
    }
    pattern += escape(message.slice(position))
    return { message, pattern: new RegExp('^' + pattern + '$'), startPattern: new RegExp('^' + pattern + '(?= |$)'), translated, slots,
      priority: diagnosticShapes[message]?.priority ?? 0,
      specificity: message.replace(/\{\d+\}/g, '').length }
  }).sort((a, b) => b.priority - a.priority || b.specificity - a.specificity)
const diagnostics = templates.filter((template) => template.slots.length)
const selectionReasons = templates.filter((template) => selectionReasonMessages.has(template.message))

/** Exact, anchored engine-message templates only; never apply to names, code or imported prose. */
export function localizeDiagnostic(message: string, locale: Language = language): string {
  if (locale === 'en') return message
  if (message.startsWith('Import rejected: ')) {
    return translate(locale, 'Import rejected: {0}', localizeDiagnostic(message.slice('Import rejected: '.length), locale))
  }
  const saved = /^Saved topology could not be loaded: ([\s\S]*). The saved data has not been overwritten\.$/.exec(message)
  if (saved) return translate(locale, 'Saved topology could not be loaded: {0}. The saved data has not been overwritten.', localizeDiagnostic(saved[1], locale))
  const direct = diagnosticJa[message] ?? ja[message]
  if (direct !== undefined) return direct
  for (const { message: template, pattern, translated, slots } of diagnostics) {
    const match = pattern.exec(message)
    if (match) return translated.replace(/\{(\d+)\}/g, (slot, index: string) => {
      const capture = slots.indexOf(index)
      if (capture === -1) return slot
      const value = match[capture + 1]
      if (index === '1' && template === 'Source site: longest prefix {0}, shortest AS path {1}.' && value === 'local') {
        return translate(locale, 'local')
      }
      if (index === '0' && ['{0} must contain 1-120 characters.', '{0} must be an array with at most {1} entries.',
        '{0} must be an object.', 'Invalid {0}.'].includes(template)) return translate(locale, value)
      if (index === '0' && ['Import rejected: {0}', 'Saved topology could not be loaded: {0}. The saved data has not been overwritten.'].includes(template)) {
        return localizeDiagnostic(value, locale)
      }
      if (index === '2' && ['{0}: longest prefix {1}. {2}', 'Azure Firewall in {0}: longest prefix {1}. {2}'].includes(template)) {
        return localizeSelectionExplanation(value, locale)
      }
      return value
    })
  }

  return message
}

// Parse only complete, declared engine reasons. Multi-sentence reasons remain atomic.
function localizeSelectionExplanation(message: string, locale: Language) {
  const parts: string[] = []
  let remainder = message
  while (remainder) {
    const reason = selectionReasons.map((template) => template.startPattern.exec(remainder)).find((match) => match !== null)
    if (!reason) { parts.push(remainder); break }
    parts.push(localizeDiagnostic(reason[0], locale))
    remainder = remainder.slice(reason[0].length)
    if (remainder.startsWith(' ')) remainder = remainder.slice(1)
  }
  return parts.join(' ')
}
