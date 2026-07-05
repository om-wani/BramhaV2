export const MAX_UPLOAD_MB = 500 as const
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

export const CONTEXT_TOKEN_CAP = 128_000 as const
export const TURN_DEPTH_MAX = 4 as const
export const DELEGATION_CONCURRENT_MAX = 3 as const
export const DELEGATION_TOOL_CALLS_MAX = 20 as const

export const SESSION_ACCESS_TOKEN_TTL_SECONDS = 900 as const // 15 min
export const SESSION_REFRESH_TOKEN_TTL_DAYS = 30 as const
export const SESSION_VERIFY_TOKEN_TTL_MINUTES = 30 as const

export const RATE_LIMIT_AUTH_WINDOW_MINUTES = 15 as const
export const RATE_LIMIT_AUTH_MAX_ATTEMPTS = 5 as const
export const RATE_LIMIT_MSG_PER_MINUTE = 20 as const
export const RATE_LIMIT_TOTP_MAX = 5 as const

export const MAX_ORG_MEMBERS = 100 as const
export const MAX_PROJECTS_PER_ORG = 50 as const
export const MAX_CONTENT_BYTES = 32768 as const // 32 kB per message node

export const API_KEY_PREFIX = 'bmv2' as const
export const API_KEY_ID_LENGTH = 8 as const
export const API_KEY_SECRET_LENGTH = 32 as const
