/** Declarative native fields only; array entries retain their original identities. */
export function matchesConfiguration(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    if (!expected.length) return actual.length === 0
    const used = new Set<number>()
    return expected.every((entry) => {
      const index = actual.findIndex((candidate, index) => !used.has(index) && matchesConfiguration(candidate, entry))
      if (index < 0) return false
      used.add(index)
      return true
    })
  }
  if (expected !== null && typeof expected === 'object') {
    return actual !== null && typeof actual === 'object' && !Array.isArray(actual)
      && Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key)
        && matchesConfiguration((actual as Record<string, unknown>)[key], value))
  }
  return actual === expected
}
