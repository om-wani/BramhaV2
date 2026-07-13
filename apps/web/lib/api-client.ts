import { z } from 'zod'
import { redirectToLogin } from './auth'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions<TBody = unknown> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: TBody
  headers?: Record<string, string>
}

// access_token cookie is 15-minute TTL (SESSION_ACCESS_TOKEN_TTL_SECONDS). On a 401
// we attempt exactly one silent refresh (via the refresh_token cookie) and retry the
// original request once. Concurrent 401s share a single in-flight refresh so a burst
// of requests hitting expiry at once doesn't race the refresh-token rotation.
let refreshInFlight: Promise<boolean> | null = null

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null
      })
  }
  return refreshInFlight
}

async function doFetch(
  path: string,
  method: string,
  body: unknown,
  extraHeaders: Record<string, string>,
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const NO_REFRESH_RETRY_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/register'])

async function request<TResponse>(
  path: string,
  schema: z.ZodType<TResponse>,
  options: RequestOptions = {},
): Promise<TResponse> {
  const { method = 'GET', body, headers: extraHeaders = {} } = options

  let response = await doFetch(path, method, body, extraHeaders)

  if (response.status === 401 && !NO_REFRESH_RETRY_PATHS.has(path)) {
    const refreshed = await refreshSession()
    if (refreshed) {
      response = await doFetch(path, method, body, extraHeaders)
    } else if (typeof window !== 'undefined') {
      // refresh_token itself is invalid/expired — the session is over, not
      // just the access token. Send the user back to login rather than let
      // every caller independently discover this via a raw 401.
      redirectToLogin(window.location.pathname + window.location.search)
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new ApiError(
      response.status,
      errorData.code ?? 'unknown_error',
      errorData.detail ?? errorData.title ?? response.statusText,
    )
  }

  const data = await response.json()
  return schema.parse(data)
}

export const api = {
  get: <T>(path: string, schema: z.ZodType<T>) => request(path, schema),
  post: <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
    request(path, schema, { method: 'POST', body }),
  patch: <T>(path: string, schema: z.ZodType<T>, body: unknown) =>
    request(path, schema, { method: 'PATCH', body }),
  delete: <T>(path: string, schema: z.ZodType<T>) =>
    request(path, schema, { method: 'DELETE' }),
}
