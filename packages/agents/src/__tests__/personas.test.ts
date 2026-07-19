import { describe, it, expect } from 'vitest';
import { PERSONAS } from '../personas/index.js';
import type { PersonaSlug } from '@bramha/shared';

const ALL_SLUGS: PersonaSlug[] = [
  'ceo',
  'cto',
  'cmo',
  'cfo',
  'coo',
  'chro',
  'cso',
  'cdao',
];

describe('PERSONAS config', () => {
  it('has all 8 persona entries', () => {
    expect(Object.keys(PERSONAS)).toHaveLength(8);
    for (const slug of ALL_SLUGS) {
      expect(PERSONAS[slug]).toBeDefined();
    }
  });

  it('every persona has exactly 12 keywords', () => {
    for (const slug of ALL_SLUGS) {
      const persona = PERSONAS[slug];
      expect(persona.keywords, `${slug} should have 12 keywords`).toHaveLength(
        12,
      );
    }
  });

  it('every persona has non-empty required fields', () => {
    for (const slug of ALL_SLUGS) {
      const p = PERSONAS[slug];
      expect(p.slug).toBe(slug);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.domain.length).toBeGreaterThan(0);
      expect(p.voice.length).toBeGreaterThan(0);
      expect(p.accentToken.length).toBeGreaterThan(0);
    }
  });

  it('accent tokens match slugs', () => {
    for (const slug of ALL_SLUGS) {
      expect(PERSONAS[slug].accentToken).toBe(slug);
    }
  });

  it('has canonical persona names', () => {
    expect(PERSONAS.ceo.name).toBe('Astra');
    expect(PERSONAS.cto.name).toBe('Vulcan');
    expect(PERSONAS.cmo.name).toBe('Meridian');
    expect(PERSONAS.cfo.name).toBe('Ledger');
    expect(PERSONAS.coo.name).toBe('Lyra');
    expect(PERSONAS.chro.name).toBe('Iris');
    expect(PERSONAS.cso.name).toBe('Sage');
    expect(PERSONAS.cdao.name).toBe('Orion');
  });
});
