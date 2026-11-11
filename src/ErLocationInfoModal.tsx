import React, { useMemo, useState } from 'react'
import {
  ER_GEOPOLITICAL_AZURE_REGIONS,
  ER_PEERING_LOCATIONS_CATALOG,
  ER_SATELLITE_OPERATORS,
  evaluateErSkuRegionalCompatibility,
  findErPeeringLocationEntry,
  type ErCircuitSku,
  type ErPeeringLocationEntry,
} from './er-locations-catalog'

export interface ErLocationInfoModalProps {
  isOpen: boolean
  onClose: () => void
  initialLocationName?: string
  currentSku?: ErCircuitSku
  connectedAzureRegions?: { name: string; region: string }[]
  onSelectLocationAndSku?: (peeringLocation: string, sku: ErCircuitSku) => void
}

export const ErLocationInfoModal: React.FC<ErLocationInfoModalProps> = ({
  isOpen,
  onClose,
  initialLocationName,
  currentSku = 'Standard',
  connectedAzureRegions = [],
  onSelectLocationAndSku,
}) => {
  const initialEntry = useMemo(
    () => findErPeeringLocationEntry(initialLocationName) ?? ER_PEERING_LOCATIONS_CATALOG[0],
    [initialLocationName],
  )

  const [searchQuery, setSearchQuery] = useState('')
  const [geoFilter, setGeoFilter] = useState<string>('ALL')
  const [envFilter, setEnvFilter] = useState<string>('ALL')
  const [erDirectOnly, setErDirectOnly] = useState(false)
  const [erLocalOnly, setErLocalOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string>(initialEntry?.id ?? '')
  const [previewSku, setPreviewSku] = useState<ErCircuitSku>(currentSku)

  React.useEffect(() => {
    if (isOpen) {
      const matched = findErPeeringLocationEntry(initialLocationName)
      if (matched) {
        setSelectedId(matched.id)
      }
      setPreviewSku(currentSku)
    }
  }, [isOpen, initialLocationName, currentSku])

  const geopoliticalOptions = useMemo(() => {
    const set = new Set<string>()
    for (const item of ER_PEERING_LOCATIONS_CATALOG) {
      set.add(item.geopoliticalRegion)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [])

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const tokens = q.split(/[\s-]+/).filter(Boolean)
    return ER_PEERING_LOCATIONS_CATALOG.filter((entry) => {
      if (geoFilter !== 'ALL' && entry.geopoliticalRegion !== geoFilter) return false
      if (envFilter !== 'ALL' && entry.environment !== envFilter) return false
      if (erDirectOnly && !entry.erDirectSupported) return false
      if (erLocalOnly && entry.localAzureRegions.length === 0) return false
      if (tokens.length === 0) return true
      const haystack = [
        entry.name,
        entry.facility,
        entry.geopoliticalRegion,
        ...entry.localAzureRegions,
        ...entry.providers,
        ...entry.additionalProviders,
      ]
        .join(' ')
        .toLowerCase()
      return tokens.every((tok) => haystack.includes(tok))
    })
  }, [searchQuery, geoFilter, envFilter, erDirectOnly, erLocalOnly])

  const selectedEntry: ErPeeringLocationEntry = useMemo(() => {
    return (
      filteredEntries.find((e) => e.id === selectedId) ??
      filteredEntries[0] ??
      ER_PEERING_LOCATIONS_CATALOG.find((e) => e.id === selectedId) ??
      ER_PEERING_LOCATIONS_CATALOG[0]
    )
  }, [selectedId, filteredEntries])

  const standardReachableRegions = useMemo(() => {
    if (!selectedEntry) return []
    return ER_GEOPOLITICAL_AZURE_REGIONS[selectedEntry.geopoliticalRegion] ?? selectedEntry.localAzureRegions
  }, [selectedEntry])

  if (!isOpen) return null

  return (
    <div
      className="aznet-modal-backdrop"
      data-testid="er-location-info-modal"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--shadow)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
      }}
    >
      <div
        className="aznet-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(1120px, 96vw)',
          maxHeight: '88vh',
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          boxShadow: '0 16px 55px var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0.9rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-muted)',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
              ExpressRoute Peering Locations &amp; Providers Catalog
            </h3>
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text)' }}>
              Official Microsoft Learn reference ({ER_PEERING_LOCATIONS_CATALOG.length} peering locations across Commercial, Metro, US Gov &amp; China)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="close-er-location-info-modal"
            style={{
              borderRadius: '6px',
              padding: '0.35rem 0.7rem',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.8rem',
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Filter Bar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.6rem',
            alignItems: 'center',
            padding: '0.7rem 1.25rem',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface-muted)',
          }}
        >
          <input
            type="search"
            placeholder="Search location, facility (e.g. Equinix FR5), Azure region, or provider (Megaport, AT&T)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="er-catalog-search"
            style={{
              flex: '1 1 280px',
              borderRadius: '6px',
              padding: '0.4rem 0.65rem',
              fontSize: '0.82rem',
            }}
          />
          <select
            value={geoFilter}
            onChange={(e) => setGeoFilter(e.target.value)}
            aria-label="Filter by geopolitical region"
            style={{
              borderRadius: '6px',
              padding: '0.4rem 0.6rem',
              fontSize: '0.8rem',
            }}
          >
            <option value="ALL">All Geopolitical Regions</option>
            {geopoliticalOptions.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
            aria-label="Filter by cloud environment"
            style={{
              borderRadius: '6px',
              padding: '0.4rem 0.6rem',
              fontSize: '0.8rem',
            }}
          >
            <option value="ALL">All Clouds</option>
            <option value="Commercial">Commercial</option>
            <option value="US Government">US Government</option>
            <option value="China">China</option>
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={erDirectOnly} onChange={(e) => setErDirectOnly(e.target.checked)} />
            ER Direct (✓)
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={erLocalOnly} onChange={(e) => setErLocalOnly(e.target.checked)} />
            ER Local Supported
          </label>
        </div>

        {/* Body: Left Directory + Right Details */}
        <div className="er-catalog-body">
          {/* Left Location List */}
          <div
            style={{
              borderRight: '1px solid var(--border)',
              overflowY: 'auto',
              padding: '0.5rem',
              background: 'var(--surface-muted)',
            }}
          >
            <div style={{ fontSize: '0.72rem', color: 'var(--text)', padding: '0.25rem 0.5rem 0.45rem', fontWeight: 600 }}>
              SHOWING {filteredEntries.length} OF {ER_PEERING_LOCATIONS_CATALOG.length} LOCATIONS
            </div>
            {filteredEntries.map((item) => {
              const active = item.id === selectedEntry?.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  data-testid={`er-catalog-item-${item.id}`}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: active ? 'var(--surface-muted)' : 'transparent',
                    color: active ? 'var(--accent)' : 'var(--text)',
                    border: active ? '1px solid var(--border)' : '1px solid transparent',
                    borderRadius: '7px',
                    padding: '0.5rem 0.65rem',
                    marginBottom: '0.25rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.18rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.84rem' }}>{item.name}</span>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        padding: '0.1rem 0.38rem',
                        borderRadius: '4px',
                        background: item.isMetro ? 'var(--purple-surface)' : 'var(--surface-muted)',
                        color: item.isMetro ? 'var(--purple)' : 'var(--text)',
                      }}
                    >
                      {item.isMetro ? 'Metro' : item.zone}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.74rem', color: active ? 'var(--accent)' : 'var(--text)' }}>
                    {item.facility} • {item.geopoliticalRegion}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Right Inspector Pane */}
          {selectedEntry && (
            <div style={{ overflowY: 'auto', padding: '1.1rem 1.35rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }} data-testid="er-location-detail-name">
                      {selectedEntry.name}
                    </h4>
                    <span style={{ fontSize: '0.74rem', padding: '0.18rem 0.5rem', borderRadius: '999px', background: 'var(--surface-muted)', color: 'var(--accent)', fontWeight: 700 }}>
                      {selectedEntry.geopoliticalRegion}
                    </span>
                    <span style={{ fontSize: '0.74rem', padding: '0.18rem 0.5rem', borderRadius: '999px', background: 'var(--surface-muted)', color: 'var(--text)', fontWeight: 600 }}>
                      Billing {selectedEntry.zone}
                    </span>
                    {selectedEntry.erDirectSupported && (
                      <span style={{ fontSize: '0.74rem', padding: '0.18rem 0.5rem', borderRadius: '999px', background: 'var(--surface-muted)', color: 'var(--success)', fontWeight: 700 }}>
                        ✓ ExpressRoute Direct (10G / 100G)
                      </span>
                    )}
                    {selectedEntry.isMetro && (
                      <span style={{ fontSize: '0.74rem', padding: '0.18rem 0.5rem', borderRadius: '999px', background: 'var(--surface-muted)', color: 'var(--purple)', fontWeight: 700 }}>
                        ExpressRoute Metro (Dual-Edge)
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}>
                    <strong>Physical Meet-Me Facility:</strong>{' '}
                    {selectedEntry.facilityUrl ? (
                      <a
                        href={selectedEntry.facilityUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: 'underline' }}
                      >
                        {selectedEntry.facility} ↗
                      </a>
                    ) : (
                      selectedEntry.facility
                    )}
                  </div>
                </div>

                {onSelectLocationAndSku && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                    <select
                      value={previewSku}
                      onChange={(e) => setPreviewSku(e.target.value as ErCircuitSku)}
                      aria-label="Circuit SKU to apply"
                      style={{
                        borderRadius: '6px',
                        padding: '0.38rem 0.55rem',
                        fontSize: '0.8rem',
                      }}
                    >
                      <option value="Local">Local SKU</option>
                      <option value="Standard">Standard SKU</option>
                      <option value="Premium">Premium SKU</option>
                    </select>
                    <button
                      type="button"
                      data-testid="er-catalog-apply-location-btn"
                      onClick={() => {
                        onSelectLocationAndSku(selectedEntry.name, previewSku)
                        onClose()
                      }}
                      style={{
                        background: 'var(--accent)',
                        color: 'var(--on-accent)',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.42rem 0.8rem',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Use Location &amp; SKU
                    </button>
                  </div>
                )}
              </div>

              {/* SKU Regional Scope Breakdown */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                <div
                  style={{
                    background: 'var(--surface-muted)',
                    border: previewSku === 'Local' ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.83rem', color: 'var(--accent)', marginBottom: '0.35rem' }}>
                    ExpressRoute Local SKU
                  </div>
                  {selectedEntry.localAzureRegions.length > 0 ? (
                    <div style={{ fontSize: '0.8rem' }} data-testid="er-location-local-regions">
                      Reachable Local Azure Region(s):{' '}
                      <strong>{selectedEntry.localAzureRegions.join(', ')}</strong>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--error)' }} data-testid="er-location-local-regions">
                      ✗ Not available at this peering location (requires Standard or Premium)
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: 'var(--surface-muted)',
                    border: previewSku === 'Standard' ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.83rem', color: 'var(--purple)', marginBottom: '0.35rem' }}>
                    ExpressRoute Standard SKU
                  </div>
                  <div style={{ fontSize: '0.78rem' }}>
                    All Azure regions in <strong>{selectedEntry.geopoliticalRegion}</strong> ({standardReachableRegions.length} regions):{' '}
                    <span>{standardReachableRegions.join(', ')}</span>
                  </div>
                </div>

                <div
                  style={{
                    background: 'var(--surface-muted)',
                    border: previewSku === 'Premium' ? '1px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.75rem',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.83rem', color: 'var(--success)', marginBottom: '0.35rem' }}>
                    ExpressRoute Premium SKU
                  </div>
                  <div style={{ fontSize: '0.78rem' }}>
                    Global reachability across all Azure geopolitical regions within the{' '}
                    <strong>{selectedEntry.environment}</strong> cloud environment (&gt; 4,000 BGP prefixes supported).
                  </div>
                </div>
              </div>

              {/* Connected Gateways / Virtual Hubs Compatibility Check */}
              {connectedAzureRegions.length > 0 && (
                <div
                  style={{
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.75rem 0.9rem',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', marginBottom: '0.45rem' }}>
                    Connected Gateways / Hubs Compatibility ({previewSku} SKU at {selectedEntry.name})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {connectedAzureRegions.map((target, idx) => {
                      const check = evaluateErSkuRegionalCompatibility(previewSku, selectedEntry.name, target.region)
                      return (
                        <div
                          key={`${target.name}-${idx}`}
                          style={{
                            fontSize: '0.79rem',
                            padding: '0.35rem 0.55rem',
                            borderRadius: '6px',
                            background: check.allowed ? 'var(--success-surface)' : 'var(--error-surface)',
                            color: check.allowed ? 'var(--success)' : 'var(--error)',
                            border: check.allowed ? '1px solid var(--border)' : '1px solid var(--border)',
                          }}
                        >
                          <strong>{check.allowed ? '✓ Allowed' : '✗ Blocked'}</strong> — {target.name} ({target.region}): {check.reason}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Direct Service Providers */}
              <div
                style={{
                  background: 'var(--surface-muted)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '0.8rem 0.95rem',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                  Supported ExpressRoute Connectivity Providers ({selectedEntry.providers.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }} data-testid="er-location-providers">
                  {selectedEntry.providers.map((prov) => (
                    <span
                      key={prov}
                      style={{
                        fontSize: '0.76rem',
                        padding: '0.22rem 0.55rem',
                        borderRadius: '6px',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {prov}
                    </span>
                  ))}
                </div>
              </div>

              {/* Exchange & Additional Service Providers */}
              {(selectedEntry.exchangeProviders.length > 0 || selectedEntry.additionalProviders.length > 0) && (
                <div
                  style={{
                    background: 'var(--surface-muted)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '0.8rem 0.95rem',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                    Additional Carriers via Ethernet Exchange ({selectedEntry.exchangeProviders.join(', ')})
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.38rem' }}>
                    {selectedEntry.additionalProviders.map((prov) => (
                      <span
                        key={prov}
                        style={{
                          fontSize: '0.74rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '6px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        {prov}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Satellite Connectivity Note */}
              <div style={{ fontSize: '0.76rem', color: 'var(--text)' }}>
                <strong>Satellite Connectivity Partners:</strong> {ER_SATELLITE_OPERATORS.join(', ')} (available globally via designated ground station peering locations).
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
