const tokenPattern = /(.)aznet-name:(\d+)(.)/gs

export function routingDisplayResult<T>(value: T, names: string[]): T {
  const rebound = new WeakMap<object, unknown>()
  const visit = (entry: unknown): unknown => {
    if (typeof entry === 'string') return entry.includes('\0aznet-name:') ? entry.replace(tokenPattern, (token, before: string, index: string, after: string) =>
      before === '\0' && after === '\0' ? names[Number(index)] ?? '' : token)
      : entry
    if (Array.isArray(entry)) {
      const cached = rebound.get(entry)
      if (cached !== undefined) return cached
      let result = entry
      for (let index = 0; index < entry.length; index++) {
        const child = visit(entry[index])
        if (child !== entry[index]) {
          if (result === entry) result = entry.slice()
          result[index] = child
        }
      }
      rebound.set(entry, result)
      return result
    }
    if (entry && typeof entry === 'object') {
      const cached = rebound.get(entry)
      if (cached !== undefined) return cached
      const source = entry as Record<string, unknown>
      let result = source
      for (const key of Object.keys(source)) {
        const child = visit(source[key])
        if (child !== source[key]) {
          if (result === source) result = { ...source }
          result[key] = child
        }
      }
      rebound.set(entry, result)
      return result
    }
    return entry
  }
  return visit(value) as T
}
