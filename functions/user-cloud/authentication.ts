import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export const consumerTenant = '9188040d-6c67-4c5b-b112-36a304b66dad'
export const consumerIssuer = `https://login.microsoftonline.com/${consumerTenant}/v2.0`
const microsoftKeys = createRemoteJWKSet(new URL('https://login.microsoftonline.com/consumers/discovery/v2.0/keys'), {
  timeoutDuration: 5000,
})

export function createAuthenticator(audience: string, clientId: string, keys: JWTVerifyGetKey = microsoftKeys) {
  if (![audience, clientId].every(value => /^[0-9a-f-]{36}$/i.test(value))) throw new Error('Configure both cloud API and SPA client IDs.')
  return async (authorization: string | null) => {
    if (!authorization?.startsWith('Bearer ') || authorization.length > 20000) throw new Error('Authentication required.')
    const { payload } = await jwtVerify(authorization.slice(7), keys, {
      algorithms: ['RS256'], issuer: consumerIssuer, audience, requiredClaims: ['sub', 'exp', 'iat', 'nbf', 'tid', 'scp', 'azp'],
      clockTolerance: 30,
    })
    if (payload.tid !== consumerTenant || payload.azp !== clientId || payload.ver !== '2.0'
      || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255
      || typeof payload.scp !== 'string' || !payload.scp.split(' ').includes('Cloud.Access')) {
      throw new Error('Personal Microsoft cloud access required.')
    }
    return createHash('sha256').update(JSON.stringify([payload.iss, payload.sub])).digest('hex')
  }
}
