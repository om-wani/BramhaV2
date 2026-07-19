import { describe, it, expect } from 'vitest';
import { PERSONA_SLUGS, PERSONA_META } from '../personas.js';

describe('personas', () => {
  it('exports exactly 8 slugs', () => {
    expect(PERSONA_SLUGS).toHaveLength(8);
  });

  it('contains all expected slugs', () => {
    const expected = ['ceo', 'cto', 'cmo', 'cfo', 'coo', 'chro', 'cso', 'cdao'];
    for (const slug of expected) {
      expect(PERSONA_SLUGS).toContain(slug);
    }
  });

  it('PERSONA_META has an entry for every slug', () => {
    for (const slug of PERSONA_SLUGS) {
      expect(PERSONA_META[slug]).toBeDefined();
      expect(PERSONA_META[slug].slug).toBe(slug);
    }
  });

  it('every entry has non-empty name, title and domain', () => {
    for (const slug of PERSONA_SLUGS) {
      const meta = PERSONA_META[slug];
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.domain.length).toBeGreaterThan(0);
    }
  });

  it('has the correct canonical persona names', () => {
    expect(PERSONA_META.ceo.name).toBe('Astra');
    expect(PERSONA_META.cto.name).toBe('Vulcan');
    expect(PERSONA_META.cmo.name).toBe('Meridian');
    expect(PERSONA_META.cfo.name).toBe('Ledger');
    expect(PERSONA_META.coo.name).toBe('Lyra');
    expect(PERSONA_META.chro.name).toBe('Iris');
    expect(PERSONA_META.cso.name).toBe('Sage');
    expect(PERSONA_META.cdao.name).toBe('Orion');
  });
});
