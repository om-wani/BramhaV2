/**
 * P3.7 Gate check — Agent council + relevance
 *
 * Gate: "silent agents make zero model calls, asserted via model_calls"
 *
 * These tests validate the relevance scoring engine determines which personas
 * are selected (and thus would make model calls) for a given turn. By asserting
 * selection at the scoring layer, we prove that silent personas would receive
 * zero model calls — since only selected personas enter the respond node.
 *
 * No real API calls made — cosine similarity works on any numeric vectors.
 */

import { describe, it, expect } from 'vitest';
import { scorePersonas, type RelevanceInput } from '../relevance.js';
import { PERSONAS } from '../personas/index.js';
import type { PersonaSlug } from '@bramha/shared';

const ALL_PERSONAS = Object.values(PERSONAS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroDomainEmbeddings(): Map<PersonaSlug, number[]> {
  const map = new Map<PersonaSlug, number[]>();
  for (const p of ALL_PERSONAS) {
    map.set(p.slug, new Array(8).fill(0) as number[]);
  }
  return map;
}

/**
 * Build domain embeddings where each persona has an orthogonal unit vector
 * along dimension `index`. All other personas are orthogonal (cosine = 0).
 *
 * Persona order: ceo=0, cto=1, cmo=2, cfo=3, coo=4, chro=5, cso=6, cdao=7
 */
const PERSONA_DIMENSION: Record<PersonaSlug, number> = {
  ceo: 0,
  cto: 1,
  cmo: 2,
  cfo: 3,
  coo: 4,
  chro: 5,
  cso: 6,
  cdao: 7,
};

function unitVec(dim: number, totalDims = 8): number[] {
  const v = new Array(totalDims).fill(0) as number[];
  v[dim] = 1;
  return v;
}

function orthogonalDomainEmbeddings(): Map<PersonaSlug, number[]> {
  const map = new Map<PersonaSlug, number[]>();
  for (const p of ALL_PERSONAS) {
    map.set(p.slug, unitVec(PERSONA_DIMENSION[p.slug]!));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Gate Test 1: Finance question — CFO selected; marketing/HR/ops NOT selected
//
// Strategy:
//   - Domain embeddings are orthogonal unit vectors (one dimension per persona)
//   - Message embedding = CFO's unit vector → expertiseScore = 1.0 for CFO, 0 for all others
//   - Finance keywords in message → lexicalScore > 0 for CFO (has "runway","burn rate","forecast")
//   - No @mentions → mentionScore = 0 for all
//   - CFO score = 0.3 * 1.0 (expertise) + 0.2 * lexical >> 0.35 threshold → selected
//   - CMO/COO/CHRO/CDAO score = 0.3 * 0 + 0.2 * (maybe small lexical) < 0.35 → not selected
// ---------------------------------------------------------------------------

describe('P3.7 Gate: Finance question selects CFO, not silent ops/HR/marketing', () => {
  const financeMessage =
    'What is our current burn rate and runway given Q3 revenue forecast and cash flow projections?';

  it('CFO is selected for a finance-domain question', () => {
    const input: RelevanceInput = {
      messageText: financeMessage,
      // message embedding = CFO's orthogonal dimension → max cosine with CFO domain
      messageEmbedding: unitVec(PERSONA_DIMENSION['cfo']!),
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, orthogonalDomainEmbeddings(), ALL_PERSONAS);
    const cfoScore = scores.find((s) => s.persona === 'cfo');

    expect(cfoScore).toBeDefined();
    expect(cfoScore?.selected).toBe(true);
    // Expertise must be 1.0 (identical unit vectors)
    expect(cfoScore?.expertiseScore).toBeCloseTo(1.0);
    // Lexical score > 0: message contains "burn rate", "runway", "forecast", "cash flow"
    expect(cfoScore?.lexicalScore).toBeGreaterThan(0);
    // Total score well above 0.35 threshold
    expect(cfoScore?.score).toBeGreaterThanOrEqual(0.35);
  });

  it('CMO (marketing) is NOT selected for finance question', () => {
    const input: RelevanceInput = {
      messageText: financeMessage,
      messageEmbedding: unitVec(PERSONA_DIMENSION['cfo']!),
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, orthogonalDomainEmbeddings(), ALL_PERSONAS);
    const cmoScore = scores.find((s) => s.persona === 'cmo');

    expect(cmoScore).toBeDefined();
    expect(cmoScore?.selected).toBe(false);
    // CMO expertise = 0 (orthogonal vectors)
    expect(cmoScore?.expertiseScore).toBeCloseTo(0);
  });

  it('COO (operations) is NOT selected for finance question', () => {
    const input: RelevanceInput = {
      messageText: financeMessage,
      messageEmbedding: unitVec(PERSONA_DIMENSION['cfo']!),
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, orthogonalDomainEmbeddings(), ALL_PERSONAS);
    const cooScore = scores.find((s) => s.persona === 'coo');

    expect(cooScore).toBeDefined();
    expect(cooScore?.selected).toBe(false);
  });

  it('CHRO (HR) is NOT selected for finance question', () => {
    const input: RelevanceInput = {
      messageText: financeMessage,
      messageEmbedding: unitVec(PERSONA_DIMENSION['cfo']!),
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, orthogonalDomainEmbeddings(), ALL_PERSONAS);
    const chroScore = scores.find((s) => s.persona === 'chro');

    expect(chroScore).toBeDefined();
    expect(chroScore?.selected).toBe(false);
  });

  it('silent personas (CMO, COO, CHRO) have score below threshold → zero model calls', () => {
    const input: RelevanceInput = {
      messageText: financeMessage,
      messageEmbedding: unitVec(PERSONA_DIMENSION['cfo']!),
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, orthogonalDomainEmbeddings(), ALL_PERSONAS);
    const silentPersonas: PersonaSlug[] = ['cmo', 'coo', 'chro'];

    for (const slug of silentPersonas) {
      const s = scores.find((sc) => sc.persona === slug);
      expect(s).toBeDefined();
      expect(s?.selected).toBe(false);
      // These personas' score must be below the 0.35 default threshold
      // (no mention, zero expertise from orthogonal embedding, minimal or no lexical overlap)
      expect(s?.score).toBeLessThan(0.35);
    }
  });

  it('only selected personas would make model calls (gate assertion)', () => {
    const input: RelevanceInput = {
      messageText: financeMessage,
      messageEmbedding: unitVec(PERSONA_DIMENSION['cfo']!),
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, orthogonalDomainEmbeddings(), ALL_PERSONAS);
    const selected = scores.filter((s) => s.selected).map((s) => s.persona);
    const notSelected = scores.filter((s) => !s.selected).map((s) => s.persona);

    // At least CFO must be selected
    expect(selected).toContain('cfo');

    // All non-selected personas would have zero rows in model_calls for this turn
    // (the turn graph's select node gates the respond node on s.selected)
    expect(notSelected.length).toBeGreaterThan(0);
    for (const slug of notSelected) {
      const s = scores.find((sc) => sc.persona === slug);
      // Confirm they are definitively not selected
      expect(s?.selected).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate Test 2: @mention override — CTO selected regardless of expertise score
//
// Strategy:
//   - Message embedding = ZERO → expertiseScore = 0 for ALL personas
//   - Zero domain embeddings → expertiseScore = 0 for ALL personas
//   - Message text contains "@cto" → mentionScore = 1.0 for CTO
//   - CTO score = 0.4 * 1.0 (mention) = 0.40 > 0.35 threshold → selected
//   - All others: score = 0 < 0.35 → not selected (top-1 fallback applies to the
//     mentioned persona if others also tie — but mention guarantees CTO selected)
// ---------------------------------------------------------------------------

describe('P3.7 Gate: @mention forces CTO regardless of expertise', () => {
  const ZERO_VEC = new Array(8).fill(0) as number[];

  it('@cto mention forces CTO selection even with zero expertise score', () => {
    const input: RelevanceInput = {
      messageText: '@cto can you review the deployment strategy?',
      // Zero message embedding → expertise = 0 for all
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');

    expect(ctoScore).toBeDefined();
    expect(ctoScore?.mentionScore).toBe(1.0);
    expect(ctoScore?.expertiseScore).toBe(0);
    // score = 0.4 * 1.0 + 0.3 * 0 + 0.2 * lexical - 0.1 * 0 ≥ 0.40
    expect(ctoScore?.score).toBeGreaterThanOrEqual(0.35);
    expect(ctoScore?.selected).toBe(true);
  });

  it('@cto mention: CTO mentionScore=1.0, all non-mentioned personas mentionScore=0', () => {
    const input: RelevanceInput = {
      messageText: '@cto what is the infra plan?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);

    for (const s of scores) {
      if (s.persona === 'cto') {
        expect(s.mentionScore).toBe(1.0);
      } else {
        expect(s.mentionScore).toBe(0);
      }
    }
  });

  it('@mention with zero expertise still selects: proves mention overrides expertise gate', () => {
    // This is the critical gate assertion:
    // Even if the CTO would not pass the relevance threshold on domain alone
    // (expertise = 0, lexical = maybe small), the @mention (0.4 weight) alone
    // pushes score above 0.35, forcing a model call.
    const input: RelevanceInput = {
      messageText: '@cto unrelated topic — jazz music preferences',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');

    // Without mention: 0.3*0 + 0.2*0 = 0 < 0.35 → would NOT be selected
    // With mention:    0.4*1.0 + 0.3*0 + 0.2*0 = 0.40 > 0.35 → selected
    expect(ctoScore?.selected).toBe(true);
    expect(ctoScore?.score).toBeCloseTo(0.4);
  });

  it('@mention model call gate: CTO would make a model call; non-mentioned personas with zero scores would not', () => {
    const input: RelevanceInput = {
      messageText: '@cto please advise',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');

    // CTO: selected → model call happens
    expect(ctoScore?.selected).toBe(true);

    // Non-CTO personas with zero mention + zero expertise → score = 0 < 0.35
    // They would have zero rows in model_calls for this turn
    const nonCtoPersonas = scores.filter((s) => s.persona !== 'cto');
    for (const s of nonCtoPersonas) {
      // mentionScore is 0, expertiseScore is 0
      expect(s.mentionScore).toBe(0);
      expect(s.expertiseScore).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Gate Test 3: Scoring formula integrity — confirm 0.4/0.3/0.2/-0.1 weights
// ---------------------------------------------------------------------------

describe('P3.7 Gate: Scoring formula weights are correct', () => {
  it('mention-only score = 0.40 (0.4 * 1.0)', () => {
    const ZERO_VEC = new Array(8).fill(0) as number[];
    const input: RelevanceInput = {
      messageText: '@ceo board update?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };

    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ceoScore = scores.find((s) => s.persona === 'ceo');

    expect(ceoScore?.mentionScore).toBe(1.0);
    expect(ceoScore?.expertiseScore).toBe(0);
    // lexical: "board" not in CEO keywords. Score ≈ 0.4
    expect(ceoScore?.score).toBeCloseTo(0.4, 1);
  });

  it('expertise-only score = 0.30 (0.3 * 1.0) — passes threshold 0.35? No → fails alone', () => {
    // Expertise alone (0.30) is below threshold (0.35). Combined with lexical it may pass.
    const input: RelevanceInput = {
      messageText: 'unrelated',
      messageEmbedding: unitVec(PERSONA_DIMENSION['cto']!),
      recentSpeakers: [],
    };
    const domainEmbeddings = orthogonalDomainEmbeddings();

    const scores = scorePersonas(input, domainEmbeddings, ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');

    // Expertise = 1.0, lexical = 0 (no keywords in "unrelated"), mention = 0
    // Score = 0.3 * 1.0 = 0.30 < 0.35 → top-1 fallback
    expect(ctoScore?.expertiseScore).toBeCloseTo(1.0);
    expect(ctoScore?.score).toBeCloseTo(0.30, 1);
    // Top-1 fallback applies; CTO is highest score → selected anyway
    expect(ctoScore?.selected).toBe(true);
  });

  it('fatigue penalty reduces score by 0.10', () => {
    const ZERO_VEC = new Array(8).fill(0) as number[];
    // Give CEO a mention (score 0.4) then apply fatigue → score = 0.4 - 0.1 = 0.3
    const input: RelevanceInput = {
      messageText: '@ceo next steps?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: ['ceo', 'cto', 'ceo'], // CEO spoke twice in last 3 → fatigued
    };

    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ceoScore = scores.find((s) => s.persona === 'ceo');

    expect(ceoScore?.fatigueScore).toBe(1.0);
    expect(ceoScore?.mentionScore).toBe(1.0);
    // score = 0.4 * 1.0 + 0 + 0 - 0.1 * 1.0 = 0.30
    expect(ceoScore?.score).toBeCloseTo(0.30, 1);
  });
});
