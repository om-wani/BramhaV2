/**
 * Chaos: kill the agent-runtime worker process mid-turn.
 * Verifies that BullMQ's stalled-job recovery resurrects the turn.
 *
 * SAFETY: refuses to run against BRAMHA_ENV=production.
 * Usage: BRAMHA_ENV=chaos pnpm tsx scripts/load/chaos-kill-worker.ts
 */

import { Redis } from 'ioredis'
import { Queue, Worker } from 'bullmq'

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
const ENV = process.env['BRAMHA_ENV'] ?? 'development'

if (ENV === 'production') {
  console.error('SAFETY: chaos scripts refuse BRAMHA_ENV=production')
  process.exit(1)
}

// script body: enqueue a test job, start a worker that kills itself mid-job,
// wait for BullMQ stalled-job requeue (default: 30s), verify job eventually completes.
// Full chaos test harness: T5 (production hardening).
console.log('chaos-kill-worker: BRAMHA_ENV check passed, env=', ENV)
console.log('chaos-kill-worker: redis=', REDIS_URL)
console.log('chaos-kill-worker: See T5 for full chaos test harness — this is a scaffold.')

// Prevent unused-import warnings in scaffold mode
void Queue
void Worker
void Redis

process.exit(0)
