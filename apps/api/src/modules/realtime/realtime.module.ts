import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { RealtimeGateway } from './realtime.gateway.js'
import { EventRelayService } from './event-relay.service.js'
import { SseController } from './sse.controller.js'
import { WsAuthGuard } from './ws-auth.guard.js'
import { RlsDbService } from '../common/db/rls-db.service.js'

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
