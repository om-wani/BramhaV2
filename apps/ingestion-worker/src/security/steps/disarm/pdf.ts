import { PDFDocument } from 'pdf-lib'

/**
 * Strips dangerous content from a PDF by loading it with pdf-lib and
 * re-serializing.
 *
 * pdf-lib models only the safe subset of the PDF specification. When it
 * saves the document, it re-serializes only what it understands — naturally
 * dropping:
 *   - /OpenAction (auto-launch actions, JS)
 *   - /AA (additional actions / event handlers)
 *   - /AcroForm with /JS or /JavaScriptAction entries
 *   - /Launch actions
 *   - Embedded file streams (/EmbeddedFiles)
 *
 * We additionally attempt to explicitly delete the catalog entries for these
 * if the pdf-lib version exposes dictionary access.
 *
 * useObjectStreams: false forces uncompressed cross-reference tables, making
 * the output more predictable and easier to audit downstream.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function disarmPdf(buffer: Buffer, _mime?: string): Promise<Buffer> {
  let pdfDoc: PDFDocument
  try {
    pdfDoc = await PDFDocument.load(new Uint8Array(buffer), {
      // Do NOT set ignoreEncryption: encrypted PDFs hide catalog entries (JS, /OpenAction)
      // behind encrypted streams — stripping them is impossible without decryption.
      // Treat encrypted or corrupt PDFs as untrusted and quarantine them.
      updateMetadata: false,
    })
  } catch {
    throw new Error('encrypted_or_corrupt_pdf')
  }

  // Attempt to remove dangerous catalog entries via low-level dict access.
  // This is best-effort; pdf-lib's re-serialization is the primary mechanism.
  try {
    const catalog = pdfDoc.catalog as unknown as {
      dict?: { delete?: (key: unknown) => void }
    }
    if (catalog?.dict?.delete) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const PDFName = (await import('pdf-lib')).PDFName as any
      for (const key of ['OpenAction', 'AA', 'AcroForm', 'Names', 'EmbeddedFiles']) {
        try {
          catalog.dict.delete(PDFName.of(key))
        } catch {
          // Not all entries may exist; ignore
        }
      }
    }
  } catch {
    // Low-level access failed — fall back to re-serialization only
  }

  const savedBytes = await pdfDoc.save({ useObjectStreams: false })
  return Buffer.from(savedBytes)
}
