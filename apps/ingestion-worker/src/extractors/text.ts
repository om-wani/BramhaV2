/**
 * Text / Markdown extractor.
 *
 * For plain text: splits by blank lines into paragraphs, groups under
 * any Markdown headings encountered.
 *
 * For Markdown: parses ATX headings (##, ###, ####) to build heading trail.
 */
import type { ExtractionResult, ExtractionSection, Extractor } from './types.js'

export class TextExtractor implements Extractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const raw = buffer.toString('utf8')
    const sections = parseMarkdownSections(raw)
    const totalText = sections.map((s) => s.text).join('\n\n')
    return { sections, totalText }
  }
}

function parseMarkdownSections(text: string): ExtractionSection[] {
  const lines = text.split('\n')
  const sections: ExtractionSection[] = []
  const headingTrail: string[] = []
  let paragraphBuffer: string[] = []

  function flushParagraph() {
    const content = paragraphBuffer.join('\n').trim()
    if (content) {
      sections.push({
        headingTrail: headingTrail.length > 0 ? [...headingTrail] : ['Content'],
        text: content,
      })
    }
    paragraphBuffer = []
  }

  for (const line of lines) {
    const h1Match = /^# (.+)/.exec(line)
    const h2Match = /^## (.+)/.exec(line)
    const h3Match = /^### (.+)/.exec(line)
    const h4Match = /^#### (.+)/.exec(line)

    if (h1Match ?? h2Match ?? h3Match ?? h4Match) {
      flushParagraph()
      if (h1Match) {
        headingTrail.length = 0
        headingTrail.push(h1Match[1]!.trim())
      } else if (h2Match) {
        headingTrail.splice(1, headingTrail.length - 1, h2Match[1]!.trim())
      } else if (h3Match) {
        headingTrail.splice(2, headingTrail.length - 2, h3Match[1]!.trim())
      } else if (h4Match) {
        headingTrail.splice(3, headingTrail.length - 3, h4Match[1]!.trim())
      }
    } else if (line.trim() === '') {
      // Blank line: end of paragraph
      flushParagraph()
    } else {
      paragraphBuffer.push(line)
    }
  }

  flushParagraph()

  if (sections.length === 0 && text.trim()) {
    sections.push({ headingTrail: ['Content'], text: text.trim() })
  }

  return sections
}
