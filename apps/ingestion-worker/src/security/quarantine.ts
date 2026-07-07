import {
  CopyObjectCommand,
  DeleteObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'

export interface QuarantineOptions {
  stagingBucket: string
  quarantineBucket: string
  storageKey: string
  projectId: string
  fileId: string
}

/**
 * Moves a file from the staging bucket to the quarantine bucket.
 *
 * Uses S3 CopyObject + DeleteObject (two-phase move). If the copy succeeds
 * but the delete fails, the file will exist in both buckets. That is
 * acceptable — the quarantine bucket is authoritative, and the staging
 * object will be cleaned up by the lifecycle policy.
 */
export async function quarantineFile(s3: S3Client, opts: QuarantineOptions): Promise<void> {
  const { stagingBucket, quarantineBucket, storageKey, projectId, fileId } = opts

  const destKey = `${projectId}/${fileId}`
  const copySource = encodeURIComponent(`${stagingBucket}/${storageKey}`)

  await s3.send(
    new CopyObjectCommand({
      Bucket: quarantineBucket,
      CopySource: copySource,
      Key: destKey,
    }),
  )

  await s3.send(
    new DeleteObjectCommand({
      Bucket: stagingBucket,
      Key: storageKey,
    }),
  )
}
