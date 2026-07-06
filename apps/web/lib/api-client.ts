import { z } from 'zod'

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

async function request<TResponse>(
  path: string,
  schema: z.ZodType<TResponse>,
  options: RequestOptions = {},
): Promise<TResponse> {
  const { method = 'GET', body, headers: extraHeaders = {} } = options

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

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
