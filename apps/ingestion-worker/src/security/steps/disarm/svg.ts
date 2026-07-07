import { JSDOM } from 'jsdom'
import createDOMPurify from 'dompurify'

/**
 * Sanitizes an SVG using DOMPurify + jsdom:
 *   - Removes all <script> elements
 *   - Removes event handler attributes (onload, onerror, onclick, …)
 *   - Removes javascript: URIs
 *   - Removes <object>, <embed>, <link>, <base> elements
 *
 * Returns the sanitized SVG as a UTF-8 Buffer.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function disarmSvg(buffer: Buffer, _mime?: string): Promise<Buffer> {
  const svgString = buffer.toString('utf-8')

  const { window } = new JSDOM('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DOMPurify = createDOMPurify(window as any)

  const clean = DOMPurify.sanitize(svgString, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'object', 'embed', 'link', 'base'],
    FORBID_ATTR: [
      'onload',
      'onerror',
      'onclick',
      'onmouseover',
      'onmouseout',
      'onmousemove',
      'onfocus',
      'onblur',
      'onkeydown',
      'onkeyup',
      'onkeypress',
    ],
    FORCE_BODY: false,
  })

  return Buffer.from(clean, 'utf-8')
}
