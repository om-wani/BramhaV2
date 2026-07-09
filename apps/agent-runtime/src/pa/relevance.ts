/**
 * Relevance scorer — decides WHO speaks next in a conversation turn.
 *
 * Formula (04_agent_orchestration_spec.md §2.1):
 *   score = w_m·mention + w_e·expertise + w_l·lexical + w_t·threadOwnership
 *         + w_o·openLoop − w_r·recencyFatigue + ε (jitter)
 *
 * Security: all text inputs are capped at 8192 chars before processing.
 * Tokenisation uses a simple \W+ split — linear time, no catastrophic backtracking.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ScoringAgent {
  personaId: string
  slug: string
  name: string
  expertiseTags: string[]       // e.g. ['finance', 'pricing', 'budgeting']
  expertiseCentroid: number[]   // pre-computed mean embedding (may be [] if unavailable)
  speakProfile: {
    eagerness: number           // added to score in turn-policy (room-specific)
    interruptThreshold: number
    silenceBias: number         // subtracted in conference rooms (room-specific)
  }
}

export interface ScoringNode {
  nodeId: string
  text: string                  // message text (first 8192 chars used)
  type: string                  // 'user_message' | 'agent_message' | 'summon' | etc.
  authorPersonaId: string | null
  embedding: number[]           // may be [] if not embedded yet
}

export interface ScoringContext {
  node: ScoringNode              // the trigger node
  recentAncestors: ScoringNode[] // last k=6 nodes on branch (for ownership / fatigue)
  openLoopsPerAgent: Record<string, string[]>  // personaId → open loop texts
  weights?: Partial<ScoreWeights>              // per-project overrides
}

export interface ScoreWeights {
  w_m: number   // mention weight       (default 10)
  w_e: number   // expertise weight     (default 2.0)
  w_l: number   // lexical weight       (default 1.0)
  w_t: number   // thread ownership     (default 1.0)
  w_o: number   // open loop            (default 1.5)
  w_r: number   // recency fatigue      (default 1.2)
}

export interface AgentScore {
  agent: ScoringAgent
  score: number
  breakdown: {
    mention: number
    expertise: number
    lexical: number
    threadOwnership: number
    openLoop: number
    recencyFatigue: number
    eagerness: number   // always 0 here — eagerness is applied by turn-policy
    jitter: number
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Default weights
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: ScoreWeights = {
  w_m: 10,
  w_e: 2.0,
  w_l: 1.0,
  w_t: 1.0,
  w_o: 1.5,
  w_r: 1.2,
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const TEXT_CAP = 8192          // max chars examined for DoS safety
const BM25_K1 = 1.5
const BM25_B = 0.75
const BM25_AVG_DOC_LEN = 100  // reasonable default for message text
const THREAD_OWNERSHIP_LOOKBACK = 6
const FATIGUE_LOOKBACK = 2
const OWNERSHIP_BONUS = 0.3
const OPEN_LOOP_BONUS = 0.4
const FATIGUE_PENALTY = 1.0   // multiplied by w_r in the formula
const JITTER_MAX = 0.05

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Linear-time tokeniser — split on non-word chars, lowercase, drop empties. */
function tokenise(text: string): string[] {
  const capped = text.length > TEXT_CAP ? text.slice(0, TEXT_CAP) : text
  return capped.toLowerCase().split(/\W+/).filter(Boolean)
}

/** Cosine similarity between two vectors. Returns 0 if either is empty or zero-norm. */
function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
     
    const ai = a[i]!, bi = b[i]!
    dot += ai * bi
    na += ai * ai
    nb += bi * bi
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * DJB2 hash → deterministic jitter in [0, JITTER_MAX].
 * Pure integer arithmetic — no regex, no allocation beyond the input string.
 */
function jitter(nodeId: string, personaId: string): number {
  const key = `${nodeId}:${personaId}`
  let h = 5381
  for (let i = 0; i < key.length; i++) {
    // djb2: h = h * 33 ^ c  (keep in 32-bit signed range)
    h = ((h << 5) + h) ^ key.charCodeAt(i)
    h = h | 0  // force 32-bit signed
  }
  // Map to [0, JITTER_MAX]
  return ((Math.abs(h) % 1000) / 1000) * JITTER_MAX
}

// ──────────────────────────────────────────────────────────────────────────────
// Component scorers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * mention — 1.0 if @mentioned by slug or name (case-insensitive), or summon node.
 * Only examines first TEXT_CAP chars.
 */
function scoreMention(node: ScoringNode, agent: ScoringAgent): number {
  const text = (node.text.length > TEXT_CAP ? node.text.slice(0, TEXT_CAP) : node.text).toLowerCase()
  const slugPattern = `@${agent.slug.toLowerCase()}`
  const namePattern = `@${agent.name.toLowerCase()}`

  if (text.includes(slugPattern) || text.includes(namePattern)) return 1.0
  if (node.type === 'summon' && text.includes(agent.slug.toLowerCase())) return 1.0
  return 0
}

/**
 * expertise — cosine similarity between node embedding and agent centroid.
 */
function scoreExpertise(node: ScoringNode, agent: ScoringAgent): number {
  return cosine(node.embedding, agent.expertiseCentroid)
}

/**
 * lexical — BM25 of node text against agent expertise tags as query terms.
 *
 * "Document" = node text tokens.
 * "Query"    = agent.expertiseTags (each tag is one term).
 * Returns score normalised by number of query terms so the scale stays ~0-1.
 */
function scoreLexical(node: ScoringNode, agent: ScoringAgent): number {
  if (agent.expertiseTags.length === 0) return 0

  const docTokens = tokenise(node.text)
  if (docTokens.length === 0) return 0

  // Term-frequency map for the document
  const tf = new Map<string, number>()
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1)

  const docLen = docTokens.length
  const lenNorm = 1 - BM25_B + BM25_B * (docLen / BM25_AVG_DOC_LEN)

  // Each expertise tag is treated as a query term; IDF = 1 (single-doc corpus)
  let total = 0
  for (const tag of agent.expertiseTags) {
    const term = tag.toLowerCase()
    const freq = tf.get(term) ?? 0
    if (freq === 0) continue
    const tfBm25 = (freq * (BM25_K1 + 1)) / (freq + BM25_K1 * lenNorm)
    // IDF = 1.0 (no document collection to compute against)
    total += tfBm25
  }

  return total / agent.expertiseTags.length
}

/**
 * thread_ownership — 0.3 if agent authored any of the last k=6 nodes.
 */
function scoreThreadOwnership(agent: ScoringAgent, recentAncestors: ScoringNode[]): number {
  const lookback = recentAncestors.slice(0, THREAD_OWNERSHIP_LOOKBACK)
  return lookback.some(n => n.authorPersonaId === agent.personaId) ? OWNERSHIP_BONUS : 0
}

/**
 * open_loop — 0.4 if this agent has any pending open loops.
 */
function scoreOpenLoop(agent: ScoringAgent, openLoopsPerAgent: Record<string, string[]>): number {
  const loops = openLoopsPerAgent[agent.personaId] ?? []
  return loops.length > 0 ? OPEN_LOOP_BONUS : 0
}

/**
 * recency_fatigue — 1.0 (× w_r) if agent spoke in the last 2 nodes.
 */
function scoreRecencyFatigue(agent: ScoringAgent, recentAncestors: ScoringNode[]): number {
  const lookback = recentAncestors.slice(0, FATIGUE_LOOKBACK)
  return lookback.some(n => n.authorPersonaId === agent.personaId) ? FATIGUE_PENALTY : 0
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Score all agents against the trigger node and context.
 * Returns array sorted by score descending.
 * Eagerness is NOT applied here — it is room-policy-specific (see turn-policies.ts).
 */
export function scoreAgents(agents: ScoringAgent[], ctx: ScoringContext): AgentScore[] {
  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS, ...ctx.weights }
  const { node, recentAncestors, openLoopsPerAgent } = ctx

  const scores: AgentScore[] = agents.map(agent => {
    const mention       = scoreMention(node, agent)
    const expertise     = scoreExpertise(node, agent)
    const lexical       = scoreLexical(node, agent)
    const threadOwnership = scoreThreadOwnership(agent, recentAncestors)
    const openLoop      = scoreOpenLoop(agent, openLoopsPerAgent)
    const recencyFatigue = scoreRecencyFatigue(agent, recentAncestors)
    const eps           = jitter(node.nodeId, agent.personaId)

    const score =
      weights.w_m * mention
      + weights.w_e * expertise
      + weights.w_l * lexical
      + weights.w_t * threadOwnership
      + weights.w_o * openLoop
      - weights.w_r * recencyFatigue
      + eps

    return {
      agent,
      score,
      breakdown: {
        mention,
        expertise,
        lexical,
        threadOwnership,
        openLoop,
        recencyFatigue,
        eagerness: 0,   // applied by turn-policy
        jitter: eps,
      },
    }
  })

  return scores.sort((a, b) => b.score - a.score)
}
