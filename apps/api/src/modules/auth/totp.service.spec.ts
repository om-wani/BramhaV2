import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'crypto'
import { generateSync } from 'otplib'
import { TotpService } from './totp.service.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a TotpService with a random MASTER_KEY for testing. */
function buildSvc(): TotpService {
  const masterKey = randomBytes(32).toString('base64')
  process.env['MASTER_KEY'] = masterKey
  const svc = new TotpService()
  svc.onModuleInit()
  return svc
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TotpService', () => {
  let svc: TotpService

  beforeAll(() => {
    svc = buildSvc()
  })

  describe('encrypt / decrypt round-trip', () => {
    it('encrypts and decrypts the same plaintext', () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const enc = svc.encrypt(secret)
      expect(enc).toBeInstanceOf(Buffer)
      const dec = svc.decrypt(enc)
      expect(dec).toBe(secret)
    })

    it('handles a generated 32-char base32 secret', () => {
      const secret = svc.generateSecret()
      expect(secret.length).toBe(32)
      const enc = svc.encrypt(secret)
      const dec = svc.decrypt(enc)
      expect(dec).toBe(secret)
    })
  })

  describe('IV randomness', () => {
    it('produces different ciphertexts for the same plaintext (unique IV per call)', () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const enc1 = svc.encrypt(secret)
      const enc2 = svc.encrypt(secret)
      // Ciphertexts must differ because IVs are random
      expect(enc1.toString('hex')).not.toBe(enc2.toString('hex'))
    })
  })

  describe('tamper detection', () => {
    it('throws on tampered ciphertext (GCM auth tag verification fails)', () => {
      const secret = 'JBSWY3DPEHPK3PXP'
      const enc = svc.encrypt(secret)
      // Flip a byte in the ciphertext portion (after iv[12] + authTag[16] = 28 bytes)
      if (enc.length > 28) {
        enc[28] = enc[28]! ^ 0xff
      }
      expect(() => svc.decrypt(enc)).toThrow()
    })

    it('throws when the auth tag is tampered', () => {
      const secret = 'TESTSECRETHELLO'
      const enc = svc.encrypt(secret)
      // Flip a byte in the auth tag (bytes 12–27)
      enc[13] = enc[13]! ^ 0x01
      expect(() => svc.decrypt(enc)).toThrow()
    })
  })

  describe('cross-key isolation', () => {
    it('decryption with a different key throws', () => {
      const key1 = randomBytes(32)
      const key2 = randomBytes(32)
      const secret = 'MY_SECRET'
      const enc = svc.encryptSecretWithKey(secret, key1)
      expect(() => svc.decryptSecretWithKey(enc, key2)).toThrow()
    })
  })

  describe('generateSecret', () => {
    it('returns a 32-character base32 string', () => {
      const secret = svc.generateSecret()
      expect(typeof secret).toBe('string')
      expect(secret.length).toBe(32)
    })
  })

  describe('verify (generate and verify)', () => {
    it('verifies a freshly generated TOTP code', () => {
      const secret = svc.generateSecret()
      const code = generateSync({ secret })
      expect(svc.verify(secret, code)).toBe(true)
    })

    it('rejects a wrong code', () => {
      const secret = svc.generateSecret()
      expect(svc.verify(secret, '000000')).toBe(false)
    })
  })

  describe('getUri', () => {
    it('returns a valid otpauth:// URI', () => {
      const secret = svc.generateSecret()
      const uri = svc.getUri('alice@example.com', secret)
      expect(uri).toMatch(/^otpauth:\/\/totp\//)
      expect(uri).toContain('BramhaV2')
    })
  })
})
