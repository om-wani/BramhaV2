import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'

export interface PromoteOptions {
  cleanBucket: string
  cleanKey: string
  buffer: Buffer
  contentType: string
}

/**
 * Writes a disarmed file to the clean bucket (PutObject only).
 *
 * Intentionally does NOT delete from staging. Callers must call
 * deleteFromStaging() separately, AFTER the DB status has been committed
 * to 'clean'. This ordering guarantees that if a crash occurs between
 * the PutObject and the staging delete, the DB reflects the correct state
 * and a retry cannot succeed without re-uploading the disarmed content.
 *
 * Uses PutObject (not CopyObject) so the stored bytes are the sanitized
 * version, not the original staging file.
 */
export async function promoteFile(s3: S3Client, opts: PromoteOptions): Promise<void> {
  const { cleanBucket, cleanKey, buffer, contentType } = opts

  await s3.send(
    new PutObjectCommand({
      Bucket: cleanBucket,
      Key: cleanKey,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length,
    }),
  )
}

/**
 * Deletes the original file from staging storage.
 *
 * Call this AFTER the DB status has been committed to 'clean' and the
 * disarmed file is safely in the clean bucket. If this call fails, the
 * stale staging object is harmless — a background cleanup job can remove it.
 */
export async function deleteFromStaging(
  s3: S3Client,
  stagingBucket: string,
  storageKey: string,
): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: stagingBucket,
      Key: storageKey,
    }),
  )
}
