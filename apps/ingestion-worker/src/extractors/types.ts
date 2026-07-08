/**
 * Shared types for text extractors.
 */

export interface ExtractionSection {
  /** Breadcrumb path of headings that this section falls under. */
  headingTrail: string[]
  /** Extracted text content. */
  text: string
}

export interface ExtractionResult {
  /** Ordered sections with heading metadata. */
  sections: ExtractionSection[]
  /** Concatenation of all section text (convenience for token estimation). */
  totalText: string
}

export interface Extractor {
  extract(buffer: Buffer, fileName: string, declaredMime: string): Promise<ExtractionResult>
}
