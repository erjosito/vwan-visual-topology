export function ipv4(value: string): number | undefined {
  if (!/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(value)) return undefined
  let address = 0, octet = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 46) {
      if (octet > 255) return undefined
      address = address * 256 + octet
      octet = 0
    } else {
      octet = octet * 10 + code - 48
    }
  }
  return octet > 255 ? undefined : address * 256 + octet
}

export function cidr(value: string): { network: number; length: number } | undefined {
  const parts = value.split('/')
  if (parts.length !== 2 || !/^(0|[1-9]\d?)$/.test(parts[1])) return undefined
  const address = ipv4(parts[0])
  const length = Number(parts[1])
  if (address === undefined || length > 32) return undefined
  const block = 2 ** (32 - length)
  const network = Math.floor(address / block) * block
  if (address !== network) return undefined
  return { network, length }
}

export function formatIpv4(address: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(address / 2 ** shift) % 256).join('.')
}

export function contains(prefix: string, address: number): boolean {
  const parsed = cidr(prefix)
  return !!parsed && Math.floor(address / 2 ** (32 - parsed.length)) * 2 ** (32 - parsed.length) === parsed.network
}
