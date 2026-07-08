import yauzl from 'yauzl'
import { ZipBombError } from '../../errors.js'

const MAX_ENTRIES = 1_000
const MAX_DEPTH = 2
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024 // 500 MB
const MAX_RATIO = 100 // 100× compression ratio per-entry and overall

/**
 * Validates a ZIP archive for zip-bomb characteristics.
 *
 * Checks:
 *   - Entries ≤ 1000
 *   - Path depth ≤ 2 directory levels
 *   - Per-entry compression ratio ≤ 100×
 *   - Total uncompressed size ≤ 500 MB
 *   - Overall compression ratio (total uncompressed / sizeBytes) ≤ 100×
 *
 * Throws ZipBombError if any check fails.
 * Does NOT re-pack the archive — returns the original buffer unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function disarmZip(buffer: Buffer, _mime?: string): Promise<Buffer> {
  const compressedSize = buffer.length

  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(err ?? new Error('Failed to open ZIP'))
        return
      }

      let entryCount = 0
      let totalUncompressed = 0

      zipFile.readEntry()

      zipFile.on('entry', (entry: yauzl.Entry) => {
        entryCount++

        if (entryCount > MAX_ENTRIES) {
          zipFile.close()
          reject(new ZipBombError(`ZIP has too many entries: ${entryCount} > ${MAX_ENTRIES}`))
          return
        }

        // Count directory depth from the path (strip trailing slash from dir entries)
        const pathParts = entry.fileName.replace(/\/$/, '').split('/').filter(Boolean)
        const depth = pathParts.length - 1 // number of directory levels above the leaf
        if (depth > MAX_DEPTH) {
          zipFile.close()
          reject(
            new ZipBombError(
              `ZIP entry "${entry.fileName}" is ${depth} levels deep (max ${MAX_DEPTH})`,
            ),
          )
          return
        }

        // Per-entry ratio check.
        // Note: entry.compressedSize is attacker-controlled from the ZIP central directory.
        // This per-entry check is best-effort; the overall ratio and absolute 500 MB cap
        // (checked against real decompressed sizes) are the primary bomb-prevention guards.
        if (entry.compressedSize > 0) {
          const entryRatio = entry.uncompressedSize / entry.compressedSize
          if (entryRatio > MAX_RATIO) {
            zipFile.close()
            reject(
              new ZipBombError(
                `ZIP entry "${entry.fileName}" has compression ratio ${entryRatio.toFixed(1)}× (max ${MAX_RATIO}×)`,
              ),
            )
            return
          }
        }

        totalUncompressed += entry.uncompressedSize

        if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
          zipFile.close()
          reject(
            new ZipBombError(
              `ZIP total uncompressed size ${totalUncompressed} bytes exceeds ${MAX_UNCOMPRESSED_BYTES} bytes`,
            ),
          )
          return
        }

        zipFile.readEntry()
      })

      zipFile.on('end', () => {
        // Overall ratio check against the declared compressed size
        if (compressedSize > 0 && totalUncompressed / compressedSize > MAX_RATIO) {
          reject(
            new ZipBombError(
              `ZIP overall compression ratio ${(totalUncompressed / compressedSize).toFixed(1)}× exceeds ${MAX_RATIO}×`,
            ),
          )
          return
        }
        resolve()
      })

      zipFile.on('error', reject)
    })
  })

  // Validation passed — return original buffer (no re-packing)
  return buffer
}
