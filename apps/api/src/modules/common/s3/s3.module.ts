import { Module, Global } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { S3Client } from '@aws-sdk/client-s3'

export const S3_CLIENT = 'S3_CLIENT'
export const S3_BUCKET = 'S3_BUCKET'

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Client => {
        const region = config.get<string>('AWS_REGION', 'us-east-1')
        const endpoint = config.get<string>('S3_ENDPOINT')
        return new S3Client({
          region,
          ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
          credentials: {
            accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID', ''),
            secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY', ''),
          },
        })
      },
    },
    {
      provide: S3_BUCKET,
      inject: [ConfigService],
      useFactory: (config: ConfigService): string =>
        config.get<string>('S3_BUCKET', 'bramha-artifacts'),
    },
  ],
  exports: [S3_CLIENT, S3_BUCKET],
})
export class S3Module {}
