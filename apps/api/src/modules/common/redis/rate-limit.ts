import type { Redis } from 'ioredis'
import { HttpException, HttpStatus } from '@nestjs/common'

const LUA_INCR_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`

/**
 * Atomically increments a Redis counter, setting its TTL only on the first
 * increment (so the window doesn't reset on every hit). Returns the new count.
 */
export async function incrementCounterWithExpiry(
  redis: Redis,
  key: string,
  windowSeconds: number,
): Promise<number> {
  return (await redis.eval(LUA_INCR_WITH_EXPIRY, 1, key, windowSeconds)) as number
}

export interface RateLimitOptions {
  limit: number
  windowSeconds: number
  exceededMessage: string
  /** If set, a Redis error (e.g. connection failure) throws a 503 with this
   *  message instead of propagating raw — fail closed rather than open. */
  unavailableMessage?: string
}

/**
 * Increment-and-throw helper for the common "N per window, else 429" shape.
 * Was duplicated byte-for-byte across conversations/knowledge/auth/2FA — some
 * copies in-memory (single-process only; wrong under horizontal scaling),
 * some Redis-backed with slightly different Lua. One implementation now.
 */
export async function enforceRateLimit(
  redis: Redis,
  key: string,
  opts: RateLimitOptions,
): Promise<void> {
  let count: number
  try {
    count = await incrementCounterWithExpiry(redis, key, opts.windowSeconds)
  } catch (err) {
    if (opts.unavailableMessage) {
      throw new HttpException(
        { statusCode: 503, code: 'service_unavailable', message: opts.unavailableMessage },
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    }
    throw err
  }
  if (count > opts.limit) {
    throw new HttpException(
      { statusCode: 429, code: 'rate_limit_exceeded', message: opts.exceededMessage },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }
}
