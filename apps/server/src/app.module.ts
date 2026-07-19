import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrgsModule } from './modules/orgs/orgs.module.js';

@Module({ imports: [HealthModule, AuthModule, OrgsModule] })
export class AppModule {}
