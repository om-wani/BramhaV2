/**
 * Minimal HS256 JWT utilities using Node.js built-in crypto.
 * Avoids pulling in jose/jsonwebtoken as a dep for this package.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { CapabilityTokenError } from './errors.js'

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64url')
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url')
}

/** Sign a payload as an HS256 JWT. */
export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = base64urlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body = base64urlEncode(Buffer.from(JSON.stringify(payload)))
  const signing = `${header}.${body}`
  const sig = base64urlEncode(createHmac('sha256', secret).update(signing).digest())
  return `${signing}.${sig}`
}

/**
 * Verify an HS256 JWT signature and expiry.
 * Throws CapabilityTokenError with code 'invalid_signature' or 'expired'.
 * Does NOT consume the JTI (that's verifyCapabilityToken's responsibility).
 */
export function verifyJwtSignature<T extends Record<string, unknown>>(
  token: string,
  secret: string,
): T {
  const parts = token.split('.')
  if (parts.length !== 3) throw new CapabilityTokenError('invalid_signature')

  const [header, body, sig] = parts as [string, string, string]

  // Timing-safe signature check
  const expected = base64urlEncode(
    createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  )
  const sigBuf = base64urlDecode(sig)
  const expBuf = base64urlDecode(expected)

  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new CapabilityTokenError('invalid_signature')
  }

  // Decode payload
  let decoded: Record<string, unknown>
  try {
    decoded = JSON.parse(base64urlDecode(body).toString('utf-8')) as Record<string, unknown>
  } catch {
    throw new CapabilityTokenError('invalid_signature')
  }

  // Expiry check
  const now = Math.floor(Date.now() / 1000)
  if (typeof decoded['exp'] === 'number' && decoded['exp'] < now) {
    throw new CapabilityTokenError('expired')
  }

  return decoded as T
}
