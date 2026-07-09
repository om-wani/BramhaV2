import { describe, it, expect } from 'vitest'
import { scoreAgents } from './relevance.js'
import type { ScoringAgent, ScoringNode, ScoringContext } from './relevance.js'

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<ScoringAgent> = {}): ScoringAgent {
  return {
    personaId: 'persona-cfo',
    slug: 'ledger',
    name: 'Ledger',
    expertiseTags: ['finance', 'pricing', 'budgeting'],
    expertiseCentroid: [],
    speakProfile: { eagerness: 0, interruptThreshold: 1.4, silenceBias: 0 },
    ...overrides,
  }
}

function makeNode(overrides: Partial<ScoringNode> = {}): ScoringNode {
  return {
    nodeId: 'node-1',
    text: 'Hello world',
    type: 'user_message',
    authorPersonaId: null,
    embedding: [],
    ...overrides,
  }
}

function makeCtx(
  node: ScoringNode,
  overrides: Partial<ScoringContext> = {},
): ScoringContext {
  return {
    node,
    recentAncestors: [],
    openLoopsPerAgent: {},
    ...overrides,
  }
}

// Pre-computed 3-D unit vectors for cosine similarity tests
const VEC_A = [1, 0, 0] as number[]
const VEC_B = [0, 1, 0] as number[]
const VEC_DIAG = [0.707, 0.707, 0] as number[]  // ~45° between A and B

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Mention by @slug dominates (w_m=10 beats everything else)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 1 — mention by @slug beats all', () => {
  it('agent with @slug mention has score ≥ 10', () => {
    const cfo = makeAgent()
    const cto = makeAgent({ personaId: 'persona-cto', slug: 'nexus', name: 'Nexus', expertiseTags: ['tech'] })
    const node = makeNode({ text: 'Hey @ledger can you review the budget?' })
    const results = scoreAgents([cfo, cto], makeCtx(node))
    const cfoScore = results.find(r => r.agent.personaId === 'persona-cfo')!
    const ctoScore = results.find(r => r.agent.personaId === 'persona-cto')!
    expect(cfoScore.score).toBeGreaterThanOrEqual(10)
    expect(cfoScore.score).toBeGreaterThan(ctoScore.score)
    expect(cfoScore.breakdown.mention).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Mention by @name (case-insensitive)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 2 — mention by @name (case-insensitive)', () => {
  it('@LEDGER matches agent named Ledger', () => {
    const cfo = makeAgent()
    const node = makeNode({ text: 'Please ask @LEDGER about this.' })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.mention).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 3 — No mention → mention component is 0
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 3 — no mention', () => {
  it('mention=0 when agent not mentioned', () => {
    const cfo = makeAgent()
    const node = makeNode({ text: 'What is the weather today?' })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.mention).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 4 — Summon node type activates mention
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 4 — summon node type', () => {
  it('summon node with slug in text → mention=1', () => {
    const cfo = makeAgent()
    const node = makeNode({ type: 'summon', text: 'ledger please handle this task' })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.mention).toBe(1)
  })

  it('summon node without slug in text → mention=0', () => {
    const cfo = makeAgent()
    const node = makeNode({ type: 'summon', text: 'nexus handle this task' })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.mention).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 5 — CFO wakes on "pricing" (lexical BM25)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 5 — CFO (Ledger) wakes on "pricing"', () => {
  it('CFO has higher lexical score than CTO for pricing message', () => {
    const cfo = makeAgent()
    const cto = makeAgent({
      personaId: 'persona-cto',
      slug: 'nexus',
      name: 'Nexus',
      expertiseTags: ['technology', 'engineering'],
    })
    const node = makeNode({ text: 'We need to reconsider our pricing strategy for Q4' })
    const results = scoreAgents([cfo, cto], makeCtx(node))
    const cfoLexical = results.find(r => r.agent.personaId === 'persona-cfo')!.breakdown.lexical
    const ctoLexical = results.find(r => r.agent.personaId === 'persona-cto')!.breakdown.lexical
    expect(cfoLexical).toBeGreaterThan(0)
    expect(cfoLexical).toBeGreaterThan(ctoLexical)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 6 — Fatigue suppresses double-reply (last 2 nodes)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 6 — recency fatigue penalty', () => {
  it('agent who spoke in last 2 nodes gets fatigue penalty', () => {
    const cfo = makeAgent()
    const ancestor = makeNode({ nodeId: 'node-prev', authorPersonaId: 'persona-cfo' })
    const node = makeNode({ nodeId: 'node-2' })
    const ctx = makeCtx(node, { recentAncestors: [ancestor] })
    const result = scoreAgents([cfo], ctx)[0]!
    expect(result.breakdown.recencyFatigue).toBe(1)
    // Penalty applied: score reduced by w_r * 1.0 = 1.2
    expect(result.score).toBeLessThan(0 + result.breakdown.jitter)
  })

  it('agent who did NOT speak recently has no fatigue', () => {
    const cfo = makeAgent()
    const node = makeNode()
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.recencyFatigue).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 7 — Ownership bonus (last 3-6 nodes, not 1-2)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 7 — thread ownership bonus', () => {
  it('agent who spoke in nodes 3-6 of ancestors gets ownership but no fatigue', () => {
    const cfo = makeAgent()
    // Slots: [0]=most-recent, [1]=second-most-recent, [2]=third = idx 2 (position 3)
    const recent: ScoringNode[] = [
      makeNode({ nodeId: 'n0', authorPersonaId: 'persona-cto' }),
      makeNode({ nodeId: 'n1', authorPersonaId: 'persona-cto' }),
      makeNode({ nodeId: 'n2', authorPersonaId: 'persona-cfo' }),  // position 3 ← ownership
    ]
    const node = makeNode({ nodeId: 'trigger' })
    const result = scoreAgents([cfo], makeCtx(node, { recentAncestors: recent }))[0]!
    expect(result.breakdown.threadOwnership).toBe(0.3)
    expect(result.breakdown.recencyFatigue).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 8 — Open loop bonus
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 8 — open loop bonus', () => {
  it('agent with open loops scores higher', () => {
    const cfo = makeAgent()
    const node = makeNode()
    const with_ = scoreAgents([cfo], makeCtx(node, { openLoopsPerAgent: { 'persona-cfo': ['pending budget review'] } }))[0]!
    const without = scoreAgents([cfo], makeCtx(node, { openLoopsPerAgent: {} }))[0]!
    expect(with_.breakdown.openLoop).toBe(0.4)
    expect(without.breakdown.openLoop).toBe(0)
    expect(with_.score).toBeGreaterThan(without.score)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 9 — No embeddings → expertise=0
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 9 — no embeddings → expertise=0', () => {
  it('empty centroid → expertise component = 0', () => {
    const cfo = makeAgent({ expertiseCentroid: [] })
    const node = makeNode({ embedding: [1, 0, 0] })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.expertise).toBe(0)
  })

  it('empty node embedding → expertise component = 0', () => {
    const cfo = makeAgent({ expertiseCentroid: [1, 0, 0] })
    const node = makeNode({ embedding: [] })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.expertise).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 10 — Expertise cosine similarity
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 10 — expertise cosine similarity', () => {
  it('orthogonal vectors → expertise=0', () => {
    const cfo = makeAgent({ expertiseCentroid: VEC_A })
    const node = makeNode({ embedding: VEC_B })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.expertise).toBeCloseTo(0, 5)
  })

  it('same direction → expertise≈1', () => {
    const cfo = makeAgent({ expertiseCentroid: VEC_A })
    const node = makeNode({ embedding: VEC_A })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.expertise).toBeCloseTo(1, 5)
  })

  it('diagonal vector → expertise≈0.707', () => {
    const cfo = makeAgent({ expertiseCentroid: VEC_A })
    const node = makeNode({ embedding: VEC_DIAG })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.expertise).toBeCloseTo(0.707, 2)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 11 — BM25: matching tags score higher
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 11 — BM25 lexical scoring', () => {
  it('agent with matching expertise tags scores higher than agent with none', () => {
    const cfo = makeAgent({ expertiseTags: ['finance', 'pricing'] })
    const hr  = makeAgent({ personaId: 'persona-hr', slug: 'pulse', name: 'Pulse', expertiseTags: ['hiring', 'culture'] })
    const node = makeNode({ text: 'We need to fix our pricing before the next finance review' })
    const results = scoreAgents([cfo, hr], makeCtx(node))
    const cfoL = results.find(r => r.agent.personaId === 'persona-cfo')!.breakdown.lexical
    const hrL  = results.find(r => r.agent.personaId === 'persona-hr')!.breakdown.lexical
    expect(cfoL).toBeGreaterThan(hrL)
  })

  it('empty node text → lexical=0', () => {
    const cfo = makeAgent()
    const node = makeNode({ text: '' })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.lexical).toBe(0)
  })

  it('agent with empty expertiseTags → lexical=0', () => {
    const agent = makeAgent({ expertiseTags: [] })
    const node = makeNode({ text: 'budget finance pricing strategy' })
    const result = scoreAgents([agent], makeCtx(node))[0]!
    expect(result.breakdown.lexical).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 12 — Jitter is deterministic
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 12 — jitter determinism', () => {
  it('same nodeId + personaId → same jitter across two runs', () => {
    const cfo = makeAgent()
    const node = makeNode({ nodeId: 'fixed-node' })
    const r1 = scoreAgents([cfo], makeCtx(node))[0]!
    const r2 = scoreAgents([cfo], makeCtx(node))[0]!
    expect(r1.breakdown.jitter).toBe(r2.breakdown.jitter)
  })

  it('different personaIds → different jitter', () => {
    const a1 = makeAgent({ personaId: 'persona-cfo' })
    const a2 = makeAgent({ personaId: 'persona-cto', slug: 'nexus', name: 'Nexus' })
    const node = makeNode({ nodeId: 'fixed-node' })
    const results = scoreAgents([a1, a2], makeCtx(node))
    const j1 = results.find(r => r.agent.personaId === 'persona-cfo')!.breakdown.jitter
    const j2 = results.find(r => r.agent.personaId === 'persona-cto')!.breakdown.jitter
    expect(j1).not.toBe(j2)
  })

  it('jitter is in [0, 0.05]', () => {
    const cfo = makeAgent()
    const node = makeNode({ nodeId: 'any-node' })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.jitter).toBeGreaterThanOrEqual(0)
    expect(result.breakdown.jitter).toBeLessThanOrEqual(0.05)
  })

  it('jitter breaks ties: two identical agents → different scores', () => {
    const a1 = makeAgent({ personaId: 'p1', slug: 's1', name: 'A' })
    const a2 = makeAgent({ personaId: 'p2', slug: 's2', name: 'B' })
    const node = makeNode({ nodeId: 'tie-breaker-node' })
    const results = scoreAgents([a1, a2], makeCtx(node))
    expect(results[0]!.score).not.toBe(results[1]!.score)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 13 — Results sorted descending
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 13 — scoreAgents returns sorted desc', () => {
  it('results are in descending score order', () => {
    const cfo = makeAgent()
    const cto = makeAgent({ personaId: 'persona-cto', slug: 'nexus', name: 'Nexus', expertiseTags: ['tech'] })
    const node = makeNode({ text: '@ledger please check the budget finance pricing' })
    const results = scoreAgents([cto, cfo], makeCtx(node))
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 14 — Empty agent list
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 14 — empty agent list', () => {
  it('returns empty array for no agents', () => {
    const node = makeNode()
    const results = scoreAgents([], makeCtx(node))
    expect(results).toHaveLength(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 15 — Weight override: w_m=0 → mention has no effect
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 15 — weight override w_m=0', () => {
  it('mention does not boost score when w_m=0', () => {
    const cfo = makeAgent()
    const node = makeNode({ text: '@ledger check this out' })
    const withMention   = scoreAgents([cfo], makeCtx(node))[0]!
    const withoutWeight = scoreAgents([cfo], makeCtx(node, { weights: { w_m: 0 } }))[0]!
    expect(withMention.breakdown.mention).toBe(1)
    expect(withoutWeight.score).toBeLessThan(withMention.score)
    // The mention component contributes 0 * 1 = 0
    expect(withoutWeight.score).toBeCloseTo(
      withoutWeight.breakdown.lexical * 1.0
      + withoutWeight.breakdown.jitter,
      3,
    )
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 16 — Partial weight override: only w_e changes
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 16 — partial weight override', () => {
  it('only w_e changes, others stay at defaults', () => {
    const cfo = makeAgent({ expertiseCentroid: VEC_A })
    const node = makeNode({ embedding: VEC_A })  // expertise=1, so w_e multiplier matters
    const default_ = scoreAgents([cfo], makeCtx(node))[0]!
    const override  = scoreAgents([cfo], makeCtx(node, { weights: { w_e: 5.0 } }))[0]!
    // Default w_e=2.0; override w_e=5.0; expertise=1.0 → difference should be (5-2)*1 = 3
    expect(override.score - default_.score).toBeCloseTo(3.0, 5)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 17 — Eagerness NOT applied in scoreAgents (always 0)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 17 — eagerness is 0 in scorer', () => {
  it('breakdown.eagerness is always 0 from scoreAgents', () => {
    const cfo = makeAgent({ speakProfile: { eagerness: 5, interruptThreshold: 1.4, silenceBias: 0.2 } })
    const node = makeNode()
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.eagerness).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 18 — Input length cap (security)
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 18 — input length cap', () => {
  it('mention only checked in first 8192 chars', () => {
    const cfo = makeAgent()
    // Pad well past 8192 chars, then put @ledger at the very end
    const prefix = 'a'.repeat(9000)
    const node = makeNode({ text: prefix + ' @ledger' })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    // @ledger is beyond the cap → mention should be 0
    expect(result.breakdown.mention).toBe(0)
  })

  it('mention found within first 8192 chars is detected', () => {
    const cfo = makeAgent()
    const text = '@ledger ' + 'b'.repeat(9000)
    const node = makeNode({ text })
    const result = scoreAgents([cfo], makeCtx(node))[0]!
    expect(result.breakdown.mention).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 19 — Multiple agents, one mentioned: only the mentioned one gets boost
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 19 — multiple agents, one mentioned', () => {
  it('only the @mentioned agent gets w_m boost', () => {
    const cfo = makeAgent()
    const cto = makeAgent({ personaId: 'persona-cto', slug: 'nexus', name: 'Nexus', expertiseTags: [] })
    const cmo = makeAgent({ personaId: 'persona-cmo', slug: 'brand', name: 'Brand', expertiseTags: [] })
    const node = makeNode({ text: '@ledger what is the budget for this quarter?' })
    const results = scoreAgents([cfo, cto, cmo], makeCtx(node))
    const cfoR = results.find(r => r.agent.personaId === 'persona-cfo')!
    const ctoR = results.find(r => r.agent.personaId === 'persona-cto')!
    const cmoR = results.find(r => r.agent.personaId === 'persona-cmo')!
    expect(cfoR.breakdown.mention).toBe(1)
    expect(ctoR.breakdown.mention).toBe(0)
    expect(cmoR.breakdown.mention).toBe(0)
    expect(cfoR.score).toBeGreaterThan(ctoR.score)
    expect(cfoR.score).toBeGreaterThan(cmoR.score)
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Scenario 20 — All components combined correctly
// ──────────────────────────────────────────────────────────────────────────────
describe('Scenario 20 — composite score sanity check', () => {
  it('score equals weighted sum of components', () => {
    const cfo = makeAgent({ expertiseCentroid: VEC_A })
    const ancestor = makeNode({ nodeId: 'anc-1', authorPersonaId: 'persona-cfo' })
    const node = makeNode({ nodeId: 'trigger', text: 'pricing budget', embedding: VEC_A })
    const ctx = makeCtx(node, {
      recentAncestors: [ancestor],
      openLoopsPerAgent: { 'persona-cfo': ['pending item'] },
    })
    const result = scoreAgents([cfo], ctx)[0]!
    const b = result.breakdown
    // recencyFatigue = 1 (ancestor[0] is persona-cfo)
    // ownership = 0.3 (ancestor[0] is persona-cfo, within last 6)
    const expected =
      10 * b.mention
      + 2.0 * b.expertise
      + 1.0 * b.lexical
      + 1.0 * b.threadOwnership
      + 1.5 * b.openLoop
      - 1.2 * b.recencyFatigue
      + b.jitter
    expect(result.score).toBeCloseTo(expected, 10)
  })
})
