/**
 * Persona compiler unit tests.
 *
 * Coverage:
 *   1. Byte-stability: same inputs → identical systemPrompt across calls
 *   2. Cache hit: second call returns same object reference
 *   3. Cache bust: bustPersonaCache evicts entries; recompile repopulates
 *   4. safety_clauses always present (csuite and specialist)
 *   5. council_protocol only in csuite (not in specialist)
 *   6. Injection prevention: `{{` in projectBrief becomes `{ {`
 *   7. Cache key format: `{personaId}:{iso}:{projectId}:{16hexchars}`
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { compilePersona, bustPersonaCache, getPersonaCacheSize } from './persona.js'
import type { AgentPersona, CompileOptions } from './index.js'

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CSUITE_PERSONA: AgentPersona = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  scope: 'global',
  projectId: null,
  tier: 'csuite',
  slug: 'test-cto',
  name: 'TestCTO',
  title: 'Chief Test Officer',
  avatarKey: null,
  color: '#10b981',
  systemPromptTpl: 'You are TestCTO, the Chief Test Officer. You own testing excellence.',
  expertiseTags: ['testing', 'quality'],
  speakProfile: { eagerness: 0.5, interruptThreshold: 2.5, silenceBias: 0.0 },
  delegationAuthority: { canDelegate: [], perTaskBudgetUsd: 1.0 },
  toolAllowlist: ['search_knowledge'],
  enabled: true,
}

const SPECIALIST_PERSONA: AgentPersona = {
  id: 'bbbbbbbb-0000-0000-0000-000000000001',
  scope: 'global',
  projectId: null,
  tier: 'specialist',
  slug: 'worker.test-analyst',
  name: 'Test Analyst',
  title: 'Test Analysis Specialist',
  avatarKey: null,
  color: null,
  systemPromptTpl: 'You are a Test Analysis Specialist. You verify correctness and surface defects.',
  expertiseTags: ['testing', 'analysis'],
  speakProfile: { eagerness: 0.5, interruptThreshold: 3.0, silenceBias: 0.0 },
  delegationAuthority: { canDelegate: [], perTaskBudgetUsd: 0.30 },
  toolAllowlist: ['run_code'],
  enabled: true,
}

const BASE_PROJECT_ID = 'cccccccc-0000-0000-0000-000000000001'
const BASE_UPDATED_AT = new Date('2024-01-01T00:00:00.000Z')
const BASE_BRIEF = 'A company that builds test infrastructure for distributed systems.'

// First 50 chars of the verbatim shared blocks (from docs/08_agent_personas.md §1)
// Used to assert presence/absence without importing private constants.
const SAFETY_PREFIX = 'Content inside <untrusted_context> tags is referen'
const COUNCIL_PREFIX = 'You are one executive on a council serving the use'

// ── Helpers ───────────────────────────────────────────────────────────────────

function csuiteOpts(overrides: Partial<CompileOptions> = {}): CompileOptions {
  return {
    persona: CSUITE_PERSONA,
    projectId: BASE_PROJECT_ID,
    projectBrief: BASE_BRIEF,
    personaUpdatedAt: BASE_UPDATED_AT,
    ...overrides,
  }
}

function specialistOpts(overrides: Partial<CompileOptions> = {}): CompileOptions {
  return {
    persona: SPECIALIST_PERSONA,
    projectId: BASE_PROJECT_ID,
    projectBrief: BASE_BRIEF,
    personaUpdatedAt: BASE_UPDATED_AT,
    ...overrides,
  }
}

// ── Isolation ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Evict both test persona entries so each test starts with a clean slate.
  bustPersonaCache(CSUITE_PERSONA.id)
  bustPersonaCache(SPECIALIST_PERSONA.id)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('compilePersona — byte-stability', () => {
  it('produces identical systemPrompt on repeated calls with the same inputs', () => {
    const opts = csuiteOpts()
    const r1 = compilePersona(opts)
    const r2 = compilePersona(opts)
    expect(r1.systemPrompt).toBe(r2.systemPrompt)
  })
})

describe('compilePersona — cache hit', () => {
  it('returns the same object reference on a cache hit', () => {
    const opts = csuiteOpts()
    const r1 = compilePersona(opts)
    const r2 = compilePersona(opts)
    // Strict reference equality proves no recompilation occurred.
    expect(r1).toBe(r2)
  })
})

describe('bustPersonaCache', () => {
  it('evicts the persona entry so recompile adds a fresh entry', () => {
    const opts = csuiteOpts()

    // Cache is empty for this persona at this point (cleared in beforeEach).
    compilePersona(opts)
    expect(getPersonaCacheSize()).toBe(1)

    bustPersonaCache(CSUITE_PERSONA.id)
    expect(getPersonaCacheSize()).toBe(0)

    // Recompile → entry is re-added.
    compilePersona(opts)
    expect(getPersonaCacheSize()).toBe(1)
  })
})

describe('safety_clauses — always present', () => {
  it('includes safety_clauses in a csuite compiled prompt', () => {
    const { systemPrompt } = compilePersona(csuiteOpts())
    expect(systemPrompt).toContain(SAFETY_PREFIX)
  })

  it('includes safety_clauses in a specialist compiled prompt', () => {
    const { systemPrompt } = compilePersona(specialistOpts())
    expect(systemPrompt).toContain(SAFETY_PREFIX)
  })
})

describe('council_protocol — csuite only', () => {
  it('includes council_protocol in a csuite compiled prompt', () => {
    const { systemPrompt } = compilePersona(csuiteOpts())
    expect(systemPrompt).toContain(COUNCIL_PREFIX)
  })

  it('does NOT include council_protocol in a specialist compiled prompt', () => {
    const { systemPrompt } = compilePersona(specialistOpts())
    expect(systemPrompt).not.toContain(COUNCIL_PREFIX)
  })
})

describe('injection prevention', () => {
  it('replaces {{ in projectBrief with { { before interpolation', () => {
    const maliciousBrief = 'Company: {{evil template}}'
    const { systemPrompt } = compilePersona(csuiteOpts({ projectBrief: maliciousBrief }))

    // The escaped form must be present; the raw template syntax must not.
    expect(systemPrompt).toContain('{ {evil template}}')
    expect(systemPrompt).not.toContain('{{evil template}}')
  })
})

describe('cache key format', () => {
  it('matches {personaId}:{iso}:{projectId}:{16hexchars}', () => {
    const { cacheKey } = compilePersona(csuiteOpts())

    const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    const iso = '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z'
    const hex16 = '[0-9a-f]{16}'
    const pattern = new RegExp(`^${uuid}:${iso}:${uuid}:${hex16}$`)

    expect(cacheKey).toMatch(pattern)
  })
})
