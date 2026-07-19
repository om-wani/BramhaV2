export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  // Rate / limits
  RATE_LIMITED: 'RATE_LIMITED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  // Agent
  AGENT_STREAM_ERROR: 'AGENT_STREAM_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Problem+JSON shape (RFC 7807) — what the server returns on errors
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: ErrorCode;
}
