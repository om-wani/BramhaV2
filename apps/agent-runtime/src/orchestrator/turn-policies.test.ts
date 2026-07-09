import { describe, it, expect } from 'vitest'
import { applyTurnPolicy } from './turn-policies.js'
import type { TurnPolicyInput, AgentScore } from './turn-policies.js'
import type { ScoringAgent } from '../pa/relevance.js'

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeAgent(id: string, eagerness = 0, silenceBias = 0): ScoringAgent {
  return {
    personaId: id,
    slug: id,
    name: id,
    expertiseTags: [],
    expertiseCentroid: [],
    speakProfile: { eagerness, interruptThreshold: 1.4, silenceBias },
  }
}

function makeScore(agent: ScoringAgent, score: number): AgentScore {
  return {
    agent,
    score,
    breakdown: {
      mention: 0,
      expertise: 0,
      lexical: 0,
      threadOwnership: 0,
      openLoop: 0,
      recencyFatigue: 0,
      eagerness: 0,
      jitter: 0,
    },
  }
}

function input(overrides: Partial<TurnPolicyInput> & { scores: AgentScore[] }): TurnPolicyInput {
  return {
    roomType: 'meeting',
    triggerKind: 'user',
    turnDepth: 0,
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T1 — call room: single agent always speaks
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T1 — call room always speaks', () => {
  it('returns the single agent regardless of score', () => {
    const agent = makeAgent('cfo')
    const scores = [makeScore(agent, 0.1)]  // very low score
    const result = applyTurnPolicy(input({ scores, roomType: 'call' }))
    expect(result.speakers).toHaveLength(1)
    expect(result.speakers[0]!.agent.personaId).toBe('cfo')
    expect(result.silenced).toHaveLength(0)
  })

  it('call: returns highest scorer when multiple agents present', () => {
    const a = makeAgent('a')
    const b = makeAgent('b')
    const scores = [makeScore(a, 0.5), makeScore(b, 3.0)]
    const result = applyTurnPolicy(input({ scores, roomType: 'call' }))
    expect(result.speakers).toHaveLength(1)
    expect(result.speakers[0]!.agent.personaId).toBe('b')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T2 — meeting: θ=1.4 threshold
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T2 — meeting θ=1.4', () => {
  it('agent with score 1.5 speaks in meeting', () => {
    const a = makeAgent('cfo')
    const scores = [makeScore(a, 1.5)]
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    expect(result.speakers).toHaveLength(1)
  })

  it('agent with score 1.3 is silenced in meeting', () => {
    const a = makeAgent('cfo')
    const scores = [makeScore(a, 1.3)]
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    expect(result.speakers).toHaveLength(0)
    expect(result.silenced).toHaveLength(1)
  })

  it('meeting does NOT have conference fallback (no speaker if all below θ)', () => {
    const a = makeAgent('cfo')
    const scores = [makeScore(a, 0.5)]
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    expect(result.speakers).toHaveLength(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T3 — conference: θ=1.8 threshold
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T3 — conference θ=1.8', () => {
  it('agent with score 2.1 speaks in conference', () => {
    const a = makeAgent('cfo')
    const scores = [makeScore(a, 2.1)]
    const result = applyTurnPolicy(input({ scores, roomType: 'conference' }))
    expect(result.speakers).toHaveLength(1)
    expect(result.speakers[0]!.agent.personaId).toBe('cfo')
  })

  it('agent with score 1.5 is below θ → conference fallback fires', () => {
    const a = makeAgent('cfo')
    const scores = [makeScore(a, 1.5)]
    const result = applyTurnPolicy(input({ scores, roomType: 'conference' }))
    // Fallback: no one clears θ=1.8 → highest scorer speaks
    expect(result.speakers).toHaveLength(1)
    expect(result.speakers[0]!.agent.personaId).toBe('cfo')
    expect(result.silenced).toHaveLength(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T4 — conference fallback: if ALL below θ, highest scorer speaks
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T4 — conference fallback', () => {
  it('if all agents below θ_conf, highest scorer still speaks', () => {
    const a = makeAgent('cfo')
    const b = makeAgent('cto')
    const scores = [makeScore(a, 1.0), makeScore(b, 0.5)]
    const result = applyTurnPolicy(input({ scores, roomType: 'conference' }))
    expect(result.speakers).toHaveLength(1)
    // highest scorer is 'cfo'
    expect(result.speakers[0]!.agent.personaId).toBe('cfo')
    expect(result.silenced).toHaveLength(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T5 — max 3 speakers enforced
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T5 — max 3 speakers', () => {
  it('only 3 agents speak even when 5 clear threshold in meeting', () => {
    const agents = [makeAgent('a'), makeAgent('b'), makeAgent('c'), makeAgent('d'), makeAgent('e')]
    const scores = agents.map(a => makeScore(a, 2.5))  // all well above θ=1.4
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    expect(result.speakers).toHaveLength(3)
    expect(result.silenced).toHaveLength(2)
  })

  it('conference max 3 also enforced', () => {
    const agents = [makeAgent('a'), makeAgent('b'), makeAgent('c'), makeAgent('d')]
    const scores = agents.map(a => makeScore(a, 2.5))
    const result = applyTurnPolicy(input({ scores, roomType: 'conference' }))
    expect(result.speakers).toHaveLength(3)
    expect(result.silenced).toHaveLength(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T6 — agent→agent trigger: θ increases by 0.6
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T6 — agent→agent stricter threshold', () => {
  it('meeting: agent with score 1.7 speaks on user turn (θ=1.4) but silenced on agent→agent (θ=2.0)', () => {
    const a = makeAgent('cfo')
    const scores = [makeScore(a, 1.7)]
    const userTurn  = applyTurnPolicy(input({ scores, roomType: 'meeting', triggerKind: 'user' }))
    const agentTurn = applyTurnPolicy(input({ scores, roomType: 'meeting', triggerKind: 'agent' }))
    expect(userTurn.speakers).toHaveLength(1)
    expect(agentTurn.speakers).toHaveLength(0)
  })

  it('conference: agent→agent threshold is θ_conf+0.6=2.4; fallback still fires below that', () => {
    const a = makeAgent('cfo')
    // score=2.2 → clears θ_conf=1.8 on user turn but not 2.4 on agent→agent
    const scores = [makeScore(a, 2.2)]
    const userTurn  = applyTurnPolicy(input({ scores, roomType: 'conference', triggerKind: 'user' }))
    const agentTurn = applyTurnPolicy(input({ scores, roomType: 'conference', triggerKind: 'agent' }))
    expect(userTurn.speakers).toHaveLength(1)
    // agent→agent: all below 2.4 → conference fallback kicks in (highest speaks anyway)
    expect(agentTurn.speakers).toHaveLength(1)
    expect(agentTurn.speakers[0]!.agent.personaId).toBe('cfo')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T7 — Eagerness applied in policy (not scorer)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T7 — eagerness applied in policy', () => {
  it('agent with eagerness=1.0 gets boosted and clears meeting θ', () => {
    const a = makeAgent('cfo', /* eagerness= */ 1.0)
    // Raw score 0.6 + eagerness 1.0 = 1.6 > θ=1.4 → speaks
    const scores = [makeScore(a, 0.6)]
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    expect(result.speakers).toHaveLength(1)
  })

  it('agent without eagerness stays below meeting θ', () => {
    const a = makeAgent('cfo', /* eagerness= */ 0)
    const scores = [makeScore(a, 0.6)]
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    expect(result.speakers).toHaveLength(0)
  })

  it('adjusted score in speakers reflects eagerness', () => {
    const a = makeAgent('cfo', 0.5)
    const scores = [makeScore(a, 2.0)]
    const result = applyTurnPolicy(input({ scores, roomType: 'conference' }))
    expect(result.speakers[0]!.score).toBeCloseTo(2.5, 5)
    expect(result.speakers[0]!.breakdown.eagerness).toBe(0.5)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T8 — silenceBias subtracted in conference only
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T8 — silenceBias conference-only', () => {
  it('conference: silenceBias reduces adjusted score', () => {
    const a = makeAgent('cfo', /* eagerness= */ 0, /* silenceBias= */ 0.5)
    // Raw=2.5, silenceBias=0.5 → adjusted=2.0 → still clears θ=1.8
    const scores = [makeScore(a, 2.5)]
    const result = applyTurnPolicy(input({ scores, roomType: 'conference' }))
    expect(result.speakers[0]!.score).toBeCloseTo(2.0, 5)
  })

  it('meeting: silenceBias NOT applied', () => {
    const a = makeAgent('cfo', /* eagerness= */ 0, /* silenceBias= */ 0.5)
    const scores = [makeScore(a, 2.0)]
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    // silenceBias should not reduce score in meeting
    expect(result.speakers[0]!.score).toBeCloseTo(2.0, 5)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T9 — speakers ordered by score descending
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T9 — speakers ordered desc', () => {
  it('speakers in descending adjusted-score order', () => {
    const a = makeAgent('a')
    const b = makeAgent('b')
    const c = makeAgent('c')
    const scores = [makeScore(a, 1.6), makeScore(b, 2.4), makeScore(c, 1.9)]
    const result = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    expect(result.speakers[0]!.agent.personaId).toBe('b')
    expect(result.speakers[1]!.agent.personaId).toBe('c')
    expect(result.speakers[2]!.agent.personaId).toBe('a')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T10 — Empty scores list
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T10 — empty scores', () => {
  it('returns empty speakers and silenced for no agents', () => {
    const result = applyTurnPolicy(input({ scores: [], roomType: 'conference' }))
    expect(result.speakers).toHaveLength(0)
    expect(result.silenced).toHaveLength(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T11 — Per-project threshold overrides
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T11 — per-project threshold overrides', () => {
  it('custom meeting threshold overrides default 1.4', () => {
    const a = makeAgent('cfo')
    // score=1.6 → clears default 1.4 but not custom 2.0
    const scores = [makeScore(a, 1.6)]
    const defaultRes = applyTurnPolicy(input({ scores, roomType: 'meeting' }))
    const customRes  = applyTurnPolicy(input({ scores, roomType: 'meeting', projectThresholds: { meeting: 2.0 } }))
    expect(defaultRes.speakers).toHaveLength(1)
    expect(customRes.speakers).toHaveLength(0)
  })

  it('custom conference threshold overrides default 1.8', () => {
    const a = makeAgent('cfo')
    const scores = [makeScore(a, 3.0)]  // above any reasonable default
    const result = applyTurnPolicy(input({ scores, roomType: 'conference', projectThresholds: { conference: 4.0 } }))
    // 3.0 < 4.0 → no one clears, conference fallback kicks in
    expect(result.speakers).toHaveLength(1)
    expect(result.speakers[0]!.agent.personaId).toBe('cfo')
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario T12 — Mixed tier: some above θ, some below
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario T12 — mixed tier in conference', () => {
  it('only agents above θ_conf=1.8 speak; below are silenced (no fallback needed)', () => {
    const a = makeAgent('a')
    const b = makeAgent('b')
    const c = makeAgent('c')
    const scores = [makeScore(a, 2.5), makeScore(b, 0.8), makeScore(c, 1.9)]
    const result = applyTurnPolicy(input({ scores, roomType: 'conference' }))
    const speakerIds = result.speakers.map(s => s.agent.personaId)
    expect(speakerIds).toContain('a')
    expect(speakerIds).toContain('c')
    expect(speakerIds).not.toContain('b')
    expect(result.silenced.map(s => s.agent.personaId)).toContain('b')
  })
})
