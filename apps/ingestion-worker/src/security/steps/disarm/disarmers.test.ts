/**
 * Unit tests for the per-type disarmer functions.
 *
 * Tests run against the real disarmer implementations (no mocks for the
 * disarmers themselves) to catch regressions in the actual sanitization logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── PDF: /OpenAction stripped ─────────────────────────────────────────────────

describe('PDF disarmer', () => {
  it('strips /OpenAction from PDF catalog', async () => {
    const { PDFDocument, PDFName } = await import('pdf-lib')
    const { disarmPdf } = await import('./pdf.js')

    // Build a minimal PDF with a JavaScript OpenAction in the catalog
    const pdfDoc = await PDFDocument.create()
    pdfDoc.addPage()

    // Access the catalog dict to inject a dangerous /OpenAction entry.
    // pdf-lib's PDFCatalog exposes a dict property on the underlying object.
    const catalog = pdfDoc.catalog as unknown as {
      dict?: {
        set?: (key: unknown, val: unknown) => void
        has?: (key: unknown) => boolean
        delete?: (key: unknown) => void
      }
    }
    if (catalog?.dict?.set) {
      catalog.dict.set(
        PDFName.of('OpenAction'),
        pdfDoc.context.obj({ S: 'JavaScript', JS: 'app.alert("pwned")' }),
      )
    }

    const pdfBytes = await pdfDoc.save()
    const disarmed = await disarmPdf(Buffer.from(pdfBytes))
    const disarmedDoc = await PDFDocument.load(new Uint8Array(disarmed))

    const disarmedCatalog = disarmedDoc.catalog as unknown as {
      dict?: { has?: (key: unknown) => boolean }
    }
    // /OpenAction must be absent from the re-serialized catalog
    expect(disarmedCatalog?.dict?.has?.(PDFName.of('OpenAction'))).toBeFalsy()
  })

  it('throws encrypted_or_corrupt_pdf for an invalid PDF buffer', async () => {
    const { disarmPdf } = await import('./pdf.js')
    const garbage = Buffer.from('this is not a pdf at all %%FAKE')
    await expect(disarmPdf(garbage)).rejects.toThrow('encrypted_or_corrupt_pdf')
  })
})

// ── ZIP bomb: throws ZipBombError ─────────────────────────────────────────────

describe('ZIP disarmer', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects zip bomb (compression ratio > 100×)', async () => {
    // Use vi.mock to inject synthetic yauzl entries with uncompressedSize >> compressedSize.
    // This avoids constructing a real ZIP with huge compressed data in tests.
    vi.mock('yauzl', () => {
      return {
        default: {
          fromBuffer: (
            _buf: Buffer,
            _opts: unknown,
            callback: (err: Error | null, zipFile: unknown) => void,
          ) => {
            const emitter = {
              listeners: {} as Record<string, ((...args: unknown[]) => void)[]>,
              on(event: string, handler: (...args: unknown[]) => void) {
                this.listeners[event] = this.listeners[event] ?? []
                this.listeners[event]!.push(handler)
                return this
              },
              emit(event: string, ...args: unknown[]) {
                for (const h of this.listeners[event] ?? []) h(...args)
              },
              readEntry() {
                // Emit one entry with 200 MB uncompressed but only 100 bytes compressed
                process.nextTick(() => {
                  this.emit('entry', {
                    fileName: 'bomb.txt',
                    uncompressedSize: 200_000_000,
                    compressedSize: 100,
                  })
                })
              },
              close() {},
            }
            process.nextTick(() => callback(null, emitter))
          },
        },
      }
    })

    const { disarmZip } = await import('./zip.js')
    const fakeZip = Buffer.alloc(100) // actual bytes don't matter — yauzl is mocked
    // Use toMatchObject on error name to avoid class-identity issues after vi.resetModules()
    await expect(disarmZip(fakeZip)).rejects.toMatchObject({ name: 'ZipBombError' })
  })
})

// ── SVG: event handlers and external hrefs stripped ───────────────────────────

describe('SVG disarmer', () => {
  it('strips onload handler from SVG', async () => {
    const { disarmSvg } = await import('./svg.js')

    const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect/></svg>'
    const result = await disarmSvg(Buffer.from(maliciousSvg))
    const output = result.toString()

    expect(output).not.toContain('onload')
    expect(output).not.toContain('alert')
  })

  it('strips external href from SVG use element (SSRF prevention)', async () => {
    const { disarmSvg } = await import('./svg.js')

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<use href="https://evil.com/x.svg#id"/>' +
      '</svg>'
    const result = await disarmSvg(Buffer.from(svg))

    expect(result.toString()).not.toContain('https://evil.com')
  })

  it('strips script tags from SVG', async () => {
    const { disarmSvg } = await import('./svg.js')

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg">' +
      '<script>alert(1)</script>' +
      '<rect/>' +
      '</svg>'
    const result = await disarmSvg(Buffer.from(svg))
    const output = result.toString()

    expect(output).not.toContain('<script>')
    expect(output).not.toContain('alert')
  })
})
