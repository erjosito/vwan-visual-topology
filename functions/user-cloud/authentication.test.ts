import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { consumerIssuer, consumerTenant, createAuthenticator } from './authentication'

const audience = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
let authenticate: ReturnType<typeof createAuthenticator>
let token: (changes?: Record<string, unknown>) => Promise<string>
beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'test', alg: 'RS256', use: 'sig' }
  authenticate = createAuthenticator(audience, clientId, createLocalJWKSet({ keys: [jwk] }))
  token = async changes => {
    const now = Math.floor(Date.now() / 1000)
    return `Bearer ${await new SignJWT({ iss: consumerIssuer, aud: audience, sub: 'original-user', tid: consumerTenant,
      scp: 'Cloud.Access', azp: clientId, ver: '2.0', iat: now, nbf: now, exp: now + 300, ...changes })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey)}`
  }
})
describe('personal Microsoft cloud access tokens', () => {
  it('derives a stable opaque owner from a verified subject, not a mutable email', async () => {
    const owner = await authenticate(await token({ email: 'first@example.test' }))
    expect(owner).toMatch(/^[a-f0-9]{64}$/)
    expect(await authenticate(await token({ email: 'changed@example.test' }))).toBe(owner)
    expect(await authenticate(await token({ sub: 'another-user' }))).not.toBe(owner)
  })
  it.each([
    { aud: clientId }, { iss: 'https://untrusted.test' }, { tid: 'other-tenant' }, { azp: audience },
    { scp: 'openid profile' }, { ver: '1.0' }, { exp: 1 }, { nbf: 9999999999 }, { sub: '' },
  ])('rejects wrong issuer/audience/client/scope/tenant or invalid claims: %j', async changes => {
    await expect(authenticate(await token(changes))).rejects.toThrow()
  })
  it('rejects a tampered signature and missing authentication', async () => {
    const original = await token()
    const pieces = original.split('.')
    pieces[1] = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url')
    await expect(authenticate(pieces.join('.'))).rejects.toThrow()
    await expect(authenticate(null)).rejects.toThrow()
  })
})
