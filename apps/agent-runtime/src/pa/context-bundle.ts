/**
 * Context bundle assembler.
 *
 * Builds the full model input for a persona turn, respecting exact section order
 * and a hard token budget (with 5% safety margin).
 *
 * Section order (04_agent_orchestration.md §2.2):
 *   1. Persona system prompt
 *   2. Tool schemas
 *   3. Project brief           (≤ 500 tokens, truncated with notice)
 *   4. Working-memory summary  (≤ 800 tokens, local conversation only)
 *   4b. Project facts block    (≤ 200 tokens, cross-room global facts)
 *   5. Open loops              (≤ 200 tokens)
 *   6. RAG block               (≤ 35% of remaining budget, wrapped in <untrusted_context>)
 *   7. Thread window           (oldest-first / newest-last, truncated to remaining)
 *   8. Trigger instruction
 *
 * Security:
 *   RAG content and any file/MCP content MUST pass through untrustedContext().
 *   Hard cap = Math.floor(rawBudget * 0.95) — enforced even if token-count
 *   underestimates actual model tokens.
 */

import { estimateTokenCount } from '@bramha/agents'
import type { WorkingMemory, Fact } from './working-memory.js'

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONTEXT_TOKEN_CAP = 12_000

const PROJECT_BRIEF_TOKEN_CAP = 500
const WORKING_MEMORY_TOKEN_CAP = 800
const PROJECT_FACTS_TOKEN_CAP = 200
const OPEN_LOOPS_TOKEN_CAP = 200
const RAG_BUDGET_FRACTION = 0.35
const SAFETY_MARGIN = 0.95

// ── Cross-room routing matrix ──────────────────────────────────────────────────

/**
 * Cross-room context routing matrix.
 *
 * ┌─────────────────────────┬───────────────────────────────────────────────────┐
 * │ Context type            │ Routing rule                                      │
 * ├─────────────────────────┼───────────────────────────────────────────────────┤
 * │ Knowledge chunks (RAG)  │ All rooms, always — knowledge is org-wide         │
 * │ Rolling summary         │ Same room (conversation) only                     │
 * │ Working-memory facts    │ Agent-global per project, EXCEPT:                 │
 * │                         │   confidential-1:1 facts stay in that room until  │
 * │                         │   user "debriefs" (sets fact.sourceRoomConfidential│
 * │                         │   = false or marks the room non-confidential)     │
 * │ Open loops              │ Current conversation only                         │
 * └─────────────────────────┴───────────────────────────────────────────────────┘
 */
export const ROUTING_MATRIX = {
  ragChunks: 'all-rooms-always',
  rollingSummary: 'same-room-only',
  workingMemoryFacts: 'agent-global-project-except-confidential-1:1',
  openLoops: 'current-conversation-only',
} as const

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A fact sourced from another conversation in the same project.
 * Extends Fact with routing metadata required for cross-room filtering.
 */
export interface GlobalFact extends Fact {
  /** Conversation ID from which this fact originated */
  sourceConversationId: string
  /** Room ID from which this fact originated (required for routing filter) */
  sourceRoomId: string
  /** Room type from which this fact originated */
  sourceRoomType: string
  /** Whether the source room was flagged confidential at time of extraction */
  sourceRoomConfidential: boolean
}

export interface ThreadNode {
  nodeId: string
  authorKind: 'user' | 'agent' | 'system'
  /** Display name */
  authorName: string
  text: string
  type: string
}

export interface RagChunk {
  chunkId: string
  /** Source document/URL identifier */
  origin: string
  headingTrail: string[]
  snippet: string
  /** Retrieval score (descending) */
  score: number
}

export interface BundleInput {
  /** Compiled persona prompt (from compilePersona) */
  systemPrompt: string
  /** JSON strings of tool definitions from persona.tool_allowlist */
  toolSchemas: string[]
  projectBrief: string
  workingMemory: WorkingMemory
  ragChunks: RagChunk[]
  /** Oldest first; bundle displays newest-last (same order) */
  threadNodes: ThreadNode[]
  triggerReason: 'mention' | 'expertise' | 'follow-up'
  /** Display names of other speakers active this turn */
  otherSpeakers: string[]
  /** From ModelPolicy.maxInputTokens */
  maxInputTokens: number
  /** Per-project override — defaults to 16 384 */
  projectTokenCap?: number
  // ── Cross-room routing fields ──────────────────────────────────────────────
  /** ID of the room in which this turn is taking place */
  currentRoomId: string
  /** Type of the current room */
  roomType: string
  /** Whether the current room is flagged as confidential */
  roomIsConfidential: boolean
  /** All working-memory facts for this persona across other conversations in the project */
  projectFacts: GlobalFact[]
}

export interface ContextBundle {
  sections: {
    systemPrompt: string
    toolSchemas: string
    projectBrief: string
    /** Local conversation summary only (workingMemory.summaryMd). Routing: same-room-only. */
    workingMemorySummary: string
    /** Global facts from other project rooms (filtered per routing matrix). */
    projectFactsBlock: string
    openLoops: string
    ragBlock: string
    threadWindow: string
    triggerInstruction: string
  }
  /** Sections joined with '\n\n' (empty sections omitted) */
  fullPrompt: string
  /** Estimated token count of fullPrompt */
  tokenCount: number
  /** Tokens consumed */
  budgetUsed: number
  /** Raw budget before safety margin */
  budgetTotal: number
}

// ── Security wrapper ───────────────────────────────────────────────────────────

/**
 * Wrap external/untrusted content so the model's safety clause recognises it
 * as reference material, never as instructions.
 */
export function untrustedContext(content: string): string {
  return `<untrusted_context>\n${content}\n</untrusted_context>`
}

// ── Section builders ───────────────────────────────────────────────────────────

/** Truncate text to maxTokens, appending a notice if truncated. */
function capSection(text: string, maxTokens: number, notice: string): string {
  if (estimateTokenCount(text) <= maxTokens) return text
  const maxChars = maxTokens * 4
  return text.slice(0, maxChars) + '\n' + notice
}

function buildToolSchemas(schemas: string[]): string {
  if (schemas.length === 0) return ''
  return '## Available Tools\n' + schemas.join('\n')
}

function buildProjectBrief(brief: string): string {
  if (!brief) return ''
  return capSection(
    brief,
    PROJECT_BRIEF_TOKEN_CAP,
    '[Project brief truncated — exceeds 500-token limit.]',
  )
}

// ── Cross-room routing ─────────────────────────────────────────────────────────

/**
 * Filter project-level facts according to the routing matrix.
 *
 * Rule: confidential-1:1 facts are only visible inside the same room they
 * originated in. All other facts are agent-global across the project.
 */
export function filterProjectFacts(
  facts: GlobalFact[],
  currentRoomId: string,
  currentRoomIsConfidential: boolean = false,
): GlobalFact[] {
  return facts.filter((f) => {
    // Confidential current room: block all facts not originating here
    // (a private room receives no cross-room injection)
    if (currentRoomIsConfidential && f.sourceRoomId !== currentRoomId) {
      return false
    }
    // Confidential-1:1 facts: only visible in the originating room
    if (f.sourceRoomConfidential && f.sourceRoomId !== currentRoomId) {
      return false
    }
    return true
  })
}

/** Local conversation summary only. Routing: same-room-only. */
function buildMemorySummary(memory: WorkingMemory): string {
  if (!memory.summaryMd) return ''
  return capSection(memory.summaryMd, WORKING_MEMORY_TOKEN_CAP, '[Summary truncated.]')
}

/**
 * Build the cross-room facts block from project-level global facts.
 * Only includes facts that pass the routing filter (confidential-1:1 blocked).
 * Token cap: 200 tokens (≤ PROJECT_FACTS_TOKEN_CAP).
 * Routing: agent-global per project, except confidential-1:1.
 */
function buildProjectFactsBlock(
  projectFacts: GlobalFact[],
  currentRoomId: string,
  currentRoomIsConfidential: boolean = false,
): string {
  const filtered = filterProjectFacts(projectFacts, currentRoomId, currentRoomIsConfidential)
  if (filtered.length === 0) return ''
  const bullets = filtered
    .slice(0, 10)
    .map((f) => `- [${f.sourceRoomType}] ${f.text}`)
    .join('\n')
  return capSection(
    `## Cross-Room Facts\n${bullets}`,
    PROJECT_FACTS_TOKEN_CAP,
    '[Cross-room facts truncated.]',
  )
}

function buildOpenLoops(memory: WorkingMemory): string {
  const active = memory.openLoops.filter((l) => l.closedAt === undefined)
  if (active.length === 0) return ''
  const bullets = active.map((l) => `- ${l.text}`).join('\n')
  return capSection(
    `## Open Questions\n${bullets}`,
    OPEN_LOOPS_TOKEN_CAP,
    '[Open questions truncated.]',
  )
}

function buildRagBlock(chunks: RagChunk[], budget: number): string {
  if (chunks.length === 0 || budget <= 0) return ''

  const parts: string[] = []
  let usedTokens = 0

  for (const chunk of chunks) {
    const heading = chunk.headingTrail.length > 0 ? ` | ${chunk.headingTrail.join(' > ')}` : ''
    const entry = `[${chunk.origin}${heading}]\n${chunk.snippet}`
    const entryTokens = estimateTokenCount(entry)

    if (usedTokens + entryTokens > budget) {
      // Try to fit a truncated version
      if (parts.length === 0) {
        const maxChars = budget * 4
        const truncated = `[${chunk.origin}${heading}]\n${chunk.snippet.slice(0, maxChars)}`
        if (truncated.trim()) parts.push(truncated)
      }
      break
    }

    parts.push(entry)
    usedTokens += entryTokens
  }

  if (parts.length === 0) return ''
  return untrustedContext(parts.join('\n\n---\n\n'))
}

function buildThreadWindow(nodes: ThreadNode[], budget: number): string {
  if (nodes.length === 0 || budget <= 0) return ''

  // Format all nodes (oldest first = newest-last display order)
  const formatted = nodes.map(
    (n) => `**${n.authorName}** [${n.type}]: ${n.text}`,
  )

  // Check if all nodes fit
  const full = formatted.join('\n\n')
  if (estimateTokenCount(full) <= budget) return full

  // Drop oldest nodes until we fit within budget
  for (let i = 1; i < formatted.length; i++) {
    const window = formatted.slice(i).join('\n\n')
    if (estimateTokenCount(window) <= budget) return window
  }

  // Even the newest single node may be too large — truncate it
  const newestFormatted = formatted[formatted.length - 1]
  if (newestFormatted === undefined) return ''
  return newestFormatted.slice(0, budget * 4)
}

function buildTriggerInstruction(
  reason: BundleInput['triggerReason'],
  otherSpeakers: string[],
): string {
  const reasonText: Record<BundleInput['triggerReason'], string> = {
    mention: 'mention',
    expertise: 'expertise match',
    'follow-up': 'follow-up to your previous message',
  }
  const speakersText =
    otherSpeakers.length > 0 ? otherSpeakers.join(', ') : 'none'
  return (
    `You are speaking now because: ${reasonText[reason]}. ` +
    `Other speakers this turn: ${speakersText}. ` +
    `Be concise; do not repeat them.`
  )
}

// ── Main assembler ─────────────────────────────────────────────────────────────

export function buildContextBundle(input: BundleInput): ContextBundle {
  // --- Compute budget ---------------------------------------------------
  const rawBudget = Math.min(
    input.maxInputTokens,
    input.projectTokenCap ?? 16_384,
    CONTEXT_TOKEN_CAP,
  )
  const effectiveBudget = Math.floor(rawBudget * SAFETY_MARGIN)

  // --- Build sections 1–5 (fixed sections with per-section caps) --------
  const s1 = input.systemPrompt
  const s2 = buildToolSchemas(input.toolSchemas)
  const s3 = buildProjectBrief(input.projectBrief)
  const s4 = buildMemorySummary(input.workingMemory)                  // local only
  const s4b = buildProjectFactsBlock(input.projectFacts, input.currentRoomId, input.roomIsConfidential)
  const s5 = buildOpenLoops(input.workingMemory)

  const s1to5Tokens = [s1, s2, s3, s4, s4b, s5].reduce(
    (sum, s) => sum + (s ? estimateTokenCount(s) : 0),
    0,
  )

  const remaining = Math.max(0, effectiveBudget - s1to5Tokens)

  // --- Section 8: trigger instruction (reserve space before RAG/thread) -
  const s8 = buildTriggerInstruction(input.triggerReason, input.otherSpeakers)
  const s8Tokens = estimateTokenCount(s8)

  const contentRemaining = Math.max(0, remaining - s8Tokens)

  // --- Section 6: RAG block (≤ 35% of remaining budget after s1–5) -----
  const ragBudget = Math.floor(remaining * RAG_BUDGET_FRACTION)
  const s6 = buildRagBlock(input.ragChunks, ragBudget)
  const s6Tokens = s6 ? estimateTokenCount(s6) : 0

  // --- Section 7: thread window (rest of content budget) ---------------
  const threadBudget = Math.max(0, contentRemaining - s6Tokens)
  const s7 = buildThreadWindow(input.threadNodes, threadBudget)

  // --- Assemble ---------------------------------------------------------
  const sections = {
    systemPrompt: s1,
    toolSchemas: s2,
    projectBrief: s3,
    workingMemorySummary: s4,
    projectFactsBlock: s4b,
    openLoops: s5,
    ragBlock: s6,
    threadWindow: s7,
    triggerInstruction: s8,
  }

  const fullPrompt = Object.values(sections)
    .filter(Boolean)
    .join('\n\n')

  const tokenCount = estimateTokenCount(fullPrompt)

  return {
    sections,
    fullPrompt,
    tokenCount,
    budgetUsed: tokenCount,
    budgetTotal: rawBudget,
  }
}
