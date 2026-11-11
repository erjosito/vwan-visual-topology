import { useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
const storageKey = 'aznet-theme'

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* Storage may be unavailable in private/embedded contexts. */ }
  return 'system'
}

export function ThemeSelector() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = preference === 'system'
        ? media.matches ? 'dark' : 'light'
        : preference
      document.documentElement.style.colorScheme = document.documentElement.dataset.theme
      document.querySelector('meta[name="theme-color"]')?.setAttribute(
        'content', getComputedStyle(document.documentElement).getPropertyValue('--page').trim(),
      )
    }
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(readPreference())
    }
    apply()
    media.addEventListener('change', apply)
    window.addEventListener('storage', sync)
    return () => {
      media.removeEventListener('change', apply)
      window.removeEventListener('storage', sync)
    }
  }, [preference])

  return (
    <label className="theme-selector">
      Theme
      <select aria-label="Theme" value={preference} onChange={(event) => {
        const next = event.target.value as ThemePreference
        try { localStorage.setItem(storageKey, next) } catch { /* Keep the in-session choice. */ }
        setPreference(next)
      }}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  )
}
