/**
 * Structured log redaction for Pino.
 * Strips known-sensitive fields before log entries reach any transport.
 *
 * Usage: pass `redact` config to pino({ redact: PINO_REDACT_PATHS })
 */

export const PINO_REDACT_PATHS = [
  'password',
  'passwd',
  'secret',
  'token',
  'api_key',
  'apiKey',
  'authorization',
  'cookie',
  'set-cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'credential',
  'credentials',
  'private_key',
  'privateKey',
  'client_secret',
  'clientSecret',
  '*.password',
  '*.secret',
  '*.token',
]

/** Verify no redacted field value appears in serialized log output. */
export function verifyRedaction(logLine: string, fixtures: Record<string, string>): void {
  for (const [field, value] of Object.entries(fixtures)) {
    if (logLine.includes(value)) {
      throw new Error(`Redaction failure: field "${field}" value leaked into log output`)
    }
  }
}
