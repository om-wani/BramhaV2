/**
 * Heading-aware semantic chunker.
 *
 * Splits sections into chunks of ~512 tokens with 64-token overlap.
 * Chunks inherit their section's headingTrail.
 * Tiny sections (< 50 tokens) are merged into the previous chunk.
 */
import { estimateTokenCount } from '@bramha/agents'
import type { ExtractionResult } from './extractors/index.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Chunk {
  chunkIndex: number
  headingTrail: string[]
  content: string
  tokenCount: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TARGET_TOKENS = 512
const DEFAULT_OVERLAP_TOKENS = 64
const MIN_CHUNK_TOKENS = 50

// ── Sentence splitter ─────────────────────────────────────────────────────────

/**
 * Split text into sentences at sentence-ending punctuation.
 * Preserves the delimiter as part of the preceding sentence.
 */
function splitSentences(text: string): string[] {
  // Split on '. ', '! ', '? ', or end-of-string after punctuation
  const raw = text.split(/(?<=[.!?])\s+/)
  return raw.flatMap((s) => {
    const trimmed = s.trim()
    return trimmed ? [trimmed] : []
  })
}

// ── Overlap helper ────────────────────────────────────────────────────────────

/**
 * Return the last N tokens (approximately) from a string.
 * Used to create the overlap prefix for the next chunk.
 */
function overlapSuffix(text: string, overlapTokens: number): string {
  // 4 chars per token estimate
  const chars = overlapTokens * 4
  if (text.length <= chars) return text
  // Try to break at a word boundary
  const slice = text.slice(text.length - chars)
  const firstSpace = slice.indexOf(' ')
  return firstSpace > 0 ? slice.slice(firstSpace + 1) : slice
}

// ── Core chunking logic ───────────────────────────────────────────────────────

/**
 * Chunk a single section's text into token-bounded pieces.
 *
 * @returns Partial chunks (without chunkIndex) for later sequential indexing.
 */
function chunkText(
  text: string,
  headingTrail: string[],
  targetTokens: number,
  overlapTokens: number,
): Array<{ headingTrail: string[]; content: string; tokenCount: number }> {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return []

  const chunks: Array<{ headingTrail: string[]; content: string; tokenCount: number }> = []
  let currentSentences: string[] = []
  let currentTokens = 0
  let overlapPrefix = ''

  function flush() {
    if (currentSentences.length === 0) return
    const content = (overlapPrefix ? overlapPrefix + ' ' : '') + currentSentences.join(' ')
    const tokenCount = estimateTokenCount(content)
    chunks.push({ headingTrail, content, tokenCount })

    // Prepare overlap for next chunk
    overlapPrefix = overlapSuffix(currentSentences.join(' '), overlapTokens)
    currentSentences = []
    currentTokens = 0
  }

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokenCount(sentence)

    if (currentTokens + sentenceTokens > targetTokens && currentSentences.length > 0) {
      flush()
    }

    currentSentences.push(sentence)
    currentTokens += sentenceTokens
  }

  // Flush remaining
  if (currentSentences.length > 0) {
    const content = (overlapPrefix ? overlapPrefix + ' ' : '') + currentSentences.join(' ')
    const tokenCount = estimateTokenCount(content)
    chunks.push({ headingTrail, content, tokenCount })
  }

  return chunks
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Chunk all sections from an extraction result into token-bounded pieces.
 *
 * - Sections < MIN_CHUNK_TOKENS are merged into the previous chunk (if any).
 * - Empty sections are skipped.
 * - Chunks are indexed sequentially across all sections.
 */
export function chunkSections(
  sections: ExtractionResult['sections'],
  targetTokens: number = DEFAULT_TARGET_TOKENS,
  overlapTokens: number = DEFAULT_OVERLAP_TOKENS,
): Chunk[] {
  const rawChunks: Array<{ headingTrail: string[]; content: string; tokenCount: number }> = []

  for (const section of sections) {
    const text = section.text.trim()
    if (!text) continue

    const sectionChunks = chunkText(text, section.headingTrail, targetTokens, overlapTokens)

    for (const chunk of sectionChunks) {
      if (chunk.tokenCount < MIN_CHUNK_TOKENS && rawChunks.length > 0) {
        // Merge tiny chunk into previous
        const prev = rawChunks[rawChunks.length - 1]!
        prev.content = prev.content + '\n' + chunk.content
        prev.tokenCount = estimateTokenCount(prev.content)
      } else {
        rawChunks.push(chunk)
      }
    }
  }

  // Assign sequential chunk indices
  return rawChunks.map((chunk, idx) => ({
    chunkIndex: idx,
    headingTrail: chunk.headingTrail,
    content: chunk.content,
    tokenCount: chunk.tokenCount,
  }))
}
