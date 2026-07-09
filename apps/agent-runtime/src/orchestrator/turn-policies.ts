/**
 * Turn policies — decides WHICH scored agents actually speak this turn.
 *
 * Per-room rules (04_agent_orchestration_spec.md §2.1):
 *   call       → single highest-scoring agent always speaks
 *   meeting    → θ=1.4, max 3; eagerness added to score; agent→agent: θ+0.6
 *   conference → θ=1.8, max 3; eagerness added, silenceBias subtracted;
 *                if NO agent clears θ, highest scorer still speaks (fallback)
 *                agent→agent: θ+0.6
 *
 * Eagerness / silenceBias are applied HERE (policy-specific), not in scoreAgents.
 */

import type { AgentScore } from '../pa/relevance.js'
export type { AgentScore } from '../pa/relevance.js'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type RoomType = 'conference' | 'meeting' | 'call'
export type TriggerKind = 'user' | 'agent'

export interface TurnPolicyInput {
  scores: AgentScore[]
  roomType: RoomType
  triggerKind: TriggerKind
  turnDepth: number           // how many agent→agent hops so far (convergence guard)
  projectThresholds?: {       // per-project overrides
    conference?: number
    meeting?: number
  }
}

export interface TurnPolicyResult {
  speakers: AgentScore[]      // ordered by adjusted score desc; empty = no one speaks
  silenced: AgentScore[]      // scored agents cut off by max/threshold
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_THETA_MEETING    = 1.4
const DEFAULT_THETA_CONFERENCE = 1.8
const AGENT_TRIGGER_DELTA      = 0.6
const MAX_SPEAKERS             = 3

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Clone an AgentScore with its score adjusted for eagerness (and optionally silenceBias).
 * Returns a new object — originals are never mutated.
 */
function adjustScore(as: AgentScore, applyEagerness: boolean, applysilenceBias: boolean): AgentScore {
  const delta =
    (applyEagerness  ? as.agent.speakProfile.eagerness   : 0)
    - (applysilenceBias ? as.agent.speakProfile.silenceBias : 0)

  return {
    ...as,
    score: as.score + delta,
    breakdown: {
      ...as.breakdown,
      eagerness: applyEagerness ? as.agent.speakProfile.eagerness : 0,
    },
  }
}

/**
 * Split an ordered, adjusted score list into speakers (≤ maxN above theta)
 * and silenced (the rest).
 */
function partition(
  adjusted: AgentScore[],
  theta: number,
  maxN: number,
  fallback: boolean,
): TurnPolicyResult {
  const eligible = adjusted.filter(a => a.score >= theta)

  if (eligible.length === 0) {
    if (fallback && adjusted.length > 0) {
      // Conference fallback: the highest scorer speaks even below θ
      // adjusted is non-empty (length > 0) so [0] is safe; non-null assertion for TS
      const top = adjusted[0]!
      return { speakers: [top], silenced: adjusted.slice(1) }
    }
    return { speakers: [], silenced: adjusted }
  }

  const speakers = eligible.slice(0, maxN)
  const silenced = [
    ...eligible.slice(maxN),
    ...adjusted.filter(a => a.score < theta),
  ]
  return { speakers, silenced }
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export function applyTurnPolicy(input: TurnPolicyInput): TurnPolicyResult {
  const { scores, roomType, triggerKind, projectThresholds } = input

  if (scores.length === 0) {
    return { speakers: [], silenced: [] }
  }

  const isAgentTrigger = triggerKind === 'agent'

  // ── call ──────────────────────────────────────────────────────────────────
  if (roomType === 'call') {
    // Single agent always speaks; eagerness doesn't change the winner in a 1:1
    const adjusted = scores.map(a => adjustScore(a, true, false))
    adjusted.sort((a, b) => b.score - a.score)
    // scores.length > 0 is checked above, so [0] is always defined
    const top = adjusted[0]!
    return { speakers: [top], silenced: adjusted.slice(1) }
  }

  // ── meeting ───────────────────────────────────────────────────────────────
  if (roomType === 'meeting') {
    let theta = projectThresholds?.meeting ?? DEFAULT_THETA_MEETING
    if (isAgentTrigger) theta += AGENT_TRIGGER_DELTA

    const adjusted = scores
      .map(a => adjustScore(a, true, false))
      .sort((a, b) => b.score - a.score)

    return partition(adjusted, theta, MAX_SPEAKERS, false)
  }

  // ── conference ────────────────────────────────────────────────────────────
  // (default)
  let theta = projectThresholds?.conference ?? DEFAULT_THETA_CONFERENCE
  if (isAgentTrigger) theta += AGENT_TRIGGER_DELTA

  const adjusted = scores
    .map(a => adjustScore(a, true, true))   // eagerness + silenceBias
    .sort((a, b) => b.score - a.score)

  return partition(adjusted, theta, MAX_SPEAKERS, /* fallback= */ true)
}
