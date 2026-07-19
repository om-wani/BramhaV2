import { Module } from '@nestjs/common';
import { AuthModule } from '../modules/auth/auth.module.js';
import { EventsGateway } from './events.gateway.js';

@Module({
  imports: [AuthModule],
  providers: [EventsGateway],
})
export class GatewayModule {}
