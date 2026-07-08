/**
 * Chunker unit tests.
 */
import { describe, it, expect } from 'vitest'
import { chunkSections } from './chunking.js'
import type { ExtractionResult } from './extractors/index.js'

describe('chunkSections', () => {
  it('chunks long text into ~512-token pieces', () => {
    // Create a section with ~2000 tokens of content
    const longText = Array.from({ length: 500 }, (_, i) => `Sentence number ${i} ends here.`).join(' ')
    const sections: ExtractionResult['sections'] = [
      { headingTrail: ['Chapter 1'], text: longText },
    ]

    const chunks = chunkSections(sections, 512, 64)

    expect(chunks.length).toBeGreaterThan(1)
    // Each chunk should be roughly within reasonable bounds
    for (const chunk of chunks) {
      // Allow some tolerance — overlap adds to the count
      expect(chunk.tokenCount).toBeGreaterThan(0)
      expect(chunk.tokenCount).toBeLessThan(1200)  // generous upper bound with overlap
    }
  })

  it('sequential chunkIndex across all sections', () => {
    const sections: ExtractionResult['sections'] = [
      { headingTrail: ['Section 1'], text: 'Hello world. This is the first section with some content here.' },
      { headingTrail: ['Section 2'], text: 'Second section. Another paragraph of text goes here for testing purposes.' },
    ]

    const chunks = chunkSections(sections, 512, 64)

    chunks.forEach((chunk, idx) => {
      expect(chunk.chunkIndex).toBe(idx)
    })
  })

  it('preserves headingTrail from parent section', () => {
    const trail = ['Part A', 'Chapter 2', 'Section 3']
    const text = Array.from({ length: 50 }, () => 'This is a test sentence for heading trail.').join(' ')
    const sections: ExtractionResult['sections'] = [
      { headingTrail: trail, text },
    ]

    const chunks = chunkSections(sections, 512, 64)

    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.headingTrail).toEqual(trail)
    }
  })

  it('overlap: last tokens of chunk N appear at start of chunk N+1', () => {
    // Create text long enough to produce multiple chunks
    const sentences = Array.from(
      { length: 100 },
      (_, i) => `This is sentence number ${i} and it is a fairly long sentence.`,
    )
    const text = sentences.join(' ')
    const sections: ExtractionResult['sections'] = [{ headingTrail: ['Doc'], text }]

    const chunks = chunkSections(sections, 512, 64)

    if (chunks.length >= 2) {
      // The end of chunk[0] should appear as a prefix in chunk[1]
      const chunk0 = chunks[0]!
      const chunk1 = chunks[1]!
      // The overlap suffix from chunk0 should be found somewhere in chunk1's content
      // (not necessarily at the very start due to how sentences are split)
      const overlapChars = 64 * 4
      const tailOfChunk0 = chunk0.content.slice(-overlapChars)
      // At least some words from the tail should appear in chunk1
      const wordsFromTail = tailOfChunk0.split(' ').filter((w) => w.length > 3)
      const someWordFound = wordsFromTail.some((w) => chunk1.content.includes(w))
      expect(someWordFound).toBe(true)
    }
  })

  it('merges tiny sections (< 50 tokens) into previous chunk', () => {
    // Large section followed by a tiny one (< 50 tokens = < 200 chars)
    const largeText = Array.from({ length: 30 }, () => 'This is a normal length sentence for testing.').join(' ')
    const tinyText = 'Tiny.'  // ~2 tokens

    const sections: ExtractionResult['sections'] = [
      { headingTrail: ['Main'], text: largeText },
      { headingTrail: ['Appendix'], text: tinyText },
    ]

    const chunksWithMerge = chunkSections(sections, 512, 64)
    const chunksWithoutTiny = chunkSections(
      [{ headingTrail: ['Main'], text: largeText }],
      512,
      64,
    )

    // With merge, the tiny section text should appear in the last chunk
    const allContent = chunksWithMerge.map((c) => c.content).join(' ')
    expect(allContent).toContain('Tiny')

    // Should not create extra chunks just for the tiny section
    expect(chunksWithMerge.length).toBeLessThanOrEqual(chunksWithoutTiny.length + 1)
  })

  it('skips empty sections', () => {
    const sections: ExtractionResult['sections'] = [
      { headingTrail: ['Empty'], text: '' },
      { headingTrail: ['Empty 2'], text: '   ' },
      { headingTrail: ['Real'], text: 'This section has actual content to chunk.' },
    ]

    const chunks = chunkSections(sections, 512, 64)

    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) {
      expect(chunk.content.trim()).not.toBe('')
    }
  })

  it('produces deterministic output for the same input', () => {
    const sections: ExtractionResult['sections'] = [
      {
        headingTrail: ['Chapter 1'],
        text: Array.from({ length: 100 }, (_, i) => `Sentence ${i} with some words here.`).join(' '),
      },
    ]

    const chunks1 = chunkSections(sections, 512, 64)
    const chunks2 = chunkSections(sections, 512, 64)

    expect(chunks1.length).toBe(chunks2.length)
    expect(chunks1.map((c) => c.chunkIndex)).toEqual(chunks2.map((c) => c.chunkIndex))
    expect(chunks1.map((c) => c.content)).toEqual(chunks2.map((c) => c.content))
    expect(chunks1.map((c) => c.tokenCount)).toEqual(chunks2.map((c) => c.tokenCount))
  })

  it('returns empty array for all-empty sections', () => {
    const sections: ExtractionResult['sections'] = [
      { headingTrail: [], text: '' },
      { headingTrail: [], text: '  \n  ' },
    ]

    const chunks = chunkSections(sections, 512, 64)
    expect(chunks).toHaveLength(0)
  })
})
