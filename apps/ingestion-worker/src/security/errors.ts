/**
 * Thrown when the ClamAV daemon is unreachable.
 * BullMQ must NOT ack the job — it retries with exponential backoff
 * until the scanner is back. Never bypass or swallow this error.
 */
export class ClamAvDownError extends Error {
  override readonly name = 'ClamAvDownError'

  constructor(cause: unknown) {
    super('ClamAV daemon is unreachable')
    this.cause = cause
  }
}

/**
 * Thrown by the zip disarmer when archive structure indicates a bomb:
 * - compression ratio > 100×
 * - depth > 2 levels
 * - entries > 1000
 * - total uncompressed > 500 MB
 */
export class ZipBombError extends Error {
  override readonly name = 'ZipBombError'

  constructor(message: string) {
    super(message)
  }
}

/**
 * Thrown by a disarmer when it cannot safely process the file.
 */
export class DisarmError extends Error {
  override readonly name = 'DisarmError'

  constructor(
    message: string,
    public readonly step: string,
  ) {
    super(message)
  }
}
