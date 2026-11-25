import type { PlatformRequest } from './contract'

const optionalFields = ['engineVersion', 'locale', 'requirements', 'budget', 'packet', 'vpnPacket', 'vpnTransition', 'application']

function omitUnsetOptions(input: object, optional: readonly string[]): Record<string, unknown> {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('Plain request options required.')
  const result: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(input))) {
    if (!('value' in descriptor) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe request option.')
    if (descriptor.value !== undefined || !optional.includes(key)) result[key] = descriptor.value
  }
  return result
}

/** Omit only typed envelope options; native data and unknown contract fields still require admission. */
export function createPlatformRequest(input: PlatformRequest): PlatformRequest {
  const request = omitUnsetOptions(input, optionalFields)
  if (request.budget !== undefined) request.budget = omitUnsetOptions(input.budget!, ['maxMillis', 'maxOutputBytes'])
  return request as PlatformRequest
}
