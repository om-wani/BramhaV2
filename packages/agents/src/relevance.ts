import type { PersonaSlug } from '@bramha/shared';
import type { PersonaConfig } from './personas/index.js';
import type { ModelRouter } from './model-router.js';

export interface RelevanceInput {
  messageText: string;
  messageEmbedding: number[];
  recentSpeakers: PersonaSlug[];
}

export interface PersonaScore {
  persona: PersonaSlug;
  score: number;
  selected: boolean;
  mentionScore: number;
  expertiseScore: number;
  lexicalScore: number;
  fatigueScore: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0; // mismatched dims (e.g. model change) → safe zero

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function computeMentionScore(
  messageText: string,
  persona: PersonaConfig,
): number {
  const lower = messageText.toLowerCase();
  const slugMention = `@${persona.slug}`;
  const nameMention = `@${persona.name.toLowerCase()}`;
  const titlePattern = new RegExp(
    `\\b(ask the |the )?${persona.title.toLowerCase()}\\b`,
  );

  // Bare name match (e.g. "talk to Vulcan") scores 0.8 to avoid false positives
  // on short names; @-mention and title get full 1.0
  const bareNameMatch = lower.includes(persona.name.toLowerCase());

  if (
    lower.includes(slugMention) ||
    lower.includes(nameMention) ||
    titlePattern.test(lower)
  ) {
    return 1.0;
  }
  if (bareNameMatch) {
    return 0.8;
  }
  return 0;
}

function computeLexicalScore(
  messageText: string,
  keywords: string[],
): number {
  if (keywords.length === 0) return 0;
  const lower = messageText.toLowerCase();
  let matched = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      matched += 1;
    }
  }
  return matched / keywords.length;
}

function computeFatigueScore(
  persona: PersonaSlug,
  recentSpeakers: PersonaSlug[],
): number {
  const lastTwo = recentSpeakers.slice(-2);
  return lastTwo.includes(persona) ? 1.0 : 0;
}

export function scorePersonas(
  input: RelevanceInput,
  domainEmbeddings: Map<PersonaSlug, number[]>,
  personas: PersonaConfig[],
  options?: {
    threshold?: number;
    maxSelected?: number;
    roomKind?: 'council' | 'one_on_one';
    boundPersona?: PersonaSlug;
  },
): PersonaScore[] {
  const threshold = options?.threshold ?? 0.35;
  const maxSelected = options?.maxSelected ?? 4;
  const roomKind = options?.roomKind ?? 'council';
  const boundPersona = options?.boundPersona;

  const scores: PersonaScore[] = personas.map((persona) => {
    const mentionScore = computeMentionScore(input.messageText, persona);
    const domainEmbedding = domainEmbeddings.get(persona.slug) ?? [];
    const expertiseScore = cosineSimilarity(
      input.messageEmbedding,
      domainEmbedding,
    );
    const lexicalScore = computeLexicalScore(
      input.messageText,
      persona.keywords,
    );
    const fatigueScore = computeFatigueScore(
      persona.slug,
      input.recentSpeakers,
    );

    const score =
      0.4 * mentionScore +
      0.3 * expertiseScore +
      0.2 * lexicalScore -
      0.1 * fatigueScore;

    return {
      persona: persona.slug,
      score,
      selected: false,
      mentionScore,
      expertiseScore,
      lexicalScore,
      fatigueScore,
    };
  });

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  if (roomKind === 'one_on_one' && boundPersona !== undefined) {
    for (const s of scores) {
      s.selected = s.persona === boundPersona;
    }
    return scores;
  }

  // Council mode: select personas that pass threshold, up to maxSelected
  const passing = scores.filter((s) => s.score >= threshold);

  if (passing.length === 0) {
    // Fallback: top-1
    const top = scores[0];
    if (top !== undefined) {
      top.selected = true;
    }
  } else {
    const toSelect = passing.slice(0, maxSelected);
    for (const s of toSelect) {
      s.selected = true;
    }
  }

  return scores;
}

export async function computeDomainEmbeddings(
  personas: PersonaConfig[],
  router: ModelRouter,
): Promise<Map<PersonaSlug, number[]>> {
  const texts = personas.map((p) => p.domain);
  const embeddings = await router.embed(texts);
  const map = new Map<PersonaSlug, number[]>();
  for (let i = 0; i < personas.length; i++) {
    const persona = personas[i];
    const embedding = embeddings[i];
    if (persona !== undefined && embedding !== undefined) {
      map.set(persona.slug, embedding);
    }
  }
  return map;
}
