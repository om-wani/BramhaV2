/**
 * Unit tests for daily-standup.ts — all I/O mocked.
 */

import { describe, it, expect, vi, type Mock } from 'vitest'
import { buildStandupMarkdown, StandupScheduler, type StandupSchedulerDeps } from './daily-standup.js'
import type { Fact } from './working-memory.js'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROJECT_ID   = 'a0000001-0000-4000-8000-000000000001'
const OFFICE_CONV  = 'a0000002-0000-4000-8000-000000000002'
const NOTE_ID      = 'note-001'

function makeFact(text: string, ts = new Date().toISOString()): Fact {
  return {
    text,
    sourceNode: 'node-001',
    confidence: 0.7,
    ts,
  }
}

function makeDeps(overrides: Partial<StandupSchedulerDeps> = {}): StandupSchedulerDeps {
  return {
    loadRecentFacts: vi.fn().mockResolvedValue([
      makeFact('We decided to launch in Q3'),
      makeFact('Budget approved at $50K'),
    ]),
    findOfficeConversationId: vi.fn().mockResolvedValue(OFFICE_CONV),
    createNote: vi.fn().mockResolvedValue({ noteId: NOTE_ID }),
    ...overrides,
  }
}

// ── buildStandupMarkdown ──────────────────────────────────────────────────────

describe('buildStandupMarkdown', () => {
  it('produces a non-empty markdown string', () => {
    const facts = [makeFact('We agreed to go with React')]
    const md = buildStandupMarkdown(facts)
    expect(md.length).toBeGreaterThan(0)
  })

  it('includes a date header', () => {
    const facts = [makeFact('Hired new VP of Sales')]
    const md = buildStandupMarkdown(facts, '2026-01-15')
    expect(md).toContain('## Daily Standup — 2026-01-15')
  })

  it('lists each fact as a bullet point', () => {
    const facts = [
      makeFact('Decision A'),
      makeFact('Decision B'),
    ]
    const md = buildStandupMarkdown(facts, '2026-01-15')
    expect(md).toContain('- Decision A')
    expect(md).toContain('- Decision B')
  })

  it('deduplicates facts with identical text', () => {
    const facts = [makeFact('We decided X'), makeFact('We decided X')]
    const md = buildStandupMarkdown(facts, '2026-01-15')
    const occurrences = (md.match(/We decided X/g) ?? []).length
    expect(occurrences).toBe(1)
  })

  it('handles empty facts with placeholder line', () => {
    const md = buildStandupMarkdown([], '2026-01-15')
    expect(md).toContain('## Daily Standup — 2026-01-15')
    expect(md).toContain('No key decisions')
  })

  it('uses today\'s date when no dateLabel is provided', () => {
    const today = new Date().toISOString().slice(0, 10)
    const md = buildStandupMarkdown([makeFact('some fact')])
    expect(md).toContain(today)
  })
})

// ── StandupScheduler ──────────────────────────────────────────────────────────

describe('StandupScheduler.run', () => {
  it('returns null when office conversation not found', async () => {
    const deps = makeDeps({ findOfficeConversationId: vi.fn().mockResolvedValue(null) })
    const scheduler = new StandupScheduler(deps)
    const result = await scheduler.run(PROJECT_ID)
    expect(result).toBeNull()
    expect(deps.createNote as Mock).not.toHaveBeenCalled()
  })

  it('creates a note and returns noteId on success', async () => {
    const deps = makeDeps()
    const scheduler = new StandupScheduler(deps)
    const result = await scheduler.run(PROJECT_ID, new Date('2026-01-15T09:00:00Z'))
    expect(result).toEqual({ noteId: NOTE_ID })
  })

  it('passes correct title and date-tagged content to createNote', async () => {
    const deps = makeDeps()
    const scheduler = new StandupScheduler(deps)
    await scheduler.run(PROJECT_ID, new Date('2026-01-15T09:00:00Z'))

    const createNoteMock = deps.createNote as Mock
    expect(createNoteMock).toHaveBeenCalledTimes(1)
    const [title, content, tags, projId] = createNoteMock.mock.calls[0]!
    expect(title).toBe('Daily Standup — 2026-01-15')
    expect(content).toContain('## Daily Standup — 2026-01-15')
    expect(tags).toContain('standup')
    expect(tags).toContain('auto-generated')
    expect(projId).toBe(PROJECT_ID)
  })

  it('loads facts from the last 24h', async () => {
    const deps = makeDeps()
    const scheduler = new StandupScheduler(deps)
    const now = new Date('2026-01-15T12:00:00Z')
    await scheduler.run(PROJECT_ID, now)

    const loadMock = deps.loadRecentFacts as Mock
    expect(loadMock).toHaveBeenCalledWith(PROJECT_ID, expect.any(Date))
    const since: Date = loadMock.mock.calls[0]![1]
    // since should be ~24h before now
    expect(now.getTime() - since.getTime()).toBeCloseTo(24 * 60 * 60 * 1_000, -3)
  })

  it('creates note with empty-facts placeholder when no facts loaded', async () => {
    const deps = makeDeps({ loadRecentFacts: vi.fn().mockResolvedValue([]) })
    const scheduler = new StandupScheduler(deps)
    await scheduler.run(PROJECT_ID, new Date('2026-01-15T09:00:00Z'))

    const createNoteMock = deps.createNote as Mock
    const content: string = createNoteMock.mock.calls[0]![1]
    expect(content).toContain('No key decisions')
  })
})
