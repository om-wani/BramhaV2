/**
 * Budget guard — per-project daily USD circuit breaker + agents_paused check.
 *
 * Security: checks both the Redis "kill switch" and the DB daily spend cap
 * before allowing the turn engine to schedule any agent work.
 *
 * Hardcoded daily limit: 100 USD (Phase 3 default; per-project overrides deferred).
 */

import type { Redis } from 'ioredis'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Daily per-project USD hard cap. Phase 3 default — per-project overrides in Phase 4. */
export const DAILY_USD_LIMIT = 100

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BudgetGuardResult {
  allowed: boolean
  reason?: 'agents_paused' | 'daily_budget_exceeded'
}

/**
 * Returns the total estimated USD spent today for the given project.
 * Implementations call:
 *   SELECT COALESCE(SUM(estimated_usd), 0) FROM token_usage
 *   WHERE project_id = :pid AND created_at >= CURRENT_DATE
 */
export type DailyUsdChecker = (projectId: string) => Promise<number>

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check whether a project is allowed to schedule agent turns.
 *
 * Checks (in order, short-circuit on first failure):
 *   1. Redis key `agents_paused:{projectId}` — if exists, paused immediately.
 *   2. Daily USD spend ≥ DAILY_USD_LIMIT — budget exhausted.
 *
 * @param projectId     Project UUID.
 * @param redis         Shared (non-subscriber) Redis connection.
 * @param checkDailyUsd Injected DB query function (for testability).
 */
export async function checkBudgetGuard(
  projectId: string,
  redis: Redis,
  checkDailyUsd: DailyUsdChecker,
): Promise<BudgetGuardResult> {
  // 1. Check agents_paused kill switch
  const paused = await redis.exists(`agents_paused:${projectId}`)
  if (paused > 0) {
    return { allowed: false, reason: 'agents_paused' }
  }

  // 2. Check daily USD budget
  const totalUsd = await checkDailyUsd(projectId)
  if (totalUsd >= DAILY_USD_LIMIT) {
    return { allowed: false, reason: 'daily_budget_exceeded' }
  }

  return { allowed: true }
}
