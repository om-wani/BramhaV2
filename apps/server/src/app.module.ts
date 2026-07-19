import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OrgsModule } from './modules/orgs/orgs.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';

@Module({ imports: [HealthModule, AuthModule, OrgsModule, ProjectsModule] })
export class AppModule {}
