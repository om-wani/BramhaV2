import { Module, Global } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { S3Client } from '@aws-sdk/client-s3'

export const S3_CLIENT = 'S3_CLIENT'
export const S3_BUCKET_STAGING = 'S3_BUCKET_STAGING'
export const S3_BUCKET_CLEAN = 'S3_BUCKET_CLEAN'
export const S3_BUCKET_QUARANTINE = 'S3_BUCKET_QUARANTINE'
export const S3_BUCKET_ARTIFACTS = 'S3_BUCKET_ARTIFACTS'

/**
 * Env var names match apps/ingestion-worker exactly (S3_ACCESS_KEY_ID /
 * S3_SECRET_ACCESS_KEY / S3_REGION, not AWS_*, and the 4 named buckets from
 * compose.dev.yml) — the API and ingestion worker share the same MinIO/S3
 * account and must agree on where objects actually live. Uploads go to
 * STAGING; only the security gate (ingestion worker) may promote an object
 * into CLEAN, after which it updates files.storage_key to match.
 */
function bucketProvider(token: string, envVar: string) {
  return {
    provide: token,
    inject: [ConfigService],
    useFactory: (config: ConfigService): string => config.getOrThrow<string>(envVar),
  }
}

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Client => {
        const region = config.get<string>('S3_REGION', 'us-east-1')
        const endpoint = config.get<string>('S3_ENDPOINT')
        return new S3Client({
          region,
          ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
          credentials: {
            accessKeyId: config.get<string>('S3_ACCESS_KEY_ID', ''),
            secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY', ''),
          },
        })
      },
    },
    bucketProvider(S3_BUCKET_STAGING, 'S3_BUCKET_STAGING'),
    bucketProvider(S3_BUCKET_CLEAN, 'S3_BUCKET_CLEAN'),
    bucketProvider(S3_BUCKET_QUARANTINE, 'S3_BUCKET_QUARANTINE'),
    bucketProvider(S3_BUCKET_ARTIFACTS, 'S3_BUCKET_ARTIFACTS'),
  ],
  exports: [S3_CLIENT, S3_BUCKET_STAGING, S3_BUCKET_CLEAN, S3_BUCKET_QUARANTINE, S3_BUCKET_ARTIFACTS],
})
export class S3Module {}
