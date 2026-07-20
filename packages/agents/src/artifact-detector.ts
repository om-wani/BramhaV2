export interface Artifact {
  type: 'html';
  content: string; // the full HTML string
}

/**
 * Extract HTML artifact from agent response content.
 * Looks for a code block with html tag or DOCTYPE declaration.
 * Returns the FIRST artifact found, or null if none.
 */
export function detectArtifact(content: string): Artifact | null {
  // Match ```html ... ``` code blocks
  const fencedHtml = content.match(/```html\s*\n([\s\S]*?)```/i);
  if (fencedHtml && fencedHtml[1]) {
    return { type: 'html', content: fencedHtml[1].trim() };
  }

  // Match standalone <!DOCTYPE html> or <html> (full document not in code block)
  if (/<!DOCTYPE\s+html/i.test(content) || /^<html/im.test(content)) {
    // Extract from first < to last >
    const start = content.search(/<(!DOCTYPE\s+html|html)/i);
    if (start !== -1) {
      const end = content.lastIndexOf('</html>');
      const slice = end !== -1 ? content.slice(start, end + 7) : content.slice(start);
      return { type: 'html', content: slice.trim() };
    }
  }

  return null;
}
