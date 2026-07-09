/**
 * Rolling summary scheduler.
 *
 * Checks whether the un-summarized portion of a conversation branch has
 * exceeded SUMMARY_THRESHOLD_TOKENS. If so, returns a job payload for the
 * BullMQ `housekeeping` queue (actual queue push happens in T3.3.1).
 *
 * One summary per (conversation, branch) — not per agent. Idempotent: calling
 * with the same node list and lastSummaryNode always produces the same result.
 *
 * Token counting uses the synchronous estimateTokenCount heuristic
 * (ceil(length / 4)) — fast, conservative, no WASM required.
 */

import { estimateTokenCount } from '@bramha/agents'
import type { ThreadNode } from './context-bundle.js'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Token count threshold above which a rolling summary job is scheduled. */
export const SUMMARY_THRESHOLD_TOKENS = 3_500

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SummaryJobPayload {
  conversationId: string
  branchId: string
  projectId: string
  /**
   * The node ID of the last summarized node, or null if no summary exists yet.
   * BullMQ worker uses this to know which nodes to include in the new summary.
   */
  nodesSince: string | null
  estimatedTokens: number
}

export interface SummaryCheck {
  shouldSummarize: boolean
  unsummarizedTokens: number
  jobPayload?: SummaryJobPayload
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check whether the un-summarized window of a conversation branch exceeds
 * the summary threshold.
 *
 * @param threadNodes    Full ordered node list for the branch (oldest first).
 * @param lastSummaryNode Node ID of the last summarized node, or null.
 * @param conversationId  Conversation UUID.
 * @param branchId        Branch UUID.
 * @param projectId       Project UUID (for RLS in the worker job).
 */
export function checkSummaryThreshold(
  threadNodes: ThreadNode[],
  lastSummaryNode: string | null,
  conversationId: string,
  branchId: string,
  projectId: string,
): SummaryCheck {
  // Slice to nodes after lastSummaryNode (or all if null)
  let nodesToCount: ThreadNode[]

  if (lastSummaryNode === null) {
    nodesToCount = threadNodes
  } else {
    const idx = threadNodes.findIndex((n) => n.nodeId === lastSummaryNode)
    nodesToCount = idx >= 0 ? threadNodes.slice(idx + 1) : threadNodes
  }

  const unsummarizedTokens = nodesToCount.reduce(
    (sum, node) => sum + estimateTokenCount(node.text),
    0,
  )

  if (unsummarizedTokens < SUMMARY_THRESHOLD_TOKENS) {
    return { shouldSummarize: false, unsummarizedTokens }
  }

  return {
    shouldSummarize: true,
    unsummarizedTokens,
    jobPayload: {
      conversationId,
      branchId,
      projectId,
      nodesSince: lastSummaryNode,
      estimatedTokens: unsummarizedTokens,
    },
  }
}
