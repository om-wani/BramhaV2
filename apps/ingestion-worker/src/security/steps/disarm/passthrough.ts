/**
 * Passthrough disarmer — returns the buffer unchanged.
 *
 * Used for file types that are trusted after the magic-byte and ClamAV checks
 * and do not have an active disarm path:
 *   - text/plain
 *   - text/markdown
 *   - audio/mpeg (mp3)
 *   - video/mp4
 *   - application/vnd.openxmlformats-officedocument.wordprocessingml.document (docx)
 *   - application/vnd.openxmlformats-officedocument.spreadsheetml.sheet (xlsx)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function passthroughDisarm(buffer: Buffer, _mime?: string): Promise<Buffer> {
  return buffer
}
