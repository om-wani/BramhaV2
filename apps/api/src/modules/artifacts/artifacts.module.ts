import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { S3Module } from '../common/s3/s3.module.js'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard.js'
import { ArtifactsService } from './artifacts.service.js'
import { ArtifactsController } from './artifacts.controller.js'

@Module({
  imports: [AuthModule, S3Module],
  controllers: [ArtifactsController],
  providers: [ArtifactsService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
