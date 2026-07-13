/**
 * Docker HEALTHCHECK for this worker — it has no HTTP surface (unlike api/web),
 * so liveness is a real PING against the one dependency every queue consumer
 * needs: Redis. Not a full readiness probe (doesn't touch Postgres/S3/ClamAV);
 * just enough to catch "the process is up but can't reach its queue".
 */
import { Redis } from 'ioredis'

const url = process.env['REDIS_URL']
if (!url) {
  console.error('REDIS_URL environment variable is required')
  process.exit(1)
}

const redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true })

try {
  await redis.connect()
  await redis.ping()
  redis.disconnect()
  process.exit(0)
} catch (err) {
  console.error('healthcheck failed:', err instanceof Error ? err.message : err)
  redis.disconnect()
  process.exit(1)
}
