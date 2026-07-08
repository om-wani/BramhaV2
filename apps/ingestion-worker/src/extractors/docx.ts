/**
 * DOCX extractor — uses mammoth to extract text and heading structure.
 */
import mammoth from 'mammoth'
import type { ExtractionResult, ExtractionSection, Extractor } from './types.js'

export class DocxExtractor implements Extractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    // Extract HTML to capture heading structure
    const htmlResult = await mammoth.convertToHtml({ buffer })
    const html = htmlResult.value

    // Parse heading structure from HTML
    const sections = parseHtmlSections(html)

    const totalText = sections.map((s) => s.text).join('\n\n')
    return { sections, totalText }
  }
}

/**
 * Parse mammoth HTML output into sections keyed by heading trail.
 * Headings h1–h3 advance the current trail; body text accumulates into
 * the current section.
 */
function parseHtmlSections(html: string): ExtractionSection[] {
  const sections: ExtractionSection[] = []
  const headingTrail: string[] = []
  let currentText = ''

  // Extract all elements with a simple regex (not a full parser)
  const elementPattern = /<(h[1-3]|p|li)[^>]*>([\s\S]*?)<\/\1>/gi
  let match: RegExpExecArray | null

  while ((match = elementPattern.exec(html)) !== null) {
    const tag = match[1]?.toLowerCase() ?? ''
    const rawContent = match[2] ?? ''
    // Strip inner HTML tags
    const text = rawContent.replace(/<[^>]+>/g, '').trim()
    if (!text) continue

    if (tag === 'h1') {
      // Flush previous section
      if (currentText.trim()) {
        sections.push({ headingTrail: [...headingTrail], text: currentText.trim() })
        currentText = ''
      }
      headingTrail.length = 0
      headingTrail.push(text)
    } else if (tag === 'h2') {
      if (currentText.trim()) {
        sections.push({ headingTrail: [...headingTrail], text: currentText.trim() })
        currentText = ''
      }
      // Keep h1 if exists, replace h2 slot
      headingTrail.splice(1, headingTrail.length - 1, text)
    } else if (tag === 'h3') {
      if (currentText.trim()) {
        sections.push({ headingTrail: [...headingTrail], text: currentText.trim() })
        currentText = ''
      }
      headingTrail.splice(2, headingTrail.length - 2, text)
    } else {
      // Paragraph or list item — accumulate
      currentText += (currentText ? '\n' : '') + text
    }
  }

  // Flush remaining text
  if (currentText.trim()) {
    sections.push({
      headingTrail: headingTrail.length > 0 ? [...headingTrail] : ['Document'],
      text: currentText.trim(),
    })
  }

  // If no sections found (no heading structure), fall back to raw text extraction
  if (sections.length === 0) {
    const plainResult = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (plainResult) {
      sections.push({ headingTrail: ['Document'], text: plainResult })
    }
  }

  return sections
}
