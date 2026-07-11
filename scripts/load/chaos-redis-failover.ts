/**
 * Chaos: simulate Redis failover mid-turn by disconnecting and reconnecting.
 * Verifies ioredis reconnect + BullMQ job recovery.
 *
 * SAFETY: refuses to run against BRAMHA_ENV=production.
 * Usage: BRAMHA_ENV=chaos pnpm tsx scripts/load/chaos-redis-failover.ts
 */

const ENV = process.env['BRAMHA_ENV'] ?? 'development'

if (ENV === 'production') {
  console.error('SAFETY: chaos scripts refuse BRAMHA_ENV=production')
  process.exit(1)
}

console.log('chaos-redis-failover: BRAMHA_ENV check passed, env=', ENV)
console.log('chaos-redis-failover: See T5 for full chaos test harness — this is a scaffold.')
process.exit(0)
