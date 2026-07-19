import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OrgsService } from './orgs.service.js';
import { OrgsController } from './orgs.controller.js';

@Module({
  imports: [AuthModule],
  providers: [OrgsService],
  controllers: [OrgsController],
  exports: [OrgsService],
})
export class OrgsModule {}
