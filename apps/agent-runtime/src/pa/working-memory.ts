/**
 * Working memory — per-persona, per-conversation state.
 *
 * All functions are pure (no I/O). Persistence is the responsibility of the
 * calling service which uses withTenant() to read/write agent_working_memory.
 *
 * Security:
 *   - Text inputs are capped at TEXT_CAP chars before pattern matching to
 *     prevent catastrophic backtracking on adversarial input.
 *   - Patterns use fixed-width quantifiers ({10,100}) and no nested groups.
 */

import { randomUUID } from 'node:crypto'
import type { RoomType } from '@bramha/shared'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum chars processed from any node text to prevent DoS. */
const TEXT_CAP = 8_192
/** Hard cap on number of facts retained (LRU — oldest evicted). */
const MAX_FACTS = 50
/** Hard cap on open loops — drop oldest arrivals when full. */
const MAX_OPEN_LOOPS = 20
/** Maximum new facts extracted per node. */
const MAX_FACTS_PER_NODE = 3
/** Jaccard similarity threshold to close an open loop. */
const JACCARD_THRESHOLD = 0.3

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Fact {
  /** Plain-English extracted fact */
  text: string
  /** Source node ID */
  sourceNode: string
  /** 0.5–1.0; heuristic = 0.7, agent-stated explicit = 1.0 */
  confidence: number
  /** ISO timestamp */
  ts: string
  // ── Routing fields (optional — absent means no restriction) ───────────────
  /** ID of the room in which this fact was learned */
  sourceRoomId?: string
  /** Type of the source room */
  sourceRoomType?: RoomType
  /** Whether the source room was flagged as confidential at time of extraction */
  sourceRoomConfidential?: boolean
}

export interface OpenLoop {
  id: string
  /** The original question or request text */
  text: string
  createdAt: string
  closedAt?: string
}

export interface WorkingMemory {
  personaId: string
  conversationId: string
  projectId: string
  facts: Fact[]
  openLoops: OpenLoop[]
  lastSummaryNode: string | null
  summaryMd: string | null
  updatedAt: string
}

// ── Fact-extraction patterns ───────────────────────────────────────────────────

const DECISION_RE =
  /(we will|we've decided|decided to|agreed to|going with|let's|we'll)\s+(.{10,100})/i

const DATE_RE = /(by|on|until|before)\s+(\w+\s+\d{1,2}|\d{4}-\d{2}-\d{2})/i

const MONEY_RE = /\$[\d,.]+[KMB]?/

function buildCommitmentRe(agentName: string, agentTitle: string): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(${esc(agentName)}|${esc(agentTitle)})\\s+will\\s+(.{5,80})`,
    'i',
  )
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Extract facts from a single node text.
 * Returns at most MAX_FACTS_PER_NODE (3) facts.
 * Confidence is 0.7 for all heuristic extractions.
 */
export function extractFacts(
  nodeText: string,
  nodeId: string,
  agentName: string,
  agentTitle: string,
): Fact[] {
  const text = nodeText.length > TEXT_CAP ? nodeText.slice(0, TEXT_CAP) : nodeText
  const ts = new Date().toISOString()
  const facts: Fact[] = []

  const patterns: RegExp[] = [
    DECISION_RE,
    DATE_RE,
    MONEY_RE,
    buildCommitmentRe(agentName, agentTitle),
  ]

  for (const pattern of patterns) {
    if (facts.length >= MAX_FACTS_PER_NODE) break
    const match = pattern.exec(text)
    if (match !== null) {
      facts.push({
        text: match[0].trim(),
        sourceNode: nodeId,
        confidence: 0.7,
        ts,
      })
    }
  }

  return facts
}

// ── Open-loop detection ────────────────────────────────────────────────────────

/** Heuristics that mark a message as a question directed at the agent. */
const QUESTION_RE = /can you|could you|would you|what do you|how do you|\?/i

/**
 * Detect open loops from a node.
 *
 * Council / call rooms differ:
 *   - council/chat rooms: @slug mention + question indicator = open loop
 *   - call rooms: any message is an implicit open loop (the PA handles all
 *     messages not authored by the agent; callers filter own messages out)
 */
export function detectOpenLoops(
  nodeText: string,
  nodeId: string,
  agentSlug: string,
  roomType: string,
): OpenLoop[] {
  const text = nodeText.length > TEXT_CAP ? nodeText.slice(0, TEXT_CAP) : nodeText
  const ts = new Date().toISOString()

  if (roomType === 'call') {
    return [{ id: randomUUID(), text, createdAt: ts }]
  }

  const hasMention = text.toLowerCase().includes(`@${agentSlug.toLowerCase()}`)
  const isQuestion = QUESTION_RE.test(text)

  if (hasMention && isQuestion) {
    return [{ id: randomUUID(), text, createdAt: ts }]
  }

  return []
}

// ── Loop closure ───────────────────────────────────────────────────────────────

/**
 * Compute Jaccard similarity between two strings using word-level tokenisation.
 * Returns value in [0, 1].
 */
function jaccardSimilarity(a: string, b: string): number {
  const tokenise = (s: string): Set<string> =>
    new Set(s.toLowerCase().split(/\W+/).filter(Boolean))

  const setA = tokenise(a)
  const setB = tokenise(b)

  if (setA.size === 0 && setB.size === 0) return 1

  let intersectionSize = 0
  for (const token of setA) {
    if (setB.has(token)) intersectionSize++
  }

  const unionSize = setA.size + setB.size - intersectionSize
  return unionSize === 0 ? 0 : intersectionSize / unionSize
}

/**
 * Given an agent's reply and the current open loops, return IDs of loops
 * that the reply closes (Jaccard similarity of first 2 reply sentences ≥ 0.3).
 *
 * Already-closed loops are skipped.
 */
export function closeLoops(replyText: string, openLoops: OpenLoop[]): string[] {
  // Compare against the first two sentences of the reply
  const sentences = replyText.split(/(?<=[.!?])\s+/)
  const replyWindow = sentences.slice(0, 2).join(' ')

  const closedIds: string[] = []
  for (const loop of openLoops) {
    if (loop.closedAt !== undefined) continue
    if (jaccardSimilarity(replyWindow, loop.text) >= JACCARD_THRESHOLD) {
      closedIds.push(loop.id)
    }
  }
  return closedIds
}

// ── State updater ──────────────────────────────────────────────────────────────

/**
 * Apply fact/loop updates to working memory.
 * Returns a new WorkingMemory (immutable — no mutation of input).
 *
 * Caps:
 *   facts     — ring buffer capped at 50; oldest evicted when full.
 *   openLoops — capped at 20; oldest dropped when full (after closures applied).
 */
export function updateWorkingMemory(
  memory: WorkingMemory,
  newFacts: Fact[],
  newLoops: OpenLoop[],
  closedLoopIds: string[],
): WorkingMemory {
  const now = new Date().toISOString()

  // --- facts ring buffer ------------------------------------------------
  let facts = [...memory.facts, ...newFacts]
  if (facts.length > MAX_FACTS) {
    facts = facts.slice(facts.length - MAX_FACTS)
  }

  // --- close loops (mark with closedAt) ---------------------------------
  const closedSet = new Set(closedLoopIds)
  const loopsAfterClose: OpenLoop[] = memory.openLoops.map((loop) =>
    closedSet.has(loop.id) ? { ...loop, closedAt: now } : loop,
  )

  // --- append new loops, cap at MAX_OPEN_LOOPS --------------------------
  const combined = [...loopsAfterClose, ...newLoops]
  const openLoops =
    combined.length > MAX_OPEN_LOOPS
      ? combined.slice(combined.length - MAX_OPEN_LOOPS)
      : combined

  return {
    ...memory,
    facts,
    openLoops,
    updatedAt: now,
  }
}
