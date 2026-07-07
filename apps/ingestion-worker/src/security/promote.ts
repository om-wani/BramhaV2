import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'

export interface PromoteOptions {
  stagingBucket: string
  cleanBucket: string
  storageKey: string
  cleanKey: string
  buffer: Buffer
  contentType: string
}

/**
 * Promotes a disarmed file to the clean bucket.
 *
 * Writes the disarmed buffer via PutObject (rather than CopyObject) so that
 * the stored bytes are guaranteed to be the sanitized version, not the
 * original staging file. Then deletes from staging.
 */
export async function promoteFile(s3: S3Client, opts: PromoteOptions): Promise<void> {
  const { stagingBucket, cleanBucket, storageKey, cleanKey, buffer, contentType } = opts

  await s3.send(
    new PutObjectCommand({
      Bucket: cleanBucket,
      Key: cleanKey,
      Body: buffer,
      ContentType: contentType,
      ContentLength: buffer.length,
    }),
  )

  await s3.send(
    new DeleteObjectCommand({
      Bucket: stagingBucket,
      Key: storageKey,
    }),
  )
}
