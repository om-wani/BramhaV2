import { Module, Global, Injectable, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

export const REDIS_CLIENT = 'REDIS_CLIENT'

/**
 * Wrapper that holds the ioredis client and disconnects gracefully on shutdown.
 * NestJS calls onModuleDestroy() during app.close() / SIGTERM handling.
 */
@Injectable()
class RedisService implements OnModuleDestroy {
  readonly client: Redis

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6379'))
  }

  onModuleDestroy() {
    return this.client.quit()
  }
}

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: REDIS_CLIENT,
      inject: [RedisService],
      useFactory: (svc: RedisService) => svc.client,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
