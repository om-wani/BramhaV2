/**
 * Code extractor — regex-based function/class detection.
 *
 * Splits source code by top-level function and class declarations.
 * Full tree-sitter integration comes in T3.1.1.
 */
import type { ExtractionResult, ExtractionSection, Extractor } from './types.js'

/**
 * Matches the start of a new top-level declaration.
 * Pattern kept simple (no alternation groups with quantifiers) to avoid ReDoS.
 *
 * Captures:
 *   group 1 — function name (TS/JS/Python def)
 *   group 2 — class name (TS/JS/Python class)
 */
// eslint-disable-next-line security/detect-unsafe-regex
const TOP_LEVEL_DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?class\s+(\w+)|^def\s+(\w+)|^class\s+(\w+)\s*[:(]/

export class CodeExtractor implements Extractor {
  async extract(buffer: Buffer, fileName: string): Promise<ExtractionResult> {
    const content = buffer.toString('utf8')
    const sections = splitByDeclarations(content, fileName)
    const totalText = sections.map((s) => s.text).join('\n\n')
    return { sections, totalText }
  }
}

function splitByDeclarations(content: string, fileName: string): ExtractionSection[] {
  const lines = content.split('\n')
  const sections: ExtractionSection[] = []
  let currentName = 'module'
  let currentLines: string[] = []

  function flush() {
    const text = currentLines.join('\n').trim()
    if (text) {
      sections.push({ headingTrail: [fileName, currentName], text })
    }
    currentLines = []
  }

  for (const line of lines) {
    const match = TOP_LEVEL_DECL.exec(line)
    if (match && !line.startsWith(' ') && !line.startsWith('\t')) {
      flush()
      currentName = match[1] ?? match[2] ?? match[3] ?? match[4] ?? 'unknown'
    }
    currentLines.push(line)
  }

  flush()

  if (sections.length === 0 && content.trim()) {
    sections.push({ headingTrail: [fileName], text: content.trim() })
  }

  return sections
}
