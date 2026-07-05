// Problem+JSON error catalog — codes are stable; never reuse a code after removal

export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS: 'invalid_credentials',
  EMAIL_UNVERIFIED: 'email_unverified',
  EMAIL_ALREADY_REGISTERED: 'email_already_registered',
  TOKEN_EXPIRED: 'token_expired',
  TOKEN_INVALID: 'token_invalid',
  TOTP_REQUIRED: 'totp_required',
  TOTP_INVALID: 'totp_invalid',
  RECOVERY_CODE_INVALID: 'recovery_code_invalid',
  ACCOUNT_LOCKED: 'account_locked',
  SESSION_REVOKED: 'session_revoked',

  // Authorization
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  INSUFFICIENT_ROLE: 'insufficient_role',

  // Validation
  VALIDATION_ERROR: 'validation_error',
  UNKNOWN_FIELD: 'unknown_field',

  // Resources
  ORG_SLUG_TAKEN: 'org_slug_taken',
  PROJECT_ARCHIVED: 'project_archived',
  MEMBER_ALREADY_EXISTS: 'member_already_exists',
  LAST_OWNER_REMOVAL: 'last_owner_removal',

  // API keys
  API_KEY_INVALID: 'api_key_invalid',
  API_KEY_REVOKED: 'api_key_revoked',

  // Rate limiting
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',

  // Server
  INTERNAL_ERROR: 'internal_error',
  SERVICE_UNAVAILABLE: 'service_unavailable',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

export interface ProblemDetail {
  type: string // URI reference
  title: string
  status: number
  detail?: string
  instance?: string
  code: ErrorCode
}

// Verify all codes are unique at compile time
const _allCodes = Object.values(ErrorCodes)
const _uniqueCodes = new Set(_allCodes)
if (_allCodes.length !== _uniqueCodes.size) {
  throw new Error('Duplicate error codes detected in error catalog')
}
