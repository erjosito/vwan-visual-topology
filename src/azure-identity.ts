export function azureObjectId(kind: string, armId: string): string {
  let hash = 14695981039346656037n
  for (const char of armId.toLowerCase()) hash = BigInt.asUintN(64, (hash ^ BigInt(char.charCodeAt(0))) * 1099511628211n)
  return `az-${kind}-${hash.toString(16)}`
}

export const armKey = (value: string) => value.trim().replace(/\/+$/, '').toLowerCase()
