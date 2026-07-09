/**
 * Context bundle assembler.
 *
 * Builds the full model input for a persona turn, respecting exact section order
 * and a hard token budget (with 5% safety margin).
 *
 * Section order (04_agent_orchestration.md §2.2):
 *   1. Persona system prompt
 *   2. Tool schemas
 *   3. Project brief       (≤ 500 tokens, truncated with notice)
 *   4. Working-memory summary (≤ 800 tokens)
 *   5. Open loops          (≤ 200 tokens)
 *   6. RAG block           (≤ 35% of remaining budget, wrapped in <untrusted_context>)
 *   7. Thread window       (oldest-first / newest-last, truncated to remaining)
 *   8. Trigger instruction
 *
 * Security:
 *   RAG content and any file/MCP content MUST pass through untrustedContext().
 *   Hard cap = Math.floor(rawBudget * 0.95) — enforced even if token-count
 *   underestimates actual model tokens.
 */

import { estimateTokenCount } from '@bramha/agents'
import type { WorkingMemory } from './working-memory.js'

// ── Constants ─────────────────────────────────────────────────────────────────

export const CONTEXT_TOKEN_CAP = 12_000

const PROJECT_BRIEF_TOKEN_CAP = 500
const WORKING_MEMORY_TOKEN_CAP = 800
const OPEN_LOOPS_TOKEN_CAP = 200
const RAG_BUDGET_FRACTION = 0.35
const SAFETY_MARGIN = 0.95

// ── Types ──────────────────────────────────────────────────────────────────────

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
}

export interface ContextBundle {
  sections: {
    systemPrompt: string
    toolSchemas: string
    projectBrief: string
    workingMemorySummary: string
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

function buildMemorySummary(memory: WorkingMemory): string {
  if (!memory.summaryMd) return ''
  return capSection(memory.summaryMd, WORKING_MEMORY_TOKEN_CAP, '[Summary truncated.]')
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
  const s4 = buildMemorySummary(input.workingMemory)
  const s5 = buildOpenLoops(input.workingMemory)

  const s1to5Tokens = [s1, s2, s3, s4, s5].reduce(
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
