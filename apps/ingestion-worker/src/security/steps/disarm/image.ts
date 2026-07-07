import sharp from 'sharp'

/**
 * Re-encodes an image via sharp, stripping all EXIF metadata, embedded
 * thumbnails, ICC profiles, and any steganographic content in unused bytes.
 *
 * Output format is determined by the declared MIME type:
 *   image/jpeg  → JPEG (quality 85)
 *   image/png   → PNG
 *   image/webp  → WebP
 *
 * Sharp strips metadata by default unless .withMetadata() is called.
 */
export async function disarmImage(buffer: Buffer, mime: string): Promise<Buffer> {
  const img = sharp(buffer)

  switch (mime) {
    case 'image/jpeg':
      return img.jpeg({ quality: 85, progressive: false }).toBuffer()
    case 'image/png':
      return img.png({ compressionLevel: 6 }).toBuffer()
    case 'image/webp':
      return img.webp({ quality: 85 }).toBuffer()
    default:
      // Fallback: run through sharp without specifying format — strips metadata
      return img.toBuffer()
  }
}
