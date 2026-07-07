import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { S3Module } from '../common/s3/s3.module'
import { ProjectViewerGuard, ProjectEditorGuard } from '../common/guards/project-member.guard'
import { ArtifactsService } from './artifacts.service'
import { ArtifactsController } from './artifacts.controller'

@Module({
  imports: [AuthModule, S3Module],
  controllers: [ArtifactsController],
  providers: [ArtifactsService, ProjectViewerGuard, ProjectEditorGuard],
  exports: [ArtifactsService],
})
export class ArtifactsModule {}
