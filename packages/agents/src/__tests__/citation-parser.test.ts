import { describe, it, expect } from 'vitest';
import { parseCitations, validateCitations } from '../citation-parser.js';
import type { KnowledgeChunk } from '@bramha/shared';

// Minimal KnowledgeChunk factory
function makeChunk(overrides: Partial<KnowledgeChunk> = {}): KnowledgeChunk {
  return {
    id: 'chunk-1',
    fileId: 'file-1',
    chunkIndex: 0,
    content: 'Default content of the chunk for testing purposes.',
    filename: 'report.pdf',
    score: 0.9,
    ...overrides,
  };
}

describe('parseCitations', () => {
  it('parses single citation', () => {
    const result = parseCitations('See [Source: report.pdf #3] for details.');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: 'report.pdf',
      chunkIndex: 3,
      raw: '[Source: report.pdf #3]',
    });
  });

  it('parses multiple citations', () => {
    const result = parseCitations(
      'Ref [Source: a.pdf #1] and also [Source: b.docx #7].',
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ filename: 'a.pdf', chunkIndex: 1 });
    expect(result[1]).toMatchObject({ filename: 'b.docx', chunkIndex: 7 });
  });

  it('ignores malformed patterns', () => {
    const result = parseCitations(
      'No match here: [Source: missing-hash], [source: lowercase #1], [Source: #3]',
    );
    expect(result).toHaveLength(0);
  });

  it('handles empty string', () => {
    expect(parseCitations('')).toHaveLength(0);
  });
});

describe('validateCitations', () => {
  it('keeps citations matching real chunks', () => {
    const chunk = makeChunk({ filename: 'report.pdf', chunkIndex: 3, id: 'c1', fileId: 'f1', content: 'Actual chunk text here.' });
    const parsed = parseCitations('[Source: report.pdf #3]');
    const result = validateCitations(parsed, [chunk]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      filename: 'report.pdf',
      chunkIndex: 3,
      chunkId: 'c1',
      fileId: 'f1',
    });
  });

  it('drops hallucinated citations (no matching chunk)', () => {
    const chunk = makeChunk({ filename: 'real.pdf', chunkIndex: 0 });
    const parsed = parseCitations('[Source: fake.pdf #99]');
    const result = validateCitations(parsed, [chunk]);
    expect(result).toHaveLength(0);
  });

  it('uses excerpt from chunk content (first 200 chars)', () => {
    const longContent = 'A'.repeat(300);
    const chunk = makeChunk({ filename: 'doc.pdf', chunkIndex: 0, content: longContent });
    const parsed = parseCitations('[Source: doc.pdf #0]');
    const result = validateCitations(parsed, [chunk]);
    expect(result).toHaveLength(1);
    expect(result[0]!.excerpt).toHaveLength(200);
    expect(result[0]!.excerpt).toBe('A'.repeat(200));
  });
});
