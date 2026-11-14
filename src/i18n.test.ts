import { describe, expect, it } from 'vitest'
import { localizeDiagnostic, readLanguage, translate } from './i18n'
import { example } from './model'
import { simulate, traceFlow } from './routing'
import { validateTopology } from './validation'

describe('localization boundaries', () => {
  it('translates declared context-provenance envelopes without rewriting opaque imported hub names', () => {
    const name = 'BGP table {2}: Hub route-table inventory is incomplete'
    for (const reason of [
      'Hub route-table inventory is incomplete; table-context reachability is unknown.',
      'A VNet association or propagation context is unknown or outside the captured local inventory.',
      'A VNet internet-security flag is unknown; default-route reachability is not established.',
      'Hub BGP connections could not be read; configuration is incomplete.',
    ]) {
      expect(localizeDiagnostic(`${name}: ${reason}`, 'ja')).toBe(`${name}: ${translate('ja', reason)}`)
      expect(localizeDiagnostic(`${name}: ${reason} user prose`, 'ja')).toBe(`${name}: ${reason} user prose`)
    }
  })

  it('defaults to English for unsupported preferences and inaccessible storage', () => {
    expect(readLanguage({ getItem: () => 'ja' })).toBe('ja')
    for (const value of ['en', 'fr', 'JA', '', null]) {
      expect(readLanguage({ getItem: () => value })).toBe('en')
    }
    expect(readLanguage({ getItem: () => { throw new Error('denied') } })).toBe('en')
  })

  it('preserves opaque names, addresses, acronyms and placeholder-looking user text', () => {
    const name = 'BGP table {1} 10.20.0.0/16 <日本語>'
    expect(translate('ja', 'Delete {0}', name)).toBe(`${name} を削除`)
    expect(translate('en', 'Delete {0}', name)).toBe(`Delete ${name}`)
    expect(translate('ja', 'Unknown message {0}', name)).toBe(`Unknown message ${name}`)
    expect(translate('ja', 'AS path')).toBe('AS パス')
    expect(translate('ja', 'BGP table')).toBe('BGP テーブル')
    expect(translate('ja', 'Learned routes')).toBe('学習したルート')
    expect(translate('ja', 'Advertised routes')).toBe('アドバタイズしたルート')
    expect(translate('ja', 'Before {0} route maps', translate('ja', 'inbound'))).toBe('インバウンド ルート マップの適用前')
    expect(translate('ja', 'After {0} route maps', translate('ja', 'outbound'))).toBe('アウトバウンド ルート マップの適用後')
  })

  it('matches only complete diagnostic templates, leaving unrecognized prose intact', () => {
    const message = 'Forwarding loop at Reachable {0} → Tokyo.'
    expect(localizeDiagnostic(message, 'ja')).toBe('Reachable {0} → Tokyo で転送ループが発生しました。')
    expect(localizeDiagnostic(`User says: ${message} Extra`, 'ja')).toBe(`User says: ${message} Extra`)
    expect(localizeDiagnostic('Imported custom warning BGP table', 'ja')).toBe('Imported custom warning BGP table')
    expect(localizeDiagnostic(message, 'en')).toBe(message)
  })

  it('localizes nested validation labels without changing invalid input', () => {
    expect(localizeDiagnostic('Import rejected: Hub name must contain 1-120 characters.', 'ja'))
      .toBe('インポートを拒否しました: ハブ名 は 1～120 文字で入力してください。')
    expect(localizeDiagnostic('Invalid IPv4 network CIDR: 10.20.0.1/16. Use the network address, not a host address.', 'ja'))
      .toContain('10.20.0.1/16。ホスト アドレスではなく')
    expect(localizeDiagnostic('Hubs must be an array with at most 20 entries.', 'ja')).toContain('ハブ は最大 20 件')
  })

  it('localizes nested path explanations but preserves router names verbatim', () => {
    const source = 'Reachable. BGP table {2}'
    const message = `${source}: longest prefix 10.20.0.0/16. Local connections are preferred over remote-hub connections. Shortest learned AS path (2 ASNs).`
    const result = localizeDiagnostic(message, 'ja')
    expect(result).toContain(`${source}: 最長プレフィックス一致 (LPM) 10.20.0.0/16`)
    expect(result).toContain('ローカル接続はリモート ハブ接続より優先されます。')
    expect(result).toContain('学習した最短 AS パス (ASN 数: 2)。')
    expect(result).not.toContain('Shortest learned')
  })

  it('prioritizes path envelopes over suffix-shaped comparison and ECMP reasons', () => {
    const local = 'Local connections are preferred over remote-hub connections.'
    const comparison = 'ExpressRoute wins the ExpressRoute versus S2S VPN comparison.'
    const equalCost = '2 equal-cost paths remain; no single traffic hash is predicted.'
    const actualStep = `Europe hub: longest prefix 10.20.0.0/16. ${local} ${comparison}`
    expect(localizeDiagnostic(actualStep, 'ja')).toBe('Europe hub: 最長プレフィックス一致 (LPM) 10.20.0.0/16。ローカル接続はリモート ハブ接続より優先されます。 ExpressRoute と S2S VPN の比較では ExpressRoute が優先されます。')
    for (const prefix of ['Europe hub', 'Azure Firewall in Europe hub']) {
      for (const reasons of [`${local} ${comparison} ${equalCost}`, `Shortest learned AS path (3 ASNs). ${equalCost}`]) {
        const result = localizeDiagnostic(`${prefix}: longest prefix 10.20.0.0/16. ${reasons}`, 'ja')
        expect(result).toContain('最長プレフィックス一致 (LPM) 10.20.0.0/16')
        expect(result).toContain('2 本の等コスト パスが残ります')
        expect(result).not.toMatch(/longest prefix|Local connections|Shortest learned|wins the|equal-cost/)
        if (prefix.startsWith('Azure Firewall')) expect(result).toContain('Europe hub の Azure Firewall')
      }
    }
    expect(localizeDiagnostic(comparison, 'ja')).toContain('比較では ExpressRoute が優先されます')
    expect(localizeDiagnostic(equalCost, 'ja')).toContain('2 本の等コスト パス')
    expect(localizeDiagnostic(`Unknown ${comparison}`, 'ja')).toBe(`Unknown ${comparison}`)
  })

  it('preserves diagnostic-looking router names while translating only the actual nested reasons', () => {
    const name = 'Lab: longest prefix 10.1.0.0/16. Local connections are preferred over remote-hub connections.'
    const reason = 'ExpressRoute wins the ExpressRoute versus S2S VPN comparison.'
    expect(localizeDiagnostic(`${name}: longest prefix 10.20.0.0/16. ${reason}`, 'ja'))
      .toBe(`${name}: 最長プレフィックス一致 (LPM) 10.20.0.0/16。ExpressRoute と S2S VPN の比較では ExpressRoute が優先されます。`)
  })

  it('keeps multi-sentence routing-intent and firewall fallback reasons atomic inside steps', () => {
    for (const reason of [
      'Routing intent redirects this prefix to Azure Firewall. The firewall uses its separate routing table.',
      'Azure Firewall has a direct Internet fallback when no default is learned. This does not install a hub default route.',
    ]) {
      const step = `Azure Firewall in Europe hub: longest prefix 0.0.0.0/0. ${reason}`
      const result = localizeDiagnostic(step, 'ja')
      expect(result).toBe(`Europe hub の Azure Firewall: 最長プレフィックス一致 (LPM) 0.0.0.0/0。${localizeDiagnostic(reason, 'ja')}`)
      expect(result).not.toMatch(/redirects|uses its|fallback|install a hub/)
    }
  })

  it('localizes known import limitations with opaque hub-name prefixes', () => {
    expect(localizeDiagnostic('BGP table Tokyo: Azure route maps are not reconstructed.', 'ja'))
      .toBe('BGP table Tokyo: Azure ルート マップは再構築しません。')
    expect(localizeDiagnostic('BGP table Tokyo: Unknown collector-specific message.', 'ja'))
      .toBe('BGP table Tokyo: Unknown collector-specific message.')
    expect(localizeDiagnostic('BGP table Tokyo: Route maps could not be read; configuration is incomplete.', 'ja'))
      .toBe('BGP table Tokyo: ルート マップを読み取れませんでした。構成は不完全です。')
  })

  it('does not change engine data or the English diagnostic API', () => {
    const topology = validateTopology(structuredClone(example))
    const saved = JSON.stringify(topology)
    const simulation = simulate(topology)
    const paths = traceFlow(topology, simulation, 'eu', '10.20.0.1')
    const original = JSON.stringify(paths)
    expect(paths[0].steps.some((step) => localizeDiagnostic(step, 'ja') !== step)).toBe(true)
    expect(JSON.stringify(paths)).toBe(original)
    expect(JSON.stringify(topology)).toBe(saved)
    expect(simulation.warnings.join(' ')).toContain('not simulated')
  })
})
