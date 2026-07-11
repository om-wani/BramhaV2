/**
 * Daily standup note generator.
 *
 * Builds a markdown summary of key decisions from the last 24h of working-memory
 * facts across all conference/meeting rooms, then posts it as a note to the
 * CEO's Office (office conversation).
 *
 * Pure function:
 *   buildStandupMarkdown(facts) → string
 *
 * Async orchestrator:
 *   StandupScheduler.run(projectId) — loads facts, builds markdown, inserts note.
 *
 * Scheduling: enqueue via BullMQ repeatable job (T4.6)
 *
 * Security:
 *   - All DB queries must be routed through withTenant() (via injected deps).
 *   - Note content is plain markdown — no HTML injection surface.
 */

import type { Fact } from './working-memory.js'

// ── Pure builder ──────────────────────────────────────────────────────────────

/**
 * Build a daily standup markdown summary from a list of working-memory facts.
 *
 * Output format:
 * ```
 * ## Daily Standup — YYYY-MM-DD
 *
 * - <fact>
 * - <fact>
 * …
 * ```
 *
 * Returns a non-empty string. If no facts are provided, a placeholder line is
 * included so the note is never empty.
 */
export function buildStandupMarkdown(facts: Fact[], dateLabel?: string): string {
  const label = dateLabel ?? new Date().toISOString().slice(0, 10)
  const header = `## Daily Standup — ${label}\n`

  if (facts.length === 0) {
    return `${header}\n_No key decisions recorded in the last 24 hours._\n`
  }

  // Deduplicate by text (facts from multiple agents may overlap)
  const seen = new Set<string>()
  const lines: string[] = []
  for (const fact of facts) {
    if (!seen.has(fact.text)) {
      seen.add(fact.text)
      lines.push(`- ${fact.text}`)
    }
  }

  return `${header}\n${lines.join('\n')}\n`
}

// ── Async orchestrator ────────────────────────────────────────────────────────

export interface StandupSchedulerDeps {
  /**
   * Load all working-memory facts created in the last 24h across
   * conference and meeting rooms for the project.
   */
  loadRecentFacts: (projectId: string, since: Date) => Promise<Fact[]>

  /**
   * Find the office conversation ID for a project.
   * Returns null if no office room / conversation exists.
   */
  findOfficeConversationId: (projectId: string) => Promise<string | null>

  /**
   * Insert a note into the notes table (wraps withTenant + INSERT).
   */
  createNote: (
    title: string,
    content: string,
    tags: string[],
    projectId: string,
    personaId: string | null,
  ) => Promise<{ noteId: string }>
}

/** System persona ID used when posting automated standup notes. */
const SYSTEM_PERSONA_ID = null

export class StandupScheduler {
  constructor(private readonly deps: StandupSchedulerDeps) {}

  /**
   * Generate and post the daily standup note for a project.
   *
   * @param projectId  Target project.
   * @param now        Reference time (injectable for testing; defaults to Date.now()).
   * @returns noteId if a note was created, null if office conversation not found.
   */
  async run(projectId: string, now = new Date()): Promise<{ noteId: string } | null> {
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1_000)

    const officeConvId = await this.deps.findOfficeConversationId(projectId)
    if (!officeConvId) return null

    const facts = await this.deps.loadRecentFacts(projectId, since)
    const dateLabel = now.toISOString().slice(0, 10)
    const markdown = buildStandupMarkdown(facts, dateLabel)

    return this.deps.createNote(
      `Daily Standup — ${dateLabel}`,
      markdown,
      ['standup', 'auto-generated'],
      projectId,
      SYSTEM_PERSONA_ID,
    )
  }
}
