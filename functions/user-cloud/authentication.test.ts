import { beforeAll, describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { consumerIssuer, consumerTenant, createAuthenticator } from './authentication'

const audience = '11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
let authenticate: ReturnType<typeof createAuthenticator>
let keys: ReturnType<typeof createLocalJWKSet>
let token: (changes?: Record<string, unknown>) => Promise<string>
beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'test', alg: 'RS256', use: 'sig' }
  keys = createLocalJWKSet({ keys: [jwk] })
  authenticate = createAuthenticator(audience, clientId, keys)
  token = async changes => {
    const now = Math.floor(Date.now() / 1000)
    return `Bearer ${await new SignJWT({ iss: consumerIssuer, aud: audience, sub: 'original-user', tid: consumerTenant,
      scp: 'Cloud.Access', azp: clientId, ver: '2.0', iat: now, nbf: now, exp: now + 300, ...changes })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey)}`
  }
})
describe('personal Microsoft cloud access tokens', () => {
  it('accepts only explicitly configured desktop and web clients without changing storage ownership', async () => {
    const desktop = '33333333-3333-4333-8333-333333333333'
    const both = createAuthenticator(audience, [clientId, desktop], keys)
    const webOwner = await both(await token())
    expect(await both(await token({ azp: desktop }))).toBe(webOwner)
    expect(webOwner).toBe(await authenticate(await token()))
    expect(await both(await token({ azp: desktop, sub: 'other-account' }))).not.toBe(webOwner)
    await expect(authenticate(await token({ azp: desktop }))).rejects.toThrow()
    await expect(both(await token({ azp: audience }))).rejects.toThrow()
    await expect(both(await token({ azp: desktop, scp: 'openid' }))).rejects.toThrow()
    await expect(both(await token({ azp: desktop, aud: desktop }))).rejects.toThrow()
  })
  it('fails closed for missing or malformed configured clients', () => {
    expect(() => createAuthenticator(audience, [], keys)).toThrow()
    expect(() => createAuthenticator(audience, [clientId, ''], keys)).toThrow()
    expect(() => createAuthenticator(audience, [clientId, '*'], keys)).toThrow()
  })
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
