import { describe, it, expect } from 'vitest';
import {
  scorePersonas,
  cosineSimilarity,
  type RelevanceInput,
} from '../relevance.js';
import { PERSONAS } from '../personas/index.js';
import type { PersonaSlug } from '@bramha/shared';

const ALL_PERSONAS = Object.values(PERSONAS);

// Zero vector for tests that don't need real embeddings
const ZERO_VEC: number[] = new Array(8).fill(0) as number[];

// Build a zero domain embeddings map
function zeroDomainEmbeddings(): Map<PersonaSlug, number[]> {
  const map = new Map<PersonaSlug, number[]>();
  for (const p of ALL_PERSONAS) {
    map.set(p.slug, ZERO_VEC);
  }
  return map;
}

describe('cosineSimilarity', () => {
  it('identical vectors → 1', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
  });

  it('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('empty vector → 0 (no crash)', () => {
    expect(cosineSimilarity([], [1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('zero vector → 0 (no crash)', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('scorePersonas', () => {
  it('@cto mention → cto gets mentionScore 1.0', () => {
    const input: RelevanceInput = {
      messageText: 'Hey @cto what do you think about scalability?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');
    expect(ctoScore).toBeDefined();
    expect(ctoScore?.mentionScore).toBe(1.0);
  });

  it('@Vulcan name mention → cto gets mentionScore 1.0', () => {
    const input: RelevanceInput = {
      messageText: '@Vulcan can you review the architecture?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');
    expect(ctoScore?.mentionScore).toBe(1.0);
  });

  it('bare title "ask the CFO" → cfo gets mentionScore 1.0', () => {
    const input: RelevanceInput = {
      messageText: "Let's ask the CFO about our runway.",
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const cfoScore = scores.find((s) => s.persona === 'cfo');
    expect(cfoScore?.mentionScore).toBe(1.0);
  });

  it('zero vector expertise → expertiseScore 0 (no crash)', () => {
    const input: RelevanceInput = {
      messageText: 'Generic message',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    for (const s of scores) {
      expect(s.expertiseScore).toBe(0);
    }
  });

  it('fatigue penalty applied for recent speakers (≥2 of last 3 turns)', () => {
    // ceo spoke twice in last 3, cto spoke once → only ceo is fatigued
    const input: RelevanceInput = {
      messageText: 'Next steps?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: ['ceo', 'cto', 'ceo'],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ceoScore = scores.find((s) => s.persona === 'ceo');
    const ctoScore = scores.find((s) => s.persona === 'cto');
    const cooScore = scores.find((s) => s.persona === 'coo');
    expect(ceoScore?.fatigueScore).toBe(1.0);
    expect(ctoScore?.fatigueScore).toBe(0);
    expect(cooScore?.fatigueScore).toBe(0);
  });

  it('top-1 fallback when nothing passes threshold', () => {
    const input: RelevanceInput = {
      messageText: 'Hello',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS, {
      threshold: 0.99,
    });
    const selected = scores.filter((s) => s.selected);
    expect(selected).toHaveLength(1);
    // Top-1 is the first in sorted order
    expect(scores[0]?.selected).toBe(true);
  });

  it('one_on_one mode: only boundPersona selected', () => {
    const input: RelevanceInput = {
      messageText: 'What is our data strategy?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS, {
      roomKind: 'one_on_one',
      boundPersona: 'cdao',
    });
    const selected = scores.filter((s) => s.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.persona).toBe('cdao');
  });

  it('council mode: returns all 8 scores sorted desc', () => {
    const input: RelevanceInput = {
      messageText: 'Nothing here',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    expect(scores).toHaveLength(8);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]?.score).toBeGreaterThanOrEqual(
        scores[i]?.score ?? 0,
      );
    }
  });

  it('maxSelected caps the number of selected personas', () => {
    // Give multiple personas high scores via mention
    const input: RelevanceInput = {
      messageText:
        'This involves @ceo @cto @cmo @cfo @coo @chro @cso @cdao all of them',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS, {
      threshold: 0,
      maxSelected: 3,
    });
    const selected = scores.filter((s) => s.selected);
    expect(selected.length).toBeLessThanOrEqual(3);
  });

  it('bare name without @ → mentionScore 0 (not 0.8)', () => {
    // "Vulcan" is the CTO's name. Without @, should NOT score 0.8 — spec says 0.
    const input: RelevanceInput = {
      messageText: 'talk to Vulcan about the architecture',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, zeroDomainEmbeddings(), ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');
    expect(ctoScore?.mentionScore).toBe(0);
  });

  it('fatigue: once in last 3 → 0; twice in last 3 → 1.0', () => {
    // ceo spoke once in last 3 → fatigueScore 0
    const inputOnce: RelevanceInput = {
      messageText: 'next steps?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: ['cto', 'cfo', 'ceo'],
    };
    const scoresOnce = scorePersonas(
      inputOnce,
      zeroDomainEmbeddings(),
      ALL_PERSONAS,
    );
    expect(scoresOnce.find((s) => s.persona === 'ceo')?.fatigueScore).toBe(0);

    // ceo spoke twice in last 3 → fatigueScore 1.0
    const inputTwice: RelevanceInput = {
      messageText: 'next steps?',
      messageEmbedding: ZERO_VEC,
      recentSpeakers: ['ceo', 'cfo', 'ceo'],
    };
    const scoresTwice = scorePersonas(
      inputTwice,
      zeroDomainEmbeddings(),
      ALL_PERSONAS,
    );
    expect(scoresTwice.find((s) => s.persona === 'ceo')?.fatigueScore).toBe(
      1.0,
    );
  });

  it('expertise clamp: negative cosine → expertiseScore clamped to 0', () => {
    // cto domain embedding points in one direction; message embedding points opposite → cosine < 0
    // After clamping, expertiseScore must be 0, not negative.
    const ctoPersona = ALL_PERSONAS.find((p) => p.slug === 'cto');
    expect(ctoPersona).toBeDefined();

    const positiveVec = [1, 0, 0, 0, 0, 0, 0, 0];
    const oppositeVec = [-1, 0, 0, 0, 0, 0, 0, 0];

    const domainEmbeddings = zeroDomainEmbeddings();
    // Set cto domain to positive direction
    domainEmbeddings.set('cto', positiveVec);

    const input: RelevanceInput = {
      // message embedding points opposite → cosine similarity = -1
      messageText: 'unrelated',
      messageEmbedding: oppositeVec,
      recentSpeakers: [],
    };
    const scores = scorePersonas(input, domainEmbeddings, ALL_PERSONAS);
    const ctoScore = scores.find((s) => s.persona === 'cto');
    expect(ctoScore?.expertiseScore).toBeGreaterThanOrEqual(0);
    expect(ctoScore?.expertiseScore).toBe(0);
  });
});
