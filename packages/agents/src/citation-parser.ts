/**
 * Citation parser for P4.4.
 *
 * Parses [Source: {filename} #{n}] patterns from agent response text,
 * then validates them against the actual retrieved chunks (hallucination defense).
 */

import type { KnowledgeChunk, ValidatedCitation } from '@bramha/shared';

export interface ParsedCitation {
  filename: string;
  chunkIndex: number;
  raw: string; // the original "[Source: foo.pdf #3]" text
}

export type { ValidatedCitation };

// Regex: [Source: filename.ext #number] — filename must be at least one non-whitespace char
const CITATION_RE = /\[Source:\s*([^\]#\s][^\]#]*?)\s*#(\d+)\]/g;

export function parseCitations(text: string): ParsedCitation[] {
  const results: ParsedCitation[] = [];
  let match: RegExpExecArray | null;
  while ((match = CITATION_RE.exec(text)) !== null) {
    results.push({
      raw: match[0]!,
      filename: match[1]!.trim(),
      chunkIndex: parseInt(match[2]!, 10),
    });
  }
  // Reset lastIndex for re-use across calls
  CITATION_RE.lastIndex = 0;
  return results;
}

export function validateCitations(
  parsed: ParsedCitation[],
  chunks: KnowledgeChunk[],
): ValidatedCitation[] {
  return parsed.flatMap((p) => {
    // Match by filename and chunkIndex against actual retrieved chunks
    const chunk = chunks.find(
      (c) => c.filename === p.filename && c.chunkIndex === p.chunkIndex,
    );
    if (!chunk) return []; // hallucinated citation — drop it
    return [
      {
        filename: p.filename,
        chunkIndex: p.chunkIndex,
        excerpt: chunk.content.slice(0, 200),
        chunkId: chunk.id,
        fileId: chunk.fileId,
      },
    ];
  });
}
