import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { RealtimeGateway } from './realtime.gateway'
import { EventRelayService } from './event-relay.service'
import { SseController } from './sse.controller'
import { WsAuthGuard } from './ws-auth.guard'
import { RlsDbService } from '../common/db/rls-db.service'

@Module({
  imports: [AuthModule],
  providers: [
    RealtimeGateway,
    EventRelayService,
    WsAuthGuard,
    RlsDbService,
  ],
  controllers: [SseController],
  exports: [EventRelayService],
})
export class RealtimeModule {}
