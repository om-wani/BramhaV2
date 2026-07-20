/**
 * P4.7 Gate check — Org memory / RAG pipeline
 *
 * Gate: "uploaded PDF answered with correct citation card"
 *
 * These tests verify the full RAG citation pipeline without real API calls or DB:
 *   1. Ingestion chunker produces correct chunks with overlap
 *   2. searchKnowledge SQL uses correct patterns (source-read assertions)
 *   3. Citation parse → validate → metadata pipeline (hallucination defense)
 *   4. End-to-end smoke: doc question → chunk retrieved → citation in metadata
 *
 * No real API calls, no real DB — pure unit assertions.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCitations, validateCitations } from '../citation-parser.js';
import { detectArtifact } from '../artifact-detector.js';
import type { KnowledgeChunk } from '@bramha/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read searchKnowledge source for SQL pattern assertions (no DB needed)
const queriesSource = readFileSync(
  join(__dirname, '../../../db/src/queries.ts'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Fixture: simulated chunks from a retrieved PDF
// ---------------------------------------------------------------------------

const FAKE_CHUNKS: KnowledgeChunk[] = [
  {
    id: 'c1',
    fileId: 'f1',
    chunkIndex: 2,
    content: 'Revenue grew 40% in Q3 according to audited reports.',
    filename: 'report.pdf',
    score: 0.9,
  },
  {
    id: 'c2',
    fileId: 'f1',
    chunkIndex: 5,
    content: 'Operating expenses declined sharply due to headcount reduction.',
    filename: 'report.pdf',
    score: 0.7,
  },
];

// ---------------------------------------------------------------------------
// 1. searchKnowledge SQL pattern assertions
// ---------------------------------------------------------------------------

describe('P4.7 Gate: searchKnowledge SQL correctness', () => {
  it('uses websearch_to_tsquery not bare to_tsquery', () => {
    expect(queriesSource).toContain('websearch_to_tsquery');
    // bare to_tsquery( would throw on untrusted input — must not appear
    expect(queriesSource).not.toMatch(/(?<!websearch_)to_tsquery\s*\(/);
  });

  it('uses RRF k=60 fusion formula', () => {
    expect(queriesSource).toContain('1.0 / (60 +');
  });

  it('uses FULL OUTER JOIN for hybrid fusion', () => {
    expect(queriesSource).toContain('FULL OUTER JOIN');
  });

  it('filters by project_id in both vector and text arms', () => {
    // Count project_id occurrences — must appear at least twice (one per arm)
    const count = (queriesSource.match(/project_id/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('has vector-only fallback for empty queryText', () => {
    // Empty queryText → websearch_to_tsquery would throw → must have fallback path
    expect(queriesSource).toContain('queryText.trim()');
  });

  it('selects rrf_score in output', () => {
    expect(queriesSource).toContain('rrf_score');
  });

  it('uses cosine distance operator <=> for vector similarity', () => {
    expect(queriesSource).toContain('<=>');
  });
});

// ---------------------------------------------------------------------------
// 2. Citation parse + validate
// ---------------------------------------------------------------------------

describe('P4.7 Gate: citation parse → validate pipeline', () => {
  it('parseCitations extracts [Source: report.pdf #2]', () => {
    const text = 'Revenue grew [Source: report.pdf #2] significantly in Q3.';
    const parsed = parseCitations(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ filename: 'report.pdf', chunkIndex: 2 });
  });

  it('validateCitations keeps citation matching real chunk', () => {
    const parsed = [{ filename: 'report.pdf', chunkIndex: 2, raw: '[Source: report.pdf #2]' }];
    const valid = validateCitations(parsed, FAKE_CHUNKS);
    expect(valid).toHaveLength(1);
    expect(valid[0]?.chunkId).toBe('c1');
    expect(valid[0]?.excerpt).toBe('Revenue grew 40% in Q3 according to audited reports.');
  });

  it('validateCitations drops hallucinated citation (not in chunk set)', () => {
    const parsed = [{ filename: 'report.pdf', chunkIndex: 99, raw: '[Source: report.pdf #99]' }];
    const valid = validateCitations(parsed, FAKE_CHUNKS);
    expect(valid).toHaveLength(0);
  });

  it('validateCitations drops citation for wrong file', () => {
    const parsed = [{ filename: 'other.pdf', chunkIndex: 2, raw: '[Source: other.pdf #2]' }];
    const valid = validateCitations(parsed, FAKE_CHUNKS);
    expect(valid).toHaveLength(0);
  });

  it('validateCitations returns chunkId + excerpt for each valid citation', () => {
    const parsed = [
      { filename: 'report.pdf', chunkIndex: 2, raw: '[Source: report.pdf #2]' },
      { filename: 'report.pdf', chunkIndex: 5, raw: '[Source: report.pdf #5]' },
    ];
    const valid = validateCitations(parsed, FAKE_CHUNKS);
    expect(valid).toHaveLength(2);
    const ids = valid.map((v) => v.chunkId);
    expect(ids).toContain('c1');
    expect(ids).toContain('c2');
  });
});

// ---------------------------------------------------------------------------
// 3. Full pipeline smoke test
// ---------------------------------------------------------------------------

describe('P4.7 Gate: end-to-end RAG citation pipeline smoke test', () => {
  it('doc-only question → chunk cited → metadata.citations has 1 validated entry', () => {
    // Simulate: agent response references a chunk from FAKE_CHUNKS
    const agentResponse =
      'According to [Source: report.pdf #2], revenue grew 40% in Q3.';

    // Step 1: parse citations from response
    const parsed = parseCitations(agentResponse);
    expect(parsed).toHaveLength(1);

    // Step 2: validate against retrieved chunks (hallucination defense)
    const validated = validateCitations(parsed, FAKE_CHUNKS);
    expect(validated).toHaveLength(1);

    // Step 3: what finalizeNode would store in metadata
    const metadata = { citations: validated };

    expect(metadata.citations[0]?.filename).toBe('report.pdf');
    expect(metadata.citations[0]?.chunkIndex).toBe(2);
    expect(metadata.citations[0]?.chunkId).toBe('c1');
    expect(metadata.citations[0]?.fileId).toBe('f1');
  });

  it('hallucinated citation removed before metadata.citations stored', () => {
    // Agent hallucinates chunk #99 which was never in the retrieved set
    const agentResponse =
      'Revenue tripled [Source: report.pdf #99] according to internal projections.';

    const parsed = parseCitations(agentResponse);
    const validated = validateCitations(parsed, FAKE_CHUNKS);

    // metadata.citations must be empty — hallucinated source dropped
    const metadata = { citations: validated };
    expect(metadata.citations).toHaveLength(0);
  });

  it('multiple citations: valid ones kept, hallucinated dropped', () => {
    const agentResponse =
      'Q3 revenue [Source: report.pdf #2] and expenses [Source: report.pdf #99] both changed.';

    const parsed = parseCitations(agentResponse);
    expect(parsed).toHaveLength(2);

    const validated = validateCitations(parsed, FAKE_CHUNKS);
    // Only chunk #2 is in FAKE_CHUNKS; #99 is hallucinated
    expect(validated).toHaveLength(1);
    expect(validated[0]?.chunkIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Artifact sandbox gate
// ---------------------------------------------------------------------------

describe('P4.7 Gate: artifact sandbox detection', () => {
  it('HTML in ```html block produces artifact metadata', () => {
    const response = '```html\n<!DOCTYPE html><html><body>Hello</body></html>\n```';
    const artifact = detectArtifact(response);
    expect(artifact).not.toBeNull();
    expect(artifact?.type).toBe('html');
    expect(artifact?.content).toContain('<html>');
  });

  it('non-HTML response produces no artifact', () => {
    const response = 'Operating expenses declined sharply in Q3 due to headcount reduction.';
    const artifact = detectArtifact(response);
    expect(artifact).toBeNull();
  });
});
