import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { PINO_REDACT_PATHS, verifyRedaction } from '../redaction.js'

describe('log redaction', () => {
  it('strips sensitive fields before log output', () => {
    const lines: string[] = []
    const logger = pino({
      redact: PINO_REDACT_PATHS,
    }, {
      write(line: string) { lines.push(line) },
    })

    const FIXTURE_SECRET = 'SUPER_SECRET_VALUE_abc123xyz'
    logger.info({ password: FIXTURE_SECRET, user: 'alice' }, 'login')

    expect(lines.length).toBe(1)
    const line = lines[0]!

    // Secret must not appear in output
    verifyRedaction(line, { password: FIXTURE_SECRET })

    // [Redacted] placeholder should appear
    expect(line).toContain('[Redacted]')

    // Non-sensitive field must survive
    expect(line).toContain('alice')
  })

  it('strips nested sensitive fields', () => {
    const lines: string[] = []
    const logger = pino({ redact: PINO_REDACT_PATHS }, {
      write(line: string) { lines.push(line) },
    })

    const SECRET = 'nested_secret_value_xyz789'
    logger.info({ user: { password: SECRET, name: 'bob' } }, 'profile')

    const line = lines[0]!
    verifyRedaction(line, { 'user.password': SECRET })
    expect(line).toContain('bob')
  })
})
